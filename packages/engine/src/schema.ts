// 事件 schema：events.jsonl 每一行就是一个 MatchEvent。
// 它是比赛的唯一事实来源：回放、battle-log.md、结果页、eval 都从这里推导。
import { z } from 'zod';

export const FighterId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);
export const ClaimId = z.string().regex(/^C\d+$/);
export const ActionId = z.string().regex(/^A\d+$/);
export const Ref = z.union([ClaimId, ActionId]);
export const Label = z.enum(['fact', 'inference', 'speculation']);
export const ActionKind = z.enum(['attack', 'defend', 'concede', 'shift']);
export const Verdict = z.enum(['upheld', 'partial', 'rejected']);
export const Mode = z.enum(['ffa', 'team']);
export const Team = z.enum(['red', 'blue']);

export const Tokens = z.object({
  in: z.number().int().nonnegative(),
  out: z.number().int().nonnegative(),
});

export const Evidence = z.object({
  kind: z.enum(['web', 'file']),
  ref: z.string().min(1),            // URL，或 file:line（如 src/app.ts:42-58）
  quote: z.string().optional(),
});

export const FighterSpec = z.object({
  id: FighterId,
  name: z.string().min(1),           // 画面和日志里显示的名字，如 CLAUDE
  model: z.string().min(1),
  team: Team.optional(),
});

const base = {
  seq: z.number().int().nonnegative(),
  t: z.number().nonnegative(),       // 距比赛开始的毫秒数
};

export const MatchStarted = z.object({
  ...base,
  type: z.literal('match_started'),
  matchId: z.string().min(1),
  question: z.string().min(1),
  mode: Mode,
  fighters: z.array(FighterSpec).min(2).max(8),
  judge: z.string(),
  chair: z.string(),
  budget: z.number().int().positive(),
  maxRounds: z.number().int().min(1).max(5),
  workspace: z.object({ root: z.string() }).optional(),
});

export const RoundStarted = z.object({ ...base, type: z.literal('round_started'), round: z.number().int().nonnegative() });

export const ClaimMade = z.object({
  ...base,
  type: z.literal('claim'),
  id: ClaimId,
  actor: FighterId,
  text: z.string().min(1),
  short: z.string().min(1),
  label: Label,
  tokens: Tokens,
});

// 附议：分歧提取后，选手被归到别人的论点下（合并重复论点，或表明立场）
export const Seconded = z.object({ ...base, type: z.literal('second'), actor: FighterId, target: ClaimId, why: z.string() });

export const Crux = z.object({
  ...base,
  type: z.literal('crux'),
  clash: z.array(ClaimId),
  consensus: z.array(z.string()),
  merges: z.array(z.object({ from: ClaimId, into: ClaimId })),
  why: z.string(),
  tokens: Tokens,
});

export const ActionTaken = z.object({
  ...base,
  type: z.literal('action'),
  id: ActionId,
  round: z.number().int().positive(),
  kind: ActionKind,
  actor: FighterId,
  target: ClaimId,
  why: z.string().min(1),            // ≤ 20 个汉字 / 12 个英文词，超出由引擎截断并记 flag
  steelman: z.string().optional(),
  detail: z.string(),
  evidence: z.array(Evidence),
  causedBy: z.array(Ref),            // 让 / 改 必填：被哪一步说服
  shiftTo: ClaimId.optional(),
  tokens: Tokens,
});

export const Ruling = z.object({
  ...base,
  type: z.literal('ruling'),
  action: ActionId,
  verdict: Verdict,
  text: z.string(),                  // ≤ 15 个汉字
  evidenceOk: z.boolean(),
  damage: z.number().int().nonnegative(),
  heal: z.number().int().nonnegative(),
  crit: z.boolean(),
  tokens: Tokens,
});

export const Skipped = z.object({
  ...base,
  type: z.literal('skip'),
  round: z.number().int().positive(),
  actor: FighterId,
  reason: z.string(),
  savedTokens: z.number().int().nonnegative(),
  tokens: Tokens.optional(),        // 选手观望时也可能已消耗 token
});

export const Flagged = z.object({
  ...base,
  type: z.literal('flag'),
  kind: z.enum(['no_cause', 'why_truncated', 'invalid_action', 'budget']),
  actor: FighterId.optional(),
  action: ActionId.optional(),
  note: z.string(),
  tokens: Tokens.optional(),        // 被丢弃的不合规输出也要计费
});

// 文件夹模式的审计：每次只读工具调用都记一条
export const ToolCall = z.object({
  ...base,
  type: z.literal('tool_call'),
  actor: z.string(),
  tool: z.string(),
  input: z.record(z.string(), z.unknown()),
  ok: z.boolean(),
  bytes: z.number().int().nonnegative(),
  note: z.string().optional(),
});

export const Converged = z.object({
  ...base,
  type: z.literal('converged'),
  round: z.number().int().nonnegative(),
  reason: z.enum(['flawless', 'settled', 'budget', 'max_rounds', 'forfeit']),   // forfeit：交出盲答的不到 2 人，对局无效
  savedTokens: z.number().int().nonnegative(),
});

export const Final = z.object({
  ...base,
  type: z.literal('final'),
  answer: z.string().min(1),
  minority: z.array(z.string()),
  userCruxes: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  tokens: Tokens,
});

export const MatchEnded = z.object({
  ...base,
  type: z.literal('match_ended'),
  totalTokens: z.number().int().nonnegative(),
  savedTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});

export const MatchEvent = z.discriminatedUnion('type', [
  MatchStarted, RoundStarted, ClaimMade, Seconded, Crux, ActionTaken, Ruling,
  Skipped, Flagged, ToolCall, Converged, Final, MatchEnded,
]);

export type MatchEvent = z.infer<typeof MatchEvent>;
export type EventType = MatchEvent['type'];
export type EventOf<T extends EventType> = Extract<MatchEvent, { type: T }>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type EventInput = DistributiveOmit<MatchEvent, 'seq' | 't'>;
export type FighterSpec = z.infer<typeof FighterSpec>;
export type Evidence = z.infer<typeof Evidence>;
export type Label = z.infer<typeof Label>;
export type ActionKind = z.infer<typeof ActionKind>;
export type Verdict = z.infer<typeof Verdict>;
export type Tokens = z.infer<typeof Tokens>;

export const sumTokens = (t: Tokens) => t.in + t.out;

/** 解析 events.jsonl 文本；任何一行不合 schema 都会抛错并指出行号 */
export function parseEventLines(text: string): MatchEvent[] {
  return text.split(/\r?\n/).filter(l => l.trim()).map((line, i) => {
    const r = MatchEvent.safeParse(JSON.parse(line));
    if (!r.success) throw new Error(`events.jsonl 第 ${i + 1} 行不合 schema：${r.error.message}`);
    return r.data;
  });
}
