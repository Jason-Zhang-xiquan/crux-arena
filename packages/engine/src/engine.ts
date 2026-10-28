// 比赛状态机：ROUND 0 盲答 → 分歧提取 → 交锋（≤ maxRounds）→ 收敛 → 冠军答案。
// 引擎只产出事件；状态全部由 state.ts 从事件推导。
import { randomUUID } from 'node:crypto';
import type { ActionDraft, Brains } from './brains.ts';
import type { EventInput, FighterSpec, MatchEvent, Tokens } from './schema.ts';
import { MatchEvent as MatchEventSchema, sumTokens } from './schema.ts';
import { RULING_LIMIT, WHY_LIMIT, clampText, score } from './rules.ts';
import { aliveClash, apply, initialState, stanceOf } from './state.ts';
import type { MatchState } from './state.ts';
import { checkAction } from './validate.ts';
import type { RoundUsage } from './validate.ts';
import { aliases, boardView } from './view.ts';

export interface MatchConfig {
  matchId?: string;
  question: string;
  mode?: 'ffa' | 'team';
  fighters: FighterSpec[];
  judge: string;
  chair: string;
  budget?: number;                   // token 上限，用完直接进入冠军答案
  maxRounds?: number;
  workspace?: { root: string };
  price?: (tokens: number) => number;
  /** match_started 之后、盲答之前调用：文件夹模式在这里做侦察（仓库地图等），审计会进入事件流 */
  onStart?: () => Promise<void>;
}

export type Sink = (e: MatchEvent) => void | Promise<void>;
export interface ToolAudit { actor: string; tool: string; input: Record<string, unknown>; ok: boolean; bytes: number; note?: string }

/** 事件记录器：校验 schema、编号、推导状态、按顺序写给 sink（如 events.jsonl） */
export function createRecorder(opts: { now?: () => number; sink?: Sink } = {}) {
  const events: MatchEvent[] = [];
  const state: MatchState = initialState();
  const now = opts.now ?? Date.now;
  let t0: number | undefined;
  let chain: Promise<void> = Promise.resolve();
  const emit = (input: EventInput): MatchEvent => {
    t0 ??= now();
    const e = MatchEventSchema.parse({ ...input, seq: events.length, t: Math.max(0, now() - t0) });
    events.push(e);
    apply(state, e);
    if (opts.sink) { const sink = opts.sink; chain = chain.then(() => sink(e)); }
    return e;
  };
  return {
    events, state, emit,
    /** 文件夹工具的审计回调：每次只读调用变成一条 tool_call 事件 */
    tool: (a: ToolAudit) => { emit({ type: 'tool_call', ...a }); },
    flush: () => chain,
  };
}
export type Recorder = ReturnType<typeof createRecorder>;

const ZERO: Tokens = { in: 0, out: 0 };
const addTokens = (a: Tokens, b: Tokens): Tokens => ({ in: a.in + b.in, out: a.out + b.out });
const ROUND_COST_PER_FIGHTER = 2500;   // 还没有实测数据时，用来估算"省下多少"
const FINAL_RESERVE = 0.15;            // 整场预算留给冠军答案的比例（PLAN §6.4）

