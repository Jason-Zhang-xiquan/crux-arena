// 安装包自带 crux 命令：用桌面版自己的 Electron（ELECTRON_RUN_AS_NODE）运行打包好的 CLI，用户不用另装 Node。
// "安装"只是在 PATH 里的用户目录写一个小启动脚本：Windows 是 WindowsApps\crux.cmd，macOS / Linux 是 ~/.local/bin/crux。
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MARK = 'crux-arena-shim';   // 只认自己写的启动脚本，不碰用户别的 crux

export interface ShimPlan { script: string; target: string; packaged: boolean }

/** packaged：安装版里 CLI 在 resources/crux；开发时用仓库里 packages/cli/dist（先 npm run build -w @crux/cli） */
export function shimPlan(o: { packaged: boolean; resourcesPath: string; appDir: string }): ShimPlan {
  const script = o.packaged ? path.join(o.resourcesPath, 'crux', 'crux.mjs') : path.resolve(o.appDir, '..', 'cli', 'dist', 'crux.mjs');
  const target = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'WindowsApps', 'crux.cmd')
    : path.join(os.homedir(), '.local', 'bin', 'crux');
  return { script, target, packaged: o.packaged };
}

export function shimText(exe: string, p: ShimPlan): string {
  // CRUX_DESKTOP 让 crux fight 在需要画面时能把安装版桌面程序拉起来；开发版不设，CLI 会自己找仓库里的 electron
  if (process.platform === 'win32') {
    return ['@echo off', `rem ${MARK}`, 'setlocal', 'set "ELECTRON_RUN_AS_NODE=1"', ...(p.packaged ? [`set "CRUX_DESKTOP=${exe}"`] : []), `"${exe}" "${p.script}" %*`, ''].join('\r\n');
  }
  return ['#!/bin/sh', `# ${MARK}`, `ELECTRON_RUN_AS_NODE=1 ${p.packaged ? `CRUX_DESKTOP="${exe}" ` : ''}exec "${exe}" "${p.script}" "$@"`, ''].join('\n');
}

export async function shimStatus(p: ShimPlan): Promise<{ installed: boolean; ours: boolean; target: string; onPath: boolean; available: boolean }> {
  const dirs = (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).map(d => path.resolve(d).toLowerCase());
  const onPath = dirs.includes(path.dirname(p.target).toLowerCase());
  let text = '';
  try { text = await readFile(p.target, 'utf8'); } catch { /* 还没装 */ }
  return { installed: !!text, ours: text.includes(MARK), target: p.target, onPath, available: existsSync(p.script) };
}

/** 写启动脚本。目标位置已经有一个不是我们写的 crux，就不覆盖 */
export async function installShim(exe: string, p: ShimPlan): Promise<{ ok: boolean; message: string }> {
  const s = await shimStatus(p);
  if (!s.available) return { ok: false, message: `找不到打包好的 CLI：${p.script}${p.packaged ? '' : '（开发版先运行 npm run build -w @crux/cli）'}` };
  if (s.installed && !s.ours) return { ok: false, message: `${p.target} 已经有一个别的 crux，没有覆盖` };
  await mkdir(path.dirname(p.target), { recursive: true });
  await writeFile(p.target, shimText(exe, p));
  if (process.platform !== 'win32') await chmod(p.target, 0o755);
  return { ok: true, message: s.onPath ? `已安装：${p.target}。新开一个终端就能用 crux 了` : `已安装：${p.target}。这个目录不在 PATH 里，请把它加进 PATH` };
}
