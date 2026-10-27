// 只读文件夹工具：选手只能列目录、读文件、grep。没有任何写入或执行能力。
// 安全边界在这里强制，不依赖提示词：路径沙箱、符号链接检查、敏感文件屏蔽、读取预算、审计。
import { lstat, open, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import ignore from 'ignore';

export const DEFAULT_IGNORE = [
  '.git/', 'node_modules/', 'dist/', 'build/', 'out/', '.next/', 'coverage/', '.venv/', 'venv/', '__pycache__/',
  '.env', '.env.*', '!.env.example', '!.env.sample',
  '*.pem', '*.key', '*.p12', '*.pfx', '*.keystore', '*.jks', 'id_rsa*', 'id_ed25519*', 'id_ecdsa*',
  '.npmrc', '.pypirc', '.netrc', '.git-credentials', 'secrets/', 'credentials*', '*.sqlite', '*.db',
];

export interface WorkspaceOptions {
  root: string;
  maxFileBytes?: number;             // 单个文件超过就拒绝读取
  maxLinesPerRead?: number;
  maxReadsPerActor?: number;         // 每名选手的读取次数预算
  maxBytesPerActor?: number;         // 每名选手的读取字节预算（≈ token 预算）
  extraIgnore?: string[];
  onAudit?: (entry: AuditEntry) => void;
}

export interface AuditEntry { actor: string; tool: string; input: Record<string, unknown>; ok: boolean; bytes: number; note?: string }

export type WorkspaceErrorCode = 'OUTSIDE_ROOT' | 'ABSOLUTE_PATH' | 'IGNORED' | 'NOT_FOUND' | 'TOO_LARGE' | 'BINARY' | 'BUDGET' | 'BAD_INPUT';

export class WorkspaceError extends Error {
  code: WorkspaceErrorCode;
  constructor(code: WorkspaceErrorCode, message: string) { super(message); this.code = code; }
}

export interface ReadResult { path: string; from: number; to: number; totalLines: number; text: string; cached: boolean }
export interface GrepMatch { path: string; line: number; text: string }

export interface ToolSpec { name: string; description: string; input_schema: Record<string, unknown> }

/** 给模型 tool use 用的工具说明（JSON Schema） */
export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'list_dir',
    description: '列出文件夹内容（只读）。目录以 / 结尾。路径相对于工作区根目录。',
    input_schema: { type: 'object', properties: { path: { type: 'string', default: '.' }, depth: { type: 'integer', minimum: 1, maximum: 3, default: 1 } } },
  },
  {
    name: 'read_file',
    description: '按行读取文件（只读），每行带行号，方便用 file:line 引用证据。',
    input_schema: { type: 'object', required: ['path'], properties: { path: { type: 'string' }, from: { type: 'integer', minimum: 1 }, to: { type: 'integer', minimum: 1 } } },
  },
  {
    name: 'grep',
    description: '在工作区里搜索文本（默认按字面量匹配），返回 file:line 和该行内容。',
    input_schema: { type: 'object', required: ['pattern'], properties: { pattern: { type: 'string' }, path: { type: 'string', default: '.' }, regex: { type: 'boolean', default: false }, caseSensitive: { type: 'boolean', default: false }, maxResults: { type: 'integer', maximum: 200, default: 50 } } },
  },
];

