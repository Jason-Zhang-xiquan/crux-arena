import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRecorder, fighterSpecs, runMatch } from '@crux/engine';
import { LlmBrains, classify, cursorModelFor, extractJson, findOnPath, limit, minimalEnv, runProcess } from '../src/index.ts';
import type { Channel, ChannelRequest, ChannelResult, Seat } from '../src/index.ts';

test('档位映射：取最接近的一档，同样近时取低一档；没有档位变体就用原名', () => {
  const models = new Set(['kimi-k3-low', 'kimi-k3-high', 'kimi-k3-max', 'glm-5.2-high', 'glm-5.2-max', 'gpt-5.5-none', 'gpt-5.5-medium', 'gpt-5.5-extra-high', 'composer-2.5', 'composer-2.5-fast']);
  assert.equal(cursorModelFor('kimi-k3', 'low', models), 'kimi-k3-low');
  assert.equal(cursorModelFor('kimi-k3', 'medium', models), 'kimi-k3-low');
  assert.equal(cursorModelFor('glm-5.2', 'low', models), 'glm-5.2-high');
  assert.equal(cursorModelFor('gpt-5.5', 'off', models), 'gpt-5.5-none');
  assert.equal(cursorModelFor('gpt-5.5', 'max', models), 'gpt-5.5-extra-high');
  assert.equal(cursorModelFor('composer-2.5', 'low', models), 'composer-2.5');
  assert.equal(cursorModelFor('nope', 'low', models), undefined);
});

test('解析输出：容忍代码块和前后文字；错误按字样归类', () => {
  assert.deepEqual(extractJson('好的：\n```json\n{"a":1,"b":{"c":[2]}}\n```\n以上'), { a: 1, b: { c: [2] } });
  assert.throws(() => extractJson('没有 JSON'));
  assert.equal(classify('You have reached your usage limit'), 'quota');
  assert.equal(classify('Error 429: Too Many Requests'), 'rate_limit');
  assert.equal(classify('Failed to authenticate: OAuth session expired'), 'auth');
  assert.equal(classify('socket hang up'), 'unavailable');
});

test('并发闸门：同一通道同时最多 N 个调用', async () => {
  let running = 0, peak = 0;
  const ch = limit({
    id: 'x', concurrency: 2,
    async call(): Promise<ChannelResult> {
      running++; peak = Math.max(peak, running);
      await new Promise(r => setTimeout(r, 10));
      running--;
      return { ok: true, text: '{}', usage: { in: 1, out: 1, cached: 0, estimated: false }, model: 'm', effortApplied: 'm', ms: 10 };
    },
  });
  await Promise.all(Array.from({ length: 7 }, () => ch.call({ task: 'draft', model: 'm', effort: 'low', system: '', prompt: '' })));
  assert.equal(peak, 2);
});

