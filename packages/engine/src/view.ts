// 论点板视图：给大脑看的压缩状态（不是完整聊天记录），并做匿名化。
import type { BoardView } from './brains.ts';
import type { MatchState } from './state.ts';

/** 选手 id → 匿名代号（按出场顺序 P1、P2…），裁判和选手都只看到代号 */
export function aliases(s: MatchState): Map<string, string> {
  return new Map((s.start?.fighters ?? []).map((f, i) => [f.id, `P${i + 1}`]));
}

export function boardView(s: MatchState, viewer?: string): BoardView {
  const alias = aliases(s);
  const name = (id: string) => (id === viewer ? 'YOU' : alias.get(id) ?? id);
  return {
    question: s.start?.question ?? '',
    round: s.round,
    viewer: viewer ? alias.get(viewer) : undefined,
    claims: s.order.filter(id => s.claims[id]).map(id => {
      const c = s.claims[id];
      return { id, owner: name(c.owner), short: c.short, label: c.label, hp: c.hp, status: c.status, supporters: c.supporters.map(name) };
    }),
    consensus: s.crux?.consensus ?? [],
    recent: Object.values(s.actions)
      .filter(a => a.round >= s.round - 1)
      .map(a => ({ id: a.id, round: a.round, actor: name(a.actor), kind: a.kind, target: a.target, why: a.why, verdict: a.ruling?.verdict, crit: a.ruling?.crit })),
  };
}

const LABEL = { fact: '事实', inference: '推断', speculation: '猜测' } as const;
const KIND = { attack: '攻', defend: '守', concede: '让', shift: '改' } as const;

/** 渲染成紧凑文本，直接放进提示词；每张卡、每个动作各一行 */
export function renderBoard(v: BoardView): string {
  const lines = [`问题：${v.question}`, `回合：${v.round}${v.viewer ? ` · 你是 ${v.viewer}` : ''}`, '论点板：'];
  for (const c of v.claims) {
    if (c.status === 'merged') continue;
    lines.push(`- ${c.id} [${LABEL[c.label]}] ${c.status === 'ko' ? '出局' : `${c.hp}HP`} · ${c.short} · 支持：${c.supporters.join(',')}`);
  }
  if (v.consensus.length) lines.push(`共识：${v.consensus.join('；')}`);
  if (v.recent.length) {
    lines.push('最近动作：');
    for (const a of v.recent) lines.push(`- #${a.id} R${a.round} ${a.actor} ${KIND[a.kind]} ${a.target}：${a.why}${a.verdict ? `（${a.verdict}${a.crit ? '，暴击' : ''}）` : ''}`);
  }
  return lines.join('\n');
}
