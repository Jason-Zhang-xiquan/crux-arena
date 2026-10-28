// 真实模型：探测本机通道（Claude Code、Cursor Agent），按选手分配座位，记录每次调用到 calls.jsonl。
// 没有通道的选手直接报错，不会偷偷换成别的模型冒充（PLAN §6.7）。
import { appendFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LlmBrains, claudeCodeChannel, cursorChannel, cursorModelFor, limit } from '@crux/channels';
import type { CallRecord, Channel, Effort, Seat } from '@crux/channels';
import type { Evidence } from '@crux/engine';
import type { BrainsFactory } from './match.ts';

/** 选手 → Cursor 里对应的模型（不带档位后缀） */
export const CURSOR_ROSTER: Record<string, string> = {
  claude: 'claude-opus-5-5',
  codex: 'gpt-5.6-sol',
  grok: 'grok-4.7',
  gemini: 'gemini-4-argon',
  muse: 'muse-spark-1.3',
  deepseek: 'deepseek-v41-flash-1017',
  kimi: 'kimi-k3',
  glm: 'glm-5.2',
};
export const CLAUDE_CODE_MODEL = 'claude-opus-5-5';

export interface RealOptions {
  effort?: Effort;                   // 选手推理档位，默认 low（省 token）
  judge?: string;                    // 裁判模型（Cursor），默认 composer-2.5：不属于任何参赛厂商
  chair?: string;
  /** 共享背景材料：文件 + 行号范围，经只读工具读取并带行号 */
  context?: Array<{ path: string; from: number; to: number }>;
  contextInAct?: boolean;
  onCall?: (c: CallRecord) => void;
}

const norm = (s: string) => s.replace(/[\s`*>#|\-—–"“”'‘’]/g, '');

export function realBrains(o: RealOptions = {}): BrainsFactory {
  return async ({ fighters, rec, ws, matchDir }) => {
    const effort = o.effort ?? 'low';
    const cursorRaw = await cursorChannel();
    const cursor = limit(cursorRaw);
    let claudeCode: Channel | undefined;
    try {
      const cc = await claudeCodeChannel();
      if (cc.loggedIn) claudeCode = limit(cc);
    } catch { /* 没装 Claude Code */ }

    const seats: Record<string, Seat> = {};
    const specs = fighters.map(f => {
      if (f.id === 'claude' && claudeCode) {
        seats[f.id] = { channel: claudeCode, model: CLAUDE_CODE_MODEL, effort };
        return { ...f, model: `claude-code/${CLAUDE_CODE_MODEL}` };
      }
      const base = CURSOR_ROSTER[f.id];
      const resolved = base && cursorModelFor(base, effort, cursorRaw.models);
      if (!resolved) throw new Error(`${f.name} 没有可用通道（PLAN §6.7：不会用别的模型冒充）`);
      seats[f.id] = { channel: cursor, model: base, effort };
      return { ...f, model: `cursor/${resolved}` };
    });
    const judge: Seat = { channel: cursor, model: o.judge ?? 'composer-2.5', effort: 'low' };
    const chair: Seat = { channel: cursor, model: o.chair ?? 'composer-2.5', effort: 'medium' };

    const callsFile = path.join(matchDir, 'calls.jsonl');
    await writeFile(callsFile, '');
    let writes: Promise<void> = Promise.resolve();

    // 文件证据核对：读原文（带审计），引文去掉空白和标点后必须出现在所引行附近
    const verify = async (e: Evidence) => {
      if (!ws) return { ok: false, note: `${e.ref}：没有打开文件夹，无法核对` };
      const m = e.ref.match(/^(.+?):(\d+)(?:-(\d+))?$/);
      if (!m) return { ok: false, note: `${e.ref}：格式应为 路径:起-止行` };
      if (!e.quote?.trim()) return { ok: false, note: `${e.ref}：没有给出原文引文` };
      try {
        const r = await ws.readFile('judge', m[1], Math.max(1, Number(m[2]) - 2), Number(m[3] ?? m[2]) + 2);
        const text = r.text.split('\n').map(l => l.replace(/^\d+\| /, '')).join('');
        const ok = norm(text).includes(norm(e.quote).slice(0, 80));
        return { ok, note: `${e.ref}：${ok ? '原文核对一致' : '原文里找不到这段引文'}` };
      } catch (err) {
        return { ok: false, note: `${e.ref}：${(err as Error).message}` };
      }
    };

    const brains = new LlmBrains({
      seats, judge, chair, state: () => rec.state, verify, contextInAct: o.contextInAct ?? true,
      onCall: c => {
        writes = writes.then(() => appendFile(callsFile, JSON.stringify({ at: new Date().toISOString(), ...c }) + '\n'));
        o.onCall?.(c);
      },
    });

    return {
      brains, fighters: specs,
      judge: `${judge.channel.id}/${judge.model}`, chair: `${chair.channel.id}/${chair.model}`,
      scout: async w => {
        const parts: string[] = [];
        for (const c of o.context ?? []) {
          try {
            const r = await w.readFile('scout', c.path, c.from, c.to);
            parts.push(`【${r.path} 第 ${r.from}–${r.to} 行】\n${r.text}`);
          } catch { /* 文件不存在或被屏蔽 */ }
        }
        brains.setContext(parts.join('\n\n'));
      },
    };
  };
}

export const REAL_FIGHTERS = Object.keys(CURSOR_ROSTER);
