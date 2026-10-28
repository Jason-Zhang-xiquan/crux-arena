// Crux Arena 桌面版主进程：托盘常驻、全局快捷键唤出输入框、开打后小 AI 们在任务栏上方打架。
// 引擎和只读文件夹工具直接在这里跑（目前用演示大脑），事件逐条推给桌面竞技场窗口。
import { BrowserWindow, Menu, Tray, app, clipboard, dialog, globalShortcut, ipcMain, nativeImage, screen, shell } from 'electron';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIGHTER_IDS, parseEventLines, renderBattleLog } from '@crux/engine';
import type { MatchEvent } from '@crux/engine';
import { runLocalMatch } from '@crux/cli/match';
import { crabPng } from './icon.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const page = (f: string) => path.join(here, 'renderer', f);
const preload = path.join(here, 'preload.cjs');
const SELFTEST = process.argv.includes('--selftest');
// 录屏用：electron packages/desktop --replay <存档文件夹> [--speed 2] [--exit-after-replay] [--backdrop]
const argValue = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const REPLAY_DIR = argValue('--replay');
const SPEED = Number(argValue('--speed')) || undefined;
const EXIT_AFTER_REPLAY = process.argv.includes('--exit-after-replay');
const BACKDROP = process.argv.includes('--backdrop');   // 录视频时铺深色背景，不录到桌面上的其他窗口
const FALLBACK_HOTKEYS = ['CommandOrControl+Alt+Space', 'CommandOrControl+Shift+Space', 'Alt+Shift+A'];
const BAND_HEIGHT = 500;
const REPO_URL = 'https://github.com/Jason-Zhang-xiquan/crux-arena';

interface Settings {
  team: string[];
  mode: 'ffa' | 'team';
  dir: string;
  question: string;
  hotkey: string;                    // 空字符串 = 自动（按备选列表找一个没被占用的）
  speed: 1 | 2 | 4;
  logPanel: 'auto' | 'open' | 'closed';
  autoLaunch: boolean;
  matchesDir: string;                // 空字符串 = 默认位置
}
const DEFAULTS: Settings = {
  team: ['claude', 'codex', 'gemini', 'deepseek'], mode: 'ffa', dir: '', question: '',
  hotkey: '', speed: 1, logPanel: 'auto', autoLaunch: false, matchesDir: '',
};

let settings: Settings = { ...DEFAULTS };
let tray: Tray | undefined;
let launcher: BrowserWindow | undefined;
let settingsWin: BrowserWindow | undefined;
let arena: BrowserWindow | undefined;
let hotkey = '';                     // 当前实际生效的快捷键（显示用）
let hotkeyError = '';
let dialogOpen = false;
let lastMatchDir = '';

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const defaultMatchesDir = () => path.join(app.getPath('userData'), 'matches');
const matchesDir = () => settings.matchesDir || defaultMatchesDir();
const display = (acc: string) => acc.replace('CommandOrControl', process.platform === 'darwin' ? 'Cmd' : 'Ctrl');

async function loadSettings() {
  try { settings = { ...DEFAULTS, ...JSON.parse(await readFile(settingsFile(), 'utf8')) }; } catch { settings = { ...DEFAULTS }; }
}
async function saveSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(settingsFile(), JSON.stringify(settings, null, 2));
}

