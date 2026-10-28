import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseEventLines, renderBattleLog } from '@crux/engine';
import { runLocalMatch } from '../src/match.ts';

test('本地开打：写出存档，文件夹侦察只读且进入事件流', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'crux-match-'));
  try {
    const repo = path.join(base, 'repo');
    await import('node:fs/promises').then(fs => fs.mkdir(repo));
    await writeFile(path.join(repo, 'README.md'), '# demo repo\n');
    await writeFile(path.join(repo, '.env'), 'SECRET=1\n');
    const seen: string[] = [];
    const r = await runLocalMatch({ question: '该不该拆微服务？', team: ['claude', 'doubao', 'kimi'], mode: 'team', dir: repo, outDir: path.join(base, 'out'), onEvent: e => seen.push(e.type) });
    const events = parseEventLines(await readFile(r.eventsFile, 'utf8'));
    assert.equal(events.length, r.events.length);
    assert.deepEqual(seen, events.map(e => e.type));
    assert.equal(await readFile(r.logFile, 'utf8'), renderBattleLog(events));
    const reads = events.filter(e => e.type === 'tool_call');
    assert.ok(reads.some(e => e.type === 'tool_call' && e.tool === 'repo_map'));
    assert.ok(reads.some(e => e.type === 'tool_call' && e.input.path === 'README.md' && e.ok));
    assert.ok(!reads.some(e => e.type === 'tool_call' && e.input.path === '.env'));
    assert.match(r.battleLog, /写入 0 次/);
    assert.equal(events.at(-1)?.type, 'match_ended');
  } finally { await rm(base, { recursive: true, force: true }); }
});
