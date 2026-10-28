import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { MH, MW, blankMascot, builtinIds, checkMascot, exportBuiltin, loadUserMascots, previewPng } from '../src/mascots.ts';

test('吉祥物：13 个自带形象都能导出成合格的像素表，四个姿势各不相同', async () => {
  const ids = await builtinIds();
  assert.equal(ids.length, 13);
  for (const id of ids) {
    const m = await exportBuiltin(id);
    assert.deepEqual(checkMascot(m), [], id);
    assert.equal(m.poses.idle!.length, MH);
    assert.ok(m.poses.idle!.every(r => r.length === MW));
    assert.notDeepEqual(m.poses.idle, m.poses.atk, `${id} 的攻击姿势应该和待机不同`);
  }
});

test('吉祥物：校验能指出行数、列数、未知字符和颜色问题', () => {
  const m = blankMascot('llama', 'LLAMA', '#f2a65a');
  assert.deepEqual(checkMascot(m), []);
  const bad = structuredClone(m);
  bad.poses.idle = bad.poses.idle!.slice(1);
  bad.poses.atk![0] = 'Z'.repeat(MW);
  bad.palette.a = 'orange';
  const e = checkMascot(bad).join('\n');
  assert.match(e, /idle 必须正好 20 行/);
  assert.match(e, /palette 里没有的字符 "Z"/);
  assert.match(e, /palette\.a 不是合法颜色/);
  assert.match(checkMascot({ ...m, id: 'Bad Id' }).join(), /id 必须/);
});

test('吉祥物：预览是合法 PNG；目录里不合格的文件被跳过并报告', async () => {
  const png = previewPng(blankMascot('x'), 4);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'crux-mascots-'));
  try {
    await writeFile(path.join(dir, 'good.json'), JSON.stringify(blankMascot('good')));
    await writeFile(path.join(dir, 'bad.json'), JSON.stringify({ id: 'bad', palette: {}, poses: {} }));
    const r = await loadUserMascots(dir);
    assert.deepEqual(r.mascots.map(m => m.id), ['good']);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /bad\.json/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
