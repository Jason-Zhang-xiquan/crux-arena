// 真实模型：探测本机通道（Claude Code、Cursor Agent），按选手分配座位，记录每次调用到 calls.jsonl。
// 没有通道的选手直接报错，不会偷偷换成别的模型冒充（PLAN §6.7）。
import { appendFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CustomConfig, LENSES, LlmBrains, claudeCodeChannel, createChannel, cursorChannel, cursorModelFor, limit, loadCustomConfig } from '@crux/channels';
import type { CallRecord, Channel, Effort, LensSet, Seat } from '@crux/channels';
import type { Evidence } from '@crux/engine';
import type { BrainsFactory } from './match.ts';
import { customConfigFile } from './settings.ts';

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
  /** 共享背景材料：文件 + 行号范围，经只读工具读取并带行号；不传就用默认侦察（仓库地图 + README + 清单文件） */
  context?: Array<{ path: string; from: number; to: number }>;
  contextInAct?: boolean;
  lenses?: LensSet | 'none';         // 立场视角，默认 decision
  allowReads?: boolean;              // 选手盲答前能否请求读文件，默认能（有文件夹时）
  onCall?: (c: CallRecord) => void;
}

interface Probe { cursor?: Channel; models: Set<string>; claudeCode?: Channel; custom: CustomConfig; channels: Map<string, Channel>; configError?: string }

/** 只读、不耗额度的通道探测 + 读用户的 channels.json；同一进程里只做一次（桌面版改了配置后调 resetProbe） */
let probed: Promise<Probe> | undefined;
export function probeChannels(): Promise<Probe> {
  probed ??= (async () => {
    let cursor: Channel | undefined, models = new Set<string>(), claudeCode: Channel | undefined, configError: string | undefined;
    let custom = CustomConfig.parse({});
    await Promise.all([
      (async () => { try { const c = await cursorChannel(); cursor = limit(c); models = c.models; } catch { /* 没装 Cursor Agent */ } })(),
      (async () => { try { const cc = await claudeCodeChannel(); if (cc.loggedIn) claudeCode = limit(cc); } catch { /* 没装 Claude Code */ } })(),
      (async () => { try { custom = await loadCustomConfig(customConfigFile()); } catch (err) { configError = (err as Error).message; } })(),
    ]);
    const channels = new Map<string, Channel>();
    if (cursor) channels.set('cursor', cursor);
    if (claudeCode) channels.set('claude-code', claudeCode);
    for (const [id, cfg] of Object.entries(custom.channels)) channels.set(id, limit(createChannel(id, cfg)));
    return { cursor, models, claudeCode, custom, channels, configError };
  })();
  return probed;
}
export const resetProbe = () => { probed = undefined; };

interface SeatPlan { seat: Seat; display: string; name?: string }

/** 选手 → 座位：channels.json 里写了的优先（新 AI，或者改自带选手的通道），否则 Claude Code / Cursor */
function seatFor(p: Probe, id: string, effort: Effort): SeatPlan | undefined {
  const f = p.custom.fighters[id];
  if (f) {
    const channel = p.channels.get(f.channel);
    if (!channel) return undefined;
    const e = f.effort ?? effort;
    const shown = f.channel === 'cursor' ? cursorModelFor(f.model, e, p.models) : f.model;
    if (!shown) return undefined;
    return { seat: { channel, model: f.model, effort: e }, display: `${f.channel}/${shown}`, name: f.name };
  }
  if (id === 'claude' && p.claudeCode) return { seat: { channel: p.claudeCode, model: CLAUDE_CODE_MODEL, effort }, display: `claude-code/${CLAUDE_CODE_MODEL}` };
  const base = CURSOR_ROSTER[id];
  const resolved = p.cursor && base && cursorModelFor(base, effort, p.models);
  if (!p.cursor || !resolved) return undefined;
  return { seat: { channel: p.cursor, model: base, effort }, display: `cursor/${resolved}` };
}

/** 裁判 / 主席：channels.json 的 roles 优先，否则 Cursor 的 composer-2.5（不属于任何参赛厂商） */
function roleSeat(p: Probe, role: 'judge' | 'chair', fallbackModel: string, effort: Effort): Seat | undefined {
  const r = p.custom.roles[role];
  if (r) { const channel = p.channels.get(r.channel); return channel && { channel, model: r.model, effort: r.effort ?? effort }; }
  return p.cursor && { channel: p.cursor, model: fallbackModel, effort };
}