const secure = (w: BrowserWindow) => {
  w.webContents.on('will-navigate', e => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (SELFTEST) w.webContents.on('console-message', e => { if (e.level === 'error' || e.level === 'warning') console.log(`[renderer ${e.level}] ${e.message}`); });
};
const webPreferences = { preload, contextIsolation: true, sandbox: true, nodeIntegration: false };
const cursorDisplay = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;

/* ---------- 快捷键 ---------- */
function registerHotkey(): { ok: boolean; error?: string } {
  globalShortcut.unregisterAll();
  hotkey = ''; hotkeyError = '';
  const wanted = settings.hotkey ? [settings.hotkey] : FALLBACK_HOTKEYS;
  for (const k of wanted) {
    try { if (globalShortcut.register(k, toggleLauncher)) { hotkey = display(k); break; } } catch { /* 格式不对或系统不允许 */ }
  }
  if (!hotkey && settings.hotkey) {
    hotkeyError = `${display(settings.hotkey)} 被其他程序占用，已改用备选`;
    for (const k of FALLBACK_HOTKEYS) { try { if (globalShortcut.register(k, toggleLauncher)) { hotkey = display(k); break; } } catch { /* 下一个 */ } }
  }
  refreshTray();
  return hotkeyError ? { ok: false, error: hotkeyError } : { ok: !!hotkey, error: hotkey ? undefined : '所有快捷键都被占用' };
}

/* ---------- 窗口 ---------- */
function createLauncher() {
  launcher = new BrowserWindow({
    width: 700, height: 600, show: false, frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#00000000', webPreferences,
  });
  secure(launcher);
  launcher.loadFile(page('launcher.html'));
  launcher.on('blur', () => { if (!dialogOpen && !SELFTEST) launcher?.hide(); });
}
function showLauncher() {
  if (!launcher) createLauncher();
  const d = cursorDisplay();
  launcher!.setBounds({ x: Math.round(d.x + (d.width - 700) / 2), y: Math.round(d.y + d.height * 0.18), width: 700, height: 600 });
  launcher!.show(); launcher!.focus();
  launcher!.webContents.send('launcher:shown');
}
const toggleLauncher = () => (launcher?.isVisible() ? launcher.hide() : showLauncher());

function showSettings() {
  launcher?.hide();
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 640, height: 640, frame: false, transparent: true, resizable: false, alwaysOnTop: true,
    skipTaskbar: false, title: 'Crux Arena 设置', backgroundColor: '#00000000', webPreferences,
  });
  secure(settingsWin);
  settingsWin.loadFile(page('settings.html'));
  settingsWin.on('closed', () => { settingsWin = undefined; });
}

function createArena(opts: { replay?: boolean } = {}): BrowserWindow {
  arena?.destroy();
  const d = cursorDisplay();
  const w = new BrowserWindow({
    x: d.x, y: d.y + d.height - BAND_HEIGHT, width: d.width, height: BAND_HEIGHT,
    frame: false, transparent: true, resizable: false, movable: false, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: true, show: false, backgroundColor: '#00000000',
    webPreferences: { ...webPreferences, backgroundThrottling: false },
  });
  w.setAlwaysOnTop(true, 'floating');
  w.setIgnoreMouseEvents(true, { forward: true });   // 空白处鼠标穿透，不挡你干活
  secure(w);
  w.loadFile(page('arena.html'), { query: { speed: String(SPEED ?? (SELFTEST ? 3 : settings.speed)), log: settings.logPanel, ...(opts.replay ? { replay: '1' } : {}), ...(BACKDROP ? { backdrop: '1' } : {}) } });
  w.once('ready-to-show', () => w.showInactive());
  w.on('closed', () => { if (arena === w) arena = undefined; });
  arena = w;
  return w;
}

/** 把事件流接到竞技场窗口：窗口就绪前先排队 */
function pipe(w: BrowserWindow) {
  const queue: MatchEvent[] = [];
  let ready = false;
  const send = (e: MatchEvent) => { if (!w.isDestroyed()) w.webContents.send('arena:event', e); };
  const onReady = (ev: Electron.IpcMainEvent) => {
    if (ev.sender !== w.webContents) return;
    ipcMain.off('arena:ready', onReady);
    ready = true; queue.splice(0).forEach(send);
  };
  ipcMain.on('arena:ready', onReady);
  w.on('closed', () => ipcMain.off('arena:ready', onReady));
  return {
    event: (e: MatchEvent) => (ready ? send(e) : queue.push(e)),
    done: (d: Record<string, unknown>) => { if (!w.isDestroyed()) w.webContents.send('arena:done', d); },
  };
}

/* ---------- 开打 / 回放 ---------- */
interface FightPayload { question: unknown; team: unknown; mode: unknown; dir: unknown }

