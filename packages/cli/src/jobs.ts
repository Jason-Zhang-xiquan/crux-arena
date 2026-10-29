// 对局任务：给 agent 用的"后台开打 → 取结果"。
// 每场存档里多一个 meta.json（谁发起、怎么显示、跑比赛的进程号），桌面版据此接管画面，crux result 据此判断死活。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseEventLines, reduce } from '@crux/engine';
import type { MatchEvent } from '@crux/engine';
import type { Display } from './settings.ts';
import { desktopLockFile } from './settings.ts';

export interface MatchMeta {
  source: 'cli' | 'desktop';
  display: Display;
  pid: number;
  question: string;
  team: string[];
  startedAt: string;
}

export const writeMeta = (matchDir: string, meta: MatchMeta) => writeFile(path.join(matchDir, 'meta.json'), JSON.stringify(meta, null, 2));
export async function readMeta(matchDir: string): Promise<MatchMeta | undefined> {
  try { return JSON.parse(await readFile(path.join(matchDir, 'meta.json'), 'utf8')); } catch { return undefined; }
}

export const alive = (pid?: number) => {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
};

export type MatchStatus = 'starting' | 'running' | 'done' | 'dead';
export interface MatchInfo { id: string; dir: string; status: MatchStatus; events: MatchEvent[]; meta?: MatchMeta }

export async function readMatch(dir: string): Promise<MatchInfo> {
  const meta = await readMeta(dir);
  let events: MatchEvent[] = [];
  try {
    const text = await readFile(path.join(dir, 'events.jsonl'), 'utf8');
    // 跑到一半时最后一行可能还没写完，只解析完整的行
    events = parseEventLines(text.slice(0, text.lastIndexOf('\n') + 1));
  } catch { /* 还没开始写 */ }
  const done = events.some(e => e.type === 'match_ended');
  const status: MatchStatus = done ? 'done' : !events.length && alive(meta?.pid) ? 'starting' : alive(meta?.pid) ? 'running' : events.length || meta ? 'dead' : 'starting';
  return { id: path.basename(dir), dir, status, events, meta };
}

/** latest / 比赛编号 / 存档路径 → 存档文件夹 */
export async function resolveMatch(root: string, ref = 'latest'): Promise<string> {
  if (ref !== 'latest') return existsSync(ref) ? path.resolve(ref) : path.join(root, ref);
  const names = (await readdir(root, { withFileTypes: true }).catch(() => [])).filter(d => d.isDirectory()).map(d => d.name).sort();
  if (!names.length) throw new Error(`${root} 里还没有对局`);
  return path.join(root, names[names.length - 1]);
}

export async function listMatches(root: string, limit = 10): Promise<MatchInfo[]> {
  const names = (await readdir(root, { withFileTypes: true }).catch(() => [])).filter(d => d.isDirectory()).map(d => d.name).sort().reverse().slice(0, limit);
  return Promise.all(names.map(n => readMatch(path.join(root, n))));
}

/** 等到对局结束（或跑比赛的进程没了）。存档文件夹可能还没建好，先等它出现 */
export async function waitForMatch(dir: string, timeoutMs: number, onTick?: (m: MatchInfo) => void): Promise<MatchInfo> {
  const t0 = Date.now();
  for (;;) {
    const m = await readMatch(dir);
    onTick?.(m);
    if (m.status === 'done' || m.status === 'dead') return m;
    if (m.status === 'starting' && !m.meta && Date.now() - t0 > 30_000) return { ...m, status: 'dead' };
    if (Date.now() - t0 > timeoutMs) return m;
    await new Promise(r => setTimeout(r, 2000));
  }
}