export async function runMatch(cfg: MatchConfig, brains: Brains, rec: Recorder = createRecorder()): Promise<Recorder> {
  const { emit, state: s } = rec;
  const mode = cfg.mode ?? 'ffa';
  const maxRounds = cfg.maxRounds ?? 3;
  const budget = cfg.budget ?? 60_000;
  const fighters = cfg.fighters.map((f, i) => (mode === 'team' ? { ...f, team: f.team ?? (i % 2 ? 'blue' as const : 'red' as const) } : f));
  const nameOf = (id: string) => fighters.find(f => f.id === id)?.name ?? id;

  emit({
    type: 'match_started', matchId: cfg.matchId ?? randomUUID().slice(0, 8), question: cfg.question, mode, fighters,
    judge: cfg.judge, chair: cfg.chair, budget, maxRounds, ...(cfg.workspace ? { workspace: cfg.workspace } : {}),
  });

  await cfg.onStart?.();

  // ROUND 0：盲答。并行调用，互相看不到。
  emit({ type: 'round_started', round: 0 });
  const drafts = await Promise.all(fighters.map(f => brains.draft(f, cfg.question)));
  let claimNo = 0;
  drafts.forEach((d, i) => {
    if (!d.claims.length) { emit({ type: 'flag', kind: 'invalid_action', actor: fighters[i].id, note: '盲答没有给出任何论点', tokens: d.tokens }); return; }
    d.claims.forEach((c, j) => {
      const short = clampText(c.short, WHY_LIMIT);
      emit({ type: 'claim', id: `C${++claimNo}`, actor: fighters[i].id, text: c.text, short: short.text, label: c.label, tokens: j === 0 ? d.tokens : ZERO });
    });
  });

  // 分歧提取：裁判只看匿名论点板
  const unalias = new Map([...aliases(s)].map(([id, a]) => [a, id]));
  const cx = await brains.crux(boardView(s));
  emit({
    type: 'crux',
    clash: cx.clash.filter(id => s.claims[id]),
    consensus: cx.consensus,
    merges: cx.merges.filter(m => s.claims[m.from] && s.claims[m.into] && m.from !== m.into),
    why: clampText(cx.why, 40).text,
    tokens: cx.tokens,
  });
  for (const [a, claim] of Object.entries(cx.stances)) {
    const who = unalias.get(a);
    const c = s.claims[claim];
    if (who && c?.status === 'alive' && !c.supporters.includes(who)) emit({ type: 'second', actor: who, target: claim, why: `立场归入 ${claim}` });
  }

  let lastRoundTokens = fighters.length * ROUND_COST_PER_FIGHTER;
  if (aliveClash(s).length <= 1) {
    emit({ type: 'converged', round: 0, reason: 'flawless', savedTokens: maxRounds * lastRoundTokens });
  } else {
    let actionNo = 0;
    for (let round = 1; round <= maxRounds; round++) {
      // 预算不够打完整一回合就不开新回合（按上一回合的实际花费估算），并给冠军答案留 15%
      if (s.tokens + lastRoundTokens > budget * (1 - FINAL_RESERVE)) break;
      emit({ type: 'round_started', round });
      const before = s.tokens;
      let progressed = false;

      // 稀疏化：第 2 回合起，和已出场选手立场完全相同的人轮空
      const active: FighterSpec[] = [];
      const stances = new Map<string, string>();
      const avgAct = Math.round(lastRoundTokens / fighters.length);
      for (const f of fighters) {
        const st = stanceOf(s, f.id).join(',');
        if (round >= 2 && st && stances.has(st)) {
          emit({ type: 'skip', round, actor: f.id, reason: `立场与 ${nameOf(stances.get(st)!)} 重合，轮空`, savedTokens: avgAct });
          continue;
        }
        if (st) stances.set(st, f.id);
        active.push(f);
      }

      for (const f of active) {
        if (s.tokens >= budget * (1 - FINAL_RESERVE)) break;   // 回合中途也守住冠军答案的预留
        let out = await brains.act(f, boardView(s, f.id));
        let spent = out.tokens;
        const problems = (list: ActionDraft[]) => {
          const used: RoundUsage = { attack: false, defend: false };
          return list.flatMap(a => {
            const r = checkAction(s, f.id, a, used);
            if (a.kind === 'attack') used.attack = true;
            if (a.kind === 'defend') used.defend = true;
            return r.errors.map(e => `${a.kind} ${a.target}：${e}`);
          });
        };
        const issues = problems(out.actions);
        if (issues.length) { out = await brains.act(f, boardView(s, f.id), issues); spent = addTokens(spent, out.tokens); }

        const used: RoundUsage = { attack: false, defend: false };
        let billed = false;
        const bill = () => { if (billed) return ZERO; billed = true; return spent; };
        for (const draft of out.actions) {
          const check = checkAction(s, f.id, draft, used);
          if (check.errors.length && !check.causeOnly) {
            emit({ type: 'flag', kind: 'invalid_action', actor: f.id, note: check.errors.join('；'), tokens: bill() });
            continue;
          }
          if (draft.kind === 'attack') used.attack = true;
          if (draft.kind === 'defend') used.defend = true;
          const id = `A${++actionNo}`;
          const why = clampText(draft.why, WHY_LIMIT);
          const causedBy = (draft.causedBy ?? []).filter(r => (s.actions[r] && s.actions[r].actor !== f.id) || s.claims[r]);
          const action = emit({
            type: 'action', id, round, kind: draft.kind, actor: f.id, target: draft.target, why: why.text,
            ...(draft.steelman ? { steelman: draft.steelman } : {}), detail: draft.detail ?? '', evidence: draft.evidence ?? [], causedBy,
            ...(draft.shiftTo ? { shiftTo: draft.shiftTo } : {}), tokens: bill(),
          });
          if (why.truncated) emit({ type: 'flag', kind: 'why_truncated', actor: f.id, action: id, note: `理由超过 ${WHY_LIMIT} 字，已截断` });
          if (check.causeOnly) emit({ type: 'flag', kind: 'no_cause', actor: f.id, action: id, note: '无因认输：没有写明被哪一步说服（可能是从众）' });
          if (action.type === 'action' && (draft.kind === 'attack' || draft.kind === 'defend')) {
            const view = boardView(s);
            const alias = aliases(s);
            const r = await brains.rule({ id, round, actor: alias.get(f.id) ?? f.id, kind: draft.kind, target: draft.target, why: why.text, steelman: draft.steelman, detail: action.detail, evidence: action.evidence }, view);
            const pts = score(draft.kind, r.verdict, action.evidence.length > 0, r.evidenceOk);
            emit({ type: 'ruling', action: id, verdict: r.verdict, text: clampText(r.text, RULING_LIMIT).text, evidenceOk: r.evidenceOk, ...pts, tokens: r.tokens });
            if (draft.kind === 'attack' && r.verdict !== 'rejected') progressed = true;
          } else progressed = true;
        }
        if (!billed && sumTokens(spent) > 0) emit({ type: 'skip', round, actor: f.id, reason: '本回合观望，没有行动', savedTokens: 0, tokens: bill() });
      }

      lastRoundTokens = Math.max(1, s.tokens - before);
      if (s.tokens >= budget) break;
      if (aliveClash(s).length <= 1 || !progressed) {
        emit({ type: 'converged', round, reason: 'settled', savedTokens: (maxRounds - round) * lastRoundTokens });
        break;
      }
      if (round === maxRounds) emit({ type: 'converged', round, reason: 'max_rounds', savedTokens: 0 });
    }
    if (!s.converged) {
      emit({ type: 'flag', kind: 'budget', note: `已用 ${s.tokens} tokens，剩余预算（共 ${budget}）不够再打一回合，直接进入冠军答案` });
      emit({ type: 'converged', round: s.round, reason: 'budget', savedTokens: 0 });
    }
  }

  const fin = await brains.final(boardView(s));
  emit({ type: 'final', answer: fin.answer, minority: fin.minority, userCruxes: fin.userCruxes, confidence: fin.confidence, tokens: fin.tokens });
  emit({ type: 'match_ended', totalTokens: s.tokens, savedTokens: s.saved, costUsd: cfg.price ? Number(cfg.price(s.tokens).toFixed(4)) : 0 });
  await rec.flush();
  return rec;
}
