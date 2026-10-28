#!/usr/bin/env node
// 脚本协议 v1 的最小示例：一个不调用任何模型的"模拟选手"，用来零成本验收通道、试跑整场比赛。
// 协议：标准输入读一个请求 JSON，标准输出最后一行写一个结果 JSON（见 docs/channels.md）。
// 接自己的模型时，把 answer() 换成真正的调用即可。
let input = '';
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  const req = JSON.parse(input);
  try {
    const json = answer(req);
    console.log(JSON.stringify({ ok: true, json, model: `mock/${req.model}`, usage: { in: Math.ceil(req.prompt.length / 2), out: 40 } }));
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: { kind: 'bad_output', message: String(err) } }));
  }
});

function answer({ task, model, prompt }) {
  if (task === 'draft') return { answer: `${model} 的回答：先做最小可行的一步。`, claim: { text: `${model} 认为应该先做 ${model.length % 2 ? '评测' : '传播'}`, short: `${model} 主张`, label: 'inference' } };
  if (task === 'crux') {
    const ids = [...prompt.matchAll(/^- (C\d+)/gm)].map(m => m[1]);
    return { merges: [], clash: ids.slice(0, 4), consensus: ['都同意先做小步验证'], stances: {}, why: '先做什么的优先级之争' };
  }
  if (task === 'act') {
    const target = prompt.match(/- (C\d+) \[[^\]]+\] \d+HP · [^·]+ · 支持：(?!YOU)/)?.[1];
    return { actions: target ? [{ kind: 'attack', target, why: '成本收益不划算', steelman: '确实有价值', detail: '模拟选手的固定反驳' }] : [] };
  }
  if (task === 'rule') {
    const ids = [...prompt.matchAll(/^- (A\d+) /gm)].map(m => m[1]);
    return { rulings: ids.map((id, i) => ({ id, verdict: i % 2 ? 'partial' : 'upheld', text: '模拟裁决', evidenceRelevant: false })), verdict: 'partial', text: '模拟裁决', evidenceRelevant: false };
  }
  if (task === 'final') return { answer: '**模拟冠军答案**\n- 先做最小可行的一步', minority: [], userCruxes: ['这是模拟选手，不代表真实模型'], confidence: 0.5 };
  throw new Error(`未知任务 ${task}`);
}