async function startFight(p: FightPayload): Promise<{ ok: true } | { ok: false; error: string }> {
  const question = typeof p.question === 'string' ? p.question.trim().slice(0, 2000) : '';
  const team = Array.isArray(p.team) ? [...new Set(p.team.filter((x): x is string => typeof x === 'string' && (FIGHTER_IDS as readonly string[]).includes(x)))] : [];
  const mode = p.mode === 'team' ? 'team' : 'ffa';
  const dir = typeof p.dir === 'string' ? p.dir.trim() : '';
  if (!question) return { ok: false, error: '先写一个问题' };
  if (team.length < 2 || team.length > 8) return { ok: false, error: '需要 2–8 名选手' };
  if (dir) {
    try { if (!(await stat(dir)).isDirectory()) return { ok: false, error: '文件夹路径不是文件夹' }; }
    catch { return { ok: false, error: '找不到这个文件夹' }; }
  }
  await saveSettings({ team, mode, dir, question });
  launcher?.hide();
  const out = pipe(createArena());
  runLocalMatch({ question, team, mode, dir: dir || undefined, outDir: matchesDir(), onEvent: out.event })
    .then(r => { lastMatchDir = r.matchDir; out.done({ battleLog: r.battleLog, matchDir: r.matchDir }); })
    .catch(err => { console.error(err); out.done({ error: String(err?.message ?? err) }); });
  return { ok: true };
}

async function replay(matchDir: string): Promise<{ ok: boolean; error?: string }> {
  let events: MatchEvent[];
  try { events = parseEventLines(await readFile(path.join(matchDir, 'events.jsonl'), 'utf8')); }
  catch (err) { return { ok: false, error: `读不了这场存档：${(err as Error).message}` }; }
  if (!events.length) return { ok: false, error: '这场存档是空的' };
  launcher?.hide();
  lastMatchDir = matchDir;
  const out = pipe(createArena({ replay: true }));
  events.forEach(out.event);
  let battleLog = '';
  try { battleLog = renderBattleLog(events); } catch { /* 比赛没打完时生成不了完整战报 */ }
  out.done({ battleLog, matchDir });
  return { ok: true };
}

