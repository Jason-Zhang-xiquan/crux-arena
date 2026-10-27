// 由事件推导比赛状态。同一串事件永远得到同一个状态：回放、日志生成、断点续跑都靠它。
import type { EventOf, Label, MatchEvent } from './schema.ts';
import { sumTokens } from './schema.ts';
import { CRED_START, HP_MAX, credForAttack, credForDefend } from './rules.ts';

export interface ClaimState {
  id: string;
  owner: string;
  text: string;
  short: string;
  label: Label;
  hp: number;
  status: 'alive' | 'ko' | 'merged';
  supporters: string[];              // 第一个是作者；附议、改投的人依次追加
  koBy?: string;                     // 被哪一步打出局（认输或血量归零）
  mergedInto?: string;
}

export interface Edge {
  from: string;                      // 说服者
  to: string;                        // 被说服者
  on: string;                        // 在哪张论点卡上
  why: string;                       // 说服者那一步的理由
  causes: string[];                  // 引起改变的动作编号
  change: string;                    // 认输 / 改投 那一步的编号
}

export type ActionState = EventOf<'action'> & { ruling?: EventOf<'ruling'> };

export interface MatchState {
  start?: EventOf<'match_started'>;
  round: number;
  claims: Record<string, ClaimState>;
  actions: Record<string, ActionState>;
  order: string[];                   // 论点和动作的出现顺序
  crux?: EventOf<'crux'>;
  cred: Record<string, number>;
  tokens: number;
  saved: number;
  edges: Edge[];
  flags: EventOf<'flag'>[];
  skips: EventOf<'skip'>[];
  reads: Record<string, number>;
  converged?: EventOf<'converged'>;
  final?: EventOf<'final'>;
  ended?: EventOf<'match_ended'>;
}

export const initialState = (): MatchState => ({
  round: 0, claims: {}, actions: {}, order: [], cred: {}, tokens: 0, saved: 0, edges: [], flags: [], skips: [], reads: {},
});

const addSupporter = (c: ClaimState | undefined, who: string) => { if (c && !c.supporters.includes(who)) c.supporters.push(who); };
const dropSupporter = (s: MatchState, who: string, except: string) => {
  for (const c of Object.values(s.claims)) if (c.id !== except && c.owner !== who) c.supporters = c.supporters.filter(x => x !== who);
};

/** 把一个事件应用到状态上（原地修改并返回，方便逐条回放） */
export function apply(s: MatchState, e: MatchEvent): MatchState {
  switch (e.type) {
    case 'match_started':
      s.start = e;
      for (const f of e.fighters) s.cred[f.id] = CRED_START;
      break;
    case 'round_started':
      s.round = e.round;
      break;
    case 'claim':
      s.claims[e.id] = { id: e.id, owner: e.actor, text: e.text, short: e.short, label: e.label, hp: HP_MAX, status: 'alive', supporters: [e.actor] };
      s.order.push(e.id);
      s.tokens += sumTokens(e.tokens);
      break;
    case 'second':
      addSupporter(s.claims[e.target], e.actor);
      break;
    case 'crux':
      s.crux = e;
      for (const m of e.merges) {
        const from = s.claims[m.from];
        if (!from) continue;
        from.status = 'merged'; from.mergedInto = m.into;
        for (const who of from.supporters) addSupporter(s.claims[m.into], who);
      }
      s.tokens += sumTokens(e.tokens);
      break;
    case 'action': {
      s.actions[e.id] = { ...e };
      s.order.push(e.id);
      s.tokens += sumTokens(e.tokens);
      if (e.kind === 'concede' || e.kind === 'shift') {
        if (e.kind === 'concede') {
          const c = s.claims[e.target];
          if (c && c.status === 'alive') { c.status = 'ko'; c.hp = 0; c.koBy = e.id; }
          if (e.shiftTo) { dropSupporter(s, e.actor, e.shiftTo); addSupporter(s.claims[e.shiftTo], e.actor); }
        } else {
          dropSupporter(s, e.actor, e.target);
          addSupporter(s.claims[e.target], e.actor);
        }
        // 说服边：每个"原因动作"的发起人 → 改变立场的人
        const byActor = new Map<string, string[]>();
        for (const ref of e.causedBy) {
          const cause = s.actions[ref];
          const who = cause?.actor ?? s.claims[ref]?.owner;
          if (!who || who === e.actor) continue;
          byActor.set(who, [...(byActor.get(who) ?? []), ref]);
        }
        for (const [from, causes] of byActor) {
          const first = s.actions[causes.find(r => s.actions[r]) ?? ''];
          s.edges.push({ from, to: e.actor, on: e.kind === 'concede' ? e.target : (e.causedBy.map(r => s.actions[r]?.target).find(Boolean) ?? e.target), why: first?.why ?? s.claims[causes[0]]?.short ?? '', causes, change: e.id });
        }
      }
      break;
    }
    case 'ruling': {
      const a = s.actions[e.action];
      if (!a) break;
      a.ruling = e;
      s.tokens += sumTokens(e.tokens);
      const c = s.claims[a.target];
      if (a.kind === 'attack' && c) {
        c.hp = Math.max(0, c.hp - e.damage);
        if (c.hp === 0 && c.status === 'alive') { c.status = 'ko'; c.koBy = a.id; }
        const d = credForAttack(e.damage);
        s.cred[a.actor] = (s.cred[a.actor] ?? CRED_START) + d.attacker;
        s.cred[c.owner] = (s.cred[c.owner] ?? CRED_START) + d.owner;
      }
      if (a.kind === 'defend' && c) {
        c.hp = Math.min(HP_MAX, c.hp + e.heal);
        s.cred[a.actor] = (s.cred[a.actor] ?? CRED_START) + credForDefend(e.heal);
      }
      break;
    }
    case 'skip':
      s.skips.push(e);
      s.saved += e.savedTokens;
      if (e.tokens) s.tokens += sumTokens(e.tokens);
      break;
    case 'flag':
      s.flags.push(e);
      if (e.tokens) s.tokens += sumTokens(e.tokens);
      break;
    case 'tool_call':
      s.reads[e.actor] = (s.reads[e.actor] ?? 0) + 1;
      break;
    case 'converged':
      s.converged = e;
      s.saved += e.savedTokens;
      break;
    case 'final':
      s.final = e;
      s.tokens += sumTokens(e.tokens);
      break;
    case 'match_ended':
      s.ended = e;
      break;
  }
  return s;
}

export const reduce = (events: MatchEvent[]) => events.reduce(apply, initialState());

/** 某名选手当前站在哪些"仍在争议中的"论点上（用于判断立场是否重合、是否收敛） */
export function stanceOf(s: MatchState, fighter: string): string[] {
  const clash = new Set(s.crux?.clash ?? []);
  return Object.values(s.claims)
    .filter(c => c.status === 'alive' && clash.has(c.id) && c.supporters.includes(fighter))
    .map(c => c.id).sort();
}

export const aliveClash = (s: MatchState) => (s.crux?.clash ?? []).filter(id => s.claims[id]?.status === 'alive');
