// 演示剧本：和 design/arena-mockup.html 里的默认比赛是同一场。
import type { MatchConfig } from '../engine.ts';
import type { Script } from '../scripted.ts';

export const demoConfig: MatchConfig = {
  matchId: 'demo-microservices',
  question: '5 人创业团队做 B2B SaaS，后端该上微服务还是单体？',
  fighters: [
    { id: 'claude', name: 'CLAUDE', model: 'demo/claude' },
    { id: 'codex', name: 'CODEX', model: 'demo/gpt' },
    { id: 'gemini', name: 'GEMINI', model: 'demo/gemini' },
    { id: 'deepseek', name: 'DEEPSEEK', model: 'demo/deepseek' },
  ],
  judge: 'demo/kimi',
  chair: 'demo/claude',
  budget: 60_000,
  maxRounds: 3,
  price: tokens => tokens * 0.12 / 31_400,
};

const draftTokens = { in: 600, out: 1400 };

export const demoScript: Script = {
  drafts: {
    claude: { answer: '先做模块化单体。', tokens: draftTokens, claims: [{ text: '先做模块化单体：按领域划清边界，真有瓶颈再拆', short: '先做模块化单体，按需再拆', label: 'inference' }] },
    codex: { answer: '直接上微服务。', tokens: draftTokens, claims: [{ text: '一开始就上微服务：各模块独立部署、独立扩容', short: '一开始就上微服务', label: 'inference' }] },
    gemini: { answer: '全部 Serverless。', tokens: draftTokens, claims: [{ text: '全部用 Serverless 函数：免运维、按量付费', short: '全部 Serverless，免运维', label: 'inference' }] },
    deepseek: { answer: '别自建 K8s。', tokens: draftTokens, claims: [{ text: '自建 K8s 微服务，运维约需 1 名专职人力', short: '自建 K8s 运维≈1 名专职', label: 'fact' }] },
  },
  crux: {
    clash: ['C1', 'C2', 'C3'],
    consensus: ['无论哪种架构，CI/CD 与监控先行'],
    merges: [],
    stances: { P4: 'C1' },
    why: 'C1/C2/C3 互斥，C4 待验证',
    tokens: { in: 900, out: 200 },
  },
  acts: {
    1: {
      claude: [{ kind: 'attack', target: 'C3', why: '冷启动会击穿 p99 延迟', steelman: 'Serverless 确实免去了服务器运维。', detail: 'B2B 客户通常签 SLA，冷启动会让 p99 出现秒级尖刺。' }],
      codex: [{ kind: 'attack', target: 'C1', why: '单体后期拆分代价高', steelman: '单体在早期开发最快、调试最简单。', detail: '单体长大后再拆，往往要大量重构。' }],
      gemini: [{ kind: 'defend', target: 'C3', why: '预留并发可消除冷启动', detail: '开启预留并发即可。', causedBy: ['A1'] }],
      deepseek: [{
        kind: 'attack', target: 'C2', why: '抽 1 人运维=砍 20% 研发', steelman: '微服务确实便于独立扩容和部署。',
        detail: '5 个人里抽 1 个专职做 K8s 运维，等于砍掉 20% 研发产能。',
        evidence: [{ kind: 'web', ref: 'https://example.com/k8s-ops-survey', quote: '小团队自建 K8s 平均需要 0.8–1.2 名专职运维（演示数据）' }],
        causedBy: ['C4'],
      }],
    },
    2: {
      claude: [{
        kind: 'attack', target: 'C3', why: '预留并发低流量下比 VM 贵', steelman: '预留并发确实能消除冷启动。',
        detail: '预留并发按小时计费，早期低流量时比一台小 VM 还贵。',
        evidence: [{ kind: 'web', ref: 'https://example.com/provisioned-concurrency-pricing', quote: '预留并发按小时计费（演示数据）' }],
        causedBy: ['A3'],
      }],
      codex: [{ kind: 'concede', target: 'C2', why: '运维人力确实不够，有条件改投 C1', detail: '团队超过 15 人或某模块需要独立扩容时再拆。', causedBy: ['A4'], shiftTo: 'C1' }],
      gemini: [{ kind: 'concede', target: 'C3', why: '成本优势不成立，改投 C1', detail: '冷启动和低流量成本两点无法反驳。', causedBy: ['A1', 'A5'], shiftTo: 'C1' }],
      deepseek: [],
    },
  },
  rulings: {
    A1: { verdict: 'upheld', text: '成立', evidenceOk: false },
    A2: { verdict: 'partial', text: '模块边界可缓解', evidenceOk: false },
    A3: { verdict: 'partial', text: '成立，但抵消了省钱优势', evidenceOk: false },
    A4: { verdict: 'upheld', text: '证据成立', evidenceOk: true },
    A5: { verdict: 'upheld', text: '证据成立', evidenceOk: true },
  },
  final: {
    answer: '先做模块化单体：按领域分模块、共用一个部署单元，CI/CD 和监控先行。团队超过 15 人，或某个模块需要独立扩容时，再把它拆成服务。不要一开始就自建 K8s。',
    minority: ['CODEX：如果预计 12 个月内团队翻倍，现在就按服务边界划分模块。'],
    userCruxes: ['未来 12 个月的团队规模和流量峰值大概是多少？这决定"什么时候拆"。'],
    confidence: 0.82,
    tokens: { in: 4200, out: 1200 },
  },
};
