#!/usr/bin/env node
// 评测用的模拟选手（脚本协议 v1）：claude 选 A，其余选 B；主席综合成 A。不调用任何模型。
let input = '';
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  const req = JSON.parse(input);
  console.log(JSON.stringify({ ok: true, json: answer(req), model: `mock/${req.model}`, usage: { in: 100, out: 20 } }));
});

function answer({ task, model, prompt }) {
  const letter = model === 'claude' ? 'A' : 'B';
  if (task === 'draft') return { answer: `${model} 的推理。\n答案：${letter}`, claim: { text: `应该选 ${letter}`, short: `选 ${letter}`, label: 'inference' } };
  if (task === 'crux') {
    const ids = [...prompt.matchAll(/^- (C\d+)/gm)].map(m => m[1]);
    return { merges: [], clash: ids.slice(0, 4), consensus: [], stances: {}, why: '选项之争' };
  }
  if (task === 'act') {
    const target = prompt.match(/- (C\d+) \[[^\]]+\] \d+HP · [^·]+ · 支持：(?!YOU)/)?.[1];
    return { actions: target ? [{ kind: 'attack', target, why: '推理有漏洞', steelman: '有一定道理', detail: '模拟反驳' }] : [] };
  }
  if (task === 'rule') {
    const ids = [...prompt.matchAll(/^- (A\d+) /gm)].map(m => m[1]);
    return { rulings: ids.map(id => ({ id, verdict: 'partial', text: '模拟裁决', evidenceRelevant: false })), verdict: 'partial', text: '模拟裁决', evidenceRelevant: false };
  }
  if (task === 'final') return { answer: '综合各方推理。\n\n答案：A', minority: ['有人选 B'], userCruxes: [], confidence: 0.6 };
  throw new Error(`未知任务 ${task}`);
}
