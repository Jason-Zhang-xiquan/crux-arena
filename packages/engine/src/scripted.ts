// 脚本化大脑：不调用任何模型，按剧本返回结果。用于演示、测试和回归。
import type { ActOut, ActionDraft, BoardAction, BoardView, Brains, CruxOut, DraftOut, FinalOut, RulingOut } from './brains.ts';
import type { Evidence, FighterSpec, Tokens } from './schema.ts';

export interface Script {
  drafts: Record<string, DraftOut>;
  crux: CruxOut;
  acts: Record<number, Record<string, ActionDraft[]>>;   // 回合 → 选手 id → 动作
  rulings: Record<string, Omit<RulingOut, 'tokens'>>;    // 动作编号 → 裁决
  final: FinalOut;
  actTokens?: Tokens;
  ruleTokens?: Tokens;
}

export class ScriptedBrains implements Brains {
  script: Script;
  calls: string[] = [];              // 调用记录，测试用

  constructor(script: Script) { this.script = script; }

  async draft(f: FighterSpec): Promise<DraftOut> {
    this.calls.push(`draft:${f.id}`);
    const d = this.script.drafts[f.id];
    if (!d) throw new Error(`剧本里没有 ${f.id} 的盲答`);
    return d;
  }

  async act(f: FighterSpec, view: BoardView, feedback?: string[]): Promise<ActOut> {
    this.calls.push(`act:${view.round}:${f.id}${feedback?.length ? ':retry' : ''}`);
    const actions = this.script.acts[view.round]?.[f.id] ?? [];
    return { actions, tokens: actions.length ? (this.script.actTokens ?? { in: 2200, out: 300 }) : { in: 0, out: 0 } };
  }

  async crux(): Promise<CruxOut> {
    this.calls.push('crux');
    return this.script.crux;
  }

  async rule(a: BoardAction & { evidence: Evidence[] }): Promise<RulingOut> {
    this.calls.push(`rule:${a.id}`);
    const r = this.script.rulings[a.id] ?? { verdict: 'partial', text: '剧本未写裁决', evidenceOk: false };
    return { ...r, tokens: this.script.ruleTokens ?? { in: 500, out: 60 } };
  }

  async final(): Promise<FinalOut> {
    this.calls.push('final');
    return this.script.final;
  }
}