/** 选手编号 → 实际会用的通道和模型；没有通道的不在里面 */
export async function availableFighters(effort: Effort = 'low'): Promise<Record<string, string>> {
  const p = await probeChannels();
  const out: Record<string, string> = {};
  for (const id of new Set([...Object.keys(CURSOR_ROSTER), 'claude', ...Object.keys(p.custom.fighters)])) {
    const s = seatFor(p, id, effort);
    if (s) out[id] = s.display;
  }
  return out;
}

/** channels.json 里新加的选手（名字、颜色），桌面版用来显示还没画形象的新 AI */
export async function customFighters(): Promise<Array<{ id: string; name: string; color?: string; maker?: string }>> {
  const p = await probeChannels();
  return Object.entries(p.custom.fighters).map(([id, f]) => ({ id, name: f.name ?? id.toUpperCase(), ...(f.color ? { color: f.color } : {}), ...(f.maker ? { maker: f.maker } : {}) }));
}

/** 问题像代码审查就用代码视角，否则用决策视角 */
export const autoLens = (question: string, dir?: string): LensSet =>
  dir && /bug|代码|code|review|审查|实现|架构|重构|安全|性能|漏洞|可行/i.test(question) ? 'code' : 'decision';

const norm = (s: string) => s.replace(/[\s`*>#|\-—–"“”'‘’]/g, '');
const REF = /^(.+?):(\d+)(?:-(\d+))?$/;
const MAX_READ_LINES = 120;

export function realBrains(o: RealOptions = {}): BrainsFactory {
  return async ({ fighters, rec, ws, matchDir }) => {
    const effort = o.effort ?? 'low';
    const p = await probeChannels();
    if (p.configError) throw new Error(p.configError);

    const seats: Record<string, Seat> = {};
    const specs = fighters.map(f => {
      const plan = seatFor(p, f.id, effort);
      if (!plan) throw new Error(`${f.name} 没有可用通道（PLAN §6.7：不会用别的模型冒充）`);
      seats[f.id] = plan.seat;
      return { ...f, name: plan.name ?? f.name, model: plan.display };
    });
    const judge = roleSeat(p, 'judge', o.judge ?? 'composer-2.5', 'low');
    const chair = roleSeat(p, 'chair', o.chair ?? 'composer-2.5', 'medium');
    if (!judge || !chair) throw new Error('裁判和主席需要一条通道：登录 Cursor Agent，或在 channels.json 的 roles 里指定');

    const callsFile = path.join(matchDir, 'calls.jsonl');
    await writeFile(callsFile, '');
    let writes: Promise<void> = Promise.resolve();

    // 文件证据核对：读原文（带审计），引文去掉空白和标点后必须出现在所引行附近
    const verify = async (e: Evidence) => {
      if (!ws) return { ok: false, note: `${e.ref}：没有打开文件夹，无法核对` };
      const m = e.ref.match(REF);
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

    // 选手请求读文件：同样走只读工具（沙箱、屏蔽敏感文件、审计），每段最多 120 行
    const read = async (actor: string, ref: string) => {
      const m = ref.match(REF);
      if (!ws || !m) return `【${ref}】无法读取：格式应为 路径:起-止行`;
      const from = Number(m[2]), to = Math.min(Number(m[3] ?? m[2]), from + MAX_READ_LINES - 1);
      try {
        const r = await ws.readFile(actor, m[1], from, to);
        return `【${r.path} 第 ${r.from}–${r.to} 行，共 ${r.totalLines} 行】\n${r.text}`;
      } catch (err) {
        return `【${ref}】无法读取：${(err as Error).message}`;
      }
    };

    const lenses = o.lenses === 'none' ? undefined : LENSES[o.lenses ?? 'decision'];
    const brains = new LlmBrains({
      seats, judge, chair, state: () => rec.state, verify, contextInAct: o.contextInAct ?? true, lenses,
      ...(ws && o.allowReads !== false ? { read } : {}),
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
        const wanted = o.context ?? [
          { path: 'README.md', from: 1, to: 60 },
          ...['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml'].map(p => ({ path: p, from: 1, to: 40 })),
        ];
        if (!o.context) parts.push(`【仓库地图】\n${await w.repoMap(150)}`);
        for (const c of wanted) {
          try {
            const r = await w.readFile('scout', c.path, c.from, c.to);
            parts.push(`【${r.path} 第 ${r.from}–${r.to} 行，共 ${r.totalLines} 行】\n${r.text}`);
          } catch { /* 文件不存在或被屏蔽 */ }
        }
        brains.setContext(parts.join('\n\n'));
      },
    };
  };
}
