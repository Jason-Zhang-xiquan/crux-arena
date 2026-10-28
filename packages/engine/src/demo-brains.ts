// 演示大脑：规则驱动，任意 2–6 名选手、混战 / 组队都能打完一整场。
// 还没接真实模型时，桌面版和 CLI 用它跑通全流程。它只看匿名论点板，和真实大脑拿到的信息一样。
import type { ActOut, ActionDraft, BoardAction, BoardView, Brains, CruxOut, DraftOut, FinalOut, RulingOut } from './brains.ts';
import type { Evidence, FighterSpec, Label, Tokens, Verdict } from './schema.ts';

type Topic = 'mono' | 'micro' | 'serverless' | 'fact';
interface Stance { topic: Topic; text: string; short: string; label: Label; answer: string }

const STANCES: Record<string, Stance> = {
  mono:       { topic: 'mono', label: 'inference', text: '先做模块化单体：按领域划清边界，真有瓶颈再拆', short: '先做模块化单体，按需再拆', answer: '先做模块化单体，按领域把代码分成清晰的模块，共用一个部署单元；哪个模块真成了瓶颈，再把它拆出去。' },
  micro:      { topic: 'micro', label: 'inference', text: '一开始就上微服务：各模块独立部署、独立扩容', short: '一开始就上微服务', answer: '直接上微服务。每个模块独立部署、独立扩容，以后团队变大也不用推倒重来。' },
  serverless: { topic: 'serverless', label: 'inference', text: '全部用 Serverless 函数：免运维、按量付费', short: '全部 Serverless，免运维', answer: '全部用 Serverless 函数。不用管服务器，按调用量付费，早期流量小的时候几乎不花钱。' },
  fact:       { topic: 'fact', label: 'fact', text: '自建 K8s 微服务，运维约需 1 名专职人力', short: '自建 K8s 运维≈1 名专职', answer: '先摆一个事实：自建 K8s 跑微服务，运维大约要占 1 名专职工程师。' },
  monoAlt:    { topic: 'mono', label: 'inference', text: '同意先做单体：模块边界先划清楚，不急着拆', short: '先单体，边界先划清', answer: '我也倾向先做单体，关键是模块边界一开始就划清楚。' },
  microAlt:   { topic: 'micro', label: 'inference', text: '服务一开始就拆开，团队扩张更顺', short: '服务早拆，扩张更顺', answer: '服务一开始就拆开，后面招人扩张会更顺。' },
  redAlt:     { topic: 'mono', label: 'inference', text: '先单体，把精力全放在产品迭代上', short: '先单体，精力放产品', answer: '5 个人最缺的是迭代速度，先把精力放在产品上。' },
  blueAlt:    { topic: 'micro', label: 'inference', text: '拆成服务后，新人可以并行开发互不阻塞', short: '拆服务，新人可并行', answer: '服务拆开以后，新招的人可以并行开发，互不阻塞。' },
};

// 每种攻防的理由、细节、证据和裁决（裁决由"演示裁判"按理由查表）
const MOVES = {
  ops:      { why: '抽 1 人运维=砍 20% 研发', steelman: '微服务确实便于独立扩容和部署。', detail: '5 个人里抽 1 个专职做 K8s 运维，等于直接砍掉 20% 的研发产能。早期产品最缺的就是迭代速度。', evidence: [{ kind: 'web', ref: 'https://example.com/demo/k8s-ops-survey', quote: '小团队自建 K8s 平均需要 0.8–1.2 名专职运维（演示数据）' }] as Evidence[], verdict: 'upheld', ruling: '证据成立' },
  cold:     { why: '冷启动会击穿 p99 延迟', steelman: 'Serverless 确实免去了服务器运维。', detail: 'B2B 客户通常签 SLA，Serverless 冷启动会让 p99 延迟出现秒级尖刺。', verdict: 'upheld', ruling: '成立' },
  prepaid:  { why: '预留并发低流量下比 VM 贵', steelman: '预留并发确实能消除冷启动。', detail: '预留并发按小时计费。早期 B2B 流量很低，这笔钱比一台小 VM 还贵，按量付费的优势没了。', evidence: [{ kind: 'web', ref: 'https://example.com/demo/provisioned-concurrency', quote: '预留并发按小时计费（演示数据）' }] as Evidence[], verdict: 'upheld', ruling: '证据成立' },
  release:  { why: '拆服务后一次发布变多次协调', steelman: '独立部署确实让单个服务发布更快。', detail: '模块之间互相调用很多，拆成服务以后，一次发布会变成好几次协调发布。', evidence: [{ kind: 'web', ref: 'https://example.com/demo/release-coordination', quote: '跨服务发布需要协调多个流水线（演示数据）' }] as Evidence[], verdict: 'upheld', ruling: '证据成立' },
  split:    { why: '单体后期拆分代价高', steelman: '单体在早期开发最快、调试最简单。', detail: '单体长大以后再拆，往往要付出大量重构成本，不如一开始就分开。', verdict: 'partial', ruling: '模块边界可缓解' },
  single:   { why: '单体一处出错，全站一起挂', steelman: '单体部署确实最简单。', detail: '单体只有一个部署单元，一个模块出错，整个服务一起挂。', verdict: 'partial', ruling: '部分成立，可用隔离缓解' },
  managed:  { why: '托管 K8s 可降到 0.3 人', detail: '用托管 K8s，集群运维交给云厂商，人力能降到 0.3 人左右。', verdict: 'partial', ruling: '部分成立' },
  reserved: { why: '预留并发可消除冷启动', detail: '开启预留并发，冷启动问题可以消除。', verdict: 'partial', ruling: '成立，但抵消了省钱优势' },
  boundary: { why: '边界划好，拆分只是搬家', detail: '只要一开始按领域划好模块边界，后面拆分就是搬家，不是重写。', verdict: 'upheld', ruling: '成立' },
} satisfies Record<string, { why: string; steelman?: string; detail: string; evidence?: Evidence[]; verdict: Verdict; ruling: string }>;
type MoveKey = keyof typeof MOVES;
const MOVE_BY_WHY = new Map(Object.values(MOVES).map(m => [m.why, m]));

