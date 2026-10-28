// 本地开打：CLI 和桌面版共用。组装选手、打开只读文件夹、侦察、跑比赛、把事件和战报写进存档。
// 默认用演示大脑；传入 brains 工厂就换成真实模型（见 real.ts）。
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DemoBrains, createRecorder, fighterSpecs, renderBattleLog, runMatch } from '@crux/engine';
import type { Brains, FighterSpec, MatchEvent, Recorder } from '@crux/engine';
import { openWorkspace } from '@crux/workspace';
import type { MatchMeta } from './jobs.ts';
import { writeMeta } from './jobs.ts';

type Workspace = Awaited<ReturnType<typeof openWorkspace>>;

export interface BrainsSetup {
  brains: Brains;
  fighters?: FighterSpec[];          // 可改写模型名（如 cursor/kimi-k3-low）
  judge?: string;
  chair?: string;
  /** 侦察完成后调用（真实大脑在这里拿到背景材料） */
  scout?: (ws: Workspace) => Promise<void>;
}
export type BrainsFactory = (ctx: { fighters: FighterSpec[]; mode: 'ffa' | 'team'; rec: Recorder; ws?: Workspace; matchDir: string }) => Promise<BrainsSetup>;

export interface LocalMatchOptions {
  question: string;
  team: string[];                    // 选手编号，如 ['claude', 'codex', 'gemini']
  mode?: 'ffa' | 'team';
  dir?: string;                      // 可选：只读文件夹
  outDir: string;                    // 存档根目录，每场一个子文件夹
  onEvent?: (e: MatchEvent) => void; // 每产生一个事件就回调（桌面版用它驱动画面）
  brains?: BrainsFactory;            // 不传就用演示大脑
  matchId?: string;                  // 后台开打时由发起方先定好编号
  meta?: MatchMeta;                  // 写进 meta.json：谁发起、怎么显示（桌面版据此接管画面）
  budget?: number;
  maxRounds?: number;
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
export const newMatchId = () => `${stamp()}-${Math.random().toString(36).slice(2, 6)}`;

export async function runLocalMatch(o: LocalMatchOptions): Promise<LocalMatchResult> {
  const mode = o.mode ?? 'ffa';
  const matchId = o.matchId ?? newMatchId();
  const matchDir = path.join(o.outDir, matchId);
  await mkdir(matchDir, { recursive: true });
  if (o.meta) await writeMeta(matchDir, o.meta);
  const eventsFile = path.join(matchDir, 'events.jsonl');
  await writeFile(eventsFile, '');

  const rec = createRecorder({ sink: async e => { await appendFile(eventsFile, JSON.stringify(e) + '\n'); o.onEvent?.(e); } });
  const ws = o.dir ? await openWorkspace({ root: o.dir, onAudit: rec.tool }) : undefined;
  const base = fighterSpecs(o.team);
  const setup: BrainsSetup = o.brains
    ? await o.brains({ fighters: base, mode, rec, ws, matchDir })
    : { brains: new DemoBrains(base, mode), judge: 'demo/judge', chair: 'demo/chair' };

  await runMatch({
    matchId, question: o.question, mode, fighters: setup.fighters ?? base,
    judge: setup.judge ?? 'demo/judge', chair: setup.chair ?? 'demo/chair',
    budget: o.budget, maxRounds: o.maxRounds,
    ...(ws ? { workspace: { root: ws.root } } : {}),
    price: o.brains ? undefined : tokens => tokens * 0.12 / 31_400,
    // 侦察：仓库地图 + 常见入口文件的开头，所有选手共享
    onStart: ws ? async () => {
      if (setup.scout) return setup.scout(ws);
      await ws.repoMap();
      for (const f of ['README.md', 'package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml']) {
        try { await ws.readFile('scout', f, 1, 40); } catch { /* 文件不存在或被屏蔽 */ }
      }
    } : undefined,
  }, setup.brains, rec);

  const battleLog = renderBattleLog(rec.events);
  const logFile = path.join(matchDir, 'battle-log.md');
  await writeFile(logFile, battleLog);
  return { matchId, matchDir, eventsFile, logFile, events: rec.events, battleLog };
}