interface MatchSummary { id: string; dir: string; question: string; mode: string; fighters: string[]; finished: boolean; when: string }
async function listMatches(limit = 12): Promise<MatchSummary[]> {
  let names: string[] = [];
  try { names = (await readdir(matchesDir(), { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort().reverse(); } catch { return []; }
  const out: MatchSummary[] = [];
  for (const id of names) {
    try {
      const text = await readFile(path.join(matchesDir(), id, 'events.jsonl'), 'utf8');
      const first = JSON.parse(text.slice(0, text.indexOf('\n')));
      if (first.type !== 'match_started') continue;
      out.push({ id, dir: path.join(matchesDir(), id), question: first.question, mode: first.mode, fighters: first.fighters.map((f: { name: string }) => f.name), finished: text.includes('"match_ended"'), when: (await stat(path.join(matchesDir(), id))).mtime.toISOString() });
    } catch { /* 不是比赛存档 */ }
    if (out.length >= limit) break;
  }
  return out;
}

async function pickReplay() {
  dialogOpen = true;
  try {
    await mkdir(matchesDir(), { recursive: true });
    const r = await dialog.showOpenDialog({ title: '选择要回放的比赛（events.jsonl）', defaultPath: matchesDir(), properties: ['openFile'], filters: [{ name: '比赛事件', extensions: ['jsonl'] }] });
    if (!r.canceled) await replay(path.dirname(r.filePaths[0]));
  } finally { dialogOpen = false; }
}
async function replayLatest() {
  const [latest] = await listMatches(1);
  if (latest) await replay(latest.dir);
  else dialog.showMessageBox({ message: '还没有比赛存档，先打一场吧。' });
}

/* ---------- IPC ---------- */
function registerIpc() {
  ipcMain.handle('settings:get', () => ({ ...settings, hotkeyActive: hotkey, hotkeyError, defaultMatchesDir: defaultMatchesDir(), version: app.getVersion(), roster: FIGHTER_IDS }));
  ipcMain.handle('settings:save', async (_e, patch: Partial<Settings>) => {
    const clean: Partial<Settings> = {};
    if (typeof patch.hotkey === 'string' && patch.hotkey.length < 60) clean.hotkey = patch.hotkey;
    if (patch.speed === 1 || patch.speed === 2 || patch.speed === 4) clean.speed = patch.speed;
    if (patch.logPanel === 'auto' || patch.logPanel === 'open' || patch.logPanel === 'closed') clean.logPanel = patch.logPanel;
    if (typeof patch.autoLaunch === 'boolean') clean.autoLaunch = patch.autoLaunch;
    if (typeof patch.matchesDir === 'string') clean.matchesDir = patch.matchesDir;
    await saveSettings(clean);
    if ('autoLaunch' in clean) app.setLoginItemSettings({ openAtLogin: settings.autoLaunch });
    const hk = 'hotkey' in clean ? registerHotkey() : { ok: true };
    return { ...hk, hotkeyActive: hotkey };
  });
  ipcMain.handle('folder:pick', async (e, title?: string) => {
    dialogOpen = true;
    try {
      const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, { title: typeof title === 'string' ? title : '选择要讨论的文件夹（只读）', properties: ['openDirectory', 'createDirectory'] });
      return r.canceled ? '' : r.filePaths[0];
    } finally { dialogOpen = false; BrowserWindow.fromWebContents(e.sender)?.focus(); }
  });
  ipcMain.handle('fight', (_e, p: FightPayload) => startFight(p));
  ipcMain.handle('matches:list', () => listMatches());
  ipcMain.handle('replay', (_e, dir: unknown) => (typeof dir === 'string' ? replay(dir) : { ok: false, error: '无效存档' }));
  ipcMain.on('replay:pick', () => pickReplay());
  ipcMain.on('arena:replay', () => { if (lastMatchDir) replay(lastMatchDir); });
  ipcMain.on('launcher:hide', () => launcher?.hide());
  ipcMain.on('settings:open', () => showSettings());
  ipcMain.on('settings:close', () => settingsWin?.close());
  ipcMain.on('open:path', (_e, which: string) => {
    if (which === 'matches') mkdir(matchesDir(), { recursive: true }).then(() => shell.openPath(matchesDir()));
    if (which === 'repo') shell.openExternal(REPO_URL);
  });
  ipcMain.on('arena:interactive', (e, on: boolean) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    w?.setIgnoreMouseEvents(!on, { forward: true });
    if (on) w?.focus();
  });
  ipcMain.on('arena:close', () => arena?.close());
  ipcMain.on('arena:open-match', () => { if (lastMatchDir) shell.openPath(lastMatchDir); });
  ipcMain.on('clipboard', (_e, text: string) => clipboard.writeText(String(text)));
}

/* ---------- 托盘 ---------- */
function refreshTray() {
  if (!tray) return;
  tray.setToolTip(`Crux Arena · ${hotkey || '未注册快捷键'} 唤出`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `提一个问题（${hotkey || '无快捷键'}）`, click: showLauncher },
    { label: '回放最近一场', click: replayLatest },
    { label: '打开存档回放…', click: pickReplay },
    { type: 'separator' },
    { label: '设置…', click: showSettings },
    { label: '打开存档文件夹', click: async () => { await mkdir(matchesDir(), { recursive: true }); shell.openPath(matchesDir()); } },
    { type: 'separator' },
    { label: '退出 Crux Arena', click: () => app.quit() },
  ]));
}
function createTray() {
  tray = new Tray(nativeImage.createFromBuffer(crabPng(2), { scaleFactor: 2 }));
  tray.on('click', showLauncher);
  refreshTray();
}

