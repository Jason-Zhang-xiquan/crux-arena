import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { MatchEvent, createRecorder } from '@crux/engine';
import { WorkspaceError, openWorkspace } from '../src/index.ts';
import type { AuditEntry } from '../src/index.ts';

let base: string, root: string, linked = false, junction = false;

before(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), 'crux-ws-'));
  root = path.join(base, 'repo');
  const files: Record<string, string | Buffer> = {
    'src/app.ts': ['import express from "express";', 'export function start() {', '  return listen(3000);', '}', ''].join('\n'),
    'src/billing/invoice.ts': 'export const TAX = 0.13; // invoice\n',
    'README.md': '# demo\nsecret word: banana\n',
    '.env': 'API_KEY=banana-secret\n',
    '.env.example': 'API_KEY=\n',
    'secrets/key.txt': 'banana\n',
    'node_modules/x/index.js': 'banana\n',
    'logs/app.log': 'banana\n',
    '.gitignore': 'logs/\n',
    'big.bin': Buffer.from([0x50, 0x4b, 0x00, 0x01, 0x02]),
  };
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), body);
  }
  await writeFile(path.join(base, 'outside.txt'), 'banana outside\n');
  try { await symlink(path.join(base, 'outside.txt'), path.join(root, 'escape.txt')); linked = true; } catch { /* Windows 无权限创建符号链接时跳过 */ }
  await mkdir(path.join(base, 'outside-dir'));
  await writeFile(path.join(base, 'outside-dir', 'secret.txt'), 'banana outside\n');
  try { await symlink(path.join(base, 'outside-dir'), path.join(root, 'jdir'), 'junction'); junction = true; } catch { /* 不支持目录联接时跳过 */ }
});
after(() => rm(base, { recursive: true, force: true }));

const code = async (p: Promise<unknown>, c: string) => {
  await assert.rejects(p, (e: unknown) => e instanceof WorkspaceError && e.code === c);
};

test('列目录：屏蔽敏感文件、依赖目录和 .gitignore 里的路径', async () => {
  const ws = await openWorkspace({ root });
  const all = await ws.listDir('p1', '.', 3);
  assert.ok(all.includes('src/app.ts') && all.includes('.env.example') && all.includes('README.md'));
  for (const hidden of ['.env', 'secrets/', 'node_modules/', 'logs/', 'secrets/key.txt', 'logs/app.log']) assert.ok(!all.includes(hidden), `${hidden} 不应出现`);
});

test('读文件：带行号、按行范围、超出行数报错', async () => {
  const ws = await openWorkspace({ root });
  const r = await ws.readFile('p1', 'src/app.ts', 2, 3);
  assert.equal(r.text, '2| export function start() {\n3|   return listen(3000);');
  assert.equal(r.totalLines, 5);
  await code(ws.readFile('p1', 'src/app.ts', 99), 'BAD_INPUT');
});

test('路径沙箱：拒绝越界、绝对路径、敏感文件、二进制', async () => {
  const ws = await openWorkspace({ root });
  await code(ws.readFile('p1', '../outside.txt'), 'OUTSIDE_ROOT');
  await code(ws.readFile('p1', 'src/../../outside.txt'), 'OUTSIDE_ROOT');
  await code(ws.readFile('p1', path.join(base, 'outside.txt')), 'ABSOLUTE_PATH');
  await code(ws.readFile('p1', 'C:/Windows/win.ini'), 'ABSOLUTE_PATH');
  await code(ws.readFile('p1', '.env'), 'IGNORED');
  await code(ws.readFile('p1', 'secrets/key.txt'), 'IGNORED');
  await code(ws.readFile('p1', 'node_modules/x/index.js'), 'IGNORED');
  await code(ws.readFile('p1', 'logs/app.log'), 'IGNORED');
  await code(ws.readFile('p1', 'big.bin'), 'BINARY');
  await code(ws.readFile('p1', 'nope.ts'), 'NOT_FOUND');
});

