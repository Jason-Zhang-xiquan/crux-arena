// 命令行通道：会员命令行（Cursor Agent、Claude Code）以只读 / 问答模式启动。
// 安全边界（PLAN §6.7）：不经过 shell；比赛内容只走标准输入；每次调用一个新的空目录；环境变量只给白名单；
// 每次调用有超时和输出大小上限；通道进程拿不到用户的文件夹，文件由我们的只读工具读取。
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Channel, ChannelRequest, ChannelResult, Effort, ErrorKind } from './channel.ts';
import { classify, estimateTokens } from './channel.ts';

export interface RunResult { code: number | null; stdout: string; stderr: string; timedOut: boolean; tooLarge: boolean; ms: number }

export function runProcess(file: string, args: string[], o: { stdin?: string; env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number; maxBytes?: number } = {}): Promise<RunResult> {
  const t0 = Date.now();
  const maxBytes = o.maxBytes ?? 2_000_000;
  return new Promise(resolve => {
    // POSIX 上单独成一个进程组，超时时能连同孙进程一起杀掉
    const win = process.platform === 'win32';
    const child = spawn(file, args, { cwd: o.cwd, env: o.env, windowsHide: true, detached: !win, stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [], err: Buffer[] = [];
    let size = 0, timedOut = false, tooLarge = false, done = false, killed = false;
    // 杀整棵进程树（child.kill 只杀直接子进程）；杀完 5 秒还没等到 close（比如有孙进程占着管道），就不等了
    const kill = () => {
      if (killed) return; killed = true;
      if (win && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
      else if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
      else child.kill();
      setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); finish(null, '\n（进程已终止，没有等到输出关闭）'); }, 5000).unref();
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, o.timeoutMs ?? 180_000);
    const collect = (into: Buffer[]) => (b: Buffer) => { size += b.length; if (size > maxBytes) { tooLarge = true; kill(); } else into.push(b); };
    child.stdout.on('data', collect(out));
    child.stderr.on('data', collect(err));
    const finish = (code: number | null, extra = '') => {
      if (done) return; done = true; clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') + extra, timedOut, tooLarge, ms: Date.now() - t0 });
    };
    child.on('error', e => finish(null, String(e)));
    child.on('close', code => finish(code));
    child.stdin.on('error', () => { /* 进程提前退出 */ });
    child.stdin.end(o.stdin ?? '');
  });
}

/** 每次调用一个新的空目录：命令行在这里启动，看不到任何用户文件，也看不到上一次调用留下的东西 */
export async function withSandbox<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'crux-sandbox-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }).catch(() => { /* 进程刚退出时 Windows 可能还占着 */ }); }
}

/** 环境变量白名单：只给命令行运行和登录所需的系统变量，不把宿主进程的密钥、会话凭据（如 CLAUDE_*、ANTHROPIC_*、各种 API key）传下去 */
const ENV_KEEP = /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|USERNAME|USER|LOGNAME|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|COMMONPROGRAMFILES|ALLUSERSPROFILE|PUBLIC|OS|PROCESSOR_ARCHITECTURE|PROCESSOR_IDENTIFIER|NUMBER_OF_PROCESSORS|LANG|LANGUAGE|LC_[A-Z_]+|TZ|SHELL|TERM|XDG_[A-Z_]+|HTTPS?_PROXY|NO_PROXY|ALL_PROXY|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR)$/i;
export function minimalEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => ENV_KEEP.test(k))), ...extra };
}

const fail = (model: string, ms: number, kind: ErrorKind, message: string): ChannelResult =>
  ({ ok: false, error: { kind, message: message.slice(0, 300) }, model, ms });

/** 进程层面的失败（超时、输出过大、退出码非 0 且没有可解析的结果） */
function processFailure(r: RunResult, model: string): ChannelResult | undefined {
  if (r.timedOut) return fail(model, r.ms, 'unavailable', '调用超时');
  if (r.tooLarge) return fail(model, r.ms, 'bad_output', '输出超过大小上限');
  return undefined;
}

/* ---------------- Cursor Agent ---------------- */

const TIERS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const WANT: Record<Effort, number> = { off: 0, low: 2, medium: 3, high: 4, max: 6 };
const tierOf = (s: string) => (s === 'extra-high' ? 5 : (TIERS as readonly string[]).indexOf(s));

