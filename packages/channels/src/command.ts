// 命令行通道：会员命令行（Cursor Agent、Claude Code）以只读 / 问答模式启动。
// 安全边界（PLAN §6.7）：不经过 shell；比赛内容只走标准输入；工作目录是空的沙箱目录；
// 每次调用有超时和输出大小上限；通道进程拿不到用户的文件夹，文件由我们的只读工具读取。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Channel, ChannelRequest, ChannelResult, Effort, ErrorKind } from './channel.ts';
import { classify, estimateTokens } from './channel.ts';

export interface RunResult { code: number | null; stdout: string; stderr: string; timedOut: boolean; tooLarge: boolean; ms: number }

export function runProcess(file: string, args: string[], o: { stdin?: string; env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number; maxBytes?: number } = {}): Promise<RunResult> {
  const t0 = Date.now();
  const maxBytes = o.maxBytes ?? 2_000_000;
  return new Promise(resolve => {
    const child = spawn(file, args, { cwd: o.cwd, env: o.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [], err: Buffer[] = [];
    let size = 0, timedOut = false, tooLarge = false, done = false;
    const kill = () => { try { child.kill(); } catch { /* 已退出 */ } };
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

/** 空的沙箱目录：命令行在这里启动，看不到任何用户文件 */
export function sandboxDir(): string {
  const dir = path.join(os.tmpdir(), 'crux-arena-sandbox');
  mkdirSync(dir, { recursive: true });
  return dir;
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

export function findCursorAgent(): { node: string; script: string } | undefined {
  const root = path.join(process.env.LOCALAPPDATA ?? '', 'cursor-agent');
  if (existsSync(path.join(root, 'node.exe')) && existsSync(path.join(root, 'index.js'))) return { node: path.join(root, 'node.exe'), script: path.join(root, 'index.js') };
  const versions = path.join(root, 'versions');
  if (!existsSync(versions)) return undefined;
  const dirs = readdirSync(versions).filter(d => /^\d{4}\.\d{1,2}\.\d{1,2}(-\d{2}-\d{2}-\d{2})?-[a-f0-9]+$/.test(d)).sort((a, b) => {
    const n = (s: string) => Number(s.split('-')[0].split('.').map((p, i) => (i ? p.padStart(2, '0') : p)).join(''));
    return n(b) - n(a);
  });
  for (const d of dirs) {
    const node = path.join(versions, d, 'node.exe'), script = path.join(versions, d, 'index.js');
    if (existsSync(node) && existsSync(script)) return { node, script };
  }
  return undefined;
}

export async function cursorChannel(o: { concurrency?: number; timeoutMs?: number } = {}): Promise<Channel & { models: Set<string> }> {
  const bin = findCursorAgent();
  if (!bin) throw new Error('没有找到 Cursor Agent（cursor-agent）');
  const env = { ...process.env, CURSOR_INVOKED_AS: 'cursor-agent.cmd' };
  const exec = (args: string[], stdin?: string, timeoutMs?: number) => runProcess(bin.node, [bin.script, ...args], { env, cwd: sandboxDir(), stdin, timeoutMs });
  // 只读模型列表：不发起对话、不耗额度
  const list = await exec(['--list-models'], undefined, 60_000);
  const models = new Set(list.stdout.split(/\r?\n/).map(l => l.match(/^([a-z0-9][\w.-]*) - /i)?.[1]).filter((x): x is string => !!x));
  return {
    id: 'cursor', concurrency: o.concurrency ?? 4, models,
    async call(req: ChannelRequest): Promise<ChannelResult> {
      const model = cursorModelFor(req.model, req.effort, models);
      if (!model) return fail(req.model, 0, 'unavailable', `Cursor 账号下没有 ${req.model}`);
      // ask 模式 = 只读问答；Cursor 没有单独的系统提示参数，系统提示放在标准输入开头
      const r = await exec(['-p', '--output-format', 'json', '--mode', 'ask', '--trust', '--workspace', sandboxDir(), '--model', model],
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

export function findClaudeCode(): string | undefined {
  const npm = path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  return existsSync(npm) ? npm : undefined;
}

/** 去掉宿主会话的环境变量（如在 Claude Code 里运行时继承的会话凭据），用用户自己的登录 */
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|ANTHROPIC)/.test(k)));

export async function claudeCodeChannel(o: { concurrency?: number; timeoutMs?: number } = {}): Promise<Channel & { loggedIn: boolean }> {
  const exe = findClaudeCode();
  if (!exe) throw new Error('没有找到 Claude Code（claude）');
  const status = await runProcess(exe, ['auth', 'status'], { env: cleanEnv(), cwd: sandboxDir(), timeoutMs: 30_000 });
  let loggedIn = false;
  try { loggedIn = !!JSON.parse(status.stdout).loggedIn; } catch { /* 旧版本没有 JSON 输出 */ }
  return {
    id: 'claude-code', concurrency: o.concurrency ?? 3, loggedIn,
    async call(req: ChannelRequest): Promise<ChannelResult> {
      const effort = CLAUDE_EFFORT[req.effort];
      // 关掉所有工具、不存会话、不加载 MCP：纯问答
      const args = ['-p', '--output-format', 'json', '--tools', '', '--no-session-persistence', '--strict-mcp-config', '--model', req.model, ...(effort ? ['--effort', effort] : []), '--system-prompt', req.system];
      const r = await runProcess(exe, args, { env: cleanEnv(), cwd: sandboxDir(), stdin: req.prompt, timeoutMs: req.timeoutMs ?? o.timeoutMs });
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
