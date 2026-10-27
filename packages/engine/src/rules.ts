// 数值规则：伤害由引擎按裁决类别算，不让模型自己报数字，保证同样的裁决得到同样的结果。
import type { ActionKind, Verdict } from './schema.ts';

export const HP_MAX = 100;
export const CRED_START = 100;
export const DAMAGE: Record<Verdict, number> = { upheld: 30, partial: 15, rejected: 0 };
export const HEAL: Record<Verdict, number> = { upheld: 10, partial: 5, rejected: 0 };
export const CRIT_MULT = 1.5;
export const WHY_LIMIT = 20;      // 20 个汉字，或 12 个英文词
export const RULING_LIMIT = 15;

/** 有证据、证据被裁判核实、且裁决成立，才算暴击 */
export function score(kind: ActionKind, verdict: Verdict, hasEvidence: boolean, evidenceOk: boolean) {
  if (kind === 'attack') {
    const crit = verdict === 'upheld' && hasEvidence && evidenceOk;
    return { damage: Math.round(DAMAGE[verdict] * (crit ? CRIT_MULT : 1)), heal: 0, crit };
  }
  if (kind === 'defend') return { damage: 0, heal: HEAL[verdict], crit: false };
  return { damage: 0, heal: 0, crit: false };
}

export const credForAttack = (damage: number) => ({ attacker: Math.round(damage / 5), owner: -Math.round(damage / 3.5) });
export const credForDefend = (heal: number) => Math.round(heal / 3);

const CJK = /[　-〿㐀-鿿豈-﫿＀-￯]/u;

/** 文本"长度"：一个汉字算 1，一个英文词算 20/12，和"20 个汉字 / 12 个英文词"等价 */
export function measure(text: string): number {
  let units = 0;
  for (const m of text.matchAll(/[　-〿㐀-鿿豈-﫿＀-￯]|[A-Za-z0-9][\w'.%+-]*/gu)) {
    units += CJK.test(m[0]) ? 1 : 20 / 12;
  }
  return units;
}

/** 超长就截断并加省略号；返回是否截断，便于引擎记 flag */
export function clampText(text: string, limit: number): { text: string; truncated: boolean } {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (measure(clean) <= limit) return { text: clean, truncated: false };
  let out = '';
  for (const ch of clean) {
    if (measure(out + ch) > limit - 1) break;
    out += ch;
  }
  return { text: out.trimEnd() + '…', truncated: true };
}
