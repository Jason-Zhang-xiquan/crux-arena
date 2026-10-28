// battle-log.md 生成器：从事件确定性生成，零 token。一个动作一行，末尾附说服链和结论溯源。
import type { EventOf, MatchEvent } from './schema.ts';
import { reduce } from './state.ts';
import type { MatchState } from './state.ts';

const LABEL = { fact: '事实', inference: '推断', speculation: '猜测' } as const;
const KIND = { attack: '攻', defend: '守', concede: '让', shift: '改' } as const;
const MODE = { ffa: 'FFA · 混战', team: 'TEAM · 红 vs 蓝' } as const;
const FLAG = { no_cause: '无因认输', why_truncated: '理由截断', invalid_action: '动作不合规', budget: '预算用尽' } as const;

/** 等宽对齐：中日韩字符按 2 格算 */
const width = (s: string) => [...s].reduce((w, ch) => w + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u.test(ch) ? 2 : 1), 0);
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(1, n - width(s)));
const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));
const refId = (r: string) => (r.startsWith('A') ? `#${r}` : r);

export function renderBattleLog(events: MatchEvent[]): string {
  const s = reduce(events);
  const start = s.start;
  if (!start) throw new Error('事件里没有 match_started');
  const name = (id: string) => start.fighters.find(f => f.id === id)?.name ?? id;
  const teamTag = (id: string) => {
    const t = start.fighters.find(f => f.id === id)?.team;
    return start.mode === 'team' && t ? (t === 'red' ? '红·' : '蓝·') : '';
  };
  const W = Math.max(8, ...start.fighters.map(f => width(teamTag(f.id) + f.name))) + 1;
  const reads = Object.values(s.reads).reduce((a, b) => a + b, 0);

  const out: string[] = [
    `# Battle Log · ${start.question}`,
    [
      `模式 ${MODE[start.mode]}`,
      `选手 ${start.fighters.map(f => teamTag(f.id) + f.name).join(' · ')}`,
      `裁判 ${start.judge}`,
      `${fmtK(s.tokens)} tok${s.ended?.costUsd ? ` · $${s.ended.costUsd.toFixed(2)}` : ''}`,
      ...(start.workspace ? [`文件夹 ${start.workspace.root}（只读，读取 ${reads} 次，写入 0 次）`] : []),
    ].join(' | '),
    '',
  ];

  const row = (id: string, round: number, tag: string, who: string, body: string) =>
    out.push(`${pad(id, 4)} R${round} ${tag} ${pad(who, W)}${body}`.trimEnd());

  for (const e of events) {
    switch (e.type) {
      case 'claim':
        row(e.id, 0, '立', teamTag(e.actor) + name(e.actor), `${pad(e.short, 34)}[${LABEL[e.label]}]`);
        break;
      case 'second':
        row('', 0, '附', teamTag(e.actor) + name(e.actor), `> ${e.target}  ${e.why}`);
        break;
      case 'crux': {
        const merged = e.merges.map(m => `${m.from}→${m.into}`).join(' ');
        row('', 0, '裁', 'JUDGE', `分歧：${e.clash.join('/') || '无'}${merged ? ` · 合并 ${merged}` : ''}${e.consensus.length ? ` · 共识：${e.consensus.join('；')}` : ''}`);
        break;
      }
      case 'action':
        row(`#${e.id}`, e.round, KIND[e.kind], teamTag(e.actor) + name(e.actor), actionBody(s, e));
        break;
      case 'skip':
        row('', e.round, '略', teamTag(e.actor) + name(e.actor), `${pad(e.reason, 40)}${e.savedTokens ? `省 ${fmtK(e.savedTokens)} tok` : ''}`);
        break;
      case 'converged': {
        const why = { flawless: '无分歧，FLAWLESS VICTORY', settled: '立场收敛，提前结束', budget: '预算用尽，直接综合', max_rounds: '打满回合，进入综合', forfeit: '交出盲答的不到 2 人，对局无效' }[e.reason];
        row('', e.round, '裁', 'JUDGE', `${pad(why, 40)}${e.savedTokens ? `省 ~${fmtK(e.savedTokens)} tok` : ''}`);
        break;
      }
      case 'final':
        row('', s.round, '终', 'CHAIR', `置信度 ${Math.round(e.confidence * 100)}% · 无因认输 ${s.flags.filter(f => f.kind === 'no_cause').length} 次`);
        break;
    }
  }

  out.push('', '## 冠军答案', s.final?.answer ?? '（未完成）');
  if (s.final?.minority.length) out.push('', '少数派：' + s.final.minority.join('；'));
  if (s.final?.userCruxes.length) out.push('需要你判断：' + s.final.userCruxes.join('；'));

  out.push('', '## 说服链');
  if (!s.edges.length) out.push('（无人改变立场）');
  for (const e of s.edges) {
    out.push(`${pad(name(e.from), W)}=> ${pad(name(e.to), W)}${pad(e.on, 4)}${pad(e.why, 34)}${e.causes.map(refId).join(' ')} → #${e.change}`);
  }

  out.push('', '## 结论溯源');
  for (const id of s.order.filter(x => s.claims[x])) out.push(traceLine(s, id, name));

  if (s.flags.length) {
    out.push('', '## 标记');
    for (const f of s.flags) out.push(`- ${FLAG[f.kind]}${f.actor ? ` · ${name(f.actor)}` : ''}${f.action ? ` · #${f.action}` : ''}：${f.note}`);
  }
  if (start.workspace) {
    out.push('', '## 文件读取（只读审计）');
    for (const [who, n] of Object.entries(s.reads)) out.push(`- ${name(who)}：${n} 次`);
  }
  return out.join('\n') + '\n';
}

function actionBody(s: MatchState, e: EventOf<'action'>): string {
  const r = s.actions[e.id]?.ruling;
  const web = e.evidence.some(x => x.kind === 'web') ? ' [web]' : '';
  const file = e.evidence.find(x => x.kind === 'file');
  const why = `${e.why}${web}${file ? ` [${file.ref}]` : ''}`;
  let result = '';
  if (e.kind === 'attack' && r) result = `→ ${r.damage ? `-${r.damage}` : '0'}${r.crit ? ' 暴击' : ''}｜${r.text}`;
  if (e.kind === 'defend' && r) result = `→ +${r.heal}｜${r.text}`;
  if (e.kind === 'concede') result = `→ ${e.target} K.O.${e.shiftTo ? `，改投 ${e.shiftTo}` : ''}`;
  if (e.kind === 'shift') result = '→ 改投';
  const causes = e.causedBy.length ? `  ←${e.causedBy.map(refId).join(' ')}` : '';
  return `${pad(`> ${e.target}`, 6)}${pad(why, 34)}${result}${causes}`;
}

function traceLine(s: MatchState, id: string, name: (id: string) => string): string {
  const c = s.claims[id];
  if (c.status === 'merged') return `${id} → 并入 ${c.mergedInto}`;
  if (c.status === 'ko') {
    const by = c.koBy ? s.actions[c.koBy] : undefined;
    if (by?.kind === 'concede') return `${id} ✗ ← #${by.id} ${name(by.actor)} 认输${by.causedBy.length ? ` ← ${by.causedBy.map(refId).join(' ')}` : '（无因）'}`;
    return `${id} ✗ ← #${by?.id ?? '?'} ${by ? name(by.actor) : ''} 击穿`;
  }
  const hits = Object.values(s.actions).filter(a => a.kind === 'attack' && a.target === id).map(a => `#${a.id}`);
  const backers = c.supporters.filter(x => x !== c.owner).map(name);
  const base = hits.length ? `扛住 ${hits.join(' ')}` : c.label === 'fact' ? '事实，未被反驳' : '未被攻击';
  return `${id} ✓ ${c.hp}HP  ${base}${backers.length ? ` · ${backers.join('、')} 支持` : ''}`;
}
