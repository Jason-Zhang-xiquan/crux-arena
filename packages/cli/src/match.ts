// 本地开打：CLI 和桌面版共用。组装选手、打开只读文件夹、侦察、跑比赛、把事件和战报写进存档。
// 目前用演示大脑；接入真实模型时只替换 brains。
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DemoBrains, createRecorder, fighterSpecs, renderBattleLog, runMatch } from '@crux/engine';
import type { MatchEvent } from '@crux/engine';
import { openWorkspace } from '@crux/workspace';

export interface LocalMatchOptions {
  question: string;
  team: string[];                    // 选手编号，如 ['claude', 'codex', 'gemini']
  mode?: 'ffa' | 'team';
  dir?: string;                      // 可选：只读文件夹
  outDir: string;                    // 存档根目录，每场一个子文件夹
  onEvent?: (e: MatchEvent) => void; // 每产生一个事件就回调（桌面版用它驱动画面）
}

export interface LocalMatchResult {
  matchId: string;
  matchDir: string;
  eventsFile: string;
  logFile: string;
  events: MatchEvent[];
  battleLog: string;
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

export async function runLocalMatch(o: LocalMatchOptions): Promise<LocalMatchResult> {
  const mode = o.mode ?? 'ffa';
  const fighters = fighterSpecs(o.team);
  const matchId = `${stamp()}-${Math.random().toString(36).slice(2, 6)}`;
  const matchDir = path.join(o.outDir, matchId);
  await mkdir(matchDir, { recursive: true });
  const eventsFile = path.join(matchDir, 'events.jsonl');
  await writeFile(eventsFile, '');

  const rec = createRecorder({ sink: async e => { await appendFile(eventsFile, JSON.stringify(e) + '\n'); o.onEvent?.(e); } });
  const ws = o.dir ? await openWorkspace({ root: o.dir, onAudit: rec.tool }) : undefined;

  await runMatch({
    matchId, question: o.question, mode, fighters, judge: 'demo/judge', chair: 'demo/chair',
    ...(ws ? { workspace: { root: ws.root } } : {}),
    price: tokens => tokens * 0.12 / 31_400,
    // 侦察：仓库地图 + 常见入口文件的开头，所有选手共享
    onStart: ws ? async () => {
      await ws.repoMap();
      for (const f of ['README.md', 'package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml']) {
        try { await ws.readFile('scout', f, 1, 40); } catch { /* 文件不存在或被屏蔽 */ }
      }
    } : undefined,
  }, new DemoBrains(fighters, mode), rec);

  const battleLog = renderBattleLog(rec.events);
  const logFile = path.join(matchDir, 'battle-log.md');
  await writeFile(logFile, battleLog);
  return { matchId, matchDir, eventsFile, logFile, events: rec.events, battleLog };
}
