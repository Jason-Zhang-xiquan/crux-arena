import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { installShim, shimPlan, shimStatus, shimText } from '../src/cli-shim.ts';

test('crux 启动脚本：安装版设 CRUX_DESKTOP，开发版不设；不覆盖别人的 crux', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'crux-shim-'));
  try {
    const script = path.join(dir, 'crux.mjs');
    await writeFile(script, '');
    const packaged = { ...shimPlan({ packaged: true, resourcesPath: dir, appDir: dir }), script, target: path.join(dir, 'bin', 'crux.cmd') };
    const text = shimText('C:/Apps/Crux Arena.exe', packaged);
    assert.match(text, /ELECTRON_RUN_AS_NODE=1/);
    assert.match(text, /CRUX_DESKTOP/);
    assert.doesNotMatch(shimText('electron.exe', { ...packaged, packaged: false }), /CRUX_DESKTOP/);

    assert.equal((await installShim('C:/Apps/Crux Arena.exe', packaged)).ok, true);
    const s = await shimStatus(packaged);
    assert.ok(s.installed && s.ours && s.available);
    assert.match(await readFile(packaged.target, 'utf8'), /crux-arena-shim/);

    // 目标位置是别人的 crux：不覆盖
    await writeFile(packaged.target, 'echo someone else');
    const r = await installShim('C:/Apps/Crux Arena.exe', packaged);
    assert.equal(r.ok, false);
    assert.equal(await readFile(packaged.target, 'utf8'), 'echo someone else');

    // 打包的 CLI 不存在：不写
    assert.equal((await installShim('x', { ...packaged, script: path.join(dir, 'missing.mjs') })).ok, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
