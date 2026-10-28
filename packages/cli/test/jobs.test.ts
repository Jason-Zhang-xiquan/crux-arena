import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { listMatches, readMatch, resolveMatch, summarize, waitForMatch } from '../src/jobs.ts';
import { runLocalMatch } from '../src/match.ts';
import { autoLens } from '../src/real.ts';
import { normalizeFighter } from '../src/settings.ts';

test('对局任务：meta.json、状态、给 agent 的结果摘要', async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), 'crux-jobs-'));
  try {
    const r = await runLocalMatch({
      question: '该不该拆微服务？', team: ['claude', 'codex', 'gemini'], outDir: out, matchId: '20260101-000000-test',
      meta: { source: 'cli', display: 'none', pid: process.pid, question: '该不该拆微服务？', team: ['claude', 'codex', 'gemini'], startedAt: new Date().toISOString() },
    });
    assert.equal(r.matchId, '20260101-000000-test');
    const m = await readMatch(r.matchDir);
    assert.equal(m.status, 'done');
    assert.equal(m.meta?.display, 'none');
    const text = summarize(m);
    assert.match(text, /## 冠军答案/);
    assert.match(text, /## 谁说服了谁/);
    assert.match(text, /battle-log\.md/);
    assert.equal(await resolveMatch(out, 'latest'), r.matchDir);
    assert.equal((await waitForMatch(r.matchDir, 1000)).status, 'done');
    assert.equal((await listMatches(out)).length, 1);

    // 进程已退出、没打完：判为中断
    const dead = path.join(out, '20260101-000001-dead');
    await mkdir(dead);
    await writeFile(path.join(dead, 'meta.json'), JSON.stringify({ source: 'cli', display: 'mini', pid: 999_999_9, question: 'x', team: [], startedAt: '' }));
    await writeFile(path.join(dead, 'events.jsonl'), '');
    assert.equal((await readMatch(dead)).status, 'dead');
  } finally { await rm(out, { recursive: true, force: true }); }
});

test('选手别名与视角自动判断', () => {
  assert.equal(normalizeFighter('GPT'), 'codex');
  assert.equal(normalizeFighter(' Google '), 'gemini');
  assert.equal(normalizeFighter('deepseek'), 'deepseek');
  assert.equal(autoLens('这套代码有哪些 bug', '/repo'), 'code');
  assert.equal(autoLens('这套代码有哪些 bug'), 'decision');
  assert.equal(autoLens('下一步该做什么', '/repo'), 'decision');
});