/** 模拟通道：按任务给出合规输出；可以注入一次格式错误、一次限流、某个模型额度用尽 */
function mockChannel(o: { badOnce?: boolean; rateLimitOnce?: boolean; quotaModel?: string } = {}): Channel & { calls: ChannelRequest[] } {
  const calls: ChannelRequest[] = [];
  let bad = o.badOnce, limited = o.rateLimitOnce;
  const ok = (json: unknown): ChannelResult => ({ ok: true, text: '```json\n' + JSON.stringify(json) + '\n```', usage: { in: 100, out: 20, cached: 0, estimated: false }, model: 'mock', effortApplied: 'mock', ms: 1 });
  return {
    id: 'mock', concurrency: 8, calls,
    async call(req) {
      calls.push(req);
      if (req.model === o.quotaModel) return { ok: false, error: { kind: 'quota', message: 'usage limit' }, model: req.model, ms: 1 };
      if (limited && req.task === 'act') { limited = false; return { ok: false, error: { kind: 'rate_limit', message: '429', retryAfterMs: 1 }, model: req.model, ms: 1 }; }
      if (bad && req.task === 'draft') { bad = false; return { ok: true, text: '我觉得应该……', usage: { in: 50, out: 10, cached: 0, estimated: false }, model: 'mock', effortApplied: 'mock', ms: 1 }; }
      if (req.task === 'draft' && req.model === 'm-a' && !req.prompt.includes('你请求查看的原文')) return ok({ need: ['src/app.ts:1-20'] });
      if (req.task === 'draft') return ok({ answer: `${req.model} 的回答`, claim: { text: `${req.model} 的主论点`, short: `${req.model} 主张`, label: '推断' } });
      if (req.task === 'crux') return ok({ merges: [], clash: ['C1', 'C2', 'C3'], consensus: ['都同意要做'], stances: {}, why: '优先级之争' });
      if (req.task === 'act') {
        // 论点板里第一张不是自己的卡就打它
        const target = req.prompt.match(/- (C\d+) \[[^\]]+\] \d+HP · [^·]+ · 支持：(?!YOU)/)?.[1] ?? 'C1';
        return ok({ actions: [{ kind: 'attack', target, why: '代价太高', steelman: '确实有用', detail: '成本收益不划算', evidence: [{ kind: 'file', ref: 'PLAN.md:1-2', quote: '标题' }] }] });
      }
      if (req.task === 'rule') {
        const ids = [...req.prompt.matchAll(/^- (A\d+) /gm)].map(m => m[1]);
        return ok({ rulings: ids.map(id => ({ id, verdict: 'upheld', text: '成立', evidenceRelevant: true })) });
      }
      return ok({ answer: '**先做 A**\n- 原因', minority: [], userCruxes: ['预算多少？'], confidence: 0.7 });
    },
  };
}

test('LLM 大脑：模拟通道打完整场；格式错误和限流会重试，额度用尽的选手观望', async () => {
  const ch = mockChannel({ badOnce: true, rateLimitOnce: true, quotaModel: 'm-d' });
  const fighters = fighterSpecs(['claude', 'codex', 'grok', 'kimi']);
  const seats: Record<string, Seat> = Object.fromEntries(fighters.map((f, i) => [f.id, { channel: ch, model: `m-${'abcd'[i]}`, effort: 'low' as const }]));
  const rec = createRecorder();
  const calls: string[] = [];
  const reads: string[] = [];
  const brains = new LlmBrains({
    seats, judge: { channel: ch, model: 'judge', effort: 'low' }, chair: { channel: ch, model: 'chair', effort: 'medium' },
    state: () => rec.state, verify: async e => ({ ok: true, note: `${e.ref}：原文核对一致` }),
    lenses: ['正确性', '安全'],
    read: async (actor, ref) => { reads.push(`${actor}:${ref}`); return `【${ref}】1| const x = 1;`; },
    onCall: c => calls.push(`${c.role}:${c.task}:${c.ok ? 'ok' : c.error?.kind}`),
  });
  await runMatch({ question: '先做什么？', fighters, judge: 'mock/judge', chair: 'mock/chair', maxRounds: 1 }, brains, rec);

  const types = rec.events.map(e => e.type);
  assert.ok(types.includes('final') && types.at(-1) === 'match_ended');
  assert.equal(rec.events.filter(e => e.type === 'claim').length, 3, '额度用尽的 KIMI 没有论点，其余 3 人各一个');
  assert.ok(calls.some(c => c.endsWith(':draft:bad_output')), '格式错误被记录');
  assert.ok(calls.some(c => c.endsWith(':act:rate_limit')), '限流被记录');
  assert.equal(calls.filter(c => c.startsWith('kimi:')).every(c => c.endsWith('quota')), true);
  assert.equal(calls.filter(c => c === 'kimi:draft:quota').length, 1, '额度用尽不重试');
  const crit = rec.events.find(e => e.type === 'ruling' && e.crit);
  assert.ok(crit, '证据核对通过 + 裁决成立 = 暴击');
  assert.equal(calls.filter(c => c.startsWith('judge:rule')).length, 1, '一回合只调用一次裁判');
  assert.equal(rec.events.filter(e => e.type === 'ruling').length, rec.events.filter(e => e.type === 'action').length);
  assert.deepEqual(reads, ['claude:src/app.ts:1-20'], '选手请求的文件由引擎读出');
  assert.equal(calls.filter(c => c === 'claude:draft:ok').length, 2, '请求读文件后再作答一次');
  assert.ok(ch.calls.some(r => r.task === 'act' && r.prompt.includes('你之前查看过的原文')), '交锋时继续给他看过的原文');
  assert.ok(ch.calls.some(r => r.task === 'draft' && r.prompt.includes('你的视角：安全')), '视角按出场顺序轮流分配');
  const fin = rec.events.find(e => e.type === 'final');
  assert.ok(fin?.type === 'final' && fin.answer.includes('先做 A'));
});