const T = (i: number, o: number): Tokens => ({ in: i, out: o });

export class DemoBrains implements Brains {
  order: string[];
  mode: 'ffa' | 'team';
  topicByShort = new Map<string, Topic>(Object.values(STANCES).map(s => [s.short, s.topic]));

  constructor(fighters: FighterSpec[], mode: 'ffa' | 'team' = 'ffa') {
    this.order = fighters.map(f => f.id);
    this.mode = mode;
  }

  /** 选手在本场的剧本角色：P1 单体派、P2 微服务派、P3 Serverless 派、P4 事实派、P5 / P6 附议（组队时单号红队、双号蓝队） */
  role(id: string) { return this.order.indexOf(id) + 1; }

  stanceFor(id: string): Stance {
    const r = this.role(id);
    if (this.mode === 'team') return r === 1 ? STANCES.mono : r === 2 ? STANCES.micro : r % 2 ? STANCES.redAlt : STANCES.blueAlt;
    return [STANCES.mono, STANCES.micro, STANCES.serverless, STANCES.fact, STANCES.monoAlt, STANCES.microAlt][r - 1] ?? STANCES.monoAlt;
  }

  async draft(f: FighterSpec): Promise<DraftOut> {
    const s = this.stanceFor(f.id);
    return { answer: s.answer, claims: [{ text: s.text, short: s.short, label: s.label }], tokens: T(600, 1400) };
  }

  async crux(view: BoardView): Promise<CruxOut> {
    const reps = new Map<Topic, string>();
    const merges: CruxOut['merges'] = [];
    const stances: Record<string, string> = {};
    for (const c of view.claims) {
      const topic = this.topicByShort.get(c.short);
      if (!topic) continue;
      const rep = reps.get(topic);
      if (rep) merges.push({ from: c.id, into: rep }); else reps.set(topic, c.id);
    }
    const clash = (['mono', 'micro', 'serverless'] as Topic[]).map(t => reps.get(t)).filter((x): x is string => !!x);
    const fact = reps.get('fact');
    const mono = reps.get('mono');
    if (fact && mono) stances[view.claims.find(c => c.id === fact)!.owner] = mono;   // 事实派的立场归入单体
    return {
      clash, consensus: ['无论哪种架构，CI/CD 与监控先行'], merges, stances,
      why: `${clash.join('/')} 互斥${fact ? `，${fact} 待验证` : ''}`, tokens: T(900, 200),
    };
  }