const toPosix = (p: string) => p.split(path.sep).join('/');
const isInside = (root: string, p: string) => {
  const rel = path.relative(root, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

export async function openWorkspace(opts: WorkspaceOptions) {
  const rootReal = await realpath(path.resolve(opts.root));
  if (!(await stat(rootReal)).isDirectory()) throw new WorkspaceError('NOT_FOUND', `${opts.root} 不是文件夹`);
  const maxFileBytes = opts.maxFileBytes ?? 512 * 1024;
  const maxLines = opts.maxLinesPerRead ?? 400;
  const maxReads = opts.maxReadsPerActor ?? 30;
  const maxBytes = opts.maxBytesPerActor ?? 160_000;

  const ig = ignore().add(DEFAULT_IGNORE).add(opts.extraIgnore ?? []);
  try { ig.add(await readFile(path.join(rootReal, '.gitignore'), 'utf8')); } catch { /* 没有 .gitignore */ }

  const usage = new Map<string, { reads: number; bytes: number }>();
  const cache = new Map<string, string[]>();          // 共享证据柜：同一文件只读一次，所有选手复用
  let repoMapCache: string | undefined;

  const ignored = (rel: string, isDir: boolean) => rel !== '' && ig.ignores(isDir ? `${rel}/` : rel);

  /** 把模型给的相对路径解析成根目录内的真实路径；越界、绝对路径、被屏蔽都直接拒绝 */
  async function resolve(input: unknown, expect: 'file' | 'dir' | 'any' = 'any') {
    if (typeof input !== 'string' || input.includes('\0') || input.length > 512) throw new WorkspaceError('BAD_INPUT', '路径无效');
    const raw = input.trim() || '.';
    if (path.isAbsolute(raw) || /^[a-zA-Z]:/.test(raw) || raw.startsWith('\\\\')) throw new WorkspaceError('ABSOLUTE_PATH', '只接受工作区内的相对路径');
    const joined = path.resolve(rootReal, raw);
    if (!isInside(rootReal, joined)) throw new WorkspaceError('OUTSIDE_ROOT', `${raw} 在工作区之外`);
    let real: string;
    try { real = await realpath(joined); } catch { throw new WorkspaceError('NOT_FOUND', `${raw} 不存在`); }
    if (!isInside(rootReal, real)) throw new WorkspaceError('OUTSIDE_ROOT', `${raw} 指向工作区之外（符号链接）`);
    const st = await stat(real);
    const rel = toPosix(path.relative(rootReal, real));
    // 逐级检查：被屏蔽目录下的文件也不能读
    const parts = rel ? rel.split('/') : [];
    for (let i = 1; i <= parts.length; i++) {
      const sub = parts.slice(0, i).join('/');
      if (ignored(sub, i < parts.length || st.isDirectory())) throw new WorkspaceError('IGNORED', `${rel} 被屏蔽（敏感文件或忽略规则）`);
    }
    if (expect === 'file' && !st.isFile()) throw new WorkspaceError('BAD_INPUT', `${rel} 不是文件`);
    if (expect === 'dir' && !st.isDirectory()) throw new WorkspaceError('BAD_INPUT', `${rel || '.'} 不是文件夹`);
    return { real, rel: rel || '.', size: st.size };
  }

  function charge(actor: string, bytes: number) {
    const u = usage.get(actor) ?? { reads: 0, bytes: 0 };
    if (u.reads + 1 > maxReads) throw new WorkspaceError('BUDGET', `${actor} 已用完读取次数预算（${maxReads} 次）`);
    if (u.bytes + bytes > maxBytes) throw new WorkspaceError('BUDGET', `${actor} 已用完读取字节预算（${maxBytes} 字节）`);
    usage.set(actor, { reads: u.reads + 1, bytes: u.bytes + bytes });
  }

  async function audited<T>(actor: string, tool: string, input: Record<string, unknown>, fn: () => Promise<{ value: T; bytes: number; note?: string }>): Promise<T> {
    try {
      const r = await fn();
      opts.onAudit?.({ actor, tool, input, ok: true, bytes: r.bytes, ...(r.note ? { note: r.note } : {}) });
      return r.value;
    } catch (err) {
      opts.onAudit?.({ actor, tool, input, ok: false, bytes: 0, note: err instanceof WorkspaceError ? err.code : 'ERROR' });
      throw err;
    }
  }

  /** 遍历目录（不跟随符号链接），跳过被屏蔽的路径 */
  async function* walk(dirReal: string, depth: number): AsyncGenerator<{ rel: string; isDir: boolean; size: number; depth: number }> {
    let entries;
    try { entries = await readdir(dirReal, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const real = path.join(dirReal, e.name);
      const rel = toPosix(path.relative(rootReal, real));
      if (ignored(rel, e.isDirectory())) continue;
      if (e.isDirectory()) {
        yield { rel, isDir: true, size: 0, depth };
        if (depth > 1) yield* walk(real, depth - 1);
      } else if (e.isFile()) {
        yield { rel, isDir: false, size: (await lstat(real)).size, depth };
      }
    }
  }

  async function loadLines(real: string, rel: string, size: number, store = true): Promise<{ lines: string[]; cached: boolean }> {
    const hit = cache.get(rel);
    if (hit) return { lines: hit, cached: true };
    if (size > maxFileBytes) throw new WorkspaceError('TOO_LARGE', `${rel} 超过 ${maxFileBytes} 字节，请改用 grep 定位`);
    const fh = await open(real, 'r');
    try {
      const buf = await fh.readFile();
      if (buf.subarray(0, 8000).includes(0)) throw new WorkspaceError('BINARY', `${rel} 是二进制文件`);
      const lines = buf.toString('utf8').split(/\r?\n/);
      if (store) cache.set(rel, lines);
      return { lines, cached: false };
    } finally { await fh.close(); }
  }

  const ws = {
    root: rootReal,

    async listDir(actor: string, dir = '.', depth = 1): Promise<string[]> {
      return audited(actor, 'list_dir', { path: dir, depth }, async () => {
        const d = await resolve(dir, 'dir');
        const out: string[] = [];
        for await (const e of walk(d.real, Math.min(Math.max(1, depth), 3))) {
          out.push(e.isDir ? `${e.rel}/` : e.rel);
          if (out.length >= 500) { out.push('…（已截断）'); break; }
        }
        const bytes = out.join('\n').length;
        charge(actor, bytes);
        return { value: out, bytes };
      });
    },

    async readFile(actor: string, file: string, from = 1, to?: number): Promise<ReadResult> {
      return audited(actor, 'read_file', { path: file, from, ...(to ? { to } : {}) }, async () => {
        const f = await resolve(file, 'file');
        const { lines, cached } = await loadLines(f.real, f.rel, f.size);
        const start = Math.max(1, Math.floor(from));
        const end = Math.min(lines.length, Math.floor(to ?? start + maxLines - 1), start + maxLines - 1);
        if (start > lines.length) throw new WorkspaceError('BAD_INPUT', `${f.rel} 只有 ${lines.length} 行`);
        const text = lines.slice(start - 1, end).map((l, i) => `${start + i}| ${l}`).join('\n');
        charge(actor, text.length);
        return { value: { path: f.rel, from: start, to: end, totalLines: lines.length, text, cached }, bytes: text.length, ...(cached ? { note: 'cache' } : {}) };
      });
    },

    async grep(actor: string, pattern: string, o: { path?: string; regex?: boolean; caseSensitive?: boolean; maxResults?: number } = {}): Promise<{ matches: GrepMatch[]; truncated: boolean }> {
      return audited(actor, 'grep', { pattern, ...o }, async () => {
        if (typeof pattern !== 'string' || !pattern || pattern.length > 200) throw new WorkspaceError('BAD_INPUT', 'pattern 需为 1–200 个字符');
        let re: RegExp;
        try { re = new RegExp(o.regex ? pattern : pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), o.caseSensitive ? '' : 'i'); }
        catch { throw new WorkspaceError('BAD_INPUT', '正则表达式无效'); }
        const d = await resolve(o.path ?? '.', 'any');
        const limit = Math.min(o.maxResults ?? 50, 200);
        const matches: GrepMatch[] = [];
        let scanned = 0, truncated = false;
        const files = (await stat(d.real)).isFile() ? [{ rel: d.rel, isDir: false, size: d.size, depth: 0 }] : walk(d.real, 32);
        outer: for await (const e of files) {
          if (e.isDir || e.size > maxFileBytes) continue;
          if (++scanned > 5000) { truncated = true; break; }
          let lines: string[];
          try { lines = (await loadLines(path.join(rootReal, e.rel), e.rel, e.size, false)).lines; } catch { continue; }   // grep 不进证据柜，避免内存膨胀
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].length > 1000 ? lines[i].slice(0, 1000) : lines[i];
            if (re.test(line)) {
              matches.push({ path: e.rel, line: i + 1, text: line.trim().slice(0, 300) });
              if (matches.length >= limit) { truncated = true; break outer; }
            }
          }
        }
        const bytes = matches.reduce((n, m) => n + m.path.length + m.text.length + 8, 0);
        charge(actor, bytes);
        return { value: { matches, truncated }, bytes };
      });
    },

    /** 仓库地图：侦察阶段生成一次，所有选手共享（不占个人预算） */
    async repoMap(maxEntries = 300): Promise<string> {
      if (repoMapCache) return repoMapCache;
      const lines: string[] = [];
      for await (const e of walk(rootReal, 4)) {
        const indent = '  '.repeat(4 - e.depth);
        lines.push(e.isDir ? `${indent}${path.posix.basename(e.rel)}/` : `${indent}${path.posix.basename(e.rel)}  ${e.size < 1024 ? `${e.size}B` : `${Math.round(e.size / 1024)}KB`}`);
        if (lines.length >= maxEntries) { lines.push('…（已截断）'); break; }
      }
      repoMapCache = lines.join('\n');
      opts.onAudit?.({ actor: 'scout', tool: 'repo_map', input: { maxEntries }, ok: true, bytes: repoMapCache.length });
      return repoMapCache;
    },

    /** 模型 tool use 的统一入口：未知工具一律拒绝 */
    async dispatch(actor: string, name: string, input: Record<string, unknown>): Promise<unknown> {
      if (name === 'list_dir') return ws.listDir(actor, (input.path as string) ?? '.', Number(input.depth ?? 1));
      if (name === 'read_file') return ws.readFile(actor, input.path as string, Number(input.from ?? 1), input.to === undefined ? undefined : Number(input.to));
      if (name === 'grep') return ws.grep(actor, input.pattern as string, { path: input.path as string | undefined, regex: !!input.regex, caseSensitive: !!input.caseSensitive, maxResults: input.maxResults === undefined ? undefined : Number(input.maxResults) });
      throw new WorkspaceError('BAD_INPUT', `没有这个工具：${name}（文件夹模式只提供只读工具）`);
    },

    usage: () => Object.fromEntries(usage),
  };
  return ws;
}

export type Workspace = Awaited<ReturnType<typeof openWorkspace>>;