test('解析输出：JSON 后面还有带括号的说明文字也能取出', () => {
  assert.deepEqual(extractJson('{"a":{"b":"x}"}}\n备注：{见上}'), { a: { b: 'x}' } });
  assert.deepEqual(extractJson('先想一下 {草稿} 然后 {"ok":true}'), { ok: true });
});

test('超时：整棵进程树被杀掉，调用在几秒内返回', async () => {
  const t0 = Date.now();
  const script = 'require("child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "inherit" }); setInterval(() => {}, 1000);';
  const r = await runProcess(process.execPath, ['-e', script], { timeoutMs: 300 });
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - t0 < 7000, `用了 ${Date.now() - t0}ms`);
});

test('环境变量白名单：不把宿主的密钥和会话凭据传给命令行', () => {
  process.env.CRUX_TEST_API_KEY = 'secret';
  process.env.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL ?? 'https://example.invalid';
  const env = minimalEnv({ CURSOR_INVOKED_AS: 'x' });
  assert.equal(env.CRUX_TEST_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_BASE_URL, undefined);
  assert.ok(env.PATH ?? env.Path);
  assert.equal(env.CURSOR_INVOKED_AS, 'x');
  delete process.env.CRUX_TEST_API_KEY;
});

test('盲答不到 2 人交卷：判对局无效，不调用裁判，也不当成完美收敛', async () => {
  for (const ok of [0, 1]) {
    const ch = mockChannel({ quotaModel: 'm-x' });
    const fighters = fighterSpecs(['claude', 'codex', 'grok']);
    const seats: Record<string, Seat> = Object.fromEntries(fighters.map((f, i) => [f.id, { channel: ch, model: i < ok ? `m-${i}` : 'm-x', effort: 'low' as const }]));
    const rec = createRecorder();
    const brains = new LlmBrains({ seats, judge: { channel: ch, model: 'judge', effort: 'low' }, chair: { channel: ch, model: 'chair', effort: 'medium' }, state: () => rec.state });
    await runMatch({ question: 'q', fighters, judge: 'j', chair: 'c' }, brains, rec);
    const conv = rec.events.find(e => e.type === 'converged');
    assert.equal(conv?.type === 'converged' && conv.reason, 'forfeit');
    assert.ok(!ch.calls.some(r => r.task === 'crux' || r.task === 'rule'), '不调用裁判');
    const fin = rec.events.find(e => e.type === 'final');
    assert.ok(fin?.type === 'final' && fin.confidence <= 0.3);
    assert.equal(ch.calls.some(r => r.task === 'final'), ok === 1, '只有一人作答时才请主席综合');
  }
});

test('PATH 查找：Windows 只认 .exe（.cmd 要经过 shell，不用），找不到返回 undefined', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'crux-path-'));
  try {
    const exe = process.platform === 'win32' ? 'tool.exe' : 'tool';
    await writeFile(path.join(dir, exe), '');
    await writeFile(path.join(dir, 'other.cmd'), '');
    assert.equal(findOnPath(['tool'], { PATH: dir }), path.join(dir, exe));
    assert.equal(findOnPath(['missing'], { PATH: dir }), undefined);
    if (process.platform === 'win32') assert.equal(findOnPath(['other'], { PATH: dir }), undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
