// LLM 大脑：通过通道调用真实模型。引擎给的仍是匿名论点板；这里只是把它渲染成提示词、解析结构化输出。
// 每次调用（含失败和重试）都交给 onCall 记录：提示词、原始输出、模型、档位映射、用量、耗时。
import { z } from 'zod';
import { aliases, renderBoard } from '@crux/engine';
import type { ActOut, BoardView, Brains, CruxOut, DraftOut, Evidence, FighterSpec, FinalOut, MatchState, RuleInput, RulingOut, Tokens } from '@crux/engine';
import type { Channel, ChannelResult, Effort, ErrorKind, Task } from './channel.ts';
import { SYSTEM_CHAIR, SYSTEM_FIGHTER, SYSTEM_JUDGE, actPrompt, cruxPrompt, draftPrompt, finalPrompt, roundRulePrompt, rulePrompt } from './prompts.ts';

export interface Seat { channel: Channel; model: string; effort: Effort }

export interface CallRecord {
  n: number;
  role: string;                      // 选手编号，或 judge / chair
  task: Task;
  attempt: number;
  channel: string;
  model: string;                     // 实际使用的模型（含档位后缀）
  effort: Effort;
  ok: boolean;
  error?: { kind: ErrorKind; message: string };
  usage?: { in: number; out: number; cached: number; estimated: boolean };
  ms: number;
  system: string;
  prompt: string;
  output?: string;
}

export interface LlmBrainsOptions {
  seats: Record<string, Seat>;       // 选手编号 → 座位
  judge: Seat;
  chair: Seat;
  state: () => MatchState;           // 用来取论点全文、动作细节（仍然匿名化）
  context?: string;                  // 共享背景材料（带行号）
  /** 核对文件证据：引擎用只读工具读原文比对，不信模型自报 */
  verify?: (e: Evidence) => Promise<{ ok: boolean; note: string }>;
  onCall?: (c: CallRecord) => void;
  /** 交锋阶段要不要再给选手背景材料（省 token 时关掉） */
  contextInAct?: boolean;
  /** 立场视角：按出场顺序轮流分配；不传就不分 */
  lenses?: readonly string[];
  /** 选手盲答前可以请求读文件（只读工具，带审计）；返回带行号的原文或错误说明 */
  read?: (actor: string, ref: string) => Promise<string>;
}

/* ---------- 输出解析：宽松接收，再交给引擎的合规检查兜底 ---------- */

const LABELS: Record<string, 'fact' | 'inference' | 'speculation'> = { fact: 'fact', 事实: 'fact', inference: 'inference', 推断: 'inference', 推理: 'inference', speculation: 'speculation', 猜测: 'speculation' };
const label = z.string().transform(s => LABELS[s.trim().toLowerCase()] ?? 'inference');
const str = z.string().catch('');
const ids = z.array(z.string()).catch([]);

const DraftJson = z.object({
  need: z.array(z.string()).nullish(),
  answer: str.optional(),
  claim: z.object({ text: z.string().min(1), short: z.string().min(1), label: label.catch('inference') }).nullish(),
}).refine(v => v.claim || v.need?.length, '需要 claim（或者先用 need 请求文件）');
const ActJson = z.object({
  actions: z.array(z.object({
    kind: z.enum(['attack', 'defend', 'concede', 'shift']),
    target: z.string(),
    why: str,
    steelman: z.string().nullish(),
    detail: z.string().nullish(),
    evidence: z.array(z.object({ kind: z.literal('file'), ref: z.string().min(1), quote: z.string().nullish() })).catch([]).nullish(),
    causedBy: ids.nullish(),
    shiftTo: z.string().nullish(),
  })).max(3),
});
const CruxJson = z.object({
  merges: z.array(z.object({ from: z.string(), into: z.string() })).catch([]),
  clash: ids, consensus: ids, why: str,
  stances: z.record(z.string(), z.string()).catch({}),
});
const RuleJson = z.object({ verdict: z.enum(['upheld', 'partial', 'rejected']), text: str, evidenceRelevant: z.boolean().catch(true) });
const RoundRuleJson = z.object({ rulings: z.array(RuleJson.extend({ id: z.string() })) });
const FinalJson = z.object({ answer: z.string().min(1), minority: ids, userCruxes: ids, confidence: z.number().min(0).max(1).catch(0.6) });