test('符号链接指向工作区外：拒绝', async t => {
  if (!linked) return t.skip('当前系统不允许创建符号链接');
  const ws = await openWorkspace({ root });
  await code(ws.readFile('p1', 'escape.txt'), 'OUTSIDE_ROOT');
  assert.ok(!(await ws.listDir('p1')).includes('escape.txt'));
});

test('目录联接指向工作区外：拒绝，且遍历时不跟随', async t => {
  if (!junction) return t.skip('当前系统不支持目录联接');
  const ws = await openWorkspace({ root });
  await code(ws.readFile('p1', 'jdir/secret.txt'), 'OUTSIDE_ROOT');
  await code(ws.listDir('p1', 'jdir'), 'OUTSIDE_ROOT');
  assert.ok(!(await ws.listDir('p1', '.', 3)).some(e => e.startsWith('jdir')));
  assert.equal((await ws.grep('p1', 'banana outside')).matches.length, 0);
});

test('grep：默认字面量匹配，不会搜到被屏蔽的文件', async () => {
  const ws = await openWorkspace({ root });
  const r = await ws.grep('p1', 'banana');
  assert.deepEqual(r.matches.map(m => `${m.path}:${m.line}`), ['README.md:2']);
  const re = await ws.grep('p1', 'export (function|const)', { regex: true });
  assert.deepEqual(re.matches.map(m => m.path).sort(), ['src/app.ts', 'src/billing/invoice.ts']);
  const lit = await ws.grep('p1', 'listen(3000)');
  assert.equal(lit.matches[0]?.line, 3);
  await code(ws.grep('p1', '('.repeat(3), { regex: true }), 'BAD_INPUT');
});

test('读取预算：按选手分别计算，超出就拒绝', async () => {
  const ws = await openWorkspace({ root, maxReadsPerActor: 2 });
  await ws.readFile('p1', 'README.md');
  await ws.readFile('p1', 'src/app.ts');
  await code(ws.readFile('p1', 'src/app.ts'), 'BUDGET');
  await ws.readFile('p2', 'README.md');
  assert.deepEqual(ws.usage().p1.reads, 2);
});

test('共享证据柜：同一个文件第二次读取走缓存', async () => {
  const ws = await openWorkspace({ root });
  assert.equal((await ws.readFile('p1', 'README.md')).cached, false);
  assert.equal((await ws.readFile('p2', 'README.md')).cached, true);
});

test('只提供只读工具：写入类工具一律拒绝', async () => {
  const ws = await openWorkspace({ root });
  await code(ws.dispatch('p1', 'write_file', { path: 'x.txt', content: 'hi' }), 'BAD_INPUT');
  await code(ws.dispatch('p1', 'run_command', { cmd: 'rm -rf /' }), 'BAD_INPUT');
  const r = await ws.dispatch('p1', 'read_file', { path: 'src/app.ts', from: 1, to: 1 }) as { text: string };
  assert.equal(r.text, '1| import express from "express";');
});

test('审计：每次调用都进事件流，成功和拒绝都有记录', async () => {
  const rec = createRecorder();
  const audit: AuditEntry[] = [];
  const ws = await openWorkspace({ root, onAudit: a => { audit.push(a); rec.tool(a); } });
  await ws.readFile('p1', 'README.md');
  await code(ws.readFile('p1', '.env'), 'IGNORED');
  await ws.repoMap();
  assert.deepEqual(audit.map(a => [a.tool, a.ok, a.note ?? '']), [['read_file', true, ''], ['read_file', false, 'IGNORED'], ['repo_map', true, '']]);
  for (const e of rec.events) assert.ok(MatchEvent.safeParse(e).success);
  assert.equal(rec.state.reads.p1, 2);
});

test('仓库地图：不含被屏蔽的路径，生成一次后复用', async () => {
  const ws = await openWorkspace({ root });
  const map = await ws.repoMap();
  assert.match(map, /app\.ts/);
  assert.doesNotMatch(map, /\.env\b(?!\.example)|secrets|node_modules|app\.log/);
  assert.equal(await ws.repoMap(), map);
});
