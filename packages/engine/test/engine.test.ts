import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ScriptedBrains, checkAction, clampText, createRecorder, demoConfig, demoScript, measure, parseEventLines,
  reduce, renderBattleLog, renderBoard, boardView, runMatch, sumTokens, WHY_LIMIT,
} from '../src/index.ts';
import type { MatchConfig, MatchEvent, Script } from '../src/index.ts';

const fixedClock = () => { let t = 0; return () => (t += 100); };
const clone = (s: Script): Script => structuredClone(s);

async function play(script: Script = demoScript, cfg: MatchConfig = demoConfig) {
  const brains = new ScriptedBrains(script);
  const rec = await runMatch(cfg, brains, createRecorder({ now: fixedClock() }));
  return { rec, brains, events: rec.events, s: rec.state, log: renderBattleLog(rec.events) };
}

test('演示比赛：流程、血量、轮空、收敛都符合剧本', async () => {
  const { events, s } = await play();
  const types = events.map(e => e.type);
  assert.equal(types[0], 'match_started');
  assert.equal(types.at(-1), 'match_ended');
  assert.deepEqual(events.filter(e => e.type === 'claim').map(e => e.id), ['C1', 'C2', 'C3', 'C4']);
  assert.deepEqual(Object.keys(s.actions), ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']);
  assert.equal(s.claims.C1.hp, 85);
  assert.equal(s.claims.C2.status, 'ko');
  assert.equal(s.claims.C3.status, 'ko');
  assert.equal(s.claims.C4.hp, 100);
  assert.deepEqual(s.skips.map(k => [k.round, k.actor]), [[2, 'deepseek']]);
  assert.equal(s.converged?.reason, 'settled');
  assert.equal(s.converged?.round, 2);
  assert.equal(s.flags.length, 0);
  assert.ok(s.actions.A4.ruling?.crit, '带证据且被核实的攻击应暴击');
  assert.equal(s.actions.A4.ruling?.damage, 45);
});

test('说服链：认输引用的动作发起人 → 认输者', async () => {
  const { s } = await play();
  assert.deepEqual(s.edges.map(e => [e.from, e.to, e.on, e.causes.join(' '), e.change]), [
    ['deepseek', 'codex', 'C2', 'A4', 'A6'],
    ['claude', 'gemini', 'C3', 'A1 A5', 'A7'],
  ]);
  assert.deepEqual(s.claims.C1.supporters, ['claude', 'deepseek', 'codex', 'gemini']);
});

test('token 合计 = 各事件 token 之和', async () => {
  const { events, s } = await play();
  const total = events.reduce((n, e) => n + ('tokens' in e && e.tokens ? sumTokens(e.tokens) : 0), 0);
  assert.equal(s.tokens, total);
  const end = events.at(-1) as Extract<MatchEvent, { type: 'match_ended' }>;
  assert.equal(end.totalTokens, total);
});

test('事件可以序列化成 jsonl 再解析回来，日志完全一致（确定性）', async () => {
  const a = await play();
  const b = await play();
  assert.equal(a.log, b.log);
  const jsonl = a.events.map(e => JSON.stringify(e)).join('\n');
  assert.equal(renderBattleLog(parseEventLines(jsonl)), a.log);
  assert.deepEqual(reduce(parseEventLines(jsonl)).claims, a.s.claims);
});

test('battle-log.md：一个动作一行，含说服链和结论溯源', async () => {
  const { log } = await play();
  assert.match(log, /#A4 +R1 攻 DEEPSEEK > C2 +抽 1 人运维=砍 20% 研发 \[web\] +→ -45 暴击｜证据成立 +←C4/);
  assert.match(log, /R2 略 DEEPSEEK +立场与 CLAUDE 重合，轮空/);
  assert.match(log, /DEEPSEEK +=> CODEX +C2 +抽 1 人运维=砍 20% 研发 +#A4 → #A6/);
  assert.match(log, /C2 ✗ ← #A6 CODEX 认输 ← #A4/);
  assert.match(log, /C1 ✓ 85HP +扛住 #A2/);
  const actionLines = log.split('\n').filter(l => /^#A\d/.test(l));
  assert.equal(actionLines.length, 7);
});

test('认输不写原因：重试一次后带"无因认输"标记放行', async () => {
  const script = clone(demoScript);
  script.acts[2].codex = [{ kind: 'concede', target: 'C2', why: '算了，听大家的', shiftTo: 'C1' }];
  const { s, brains, log } = await play(script);
  assert.ok(brains.calls.includes('act:2:codex:retry'));
  assert.deepEqual(s.flags.map(f => [f.kind, f.actor]), [['no_cause', 'codex']]);
  assert.equal(s.claims.C2.status, 'ko');
  assert.ok(!s.edges.some(e => e.to === 'codex'), '无因认输不产生说服边');
  assert.match(log, /C2 ✗ ← #A6 CODEX 认输（无因）/);
  assert.match(log, /无因认输 1 次/);
});

test('不合规动作（攻击自己的论点）重试后丢弃并记标记', async () => {
  const script = clone(demoScript);
  script.acts[1].codex = [{ kind: 'attack', target: 'C2', why: '自己打自己' }];
  const { s, brains } = await play(script);
  assert.ok(brains.calls.includes('act:1:codex:retry'));
  assert.equal(s.flags[0]?.kind, 'invalid_action');
  assert.ok(!Object.values(s.actions).some(a => a.actor === 'codex' && a.kind === 'attack'));
});

test('理由过长会被截断并记标记', async () => {
  const script = clone(demoScript);
  script.acts[1].claude[0].why = '冷启动在 B2B 场景下会让 p99 延迟出现秒级尖刺，客户签了 SLA 的情况下完全无法接受';
  const { s } = await play(script);
  assert.ok(measure(s.actions.A1.why) <= WHY_LIMIT);
  assert.ok(s.flags.some(f => f.kind === 'why_truncated' && f.action === 'A1'));
});

test('没有分歧：FLAWLESS VICTORY，不进入交锋', async () => {
  const script = clone(demoScript);
  script.crux = { ...script.crux, clash: ['C1'], stances: { P2: 'C1', P3: 'C1', P4: 'C1' } };
  const { events, s, brains } = await play(script);
  assert.equal(s.converged?.reason, 'flawless');
  assert.ok(!events.some(e => e.type === 'round_started' && e.round > 0));
  assert.ok(!brains.calls.some(c => c.startsWith('act:')));
});

test('预算用完：记标记并直接进入冠军答案', async () => {
  const { s, events } = await play(demoScript, { ...demoConfig, budget: 12_000 });
  assert.equal(s.converged?.reason, 'budget');
  assert.ok(s.flags.some(f => f.kind === 'budget'));
  assert.equal(events.at(-2)?.type, 'final');
});

test('组队模式：不能攻击队友的论点', async () => {
  const { s } = await play(demoScript, { ...demoConfig, mode: 'team' });
  // claude(红) codex(蓝) gemini(红) deepseek(蓝)：C4 属于蓝队，codex 不能打
  const r = checkAction(s, 'codex', { kind: 'attack', target: 'C1', why: 'x' }, { attack: false, defend: false });
  assert.ok(!r.errors.some(e => e.includes('队友')));
  const live = { ...s, claims: { ...s.claims, C4: { ...s.claims.C4, status: 'alive' as const } } };
  const bad = checkAction(live, 'codex', { kind: 'attack', target: 'C4', why: 'x' }, { attack: false, defend: false });
  assert.ok(bad.errors.some(e => e.includes('队友')));
});

test('论点板匿名：看不到模型名，只看到代号', async () => {
  const { s } = await play();
  const text = renderBoard(boardView(s, 'codex'));
  assert.ok(!/claude|gemini|deepseek|codex/i.test(text));
  assert.match(text, /你是 P2/);
  assert.match(text, /YOU/);
});

test('measure / clampText：20 个汉字或 12 个英文词', () => {
  assert.equal(measure('一二三四五'), 5);
  assert.equal(measure('one two three'), 5);
  assert.equal(clampText('短理由', WHY_LIMIT).truncated, false);
  const c = clampText('这是一个明显超过二十个汉字长度限制的理由文本用来测试截断', WHY_LIMIT);
  assert.ok(c.truncated && c.text.endsWith('…') && measure(c.text) <= WHY_LIMIT);
});
