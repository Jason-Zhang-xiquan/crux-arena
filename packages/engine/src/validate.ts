// 动作合规检查。大脑可能乱来，引擎必须兜底：目标存在、不能打自己、认输必须写原因等。
import type { ActionDraft } from './brains.ts';
import type { MatchState } from './state.ts';

export interface RoundUsage { attack: boolean; defend: boolean }

/** 返回问题列表；只有"原因缺失"这一类问题时，引擎会在重试后带 flag 放行 */
export function checkAction(s: MatchState, actor: string, a: ActionDraft, used: RoundUsage): { errors: string[]; causeOnly: boolean } {
  const errors: string[] = [];
  const causeErrors: string[] = [];
  const target = s.claims[a.target];
  const supports = (id: string) => !!s.claims[id]?.supporters.includes(actor);
  const team = (id: string) => s.start?.fighters.find(f => f.id === id)?.team;

  if (!target) errors.push(`目标 ${a.target} 不存在`);
  else if (target.status !== 'alive') errors.push(`目标 ${a.target} 已出局`);

  if (!a.why?.trim()) errors.push('缺少 why（一句话理由）');

  if (a.kind === 'attack') {
    if (used.attack) errors.push('本回合已经攻击过一次');
    if (target && supports(a.target)) errors.push(`不能攻击自己支持的 ${a.target}`);
    if (target && s.start?.mode === 'team' && team(target.owner) && team(target.owner) === team(actor)) errors.push(`组队模式不能攻击队友的 ${a.target}`);
  }
  if (a.kind === 'defend') {
    if (used.defend) errors.push('本回合已经防守过一次');
    if (target && !supports(a.target)) errors.push(`只能防守自己支持的论点，${a.target} 不在其中`);
  }
  if (a.kind === 'concede') {
    if (target && !supports(a.target)) errors.push(`只能放弃自己支持的论点，${a.target} 不在其中`);
    if (a.shiftTo && (a.shiftTo === a.target || s.claims[a.shiftTo]?.status !== 'alive')) errors.push(`改投目标 ${a.shiftTo} 无效`);
  }
  if (a.kind === 'shift' && target && supports(a.target)) errors.push(`已经支持 ${a.target}，无需改投`);

  if (a.kind === 'concede' || a.kind === 'shift') {
    const refs = a.causedBy ?? [];
    if (!refs.length) causeErrors.push('认输 / 改投必须在 causedBy 里写明被哪一步说服');
    for (const r of refs) {
      const act = s.actions[r];
      if (!act && !s.claims[r]) causeErrors.push(`causedBy 引用的 ${r} 不存在`);
      else if (act?.actor === actor) causeErrors.push(`causedBy 不能引用自己的动作 ${r}`);
    }
  }
  return { errors: [...errors, ...causeErrors], causeOnly: errors.length === 0 && causeErrors.length > 0 };
}
