#!/usr/bin/env node
// crux 命令行（Phase 0）：跑演示比赛、从事件重建战斗日志、试用只读文件夹工具。
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ScriptedBrains, createRecorder, demoConfig, demoScript, parseEventLines, renderBattleLog, runMatch } from '@crux/engine';
import { WorkspaceError, openWorkspace } from '@crux/workspace';
import { runLocalMatch } from './match.ts';
import { realBrains } from './real.ts';

const HELP = `crux · AI 竞技场命令行（Phase 0）

用法：
  crux fight "问题" [--team claude,codex,gemini,deepseek] [--mode ffa|team] [--dir 文件夹] [--out matches]
                                             开打（默认演示大脑），写出 events.jsonl 和 battle-log.md
       --real [--effort low] [--rounds 2] [--budget 300000] [--context 文件:起-止,…]
                                             用真实模型（本机 Claude Code / Cursor Agent），另写 calls.jsonl
  crux demo [--out matches] [--quiet]        跑固定剧本的演示赛（和网页原型同一场）
  crux log <events.jsonl>                    从事件文件重新生成 battle-log.md 并打印
  crux ws <文件夹> map                        打印仓库地图
  crux ws <文件夹> ls [路径] [--depth N]       列目录
  crux ws <文件夹> read <文件> [--from N] [--to M]
  crux ws <文件夹> grep <文本> [--regex] [--path 子目录]

文件夹工具全部只读：没有写入、没有执行命令；.env、密钥、node_modules 等默认屏蔽。`;

async function main(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string', default: 'matches' },
      quiet: { type: 'boolean', default: false },
      depth: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      regex: { type: 'boolean', default: false },
      path: { type: 'string' },
      team: { type: 'string', default: 'claude,codex,gemini,deepseek' },
      mode: { type: 'string', default: 'ffa' },
      dir: { type: 'string' },
      real: { type: 'boolean', default: false },
      effort: { type: 'string', default: 'low' },
      rounds: { type: 'string' },
      budget: { type: 'string' },
      context: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [cmd, ...rest] = positionals;
  if (!cmd || values.help) { console.log(HELP); return; }

  if (cmd === 'fight') {
    const question = rest.join(' ').trim();
    if (!question) throw new Error('用法：crux fight "问题" [--team …] [--mode ffa|team] [--dir 文件夹]');
    if (values.mode !== 'ffa' && values.mode !== 'team') throw new Error('--mode 只能是 ffa 或 team');
    const team = values.team.split(',').map(x => x.trim()).filter(Boolean);
    if (team.length < 2 || team.length > 8) throw new Error('--team 需要 2–8 名选手');
    const effort = values.effort;
    if (!['off', 'low', 'medium', 'high', 'max'].includes(effort)) throw new Error('--effort 只能是 off / low / medium / high / max');
    const context = (values.context ?? '').split(',').filter(Boolean).map(s => {
      const m = s.match(/^(.+?):(\d+)-(\d+)$/);
      if (!m) throw new Error(`--context 格式应为 文件:起-止，收到 ${s}`);
      return { path: m[1], from: Number(m[2]), to: Number(m[3]) };
    });
    const t0 = Date.now();
    const r = await runLocalMatch({
      question, team, mode: values.mode, dir: values.dir, outDir: values.out,
      ...(values.rounds ? { maxRounds: Number(values.rounds) } : {}),
      ...(values.budget ? { budget: Number(values.budget) } : {}),
      ...(values.real ? {
        brains: realBrains({
          effort: effort as 'low', context,
          onCall: c => console.error(`[${((Date.now() - t0) / 1000).toFixed(0)}s] #${c.n} ${c.role} ${c.task} ${c.model} ${c.ok ? `ok ${c.usage?.in}/${c.usage?.out} tok` : `✗ ${c.error?.kind}: ${c.error?.message.slice(0, 80)}`} ${(c.ms / 1000).toFixed(1)}s`),
        }),
      } : {}),
    });
    if (!values.quiet) console.log(r.battleLog);
    console.log(`已写出 ${r.eventsFile} 和 ${r.logFile}（${r.events.length} 个事件，${values.real ? '真实模型' : '演示大脑'}）`);
    return;
  }

  if (cmd === 'demo') {
    const dir = path.join(values.out, demoConfig.matchId ?? 'demo');
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
