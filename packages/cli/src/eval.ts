// 评测：一场比赛同时给出三组答案——每位选手的盲答（单模型）、盲答计票（多数投票）、冠军答案（竞技场），逐题配对比较。
// 运行时只存原文（盲答、冠军答案、用量），判分全在 report 里做：改了提取规则可以零 token 重新判分。
// 评测一律关掉立场视角，盲答才是模型本来的答案。
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { extractJson } from '@crux/channels';
import type { CallRecord, Effort } from '@crux/channels';
import type { BrainsFactory } from './match.ts';
import { newMatchId, runLocalMatch } from './match.ts';

// ── 题库 ────────────────────────────────────────────────────────────────

const LETTERS = 'ABCDEFGHIJ';
const ChoiceItem = z.object({
  id: z.string().min(1),
  kind: z.literal('choice').default('choice'),
  question: z.string().min(1),
  choices: z.array(z.string().min(1)).min(2).max(10),
  answer: z.string().regex(/^[A-J]$/),
});
// 代码审查：在只读文件夹里埋好 bug，标准答案是这几处；提到位置（文件名或别名，如函数名）且命中任一关键词算找到。
// 诱饵（decoys）是看着像 bug、其实没问题的代码：回答里提到它的位置并命中"当成 bug"的关键词，算误报（幻觉）
const Spot = z.object({ id: z.string().min(1), file: z.string().optional(), aliases: z.array(z.string().min(1)).default([]), keywords: z.array(z.string().min(1)).min(1) });
const BugsItem = z.object({
  id: z.string().min(1),
  kind: z.literal('bugs'),
  question: z.string().min(1),
  dir: z.string().min(1),            // 相对题库文件
  bugs: z.array(Spot).min(1),
  decoys: z.array(Spot).default([]),
});
export const EvalItem = z.union([BugsItem, ChoiceItem]);
export type EvalItem = z.infer<typeof EvalItem>;
type Choice = z.infer<typeof ChoiceItem>;
type Bugs = z.input<typeof BugsItem>;

export function parseItems(text: string, source = '题库'): EvalItem[] {
  const items: EvalItem[] = [];
  const ids = new Set<string>();
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim() || line.trimStart().startsWith('//')) return;
    let raw: unknown;
    try { raw = JSON.parse(line); } catch { throw new Error(`${source} 第 ${i + 1} 行不是 JSON`); }
    const r = EvalItem.safeParse(raw);
    if (!r.success) throw new Error(`${source} 第 ${i + 1} 行格式不对：${r.error.issues.map(x => `${x.path.join('.')} ${x.message}`).join('；')}`);
    if (r.data.kind === 'choice' && LETTERS.indexOf(r.data.answer) >= r.data.choices.length) throw new Error(`${source} 第 ${i + 1} 行：答案 ${r.data.answer} 超出选项范围`);
    if (ids.has(r.data.id)) throw new Error(`${source} 第 ${i + 1} 行：题号 ${r.data.id} 重复`);
    ids.add(r.data.id);
    items.push(r.data);
  });
  return items;
}

/** 选择题提问：题干 + 选项 + 作答格式（选手和主席都会看到） */
export function formatQuestion(item: EvalItem): string {
  if (item.kind === 'bugs') return item.question;
  return `${item.question}\n\n${item.choices.map((c, i) => `${LETTERS[i]}. ${c}`).join('\n')}\n\n这是单选题。先写关键推理，最后一行写"答案：X"（X 是选项字母）。`;
}

