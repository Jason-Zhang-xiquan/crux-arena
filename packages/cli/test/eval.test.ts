import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ChannelCfg, LlmBrains, createChannel } from '@crux/channels';
import type { CallRecord } from '@crux/channels';
import { bugHits, decoyHits, extractChoice, formatQuestion, importGpqa, parseCsv, parseItems, reportEval, runEval, vote } from '../src/eval.ts';
import type { BrainsFactory } from '../src/match.ts';

test('评测：从回答里取选项字母', () => {
  assert.equal(extractChoice('推理……\n答案：C', 4), 'C');
  assert.equal(extractChoice('答案是 (B)。', 4), 'B');
  assert.equal(extractChoice('先排除 A，答案：**D**', 4), 'D');
  assert.equal(extractChoice('The answer is B.', 4), 'B');
  assert.equal(extractChoice('the answer is a matter of taste', 4), undefined);   // 小写 a 不算
  assert.equal(extractChoice('综合来看应选 C', 4), 'C');
  assert.equal(extractChoice('一开始以为答案：A，再想想答案：B', 4), 'B');      // 取最后一次
  assert.equal(extractChoice('答案：E', 4), undefined);                          // 超出选项
  assert.equal(extractChoice('结论\nB', 4), 'B');
  assert.equal(extractChoice('没有给出明确选项', 4), undefined);
});

test('评测：多数投票、平票按期望计分、代码审查命中', () => {
  assert.deepEqual(vote(['A', 'A', 'B'], 'A'), { credit: 1, outcome: 'right', pick: 'A' });
  assert.deepEqual(vote(['A', 'B', 'B', undefined], 'A'), { credit: 0, outcome: 'wrong', pick: 'B' });
  assert.equal(vote(['A', 'B'], 'A').credit, 0.5);
  assert.equal(vote(['A', 'B'], 'A').outcome, 'tie');
  assert.equal(vote([undefined], 'A').outcome, 'none');

  const item = { id: 'r1', kind: 'bugs' as const, question: 'q', dir: '.', bugs: [
    { id: 'b1', file: 'src/auth.ts', keywords: ['token 过期', 'expiry'] },
    { id: 'b2', keywords: ['off-by-one', '越界'] },
  ] };
  assert.deepEqual(bugHits('auth.ts 没检查 token 过期；分页有越界', item), ['b1', 'b2']);
  assert.deepEqual(bugHits('有地方没检查 expiry', item), []);                  // 没提文件名
});

test('评测：shortlink 代码审查题的判分关键词', async () => {
  const [item] = parseItems(await readFile(path.join(import.meta.dirname, '..', '..', '..', 'eval', 'code-review.jsonl'), 'utf8'));
  assert.equal(item.kind, 'bugs');
  if (item.kind !== 'bugs') return;
  const ideal = [
    '1. server.js 的 DELETE 接口不检查所有者，任何登录用户都能删别人的短链（越权）。',
    '2. links.js createLink：自定义短码不检查是否已存在，会覆盖别人的短链。',
    '3. ratelimit.js clientKey 直接信任 X-Forwarded-For，伪造请求头即可绕过限流。',
    '4. auth.js issueToken 用毫秒时间戳加上秒数，令牌 3.6 秒就过期。',
    '5. listLinks 分页写成 slice(start, size)，第 2 页起为空。',
  ].join('\n');
  assert.deepEqual(bugHits(ideal, item), item.bugs.map(b => b.id));
  assert.deepEqual(bugHits('代码整体结构清晰，建议补充单元测试和日志。', item), []);
  assert.deepEqual(bugHits('listLinks 的分页有问题：slice 的第二个参数应该是 start + size。', item), ['b4-pagination']);
});

test('评测：signup 代码审查题的判分关键词，诱饵被当成 bug 算误报', async () => {
  const items = parseItems(await readFile(path.join(import.meta.dirname, '..', '..', '..', 'eval', 'code-review.jsonl'), 'utf8'));
  const item = items.find(i => i.id === 'signup');
  assert.ok(item?.kind === 'bugs');
  if (item?.kind !== 'bugs') return;
  const ideal = [
    '1. signup.js 的 signup：listSignups 和 addSignup 之间有 await，并发报名会超卖。',
    '2. export.js exportAttendees：replace 只替换第一个 ../，可以路径穿越写到导出目录之外。',
    '3. events.js createEvent：{ ...DEFAULTS } 是浅拷贝，没给 tags 的活动共用同一个数组。',
    '4. points.js totalPoints：forEach(async) 不会等待，总积分恒为 0。',
    '5. points.js topScores：默认 sort() 是字典序，应该用 (a, b) => b - a。',
  ].join('\n');
  assert.deepEqual(bugHits(ideal, item), item.bugs.map(b => b.id));
  assert.deepEqual(decoyHits(ideal, item), []);
  assert.deepEqual(decoyHits('signup.js 的 removeExpired 边遍历边删，会跳过元素；export.js readExport 里的 return await 是多余的。', item), ['d1-backward-splice', 'd2-return-await']);
});

