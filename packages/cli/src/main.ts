#!/usr/bin/env node
// crux 命令行：开打（真实模型 / 演示大脑）、后台对局与取结果（给 agent 用）、战报重建、只读文件夹工具。
import { appendFile, cp, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ScriptedBrains, createRecorder, demoConfig, demoScript, parseEventLines, renderBattleLog, runMatch } from '@crux/engine';
import { WorkspaceError, openWorkspace } from '@crux/workspace';
import type { LensSet } from '@crux/channels';
import { assetPath, docPath } from './assets.ts';
import { detachJob, ensureDesktop, listMatches, readMatch, resolveMatch, summarize, waitForMatch } from './jobs.ts';
import { blankMascot, builtinIds, checkMascot, exportBuiltin, formatMascot, loadUserMascots, mascotsDir, previewPng } from './mascots.ts';
import type { MascotData } from './mascots.ts';
import { newMatchId, runLocalMatch } from './match.ts';
import { autoLens, availableFighters, probeChannels, realBrains } from './real.ts';
import { extractJson } from '@crux/channels';
import type { Display, Effort } from './settings.ts';
import { customConfigFile, loadFightDefaults, matchesRoot, normalizeFighter } from './settings.ts';

const HELP = `crux · AI 竞技场命令行

开打（没写的参数用桌面版设置里的默认值）：
  crux fight "问题" [--team claude,codex,gemini,deepseek] [--dir 文件夹] [--mode ffa|team]
       [--brains real|demo] [--effort low] [--rounds 2] [--budget 250000] [--lens auto|code|decision|none]
       [--display full|mini|none]   画面：完整竞技场 / 角落小窗 / 纯后台
       [--detach]                   后台开打，立刻返回比赛编号（给 agent 用）
       [--context 文件:起-止,…] [--out 存档目录] [--json]
  crux result [编号|latest] [--wait] [--timeout 900] [--json]
                                             取结果：冠军答案、少数派、谁说服了谁；--wait 等到打完
  crux list                                  最近的对局和状态
  crux channels                              本机能上场的选手和实际模型（只读探测，不耗额度）
  crux setup                                 安装 Claude Code skill（其他 agent 见 docs/agents.md）

自定义：
  crux mascot list | export <编号> | new <编号> [--name 名字] [--color #hex] | check [编号] | preview <编号> | reset <编号>
                                             改自带形象、给新 AI 画形象（见 docs/mascots.md）
  crux channel list | test <通道> [--model 模型]   自定义通道（见 docs/channels.md）

其他：
  crux demo [--out matches] [--quiet]        跑固定剧本的演示赛（和网页原型同一场）
  crux log <events.jsonl>                    从事件文件重新生成 battle-log.md 并打印
  crux ws <文件夹> map | ls [路径] [--depth N] | read <文件> [--from N] [--to M] | grep <文本> [--regex] [--path 子目录]

文件夹全部只读：没有写入、没有执行命令；.env、密钥、node_modules 等默认屏蔽。真实模型会消耗你的会员额度。`;

interface Job {
  question: string; team: string[]; mode: 'ffa' | 'team'; dir?: string; outDir: string; matchId: string;
  real: boolean; effort: Effort; rounds: number; budget: number; lens: LensSet | 'none'; display: Display;
  context?: Array<{ path: string; from: number; to: number }>;
}

/** 跑一场；progress 为真时把每次模型调用打到标准错误（后台任务里就进了 runner.log） */
async function runJob(job: Job, progress: boolean) {
  const t0 = Date.now();
  return runLocalMatch({
    question: job.question, team: job.team, mode: job.mode, dir: job.dir, outDir: job.outDir, matchId: job.matchId,
    maxRounds: job.rounds, budget: job.budget,
    meta: { source: 'cli', display: job.display, pid: process.pid, question: job.question, team: job.team, startedAt: new Date().toISOString() },
    ...(job.real ? {
      brains: realBrains({
        effort: job.effort, context: job.context, lenses: job.lens,
        onCall: progress ? c => console.error(`[${((Date.now() - t0) / 1000).toFixed(0)}s] #${c.n} ${c.role} ${c.task} ${c.model} ${c.ok ? `ok ${c.usage?.in}/${c.usage?.out} tok` : `✗ ${c.error?.kind}: ${c.error?.message.slice(0, 80)}`} ${(c.ms / 1000).toFixed(1)}s`) : undefined,
      }),
    } : {}),
  });
}

