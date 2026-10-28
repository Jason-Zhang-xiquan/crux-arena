// "大脑"接口：引擎只管流程和规则，谁来想（真实模型、脚本、测试桩）由 Brains 决定。
// 引擎给大脑的只有匿名化后的论点板（BoardView），不会暴露选手是哪家模型。
import type { ActionKind, Evidence, FighterSpec, Label, Tokens, Verdict } from './schema.ts';

export interface BoardClaim {
  id: string;
  owner: string;                     // 匿名代号，如 P2；自己显示为 YOU
  short: string;
  label: Label;
  hp: number;
  status: 'alive' | 'ko' | 'merged';
  supporters: string[];
}

export interface BoardAction {
  id: string;
  round: number;
  actor: string;
  kind: ActionKind;
  target: string;
  why: string;
  verdict?: Verdict;
  crit?: boolean;
}

export interface BoardView {
  question: string;
  round: number;
  viewer?: string;                   // 当前看板的人的匿名代号
  claims: BoardClaim[];
  consensus: string[];
  recent: BoardAction[];             // 只给上一回合和本回合的动作，避免上下文随回合膨胀
}

export interface DraftOut { answer: string; claims: Array<{ text: string; short: string; label: Label }>; tokens: Tokens }

export interface ActionDraft {
  kind: ActionKind;
  target: string;
  why: string;
  steelman?: string;
  detail?: string;
  evidence?: Evidence[];
  causedBy?: string[];
  shiftTo?: string;
}
export interface ActOut { actions: ActionDraft[]; tokens: Tokens }

export interface CruxOut {
  clash: string[];
  consensus: string[];
  merges: Array<{ from: string; into: string }>;
  stances: Record<string, string>;   // 匿名代号 → 他站的争议论点
  why: string;
  tokens: Tokens;
}

export interface RulingOut { verdict: Verdict; text: string; evidenceOk: boolean; tokens: Tokens }
export type RuleInput = BoardAction & { steelman?: string; detail: string; evidence: Evidence[] };
export interface FinalOut { answer: string; minority: string[]; userCruxes: string[]; confidence: number; tokens: Tokens }

export interface Brains {
  draft(fighter: FighterSpec, question: string): Promise<DraftOut>;
  /** feedback 非空表示上一次输出不合规，要求修正一次 */
  act(fighter: FighterSpec, view: BoardView, feedback?: string[]): Promise<ActOut>;
  crux(view: BoardView): Promise<CruxOut>;
  rule(action: RuleInput, view: BoardView): Promise<RulingOut>;
  /** 可选：一回合的攻守攒到回合末尾一次判完（省调用；裁判也能把攻和守放在一起看）。顺序与输入一致 */
  ruleRound?(actions: RuleInput[], view: BoardView): Promise<{ rulings: Array<Omit<RulingOut, 'tokens'>>; tokens: Tokens }>;
  final(view: BoardView): Promise<FinalOut>;
}