/** 推理档位映射：Cursor 把档位写在模型名后缀里，而且每家能选的档位不一样，取最接近的一档 */
export function cursorModelFor(base: string, effort: Effort, available: Set<string>): string | undefined {
  const options: Array<{ id: string; tier: number }> = [];
  for (const id of available) {
    if (!id.startsWith(base + '-')) continue;
    const tier = tierOf(id.slice(base.length + 1));
    if (tier >= 0) options.push({ id, tier });
  }
  if (!options.length) return available.has(base) ? base : undefined;
  const want = WANT[effort];
  options.sort((a, b) => Math.abs(a.tier - want) - Math.abs(b.tier - want) || a.tier - b.tier);
  return options[0].id;
}

/** 在 PATH 里找可执行文件。Windows 上只认 .exe：.cmd / .bat 必须经过 shell 才能启动，我们不走 shell */
export function findOnPath(names: string[], env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  for (const name of names) for (const dir of dirs) {
    const file = path.join(dir, process.platform === 'win32' && !name.endsWith('.exe') ? `${name}.exe` : name);
    if (existsSync(file)) return file;
  }
  return undefined;
}
const firstExisting = (files: Array<string | undefined>) => files.find((f): f is string => !!f && existsSync(f));

/** 启动 Cursor Agent 的方式：可执行文件 + 前置参数。CURSOR_AGENT_PATH 可以手动指定 */
export function findCursorAgent(): { file: string; prefix: string[] } | undefined {
  if (process.env.CURSOR_AGENT_PATH && existsSync(process.env.CURSOR_AGENT_PATH)) return { file: process.env.CURSOR_AGENT_PATH, prefix: [] };
  if (process.platform !== 'win32') {
    // macOS / Linux：官方安装脚本放在 ~/.local/bin/cursor-agent（带 shebang 的脚本，可以直接启动）
    const file = firstExisting([path.join(os.homedir(), '.local', 'bin', 'cursor-agent'), findOnPath(['cursor-agent'])]);
    return file ? { file, prefix: [] } : undefined;
  }
  // Windows：cursor-agent.cmd 要经过 shell，改为直接用它自带的 node.exe 跑 index.js
  const root = path.join(process.env.LOCALAPPDATA ?? '', 'cursor-agent');
  if (existsSync(path.join(root, 'node.exe')) && existsSync(path.join(root, 'index.js'))) return { file: path.join(root, 'node.exe'), prefix: [path.join(root, 'index.js')] };
  const versions = path.join(root, 'versions');
  if (!existsSync(versions)) return undefined;
  const dirs = readdirSync(versions).filter(d => /^\d{4}\.\d{1,2}\.\d{1,2}(-\d{2}-\d{2}-\d{2})?-[a-f0-9]+$/.test(d)).sort((a, b) => {
    const n = (s: string) => Number(s.split('-')[0].split('.').map((p, i) => (i ? p.padStart(2, '0') : p)).join(''));
    return n(b) - n(a);
  });
  for (const d of dirs) {
    const node = path.join(versions, d, 'node.exe'), script = path.join(versions, d, 'index.js');
    if (existsSync(node) && existsSync(script)) return { file: node, prefix: [script] };
  }
  return undefined;
}

export async function cursorChannel(o: { concurrency?: number; timeoutMs?: number } = {}): Promise<Channel & { models: Set<string> }> {
  const bin = findCursorAgent();
  if (!bin) throw new Error('没有找到 Cursor Agent（cursor-agent）');
  const env = minimalEnv({ CURSOR_INVOKED_AS: 'cursor-agent.cmd' });
  const exec = (args: (dir: string) => string[], stdin?: string, timeoutMs?: number) =>
    withSandbox(dir => runProcess(bin.file, [...bin.prefix, ...args(dir)], { env, cwd: dir, stdin, timeoutMs }));
  // 只读模型列表：不发起对话、不耗额度
  const list = await exec(() => ['--list-models'], undefined, 60_000);
  const models = new Set(list.stdout.split(/\r?\n/).map(l => l.match(/^([a-z0-9][\w.-]*) - /i)?.[1]).filter((x): x is string => !!x));
  return {
    id: 'cursor', concurrency: o.concurrency ?? 4, models,
    async call(req: ChannelRequest): Promise<ChannelResult> {
      const model = cursorModelFor(req.model, req.effort, models);
      if (!model) return fail(req.model, 0, 'unavailable', `Cursor 账号下没有 ${req.model}`);
      // ask 模式 = 只读问答；Cursor 没有单独的系统提示参数，系统提示放在标准输入开头
      // --trust 只是免去"信任这个工作区吗"的交互确认；工作区是这次调用新建的空目录
      const r = await exec(dir => ['-p', '--output-format', 'json', '--mode', 'ask', '--trust', '--workspace', dir, '--model', model],
        `${req.system}\n\n---\n\n${req.prompt}`, req.timeoutMs ?? o.timeoutMs);
      const bad = processFailure(r, model);
      if (bad) return bad;
      let j: { is_error?: boolean; result?: string; usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number } };
      try { j = JSON.parse(r.stdout.trim().split(/\r?\n/).pop() ?? ''); } catch { return fail(model, r.ms, classify(r.stdout + r.stderr), (r.stderr || r.stdout).trim() || `退出码 ${r.code}`); }
      if (j.is_error || typeof j.result !== 'string') return fail(model, r.ms, classify(String(j.result ?? r.stderr)), String(j.result ?? r.stderr));
      const u = j.usage ?? {};
      // 有的模型 Cursor 只报未命中缓存的输入（可能只有个位数）。少于我们自己提示词的估算值时按估算记账，保证各家口径可比
      const floor = estimateTokens(req.system + req.prompt);
      const reported = u.inputTokens ?? 0;
      return { ok: true, text: j.result, model, effortApplied: model, ms: r.ms, usage: { in: Math.max(reported, floor), out: u.outputTokens ?? 0, cached: u.cacheReadTokens ?? 0, estimated: !j.usage || reported < floor } };
    },
  };
}