  async act(f: FighterSpec, view: BoardView): Promise<ActOut> {
    const r = this.role(f.id);
    const rep = (t: Topic) => view.claims.find(c => c.status === 'alive' && this.topicByShort.get(c.short) === t);
    const attacksOn = (id: string, round?: number) => view.recent.filter(a => a.kind === 'attack' && a.target === id && (round === undefined || a.round === round));
    const lastDefendOn = (id: string) => [...view.recent].reverse().find(a => a.kind === 'defend' && a.target === id);
    const opsAttack = view.recent.find(a => a.why === MOVES.ops.why);
    const move = (key: MoveKey, kind: ActionDraft['kind'], target: string | undefined, causedBy: string[] = []): ActionDraft[] => {
      if (!target) return [];
      const m = MOVES[key] as (typeof MOVES)[MoveKey] & { steelman?: string; evidence?: Evidence[] };
      return [{ kind, target, why: m.why, detail: m.detail, ...(m.steelman ? { steelman: m.steelman } : {}), ...(m.evidence ? { evidence: m.evidence } : {}), causedBy }];
    };
    const concede = (t: Topic, hpAtMost: number): ActionDraft[] => {
      const c = rep(t);
      const mono = rep('mono');
      if (!c || c.hp > hpAtMost || !mono || mono.id === c.id) return [];
      const causes = attacksOn(c.id).map(a => a.id);
      const why = t === 'micro' ? '运维人力确实不够，有条件改投单体' : '成本优势不成立，改投单体';
      return [{ kind: 'concede', target: c.id, why, detail: '这几步攻击我反驳不了，改为有条件支持单体：团队超过 15 人，或某模块需要独立扩容时再拆。', causedBy: causes, shiftTo: mono.id }];
    };
    const fact = rep('fact');
    const n = this.order.length;
    let actions: ActionDraft[] = [];

    if (this.mode === 'team') {
      const micro = rep('micro')?.id, mono = rep('mono')?.id;
      if (view.round === 1) {
        if (r === 1 && n < 3) actions = move('ops', 'attack', micro);
        if (r === 2) actions = move('split', 'attack', mono);
        if (r === 3) actions = move('ops', 'attack', micro);
        if (r === 4) actions = move('managed', 'defend', micro, attacksOn(micro ?? '', 1).map(a => a.id).slice(-1));
        if (r === 5) actions = move('boundary', 'defend', mono, attacksOn(mono ?? '', 1).map(a => a.id).slice(-1));
        if (r === 6) actions = move('single', 'attack', mono);
      } else {
        if (r === 1) actions = move('release', 'attack', micro, opsAttack ? [opsAttack.id] : []);
        if (r === 2) actions = concede('micro', 60);
      }
    } else {
      const micro = rep('micro')?.id, mono = rep('mono')?.id, sls = rep('serverless')?.id;
      if (view.round === 1) {
        if (r === 1) actions = sls ? move('cold', 'attack', sls) : move('ops', 'attack', micro);
        if (r === 2) actions = move('split', 'attack', mono);
        if (r === 3) {
          actions = move('reserved', 'defend', sls, attacksOn(sls ?? '', 1).map(a => a.id));
          if (n === 3) actions = [...actions, ...move('ops', 'attack', micro)];
        }
        if (r === 4) actions = move('ops', 'attack', micro, fact ? [fact.id] : []);
        if (r === 5) actions = move('boundary', 'defend', mono, attacksOn(mono ?? '', 1).map(a => a.id).slice(-1));
        if (r === 6) actions = move('single', 'attack', mono);
      } else {
        if (r === 1 && sls) { const d = lastDefendOn(sls); actions = move('prepaid', 'attack', sls, d ? [d.id] : []); }
        if (r === 2) actions = concede('micro', 60);
        if (r === 3) actions = concede('serverless', 40);
      }
    }
    return { actions, tokens: actions.length ? T(2200, 300) : T(0, 0) };
  }

  async rule(a: BoardAction & { evidence: Evidence[] }): Promise<RulingOut> {
    const m = MOVE_BY_WHY.get(a.why);
    return { verdict: m?.verdict ?? 'partial', text: m?.ruling ?? '部分成立', evidenceOk: a.evidence.length > 0 && !!m && 'evidence' in m, tokens: T(500, 60) };
  }

  async final(view: BoardView): Promise<FinalOut> {
    const lost = view.claims.filter(c => c.status === 'ko').map(c => c.short);
    return {
      answer: '先做模块化单体：按领域分模块、共用一个部署单元，CI/CD 和监控先行。团队超过 15 人，或某个模块需要独立扩容时，再把它拆成服务。不要一开始就自建 K8s。',
      minority: lost.includes(STANCES.micro.short) ? ['微服务派：如果预计 12 个月内团队翻倍，现在就按服务边界划分模块。'] : [],
      userCruxes: ['未来 12 个月的团队规模和流量峰值大概是多少？这决定"什么时候拆"。'],
      confidence: 0.8,
      tokens: T(4200, 1200),
    };
  }
}

/** 选手编号 → 显示名（与吉祥物名单一致） */
export const FIGHTER_IDS = ['claude', 'codex', 'gemini', 'grok', 'muse', 'mistral', 'deepseek', 'doubao', 'qwen', 'kimi', 'yuanbao', 'glm', 'minimax'] as const;
export const fighterSpecs = (ids: string[]): FighterSpec[] => ids.map(id => ({ id, name: id.toUpperCase(), model: `demo/${id}` }));