/** 给 agent 看的结果：冠军答案 + 少数派 + 谁说服了谁 + 最终论点，细节指向 battle-log.md */
export function summarize(m: MatchInfo): string {
  const s = reduce(m.events);
  const name = (id: string) => s.start?.fighters.find(f => f.id === id)?.name ?? id;
  const lines = [`# Crux Arena · ${s.start?.question ?? m.meta?.question ?? ''}`];
  const who = s.start?.fighters.map(f => `${f.name}（${f.model}）`).join('、') ?? m.meta?.team.join('、');
  lines.push(`状态：${{ starting: '准备中', running: '进行中', done: '已结束', dead: '中断（跑比赛的进程已退出）' }[m.status]} · 第 ${s.round} 回合 · ${Math.round(s.tokens / 1000)}k tok · 选手 ${who}`);
  if (s.final) {
    lines.push('', `## 冠军答案（置信度 ${Math.round(s.final.confidence * 100)}%）`, s.final.answer);
    if (s.final.minority.length) lines.push('', '## 少数派', ...s.final.minority.map(x => `- ${x}`));
    if (s.final.userCruxes.length) lines.push('', '## 需要你判断', ...s.final.userCruxes.map(x => `- ${x}`));
  }
  if (s.edges.length) lines.push('', '## 谁说服了谁', ...s.edges.map(e => `- ${name(e.from)} ⇒ ${name(e.to)}（${e.on}）：${e.why}  #${e.causes.join(' #')} → #${e.change}`));
  const claims = s.order.filter(id => s.claims[id] && s.claims[id].status !== 'merged').map(id => s.claims[id]);
  if (claims.length) lines.push('', '## 论点结局', ...claims.map(c => `- ${c.id} ${c.status === 'ko' ? '✗ 出局' : `✓ ${c.hp}HP`} · ${c.short} · 支持：${c.supporters.map(name).join('、')}`));
  if (m.status === 'done') lines.push('', `完整战报：${path.join(m.dir, 'battle-log.md')}`);
  if (m.status === 'dead') lines.push('', `运行日志：${path.join(m.dir, 'runner.log')}`);
  return lines.join('\n');
}

/* ---------------- 后台开打 ---------------- */

/** 起一个脱离当前终端的进程跑比赛，立刻返回；进度和报错写进存档里的 runner.log */
export async function detachJob(mainScript: string, matchDir: string, job: unknown): Promise<number> {
  await mkdir(matchDir, { recursive: true });
  const log = await open(path.join(matchDir, 'runner.log'), 'a');
  const child = spawn(process.execPath, [mainScript, '_job'], {
    detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd],
    env: { ...process.env, CRUX_JOB: JSON.stringify(job) },
  });
  child.unref();
  await log.close();
  return child.pid ?? 0;
}

/* ---------------- 桌面版 ---------------- */

export async function desktopRunning(): Promise<boolean> {
  try { return alive(JSON.parse(await readFile(desktopLockFile(), 'utf8')).pid); } catch { return false; }
}

/** 桌面版没开就在后台拉起来（只开托盘，不弹输入框），它会自己接管 agent 发起的对局 */
export async function ensureDesktop(): Promise<'running' | 'started' | 'unavailable'> {
  if (await desktopRunning()) return 'running';
  const desktopDir = path.resolve(import.meta.dirname, '..', '..', 'desktop');
  let cmd: string | undefined, args: string[] = [];
  if (process.env.CRUX_DESKTOP && existsSync(process.env.CRUX_DESKTOP)) cmd = process.env.CRUX_DESKTOP;   // 安装版自带的 crux 命令会设好：指向 Crux Arena.exe
  else if (existsSync(path.join(desktopDir, 'package.json'))) {
    try { cmd = createRequire(path.join(desktopDir, 'package.json'))('electron') as unknown as string; args = [desktopDir]; } catch { /* 没装 electron */ }
  }
  if (!cmd) return 'unavailable';
  // 安装版的 crux 是用 ELECTRON_RUN_AS_NODE 跑的，拉起桌面版时要去掉，否则它也会当成 Node 运行
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(cmd, [...args, '--background'], { detached: true, stdio: 'ignore', env }).unref();
  return 'started';
}