/* ---------------- Claude Code ---------------- */

const CLAUDE_EFFORT: Record<Effort, string | undefined> = { off: undefined, low: 'low', medium: 'medium', high: 'high', max: 'max' };

/** Claude Code 可执行文件：CLAUDE_CODE_PATH > 原生安装（~/.local/bin）> npm 全局安装 > PATH */
export function findClaudeCode(): string | undefined {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return firstExisting([
      process.env.CLAUDE_CODE_PATH,
      path.join(home, '.local', 'bin', 'claude.exe'),
      path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
      findOnPath(['claude']),
    ]);
  }
  return firstExisting([process.env.CLAUDE_CODE_PATH, path.join(home, '.local', 'bin', 'claude'), path.join(home, '.claude', 'local', 'claude'), findOnPath(['claude'])]);
}


export async function claudeCodeChannel(o: { concurrency?: number; timeoutMs?: number } = {}): Promise<Channel & { loggedIn: boolean }> {
  const exe = findClaudeCode();
  if (!exe) throw new Error('没有找到 Claude Code（claude）');
  // 白名单环境变量也顺带去掉了宿主会话（如在 Claude Code 里运行时）的凭据，用的是用户自己的登录
  const status = await withSandbox(dir => runProcess(exe, ['auth', 'status'], { env: minimalEnv(), cwd: dir, timeoutMs: 30_000 }));
  let loggedIn = false;
  try { loggedIn = !!JSON.parse(status.stdout).loggedIn; } catch { /* 旧版本没有 JSON 输出 */ }
  return {
    id: 'claude-code', concurrency: o.concurrency ?? 3, loggedIn,
    async call(req: ChannelRequest): Promise<ChannelResult> {
      const effort = CLAUDE_EFFORT[req.effort];
      // 关掉所有工具、不存会话、不加载 MCP：纯问答
      const args = ['-p', '--output-format', 'json', '--tools', '', '--no-session-persistence', '--strict-mcp-config', '--model', req.model, ...(effort ? ['--effort', effort] : []), '--system-prompt', req.system];
      const r = await withSandbox(dir => runProcess(exe, args, { env: minimalEnv(), cwd: dir, stdin: req.prompt, timeoutMs: req.timeoutMs ?? o.timeoutMs }));
      const bad = processFailure(r, req.model);
      if (bad) return bad;
      let j: { is_error?: boolean; result?: string; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } };
      try { j = JSON.parse(r.stdout); } catch { return fail(req.model, r.ms, classify(r.stdout + r.stderr), (r.stderr || r.stdout).trim() || `退出码 ${r.code}`); }
      if (j.is_error || typeof j.result !== 'string') return fail(req.model, r.ms, classify(String(j.result ?? r.stderr)), String(j.result ?? r.stderr));
      const u = j.usage ?? {};
      const cached = (u.cache_read_input_tokens ?? 0);
      return { ok: true, text: j.result, model: req.model, effortApplied: `--effort ${effort ?? '默认'}`, ms: r.ms, usage: { in: (u.input_tokens ?? 0) + cached + (u.cache_creation_input_tokens ?? 0), out: u.output_tokens ?? 0, cached, estimated: !j.usage } };
    },
  };
}
