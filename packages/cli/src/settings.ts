// 共享设置：桌面版和 CLI 读同一个 settings.json（桌面版的数据目录）。
// agent 拉起的对局（crux fight，没写的参数）都按这里的默认值来；桌面版设置页改的也是这份。
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type Display = 'full' | 'mini' | 'none';
export type Effort = 'off' | 'low' | 'medium' | 'high' | 'max';

export interface FightDefaults {
  team: string[];
  mode: 'ffa' | 'team';
  brains: 'real' | 'demo';
  effort: Effort;
  rounds: number;
  budget: number;
  agentDisplay: Display;             // agent 拉起的对局怎么显示：完整竞技场 / 角落小窗 / 不显示（纯后台）
  matchesDir: string;                // 空字符串 = 默认位置
}

export const FIGHT_DEFAULTS: FightDefaults = {
  team: ['claude', 'codex', 'gemini', 'deepseek'], mode: 'ffa', brains: 'real', effort: 'low',
  rounds: 2, budget: 250_000, agentDisplay: 'mini', matchesDir: '',
};

/** 和桌面版的 app.getPath('userData') 一致（应用名 Crux Arena）；CRUX_HOME 可以覆盖 */
export function dataDir(): string {
  if (process.env.CRUX_HOME) return process.env.CRUX_HOME;
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Crux Arena');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Crux Arena');
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'Crux Arena');
}

export async function loadFightDefaults(): Promise<FightDefaults> {
  let saved: Partial<FightDefaults> = {};
  try { saved = JSON.parse(await readFile(path.join(dataDir(), 'settings.json'), 'utf8')); } catch { /* 还没有设置文件 */ }
  const out = { ...FIGHT_DEFAULTS };
  for (const k of Object.keys(FIGHT_DEFAULTS) as Array<keyof FightDefaults>) if (saved[k] !== undefined) (out as Record<string, unknown>)[k] = saved[k];
  return out;
}

export const matchesRoot = (s: Pick<FightDefaults, 'matchesDir'>) => s.matchesDir || path.join(dataDir(), 'matches');
/** 自定义通道与选手（docs/channels.md） */
export const customConfigFile = () => path.join(dataDir(), 'channels.json');
/** 桌面版运行时写下自己的进程号，CLI 据此判断要不要把它拉起来 */
export const desktopLockFile = () => path.join(dataDir(), 'desktop.json');

/** 选手别名：agent 可能说"gpt""openai""月之暗面"之类 */
const ALIASES: Record<string, string> = {
  gpt: 'codex', openai: 'codex', chatgpt: 'codex', anthropic: 'claude', google: 'gemini', xai: 'grok',
  meta: 'muse', moonshot: 'kimi', zhipu: 'glm', chatglm: 'glm', qwen: 'qwen', tongyi: 'qwen',
  doubao: 'doubao', bytedance: 'doubao', yuanbao: 'yuanbao', hunyuan: 'yuanbao', minimax: 'minimax', mistral: 'mistral',
};
/** known：已有的选手编号（含 channels.json 里自定义的），命中就不再套别名 */
export const normalizeFighter = (name: string, known?: Iterable<string>) => { const k = name.trim().toLowerCase(); return known && new Set(known).has(k) ? k : ALIASES[k] ?? k; };