/** 从模型输出里取出 JSON 对象：容忍代码块包裹和前后多余文字 */
export function extractJson(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, '');
  // 先试最外层的 { … }；不行再从每个 { 起按括号配对（跳过字符串里的括号）找第一个能解析的对象
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('输出里没有 JSON 对象');
  let first: unknown;
  try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { first = e; }
  for (let start = a; start >= 0; start = t.indexOf('{', start + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < t.length; i++) {
      const ch = t[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        try { return JSON.parse(t.slice(start, i + 1)); } catch { break; }
      }
    }
  }
  throw first;
}

const ZERO: Tokens = { in: 0, out: 0 };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class LlmBrains implements Brains {
  private n = 0;
  private answers = new Map<string, string>();   // 选手编号 → 盲答全文（主席综合时用，匿名化后给出）
  private extra = new Map<string, string>();     // 选手编号 → 他自己请求读过的原文（交锋时继续给他）
  private o: LlmBrainsOptions;
  constructor(o: LlmBrainsOptions) { this.o = { ...o }; }

  /** 侦察完成后设置共享背景材料 */
  setContext(text: string) { this.o.context = text; }

  /** 调一次并解析；限流 / 故障重试，输出不合格式时带着错误提示重试一次。所有尝试的 token 都计入 */
  private async ask<T>(role: string, seat: Seat, task: Task, system: string, prompt: string, schema: z.ZodType<T>): Promise<{ value?: T; tokens: Tokens }> {
    let tokens = ZERO, p = prompt, badOutput = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r: ChannelResult = await seat.channel.call({ task, model: seat.model, effort: seat.effort, system, prompt: p });
      const rec: CallRecord = { n: ++this.n, role, task, attempt, channel: seat.channel.id, model: r.model, effort: seat.effort, ok: r.ok, ms: r.ms, system, prompt: p };
      if (r.ok) {
        tokens = { in: tokens.in + r.usage.in, out: tokens.out + r.usage.out };
        rec.usage = r.usage; rec.output = r.text;
        let error: string | undefined;
        try {
          const parsed = schema.safeParse(extractJson(r.text));
          if (parsed.success) { this.o.onCall?.(rec); return { value: parsed.data, tokens }; }
          error = parsed.error.issues.slice(0, 3).map(i => `${i.path.join('.') || '根'}：${i.message}`).join('；');
        } catch (e) { error = (e as Error).message; }
        rec.ok = false; rec.error = { kind: 'bad_output', message: error };
        this.o.onCall?.(rec);
        if (badOutput) break;
        badOutput = true;
        p = `${prompt}\n\n上一次输出无法解析（${error}）。只输出一个符合格式的 JSON 对象。`;
        continue;
      }
      rec.error = { kind: r.error.kind, message: r.error.message };
      this.o.onCall?.(rec);
      // 额度用尽、未登录、拒答不重试（PLAN §6.5）
      if (r.error.kind !== 'rate_limit' && r.error.kind !== 'unavailable') break;
      await sleep(r.error.retryAfterMs ?? 3000 * attempt);
    }
    return { tokens };
  }

  private seat(id: string) {
    const s = this.o.seats[id];
    if (!s) throw new Error(`选手 ${id} 没有配置通道`);
    return s;
  }

  async draft(f: FighterSpec, question: string): Promise<DraftOut> {
    const order = this.o.state().start?.fighters.findIndex(x => x.id === f.id) ?? 0;
    const lens = this.o.lenses?.length ? this.o.lenses[Math.max(0, order) % this.o.lenses.length] : undefined;
    const base = { question, context: this.o.context, lens };
    let { value, tokens } = await this.ask(f.id, this.seat(f.id), 'draft', SYSTEM_FIGHTER, draftPrompt({ ...base, canRead: !!this.o.read }), DraftJson);
    // 先请求读文件：引擎用只读工具读出原文（带审计、屏蔽敏感文件），再让他作答一次
    if (value && !value.claim && value.need?.length && this.o.read) {
      const got = await Promise.all(value.need.slice(0, 3).map(ref => this.o.read!(f.id, ref)));
      this.extra.set(f.id, got.join('\n\n'));
      const again = await this.ask(f.id, this.seat(f.id), 'draft', SYSTEM_FIGHTER, draftPrompt({ ...base, extra: this.extra.get(f.id) }), DraftJson);
      tokens = { in: tokens.in + again.tokens.in, out: tokens.out + again.tokens.out };
      value = again.value;
    }
    if (!value?.claim) return { answer: '', claims: [], tokens };
    this.answers.set(f.id, value.answer ?? '');
    return { answer: value.answer ?? '', claims: [value.claim], tokens };
  }

  async act(f: FighterSpec, view: BoardView, feedback?: string[]): Promise<ActOut> {
    const s = this.o.state();
    const alias = aliases(s);
    const me = s.start?.fighters.find(x => x.id === f.id);
    const teammates = me?.team ? s.start!.fighters.filter(x => x.team === me.team && x.id !== f.id).map(x => alias.get(x.id) ?? x.id) : undefined;
    const prompt = actPrompt({ board: renderBoard(view), context: this.o.contextInAct ? this.o.context : undefined, extra: this.extra.get(f.id), ownAnswer: this.answers.get(f.id), teammates, feedback });
    const { value, tokens } = await this.ask(f.id, this.seat(f.id), 'act', SYSTEM_FIGHTER, prompt, ActJson);
    const actions = (value?.actions ?? []).map(a => ({
      kind: a.kind, target: a.target, why: a.why,
      ...(a.steelman ? { steelman: a.steelman } : {}),
      detail: a.detail ?? '',
      evidence: (a.evidence ?? []).map(e => ({ kind: 'file' as const, ref: e.ref, ...(e.quote ? { quote: e.quote } : {}) })),
      causedBy: a.causedBy ?? [],
      ...(a.shiftTo ? { shiftTo: a.shiftTo } : {}),
    }));
    return { actions, tokens };
  }

  async crux(view: BoardView): Promise<CruxOut> {
    const s = this.o.state();
    const alias = aliases(s);
    const claims = s.order.filter(id => s.claims[id]).map(id => {
      const c = s.claims[id];
      return `- ${id}（${alias.get(c.owner)}，${c.label}）：${c.text}`;
    });
    const { value, tokens } = await this.ask('judge', this.o.judge, 'crux', SYSTEM_JUDGE, cruxPrompt(view.question, claims), CruxJson);
    if (!value) {
      // 裁判失败：不合并，全部论点进入交锋，各自站自己的论点
      return { clash: view.claims.map(c => c.id), consensus: [], merges: [], stances: {}, why: '裁判未能提取分歧，全部论点进入交锋', tokens };
    }
    return { clash: value.clash, consensus: value.consensus, merges: value.merges, stances: value.stances, why: value.why, tokens };
  }

  /** 把一步动作写成给裁判看的文字，并由引擎核对证据原文 */
  private async describe(a: RuleInput) {
    const s = this.o.state();
    const alias = aliases(s);
    const c = s.claims[a.target];
    const checks = await Promise.all(a.evidence.map(async e => (this.o.verify ? this.o.verify(e) : { ok: false, note: `${e.ref}：无法核对` })));
    const kind = { attack: '攻击', defend: '辩护', concede: '放弃', shift: '改投' }[a.kind];
    return {
      action: `${a.id} ${a.actor} ${kind} ${a.target}。理由：${a.why}${a.steelman ? `。对方最强理由：${a.steelman}` : ''}${a.detail ? `。展开：${a.detail}` : ''}`,
      target: c ? `${c.id}（${alias.get(c.owner)}）${c.text}` : a.target,
      evidence: checks.length ? checks.map(x => `${x.ok ? '✓' : '✗'} ${x.note}`).join('；') : '无证据',
      verified: checks.length > 0 && checks.every(x => x.ok),
    };
  }

  async rule(a: RuleInput, view: BoardView): Promise<RulingOut> {
    const d = await this.describe(a);
    const { value, tokens } = await this.ask('judge', this.o.judge, 'rule', SYSTEM_JUDGE, rulePrompt({ question: view.question, target: d.target, action: d.action, evidence: d.evidence }), RuleJson);
    if (!value) return { verdict: 'partial', text: '裁判缺席，按部分成立', evidenceOk: false, tokens };
    return { verdict: value.verdict, text: value.text, evidenceOk: d.verified && value.evidenceRelevant, tokens };
  }

  /** 一回合一次裁决：省掉大部分裁判调用，裁判也能把同一张卡上的攻和守放在一起看 */
  async ruleRound(actions: RuleInput[], view: BoardView) {
    const ds = await Promise.all(actions.map(a => this.describe(a)));
    const items = ds.map(d => `- ${d.action}
  针对：${d.target}
  证据核对：${d.evidence}`);
    const { value, tokens } = await this.ask('judge', this.o.judge, 'rule', SYSTEM_JUDGE, roundRulePrompt({ question: view.question, items }), RoundRuleJson);
    const byId = new Map((value?.rulings ?? []).map(r => [r.id, r]));
    const rulings = actions.map((a, i) => {
      const r = byId.get(a.id);
      if (!r) return { verdict: 'partial' as const, text: '裁判漏判，按部分成立', evidenceOk: false };
      return { verdict: r.verdict, text: r.text, evidenceOk: ds[i].verified && r.evidenceRelevant };
    });
    return { rulings, tokens };
  }

  async final(view: BoardView): Promise<FinalOut> {
    const s = this.o.state();
    const alias = aliases(s);
    const lines: string[] = ['最终论点板：'];
    for (const id of s.order) {
      const c = s.claims[id];
      if (!c || c.status === 'merged') continue;
      lines.push(`- ${id} [${c.status === 'ko' ? '出局' : `${c.hp}HP`}] 支持者 ${c.supporters.map(x => alias.get(x)).join(',')}：${c.text}`);
      const ans = this.answers.get(c.owner);
      if (ans && c.status === 'alive') lines.push(`  作者盲答：${ans}`);
    }
    if (view.consensus.length) lines.push(`共识：${view.consensus.join('；')}`);
    const key = Object.values(s.actions).filter(a => a.ruling && a.ruling.verdict !== 'rejected');
    if (key.length) {
      lines.push('成立的交锋：');
      for (const a of key) lines.push(`- ${a.id} ${alias.get(a.actor)} ${a.kind === 'attack' ? '攻' : '守'} ${a.target}：${a.why}${a.detail ? ` —— ${a.detail}` : ''}（${a.ruling!.verdict}）`);
    }
    const changes = Object.values(s.actions).filter(a => a.kind === 'concede' || a.kind === 'shift');
    if (changes.length) {
      lines.push('立场变化：');
      for (const a of changes) lines.push(`- ${a.id} ${alias.get(a.actor)} ${a.kind === 'concede' ? '放弃' : '改投'} ${a.target}${a.shiftTo ? ` → ${a.shiftTo}` : ''}（因为 ${a.causedBy.join(',') || '未说明'}）：${a.why}`);
    }
    const { value, tokens } = await this.ask('chair', this.o.chair, 'final', SYSTEM_CHAIR, finalPrompt({ question: view.question, board: lines.join('\n') }), FinalJson);
    if (!value) {
      const best = view.claims.filter(c => c.status === 'alive').sort((a, b) => b.hp - a.hp || b.supporters.length - a.supporters.length)[0];
      return { answer: best ? `（主席缺席，按血量取最高论点）${s.claims[best.id]?.text ?? best.short}` : '（主席缺席，未能综合答案）', minority: [], userCruxes: [], confidence: 0.3, tokens };
    }
    return { ...value, tokens };
  }
}

