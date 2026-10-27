#!/usr/bin/env node
// crux 命令行（Phase 0）：跑演示比赛、从事件重建战斗日志、试用只读文件夹工具。
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ScriptedBrains, createRecorder, demoConfig, demoScript, parseEventLines, renderBattleLog, runMatch } from '@crux/engine';
import { WorkspaceError, openWorkspace } from '@crux/workspace';

const HELP = `crux · AI 竞技场命令行（Phase 0）

用法：
  crux demo [--out matches] [--quiet]        用脚本化大脑跑一场演示比赛，写出 events.jsonl 和 battle-log.md
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
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [cmd, ...rest] = positionals;
  if (!cmd || values.help) { console.log(HELP); return; }

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