/* ---------- 自测 ---------- */
// 自动走一遍：输入框 → 设置页 → 开打 → 结果 → 回放，关键时刻截图后退出。用独立的数据目录，不影响你自己的设置和存档
async function selftest() {
  const out = process.env.CRUX_SELFTEST_DIR || path.join(app.getPath('temp'), 'crux-selftest');
  await mkdir(out, { recursive: true });
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
  const snap = async (w: BrowserWindow | undefined, name: string) => {
    if (!w || w.isDestroyed()) return;
    const file = path.join(out, name);
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await writeFile(file, (await w.webContents.capturePage()).toPNG());
        console.log(`[selftest] 截图 ${file}`);
        return;
      } catch (err) {
        // 透明窗口刚显示时偶尔还没合成好，稍等重试
        console.log(`[selftest] 截图 ${name} 第 ${attempt} 次失败：${(err as Error).message}`);
        w.show(); await wait(800);
      }
    }
  };
  const fail = (msg: string) => { console.error(`[selftest] 失败：${msg}`); app.exit(1); };
  setTimeout(() => fail('超时'), 180_000);

  showLauncher(); await wait(3500);
  await snap(launcher, 'launcher.png');
  showSettings(); await wait(3000);
  await snap(settingsWin, 'settings.png');
  settingsWin?.close();

  const team = (process.env.CRUX_SELFTEST_TEAM || 'claude,codex,gemini,deepseek,doubao,kimi').split(',');
  const finals: string[] = [];
  const shots = new Map([['concede', 'arena-battle.png'], ['final', 'arena-result.png']]);
  ipcMain.on('arena:progress', async (_e, info: { type: string }) => {
    if (info.type !== 'final' && !shots.has(info.type)) return;
    if (info.type === 'final') finals.push('final');
    const name = finals.length > 1 ? (info.type === 'final' ? 'replay-result.png' : undefined) : shots.get(info.type);
    shots.delete(info.type);
    if (!name) return;
    await wait(info.type === 'final' ? 900 : 350);
    await snap(arena, name);
    if (finals.length === 1 && info.type === 'final') {
      const list = await listMatches();
      if (!list.length) return fail('存档列表为空');
      console.log(`[selftest] 存档 ${list.length} 场，最新：${list[0].question}`);
      const r = await replay(list[0].dir);
      if (!r.ok) return fail(r.error ?? '回放失败');
    } else if (finals.length === 2) {
      console.log(`[selftest] 完成：开打 + 回放都走到冠军答案，存档在 ${lastMatchDir}`);
      app.quit();
    }
  });
  const r = await startFight({ question: '这个仓库的后端该继续单体，还是拆成微服务？', team, mode: process.env.CRUX_SELFTEST_MODE || 'ffa', dir: process.env.CRUX_SELFTEST_FOLDER || '' });
  if (!r.ok) fail(r.error);
}

/** 命令行指定回放：直接播放；带 --exit-after-replay 时，结果卡停留 12 秒后退出（方便录屏脚本收尾） */
async function replayFromArgs(dir: string) {
  if (BACKDROP) {
    // 报出竞技场在屏幕上的物理像素区域，录屏脚本据此只录这一块；稍等让录屏先启动
    const disp = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const d = disp.workArea, k = disp.scaleFactor;
    console.log(`[record] region ${Math.round(d.x * k)} ${Math.round((d.y + d.height - BAND_HEIGHT) * k)} ${Math.round(d.width * k)} ${Math.round(BAND_HEIGHT * k)}`);
    await new Promise(r => setTimeout(r, 2500));
  }
  if (EXIT_AFTER_REPLAY) ipcMain.on('arena:progress', (_e, info: { type: string }) => { if (info.type === 'match_ended') setTimeout(() => app.quit(), 12_000); });
  const r = await replay(path.resolve(dir));
  if (!r.ok) { console.error(r.error); app.exit(1); }
}

/* ---------- 启动 ---------- */
app.setName('Crux Arena');
if (SELFTEST) app.setPath('userData', path.join(app.getPath('temp'), 'crux-selftest-userdata'));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showLauncher);
  app.on('window-all-closed', () => { /* 托盘常驻，窗口关了也不退出 */ });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.whenReady().then(async () => {
    await loadSettings();
    registerIpc();
    createTray();
    registerHotkey();
    createLauncher();
    if (SELFTEST) await selftest();
    else if (REPLAY_DIR) await replayFromArgs(REPLAY_DIR);
    else showLauncher();
  });
}