test('评测：题库校验、GPQA 导入（选项固定打乱、答案跟着走）', () => {
  assert.throws(() => parseItems('{"id":"x","question":"q","choices":["a","b"],"answer":"C"}'), /超出选项范围/);
  assert.throws(() => parseItems('{"id":"x","question":"q","choices":["a","b"],"answer":"A"}\n{"id":"x","question":"q","choices":["a","b"],"answer":"A"}'), /重复/);
  const items = parseItems('// 注释\n{"id":"x","question":"1+1?","choices":["2","3"],"answer":"A"}\n');
  assert.match(formatQuestion(items[0]), /A\. 2\nB\. 3/);
  assert.match(formatQuestion(items[0]), /答案：X/);

  assert.deepEqual(parseCsv('a,"b,c","d ""e""\nf"\r\n1,2,3\n'), [['a', 'b,c', 'd "e"\nf'], ['1', '2', '3']]);
  const csv = '﻿Record ID,Question,Correct Answer,Incorrect Answer 1,Incorrect Answer 2,Incorrect Answer 3\nrec1,"What, exactly?",right,w1,w2,w3\nrec2,Q2,ok,x,y,z\n';
  const g = importGpqa(csv);
  assert.equal(g.length, 2);
  assert.equal(g[0].id, 'gpqa-rec1');
  assert.equal(g[0].question, 'What, exactly?');
  assert.equal(g[0].choices['ABCD'.indexOf(g[0].answer)], 'right');
  assert.equal(g[1].choices['ABCD'.indexOf(g[1].answer)], 'ok');
  assert.deepEqual(importGpqa(csv), g);                                       // 每次导入结果一样
  assert.throws(() => importGpqa('a,b\n1,2\n'), /Question/);
});

test('评测：整套流程（模拟选手，零 token）——盲答、计票、翻盘、续跑', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'crux-eval-'));
  try {
    const setFile = path.join(dir, 'set.jsonl');
    await writeFile(setFile, [
      { id: 'q1', question: '哪个对？', choices: ['甲', '乙', '丙'], answer: 'A' },
      { id: 'q2', question: '又是哪个？', choices: ['甲', '乙'], answer: 'B' },
    ].map(x => JSON.stringify(x)).join('\n'));
    const mock = createChannel('mock', ChannelCfg.parse({ type: 'script', cmd: [process.execPath, path.join(import.meta.dirname, 'fixtures', 'eval-mock.mjs')] }));
    const brains = ({ onCall }: { onCall: (c: CallRecord) => void }): BrainsFactory => async ({ fighters, rec }) => {
      const seat = (model: string) => ({ channel: mock, model, effort: 'low' as const });
      return { brains: new LlmBrains({ seats: Object.fromEntries(fighters.map(f => [f.id, seat(f.id)])), judge: seat('judge'), chair: seat('chair'), state: () => rec.state, onCall }), judge: 'mock/judge', chair: 'mock/chair' };
    };
    const out = path.join(dir, 'run');
    const opts = { setFile, out, team: ['claude', 'codex', 'gemini'], effort: 'low' as const, rounds: 1, budget: 50_000, brains };
    const rows = await runEval(opts);
    assert.equal(rows.size, 2);
    assert.equal(rows.get('q1')?.status, 'done');
    assert.match(rows.get('q1')?.drafts.claude.text ?? '', /答案：A/);
    assert.ok((rows.get('q1')?.totalTokens ?? 0) > 0);

    const { report, markdown } = await reportEval(out);
    const q1 = report.choice.find(s => s.id === 'q1')!;
    assert.deepEqual(q1.picks, { claude: 'A', codex: 'B', gemini: 'B' });
    assert.equal(q1.vote.outcome, 'wrong');
    assert.equal(q1.arenaRight, true);                                          // 投票错、竞技场改对
    const q2 = report.choice.find(s => s.id === 'q2')!;
    assert.equal(q2.vote.outcome, 'right');
    assert.equal(q2.arenaRight, false);                                         // 投票对、竞技场改错
    assert.match(markdown, /投票错 → 竞技场改对：1 题（q1）/);
    assert.match(markdown, /投票对 → 竞技场改错：1 题（q2）/);
    assert.match(await readFile(path.join(out, 'report.md'), 'utf8'), /单模型 claude \| 1 \| 50%/);

    // 续跑：已完成的题不再开打
    let started = 0;
    await runEval({ ...opts, log: s => { if (s.includes('开打')) started++; } });
    assert.equal(started, 0);
    // 换了阵容不能混进同一个目录
    await assert.rejects(runEval({ ...opts, team: ['claude', 'codex'] }), /设置不同/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