async function main(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      quiet: { type: 'boolean', default: false },
      depth: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      regex: { type: 'boolean', default: false },
      path: { type: 'string' },
      team: { type: 'string' },
      mode: { type: 'string' },
      dir: { type: 'string' },
      real: { type: 'boolean', default: false },
      brains: { type: 'string' },
      effort: { type: 'string' },
      rounds: { type: 'string' },
      budget: { type: 'string' },
      context: { type: 'string' },
      lens: { type: 'string', default: 'auto' },
      display: { type: 'string' },
      detach: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      wait: { type: 'boolean', default: false },
      timeout: { type: 'string', default: '900' },
      name: { type: 'string' },
      color: { type: 'string' },
      scale: { type: 'string' },
      force: { type: 'boolean', default: false },
      model: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [cmd, ...rest] = positionals;
  if (!cmd || values.help) { console.log(HELP); return; }

  if (cmd === '_job') {
    // 后台任务：参数由发起方通过环境变量传进来
    await runJob(JSON.parse(process.env.CRUX_JOB ?? '{}') as Job, true);
    return;
  }

  if (cmd === 'fight') {
    const question = rest.join(' ').trim();
    if (!question) throw new Error('用法：crux fight "问题" [--team …] [--dir 文件夹]（crux --help 看全部参数）');
    const d = await loadFightDefaults();
    const mode = (values.mode ?? d.mode) as Job['mode'];
    if (mode !== 'ffa' && mode !== 'team') throw new Error('--mode 只能是 ffa 或 team');
    const effort = (values.effort ?? d.effort) as Effort;
    if (!['off', 'low', 'medium', 'high', 'max'].includes(effort)) throw new Error('--effort 只能是 off / low / medium / high / max');
    const real = values.real || (values.brains ?? d.brains) === 'real';
    const avail = real ? await availableFighters(effort) : undefined;
    const team = [...new Set((values.team ? values.team.split(',') : d.team).map(n => normalizeFighter(n, avail && Object.keys(avail))).filter(Boolean))];
    if (team.length < 2 || team.length > 8) throw new Error('--team 需要 2–8 名选手');
    const display = (values.display ?? d.agentDisplay) as Display;
    if (!['full', 'mini', 'none'].includes(display)) throw new Error('--display 只能是 full / mini / none');
    const dir = values.dir ? path.resolve(values.dir) : undefined;
    const lens = (values.lens === 'auto' ? autoLens(question, dir) : values.lens) as Job['lens'];
    if (!['code', 'decision', 'none'].includes(lens)) throw new Error('--lens 只能是 auto / code / decision / none');
    const context = values.context?.split(',').filter(Boolean).map(s => {
      const m = s.match(/^(.+?):(\d+)-(\d+)$/);
      if (!m) throw new Error(`--context 格式应为 文件:起-止，收到 ${s}`);
      return { path: m[1], from: Number(m[2]), to: Number(m[3]) };
    });
    if (avail) {
      // 先确认每个人都有通道，免得后台跑了半天才报错
      const missing = team.filter(id => !avail[id]);
      if (missing.length) throw new Error(`这些选手在本机没有通道：${missing.join('、')}。能上场的：${Object.keys(avail).join('、') || '无'}（crux channels 查看）`);
    }
    const job: Job = {
      question, team, mode, dir, outDir: path.resolve(values.out ?? matchesRoot(d)), matchId: newMatchId(),
      real, effort, rounds: Number(values.rounds ?? d.rounds), budget: Number(values.budget ?? d.budget), lens, display, context,
    };
    const matchDir = path.join(job.outDir, job.matchId);
    const desktop = display === 'none' ? 'none' : await ensureDesktop();
    const screen = { none: '纯后台，不显示画面', running: `桌面版接管画面（${display === 'mini' ? '角落小窗' : '完整竞技场'}）`, started: `已在后台启动桌面版来显示画面（${display === 'mini' ? '角落小窗' : '完整竞技场'}）`, unavailable: '找不到桌面版，纯后台运行' }[desktop];

    if (values.detach) {
      const pid = await detachJob(path.resolve(import.meta.filename), matchDir, job);
      const info = { matchId: job.matchId, matchDir, pid, team, real, rounds: job.rounds, budget: job.budget, display: screen };
      if (values.json) console.log(JSON.stringify(info));
      else console.log(`已在后台开打：${job.matchId}\n选手：${team.join('、')} · ${real ? `真实模型（${effort}）` : '演示大脑'} · 最多 ${job.rounds} 回合 · 预算 ${job.budget} tok\n画面：${screen}\n存档：${matchDir}\n取结果：crux result ${job.matchId} --wait`);
      return;
    }
    if (!values.quiet) console.error(`开打：${team.join('、')} · ${real ? `真实模型（${effort}）` : '演示大脑'} · 画面：${screen}`);
    await runJob(job, !values.quiet);
    const m = await readMatch(matchDir);
    console.log(values.json ? JSON.stringify({ matchId: m.id, matchDir, status: m.status, final: m.events.find(e => e.type === 'final') }) : summarize(m));
    return;
  }

  if (cmd === 'result') {
    const d = await loadFightDefaults();
    const dir = await resolveMatch(path.resolve(values.out ?? matchesRoot(d)), rest[0] ?? 'latest');
    const m = values.wait ? await waitForMatch(dir, Number(values.timeout) * 1000) : await readMatch(dir);
    if (values.json) console.log(JSON.stringify({ matchId: m.id, matchDir: m.dir, status: m.status, final: m.events.find(e => e.type === 'final') ?? null }));
    else console.log(summarize(m));
    process.exitCode = m.status === 'done' ? 0 : m.status === 'dead' ? 1 : 2;
    return;
  }

  if (cmd === 'list') {
    const d = await loadFightDefaults();
    for (const m of await listMatches(path.resolve(values.out ?? matchesRoot(d)))) {
      const start = m.events.find(e => e.type === 'match_started');
      console.log(`${m.id}  ${{ starting: '准备中', running: '进行中', done: '已结束', dead: '中断' }[m.status]}  ${start?.type === 'match_started' ? start.question : m.meta?.question ?? ''}`);
    }
    return;
  }

  if (cmd === 'mascot') {
    // 形象：自带的可以导出来改（同 id 覆盖），新 AI 从模板画起；桌面版重启后生效
    const [sub, ref] = rest;
    const dir = mascotsDir();
    const fileOf = (r: string) => (r.endsWith('.json') ? path.resolve(r) : path.join(dir, `${r}.json`));
    const load = async (r: string): Promise<MascotData> => {
      try { return JSON.parse(await readFile(fileOf(r), 'utf8')); } catch (err) {
        if (!r.endsWith('.json') && (await builtinIds()).includes(r)) return exportBuiltin(r);
        throw new Error(`读不了 ${fileOf(r)}：${(err as Error).message}`);
      }
    };
    if (sub === 'list') {
      const { mascots, errors } = await loadUserMascots();
      const mine = new Map(mascots.map(m => [m.id, m]));
      for (const id of await builtinIds()) console.log(`${id.padEnd(10)} 自带${mine.has(id) ? ' · 已被你的版本覆盖' : ''}`);
      for (const m of mascots) if (!(await builtinIds()).includes(m.id)) console.log(`${m.id.padEnd(10)} 自定义 · ${m.name ?? ''}`);
      for (const e of errors) console.log(`✗ ${e}`);
      console.log(`形象目录：${dir}`);
      return;
    }
    if (sub === 'export' || sub === 'new') {
      if (!ref) throw new Error(`用法：crux mascot ${sub} <编号>`);
      const m = sub === 'export' ? await exportBuiltin(ref) : blankMascot(ref, values.name, values.color);
      const problems = checkMascot(m);
      if (problems.length) throw new Error(problems.join('\n'));
      const out = values.out ? path.resolve(values.out) : fileOf(ref);
      if (!values.force && await readFile(out).then(() => true, () => false)) throw new Error(`${out} 已存在（加 --force 覆盖）`);
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, formatMascot(m));
      console.log(`已写出 ${out}\n改 poses 里的字符画（${'24×20'}，"." 透明，字符对应 palette 里的颜色），然后 crux mascot preview ${ref} 看效果。`);
      return;
    }
    if (sub === 'check') {
      const targets = ref ? [ref] : (await readdir(dir).catch(() => [])).filter(f => f.endsWith('.json')).map(f => path.join(dir, f));
      let bad = 0;
      for (const t of targets) {
        const problems = checkMascot(await load(t));
        if (problems.length) { bad++; console.log(`✗ ${t}\n  ${problems.join('\n  ')}`); } else console.log(`✓ ${t}`);
      }
      if (!targets.length) console.log(`${dir} 里还没有形象`);
      process.exitCode = bad ? 1 : 0;
      return;
    }
    if (sub === 'preview') {
      if (!ref) throw new Error('用法：crux mascot preview <编号|文件>');
      const m = await load(ref);
      const problems = checkMascot(m);
      if (problems.length) throw new Error(`先修好这些问题：\n${problems.join('\n')}`);
      const out = values.out ? path.resolve(values.out) : path.join(dir, `${m.id}.preview.png`);
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, previewPng(m, Number(values.scale ?? 8)));
      console.log(`预览：${out}（从左到右：idle · idle2 · atk · hurt）`);
      return;
    }
    if (sub === 'reset') {
      if (!ref) throw new Error('用法：crux mascot reset <编号>');
      const f = fileOf(ref);
      await rename(f, `${f}.bak`);
      console.log(`已停用你的 ${ref} 形象（改名为 ${f}.bak），重启桌面版后恢复自带形象`);
      return;
    }
    throw new Error('用法：crux mascot list | export <编号> | new <编号> [--name 名字] [--color #hex] | check [编号] | preview <编号> | reset <编号>');
  }

  if (cmd === 'setup') {
    // 把仓库里的 Claude Code skill 全部装到用户目录（所有项目可用）；其他 agent 的接法见 docs/agents.md
    const src = assetPath('integrations', 'claude-code');
    for (const name of await readdir(src)) {
      const dest = path.join(os.homedir(), '.claude', 'skills', name);
      await mkdir(dest, { recursive: true });
      await cp(path.join(src, name), dest, { recursive: true });
      console.log(`已安装 Claude Code skill：${dest}`);
    }
    console.log(`\n在 Claude Code 里可以说：\n  "跟 codex、gemini 讨论一下…"   → crux-arena（拉起对局）\n  "给我的 llama 画个形象"         → crux-mascot（画 / 改形象）\n  "把我的 ollama 接进竞技场"      → crux-channel（自定义通道）\nCursor、Codex 等其他 agent：把 ${docPath('agents.md')} 里的说明加进它们的规则文件。`);
    return;
  }

  if (cmd === 'channel') {
    const [sub, name] = rest;
    const p = await probeChannels();
    if (p.configError) console.log(`✗ ${p.configError}`);
    if (sub === 'list' || !sub) {
      console.log(`通道（配置文件：${customConfigFile()}）`);
      for (const [id, ch] of p.channels) console.log(`  ${id.padEnd(12)} ${p.custom.channels[id]?.type ?? '内置'} · 并发 ${ch.concurrency}`);
      console.log('选手 → 实际模型');
      for (const [id, model] of Object.entries(await availableFighters((values.effort ?? 'low') as Effort))) console.log(`  ${id.padEnd(12)} ${model}${p.custom.fighters[id] ? '（channels.json）' : ''}`);
      return;
    }
    if (sub === 'test') {
      // 验收：真实调用一次，要求按格式回 JSON；会消耗一点额度
      const ch = name && p.channels.get(name);
      if (!ch) throw new Error(`没有通道 ${name ?? ''}。现有：${[...p.channels.keys()].join('、') || '无'}`);
      const model = values.model ?? Object.values(p.custom.fighters).find(f => f.channel === name)?.model ?? (name === 'cursor' ? 'composer-2.5' : '');
      if (!model) throw new Error('用 --model 指定要测的模型');
      const r = await ch.call({ task: 'draft', model, effort: (values.effort ?? 'low') as Effort, system: '你是接入测试。只输出一个 JSON 对象，不要代码块。', prompt: '输出 {"ok":true,"answer":"1+1 的结果（数字）"}' });
      if (!r.ok) { console.log(`✗ ${name} / ${r.model}：${r.error.kind} · ${r.error.message}`); process.exitCode = 1; return; }
      let json = '✓ JSON 可解析';
      try { const j = extractJson(r.text) as { ok?: boolean }; if (j.ok !== true) json = '△ JSON 可解析，但没有按要求回 ok:true'; } catch { json = '✗ 输出不是 JSON（比赛里会被判为格式错误并重试一次）'; }
      console.log(`✓ ${name} / ${r.model} 调用成功，${(r.ms / 1000).toFixed(1)}s\n  ${json}\n  用量：输入 ${r.usage.in} · 输出 ${r.usage.out}${r.usage.estimated ? '（估算）' : ''} · 档位 ${r.effortApplied}\n  原始输出：${r.text.slice(0, 200)}`);
      return;
    }
    throw new Error('用法：crux channel list | test <通道> [--model 模型] [--effort low]');
  }

  if (cmd === 'channels') {
    const avail = await availableFighters((values.effort ?? 'low') as Effort);
    if (!Object.keys(avail).length) console.log('本机没有可用通道（需要已登录的 Cursor Agent 或 Claude Code）');
    for (const [id, model] of Object.entries(avail)) console.log(`${id.padEnd(9)} ${model}`);
    return;
  }

  if (cmd === 'demo') {
    const dir = path.join(values.out ?? 'matches', demoConfig.matchId ?? 'demo');
    await mkdir(dir, { recursive: true });
    const eventsFile = path.join(dir, 'events.jsonl');
    await writeFile(eventsFile, '');
    const rec = createRecorder({ sink: e => appendFile(eventsFile, JSON.stringify(e) + '\n') });
    await runMatch(demoConfig, new ScriptedBrains(demoScript), rec);
    const md = renderBattleLog(rec.events);
    const logFile = path.join(dir, 'battle-log.md');
    await writeFile(logFile, md);
    if (!values.quiet) console.log(md);
    console.log(`已写出 ${eventsFile} 和 ${logFile}（${rec.events.length} 个事件）`);
    return;
  }

  if (cmd === 'log') {
    if (!rest[0]) throw new Error('用法：crux log <events.jsonl>');
    process.stdout.write(renderBattleLog(parseEventLines(await readFile(rest[0], 'utf8'))));
    return;
  }

  if (cmd === 'ws') {
    const [root, sub, arg] = rest;
    if (!root || !sub) throw new Error('用法：crux ws <文件夹> map|ls|read|grep …');
    const ws = await openWorkspace({
      root,
      onAudit: a => console.error(`[只读审计] ${a.tool} ${JSON.stringify(a.input)} → ${a.ok ? `ok ${a.bytes}B${a.note ? ` (${a.note})` : ''}` : `拒绝 ${a.note}`}`),
    });
    if (sub === 'map') console.log(await ws.repoMap());
    else if (sub === 'ls') console.log((await ws.listDir('cli', arg ?? '.', Number(values.depth ?? 1))).join('\n'));
    else if (sub === 'read') {
      if (!arg) throw new Error('用法：crux ws <文件夹> read <文件>');
      const r = await ws.readFile('cli', arg, Number(values.from ?? 1), values.to ? Number(values.to) : undefined);
      console.log(`# ${r.path} 第 ${r.from}–${r.to} 行，共 ${r.totalLines} 行\n${r.text}`);
    } else if (sub === 'grep') {
      if (!arg) throw new Error('用法：crux ws <文件夹> grep <文本>');
      const r = await ws.grep('cli', arg, { regex: values.regex, path: values.path });
      for (const m of r.matches) console.log(`${m.path}:${m.line}: ${m.text}`);
      console.log(`${r.matches.length} 处匹配${r.truncated ? '（已截断）' : ''}`);
    } else throw new Error(`未知子命令：${sub}`);
    return;
  }

  throw new Error(`未知命令：${cmd}\n\n${HELP}`);
}

main(process.argv.slice(2)).catch(err => {
  console.error(err instanceof WorkspaceError ? `拒绝（${err.code}）：${err.message}` : err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
