import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import { ChannelCfg, CustomConfig, createChannel } from '../src/index.ts';
import type { ChannelRequest } from '../src/index.ts';

const req: ChannelRequest = { task: 'draft', model: 'm1', effort: 'low', system: '只输出 JSON', prompt: '输出 {"ok":true}' };
const mock = path.resolve(import.meta.dirname, '..', '..', '..', 'integrations', 'channels', 'mock-fighter.mjs');

test('自定义通道 · 脚本协议：模拟选手按任务回结构化结果', async () => {
  const ch = createChannel('mock', ChannelCfg.parse({ type: 'script', cmd: [process.execPath, mock] }));
  const r = await ch.call(req);
  assert.ok(r.ok, JSON.stringify(r));
  if (r.ok) {
    assert.equal(JSON.parse(r.text).claim.short, 'm1 主张');
    assert.equal(r.model, 'mock/m1');
    assert.equal(r.usage.estimated, false);
  }
});

test('自定义通道 · 命令行模板：占位符、json 路径、用量、错误字样归类', async () => {
  const echo = 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify({result:{text:process.argv[1]+"|"+process.argv[2]},usage:{prompt_tokens:12,completion_tokens:3}})))';
  const ok = createChannel('cli', ChannelCfg.parse({ type: 'command', cmd: [process.execPath, '-e', echo, '{model}', '{effort}'], output: 'json:result.text', usage: 'json:usage', effort: { low: 'L' } }));
  const r = await ok.call(req);
  assert.ok(r.ok && r.text === 'm1|L' && r.usage.in === 12 && r.usage.out === 3, JSON.stringify(r));

  const quota = createChannel('cli', ChannelCfg.parse({ type: 'command', cmd: [process.execPath, '-e', 'console.log("Sorry, you hit your usage limit")'], errors: { quota: ['usage limit'] } }));
  const q = await quota.call(req);
  assert.ok(!q.ok && q.error.kind === 'quota');
});

test('自定义通道 · 兼容 OpenAI 的 API：请求体、key 走环境变量、状态码归类', async () => {
  const seen: Array<{ auth?: string; body: Record<string, unknown> }> = [];
  let status = 200;
  const server = createServer((rq, rs) => {
    let b = '';
    rq.on('data', d => { b += d; }).on('end', () => {
      seen.push({ auth: rq.headers.authorization, body: JSON.parse(b) });
      if (status !== 200) { rs.writeHead(status, { 'retry-after': '2' }).end('{"error":"x"}'); return; }
      rs.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ model: 'served', choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 20, completion_tokens: 5 } }));
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try {
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    process.env.CRUX_TEST_KEY = 'k-123';
    const ch = createChannel('api', ChannelCfg.parse({ type: 'openai', baseUrl, apiKeyEnv: 'CRUX_TEST_KEY', reasoningEffort: true }));
    const r = await ch.call(req);
    assert.ok(r.ok && r.text === '{"ok":true}' && r.usage.in === 20 && r.model === 'served', JSON.stringify(r));
    assert.equal(seen[0].auth, 'Bearer k-123');
    assert.equal(seen[0].body.reasoning_effort, 'low');
    assert.deepEqual((seen[0].body.messages as Array<{ role: string }>).map(m => m.role), ['system', 'user']);

    status = 429;
    const lim = await ch.call(req);
    assert.ok(!lim.ok && lim.error.kind === 'rate_limit' && lim.error.retryAfterMs === 2000);
    status = 401;
    const auth = await ch.call(req);
    assert.ok(!auth.ok && auth.error.kind === 'auth');

    delete process.env.CRUX_TEST_KEY;
    const noKey = await ch.call(req);
    assert.ok(!noKey.ok && noKey.error.kind === 'auth' && /CRUX_TEST_KEY/.test(noKey.error.message));
  } finally { server.close(); }
});

test('channels.json 校验：编号格式、未知类型都会报错', () => {
  assert.ok(CustomConfig.safeParse({ fighters: { llama: { channel: 'x', model: 'y' } } }).success);
  assert.ok(!CustomConfig.safeParse({ fighters: { 'Bad Id': { channel: 'x', model: 'y' } } }).success);
  assert.ok(!CustomConfig.safeParse({ channels: { a: { type: 'ftp' } } }).success);
});