/** 从回答里取选项字母：优先"答案：X"，其次 answer: X / 选 X，最后看结尾；取最后一次出现的 */
export function extractChoice(text: string, n: number): string | undefined {
  const valid = LETTERS.slice(0, n);
  const patterns = [
    /答案\s*(?:是|为|选)?\s*[:：]?\s*[（(【\[*]*\s*([A-J])(?![A-Za-z])/g,
    /\b(?:[Ff]inal\s+)?[Aa]nswer\s*(?:is)?\s*[:：]?\s*[(\[*]*([A-J])(?![A-Za-z])/g,   // 字母必须大写：免得把 "answer is a …" 当成 A
    /(?:选项|选择|应选|选)\s*[（(]?([A-J])(?![A-Za-z])/g,
  ];
  for (const re of patterns) {
    const hits = [...text.matchAll(re)].map(m => m[1]).filter(l => valid.includes(l));
    if (hits.length) return hits.at(-1);
  }
  const tail = text.trim().match(/(?:^|[\s*（(])([A-J])[)）.。*]*$/);
  return tail && valid.includes(tail[1]) ? tail[1] : undefined;
}

/** 多数投票：平票时按随机打破计期望分（猜中的概率） */
export function vote(choices: Array<string | undefined>, answer: string): { credit: number; outcome: 'right' | 'wrong' | 'tie' | 'none'; pick?: string } {
  const tally = new Map<string, number>();
  for (const c of choices) if (c) tally.set(c, (tally.get(c) ?? 0) + 1);
  if (!tally.size) return { credit: 0, outcome: 'none' };
  const top = Math.max(...tally.values());
  const tied = [...tally].filter(([, n]) => n === top).map(([l]) => l);
  if (tied.length > 1) return { credit: tied.includes(answer) ? 1 / tied.length : 0, outcome: 'tie', pick: tied.join('/') };
  return { credit: tied[0] === answer ? 1 : 0, outcome: tied[0] === answer ? 'right' : 'wrong', pick: tied[0] };
}

function spotHits(text: string, spots: Bugs['bugs']): string[] {
  const t = text.toLowerCase();
  const has = (s: string) => t.includes(s.toLowerCase());
  return spots.filter(b => {
    const where = [...(b.file ? [path.basename(b.file)] : []), ...(b.aliases ?? [])];
    return (!where.length || where.some(has)) && b.keywords.some(has);
  }).map(b => b.id);
}
export const bugHits = (text: string, item: Bugs) => spotHits(text, item.bugs);
/** 被当成 bug 报出来的诱饵（误报） */
export const decoyHits = (text: string, item: Bugs) => spotHits(text, item.decoys ?? []);

// ── 运行 ────────────────────────────────────────────────────────────────

export interface EvalConfig { set: string; team: string[]; effort: Effort; rounds: number; budget: number; startedAt: string }
export interface EvalRow {
  id: string;
  status: 'done' | 'forfeit' | 'error';
  error?: string;
  matchId?: string;
  drafts: Record<string, { model: string; text: string; tokens: number }>;
  final?: string;
  totalTokens: number;
  ms: number;
}

const sum = (calls: CallRecord[]) => calls.reduce((n, c) => n + (c.usage ? c.usage.in + c.usage.out : 0), 0);

/** 从这场的调用记录里取每位选手最后一次有效盲答 */
export function draftsFrom(calls: CallRecord[], team: string[]): EvalRow['drafts'] {
  const out: EvalRow['drafts'] = {};
  for (const id of team) {
    const mine = calls.filter(c => c.role === id && c.task === 'draft');
    let text = '', model = mine.at(-1)?.model ?? '';
    for (const c of mine) {
      if (!c.ok || !c.output) continue;
      try { const j = extractJson(c.output) as { answer?: unknown; claim?: { text?: unknown } }; if (typeof j.answer === 'string') { text = j.answer; model = c.model; } } catch { /* 格式不对的那次不算 */ }
    }
    out[id] = { model, text, tokens: sum(mine) };
  }
  return out;
}

export const readRows = async (dir: string): Promise<Map<string, EvalRow>> => {
  const rows = new Map<string, EvalRow>();
  try {
    for (const line of (await readFile(path.join(dir, 'results.jsonl'), 'utf8')).split('\n')) if (line.trim()) { const r = JSON.parse(line) as EvalRow; rows.set(r.id, r); }
  } catch { /* 还没开始 */ }
  return rows;
};

export interface RunEvalOptions {
  setFile: string;
  out: string;
  team: string[];
  effort: Effort;
  rounds: number;
  budget: number;
  limit?: number;
  /** 每题一个大脑工厂；onCall 收集调用记录（盲答原文从这里取） */
  brains: (o: { onCall: (c: CallRecord) => void; allowReads: boolean }) => BrainsFactory;
  log?: (s: string) => void;
}

/** 逐题开打；已完成（含对局无效）的题跳过，出错的下次重跑 */
export async function runEval(o: RunEvalOptions): Promise<Map<string, EvalRow>> {
  const items = parseItems(await readFile(o.setFile, 'utf8'), o.setFile);
  await mkdir(path.join(o.out, 'matches'), { recursive: true });
  const cfgFile = path.join(o.out, 'eval.json');
  const cfg: EvalConfig = { set: path.resolve(o.setFile), team: o.team, effort: o.effort, rounds: o.rounds, budget: o.budget, startedAt: new Date().toISOString() };
  try {
    const old = JSON.parse(await readFile(cfgFile, 'utf8')) as EvalConfig;
    const same = (k: keyof EvalConfig) => JSON.stringify(old[k]) === JSON.stringify(cfg[k]);
    const diff = (['set', 'team', 'effort', 'rounds', 'budget'] as const).filter(k => !same(k));
    if (diff.length) throw new Error(`${o.out} 里已有一轮设置不同的评测（${diff.join('、')} 不一样），换个 --out，免得两轮结果混在一起`);
    cfg.startedAt = old.startedAt;
  } catch (err) { if (!(err as NodeJS.ErrnoException).code) throw err; }
  await writeFile(cfgFile, JSON.stringify(cfg, null, 2));
  await writeFile(path.join(o.out, 'items.jsonl'), items.map(i => JSON.stringify(i)).join('\n') + '\n');

  const rows = await readRows(o.out);
  const todo = items.filter(i => rows.get(i.id)?.status !== 'done' && rows.get(i.id)?.status !== 'forfeit').slice(0, o.limit ?? Infinity);
  for (const [k, item] of todo.entries()) {
    const calls: CallRecord[] = [];
    const t0 = Date.now();
    const matchId = newMatchId();
    const question = formatQuestion(item);
    o.log?.(`[${k + 1}/${todo.length}] ${item.id} 开打`);
    let row: EvalRow;
    try {
      const r = await runLocalMatch({
        question, team: o.team, outDir: path.join(o.out, 'matches'), matchId, maxRounds: o.rounds, budget: o.budget,
        dir: item.kind === 'bugs' ? path.resolve(path.dirname(o.setFile), item.dir) : undefined,
        meta: { source: 'eval', display: 'none', pid: process.pid, question, team: o.team, startedAt: new Date().toISOString() },
        brains: o.brains({ onCall: c => calls.push(c), allowReads: item.kind === 'bugs' }),
      });
      const final = r.events.find(e => e.type === 'final');
      const ended = r.events.find(e => e.type === 'match_ended');
      const forfeit = r.events.some(e => e.type === 'converged' && e.reason === 'forfeit');
      row = {
        id: item.id, status: forfeit ? 'forfeit' : 'done', matchId, drafts: draftsFrom(calls, o.team),
        final: final?.type === 'final' ? final.answer : undefined,
        totalTokens: ended?.type === 'match_ended' ? ended.totalTokens : sum(calls), ms: Date.now() - t0,
      };
    } catch (err) {
      row = { id: item.id, status: 'error', error: (err as Error).message, matchId, drafts: draftsFrom(calls, o.team), totalTokens: sum(calls), ms: Date.now() - t0 };
    }
    await appendFile(path.join(o.out, 'results.jsonl'), JSON.stringify(row) + '\n');
    rows.set(item.id, row);
    o.log?.(`[${k + 1}/${todo.length}] ${item.id} ${{ done: '完成', forfeit: '对局无效', error: `出错：${row.error}` }[row.status]} · ${Math.round(row.totalTokens / 1000)}k tok · ${(row.ms / 1000).toFixed(0)}s`);
  }
  return rows;
}

// ── 判分与报告 ──────────────────────────────────────────────────────────

export interface ChoiceScore { id: string; answer: string; picks: Record<string, string | undefined>; vote: ReturnType<typeof vote>; arena?: string; arenaRight: boolean; tokens: number; draftTokens: number; draftBy: Record<string, number>; matchId?: string }
export interface BugsScore {
  id: string; total: number; per: Record<string, string[]>; union: string[]; arena: string[];
  decoys: number; falsePer: Record<string, string[]>; falseArena: string[];   // 诱饵个数、被当成 bug 的诱饵
  tokens: number; draftTokens: number; matchId?: string;
}
export interface EvalReport {
  cfg: EvalConfig; items: number; finished: number; forfeits: string[]; errors: string[];
  choice: ChoiceScore[]; bugs: BugsScore[];
}

export function grade(cfg: EvalConfig, items: EvalItem[], rows: Map<string, EvalRow>): EvalReport {
  const rep: EvalReport = { cfg, items: items.length, finished: 0, forfeits: [], errors: [], choice: [], bugs: [] };
  for (const item of items) {
    const row = rows.get(item.id);
    if (!row) continue;
    if (row.status === 'error') { rep.errors.push(item.id); continue; }
    if (row.status === 'forfeit') { rep.forfeits.push(item.id); continue; }
    rep.finished++;
    const draftTokens = Object.values(row.drafts).reduce((n, d) => n + d.tokens, 0);
    if (item.kind === 'choice') {
      const picks = Object.fromEntries(cfg.team.map(id => [id, extractChoice(row.drafts[id]?.text ?? '', item.choices.length)]));
      const arena = extractChoice(row.final ?? '', item.choices.length);
      rep.choice.push({ id: item.id, answer: item.answer, picks, vote: vote(Object.values(picks), item.answer), arena, arenaRight: arena === item.answer, tokens: row.totalTokens, draftTokens, draftBy: Object.fromEntries(cfg.team.map(id => [id, row.drafts[id]?.tokens ?? 0])), matchId: row.matchId });
    } else {
      const per = Object.fromEntries(cfg.team.map(id => [id, bugHits(row.drafts[id]?.text ?? '', item)]));
      const union = [...new Set(Object.values(per).flat())];
      const falsePer = Object.fromEntries(cfg.team.map(id => [id, decoyHits(row.drafts[id]?.text ?? '', item)]));
      rep.bugs.push({
        id: item.id, total: item.bugs.length, per, union, arena: bugHits(row.final ?? '', item),
        decoys: item.decoys.length, falsePer, falseArena: decoyHits(row.final ?? '', item),
        tokens: row.totalTokens, draftTokens, matchId: row.matchId,
      });
    }
  }
  return rep;
}

const pct = (x: number, n: number) => (n ? `${(x / n * 100).toFixed(0)}%` : '—');
const kt = (t: number) => `${(t / 1000).toFixed(t < 10_000 ? 1 : 0)}k`;
const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

export function renderReport(r: EvalReport): string {
  const L: string[] = [];
  const { cfg } = r;
  L.push('# Crux Arena 评测', '');
  L.push(`题库 \`${path.basename(cfg.set)}\` · ${r.finished}/${r.items} 题完成 · 选手 ${cfg.team.join('、')} · 档位 ${cfg.effort} · 最多 ${cfg.rounds} 回合 · 单场预算 ${kt(cfg.budget)} · 立场视角关闭`);
  if (r.forfeits.length) L.push('', `对局无效（交出盲答不足 2 人，不计分）：${r.forfeits.join('、')}`);
  if (r.errors.length) L.push('', `出错（重新运行 \`crux eval run\` 会补跑）：${r.errors.join('、')}`);

  const c = r.choice;
  if (c.length) {
    const n = c.length;
    const avg = (f: (s: ChoiceScore) => number) => c.reduce((x, s) => x + f(s), 0) / n;
    L.push('', `## 选择题（${n} 题）`, '', '| 方式 | 答对 | 准确率 | 平均 token / 题 |', '|---|---|---|---|');
    const arenaRight = c.filter(s => s.arenaRight).length;
    const voteCredit = c.reduce((x, s) => x + s.vote.credit, 0);
    L.push(`| **竞技场**（冠军答案） | ${arenaRight} | ${pct(arenaRight, n)} | ${kt(avg(s => s.tokens))} |`);
    L.push(`| 多数投票（盲答计票，平票按随机计期望） | ${fmt(voteCredit)} | ${pct(voteCredit, n)} | ${kt(avg(s => s.draftTokens))} |`);
    for (const id of cfg.team) {
      const right = c.filter(s => s.picks[id] === s.answer).length;
      L.push(`| 单模型 ${id} | ${right} | ${pct(right, n)} | ${kt(avg(s => s.draftBy[id] ?? 0))} |`);
    }
    const flips = {
      fixed: c.filter(s => s.vote.outcome === 'wrong' && s.arenaRight), broke: c.filter(s => s.vote.outcome === 'right' && !s.arenaRight),
      tieRight: c.filter(s => s.vote.outcome === 'tie' && s.arenaRight), tieWrong: c.filter(s => s.vote.outcome === 'tie' && !s.arenaRight),
    };
    const agreed = c.filter(s => new Set(Object.values(s.picks).filter(Boolean)).size <= 1).length;
    L.push('', '**翻盘**（和多数投票逐题比）：');
    L.push(`- 投票错 → 竞技场改对：${flips.fixed.length} 题${flips.fixed.length ? `（${flips.fixed.map(s => s.id).join('、')}）` : ''}`);
    L.push(`- 投票对 → 竞技场改错：${flips.broke.length} 题${flips.broke.length ? `（${flips.broke.map(s => s.id).join('、')}）` : ''}`);
    L.push(`- 平票时竞技场答对 ${flips.tieRight.length} 题、答错 ${flips.tieWrong.length} 题`);
    L.push(`- 盲答全员一致的题：${agreed} / ${n}（这些题三种方式几乎不会有差别）`);
    const unread = c.filter(s => !s.arena).length + c.reduce((x, s) => x + Object.values(s.picks).filter(p => !p).length, 0);
    if (unread) L.push(`- 没提取出选项字母的回答：${unread} 个，按答错计（看下表的"?"，必要时人工核对）`);
    L.push('', '| 题 | 标准 | ' + cfg.team.join(' | ') + ' | 投票 | 竞技场 | token | 存档 |', '|---|---|' + cfg.team.map(() => '---|').join('') + '---|---|---|---|');
    const mark = (p: string | undefined, a: string) => (p ? (p === a ? `${p} ✓` : p) : '?');
    for (const s of c) L.push(`| ${s.id} | ${s.answer} | ${cfg.team.map(id => mark(s.picks[id], s.answer)).join(' | ')} | ${s.vote.pick ?? '?'}${s.vote.outcome === 'right' ? ' ✓' : ''} | ${mark(s.arena, s.answer)} | ${kt(s.tokens)} | ${s.matchId ?? ''} |`);
  }

  const b = r.bugs;
  if (b.length) {
    const total = b.reduce((x, s) => x + s.total, 0);
    const found = (f: (s: BugsScore) => string[]) => b.reduce((x, s) => x + f(s).length, 0);
    const decoys = b.reduce((x, s) => x + s.decoys, 0);
    const fp = (f: (s: BugsScore) => string[]) => (decoys ? ` | ${b.reduce((x, s) => x + f(s).length, 0)} / ${decoys}` : '');
    L.push('', `## 代码审查（${b.length} 个仓库，共埋 ${total} 个 bug${decoys ? `、${decoys} 个诱饵` : ''}）`, '',
      `| 方式 | 找到 | 召回${decoys ? ' | 误报诱饵' : ''} |`, `|---|---|---${decoys ? '|---' : ''}|`);
    L.push(`| **竞技场**（冠军答案） | ${found(s => s.arena)} | ${pct(found(s => s.arena), total)}${fp(s => s.falseArena)} |`);
    L.push(`| 选手盲答合起来（任一人找到就算） | ${found(s => s.union)} | ${pct(found(s => s.union), total)}${decoys ? ' | —' : ''} |`);
    for (const id of cfg.team) L.push(`| 单模型 ${id} | ${found(s => s.per[id] ?? [])} | ${pct(found(s => s.per[id] ?? []), total)}${fp(s => s.falsePer[id] ?? [])} |`);
    L.push('', `按"提到文件名 + 命中关键词"自动判，可能漏判或误判，引用前请人工核对存档里的原文。${decoys ? '诱饵是看着像 bug、其实没问题的代码，被报出来就算误报。' : ''}`);
  }

  L.push('', '---', '样本很小，只能看方向：对外请写"N 题里改对 X 题、改错 Y 题"，不要直接说"更准"。每题的完整过程见 `matches/<存档>/battle-log.md`。');
  return L.join('\n') + '\n';
}

export async function reportEval(dir: string): Promise<{ report: EvalReport; markdown: string; file: string }> {
  let cfg: EvalConfig;
  try { cfg = JSON.parse(await readFile(path.join(dir, 'eval.json'), 'utf8')); } catch { throw new Error(`${dir} 里没有评测记录（先运行 crux eval run）`); }
  const items = parseItems(await readFile(path.join(dir, 'items.jsonl'), 'utf8'));
  const report = grade(cfg, items, await readRows(dir));
  const markdown = renderReport(report);
  const file = path.join(dir, 'report.md');
  await writeFile(file, markdown);
  return { report, markdown, file };
}

// ── 导入 GPQA ───────────────────────────────────────────────────────────

/** 最小 CSV 解析：支持引号、引号转义和字段内换行 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(x => x !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some(x => x !== '')) rows.push(row);
  return rows;
}

/** GPQA 原始 CSV → 题库。选项顺序按题号哈希固定打乱（每次导入结果一样，正确答案不总在 A） */
export function importGpqa(csv: string): Choice[] {
  const [head, ...rows] = parseCsv(csv.replace(/^﻿/, ''));
  const col = (name: string) => { const i = head.findIndex(h => h.trim() === name); if (i < 0) throw new Error(`CSV 里没有"${name}"列，确认是 GPQA 的原始 CSV（如 gpqa_diamond.csv）`); return i; };
  const [qi, ci, w1, w2, w3] = ['Question', 'Correct Answer', 'Incorrect Answer 1', 'Incorrect Answer 2', 'Incorrect Answer 3'].map(col);
  const idi = head.findIndex(h => h.trim() === 'Record ID');
  return rows.map((r, n) => {
    const id = idi >= 0 && r[idi] ? `gpqa-${r[idi].trim()}` : `gpqa-${n + 1}`;
    const opts = [r[ci], r[w1], r[w2], r[w3]].map(s => s.trim());
    const h = createHash('sha256').update(id).digest();
    const order = [0, 1, 2, 3].sort((a, b) => h[a] - h[b] || a - b);
    const choices = order.map(i => opts[i]);
    return { id, kind: 'choice' as const, question: r[qi].trim(), choices, answer: LETTERS[order.indexOf(0)] };
  }).filter(i => i.question && i.choices.every(Boolean));
}

/** 粗估一题的 token：盲答 + 分歧提取 + 主席；有分歧时再加一回合（交锋 + 裁决） */
export function estimatePerItem(fighterCost: number[], judgeCost: number, chairCost: number, rounds: number): { agreed: number; contested: number } {
  const drafts = fighterCost.reduce((a, b) => a + b, 0);
  const agreed = drafts + judgeCost + chairCost;
  return { agreed, contested: agreed + (rounds > 0 ? Math.round(drafts * 0.8) + judgeCost : 0) };
}
/** 每次调用的大致 token：Cursor 每次都带一段很长的固定提示 */
export const callCost = (display: string) => (display.startsWith('cursor/') ? 12_000 : display.startsWith('codex/') ? 6_000 : display.startsWith('claude-code/') ? 2_500 : 3_000);
