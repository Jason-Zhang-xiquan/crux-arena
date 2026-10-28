// Crux Arena 桌面版主进程：托盘常驻、全局快捷键唤出输入框、开打后小 AI 们在任务栏上方打架。
// 引擎和只读文件夹工具直接在这里跑（目前用演示大脑），事件逐条推给桌面竞技场窗口。
import { BrowserWindow, Menu, Tray, app, clipboard, dialog, globalShortcut, ipcMain, nativeImage, screen, shell } from 'electron';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIGHTER_IDS } from '@crux/engine';
import type { MatchEvent } from '@crux/engine';
import { runLocalMatch } from '@crux/cli/match';
import { crabPng } from './icon.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const page = (f: string) => path.join(here, 'renderer', f);
const preload = path.join(here, 'preload.cjs');
const SELFTEST = process.argv.includes('--selftest');
const HOTKEYS = ['CommandOrControl+Alt+Space', 'CommandOrControl+Shift+Space', 'Alt+Shift+A'];
const BAND_HEIGHT = 440;

interface Settings { team: string[]; mode: 'ffa' | 'team'; dir: string; question: string }
const DEFAULTS: Settings = { team: ['claude', 'codex', 'gemini', 'deepseek'], mode: 'ffa', dir: '', question: '' };
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const matchesDir = () => path.join(app.getPath('userData'), 'matches');

let tray: Tray | undefined;
let launcher: BrowserWindow | undefined;
let arena: BrowserWindow | undefined;
let hotkey = '';
let pickingFolder = false;
let lastMatchDir = '';

async function loadSettings(): Promise<Settings> {
  try { return { ...DEFAULTS, ...JSON.parse(await readFile(settingsFile(), 'utf8')) }; } catch { return { ...DEFAULTS }; }
}
const saveSettings = (s: Settings) => writeFile(settingsFile(), JSON.stringify(s, null, 2));

const secure = (w: BrowserWindow) => {
  w.webContents.on('will-navigate', e => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (SELFTEST) w.webContents.on('console-message', e => { if (e.level === 'error' || e.level === 'warning') console.log(`[renderer ${e.level}] ${e.message}`); });
};

function createLauncher() {
  launcher = new BrowserWindow({
    width: 700, height: 600, show: false, frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#00000000',
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  secure(launcher);
  launcher.loadFile(page('launcher.html'), { query: { hotkey } });
  launcher.on('blur', () => { if (!pickingFolder && !SELFTEST) launcher?.hide(); });
}

function showLauncher() {
  if (!launcher) createLauncher();
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  launcher!.setBounds({ x: Math.round(d.x + (d.width - 700) / 2), y: Math.round(d.y + d.height * 0.18), width: 700, height: 600 });
  launcher!.show();
  launcher!.focus();
  launcher!.webContents.send('launcher:shown');
}
const toggleLauncher = () => (launcher?.isVisible() ? launcher.hide() : showLauncher());

function createArena(): BrowserWindow {
  arena?.destroy();
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const w = new BrowserWindow({
    x: d.x, y: d.y + d.height - BAND_HEIGHT, width: d.width, height: BAND_HEIGHT,
    frame: false, transparent: true, resizable: false, movable: false, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: true, show: false, backgroundColor: '#00000000',
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  w.setAlwaysOnTop(true, 'floating');
  w.setIgnoreMouseEvents(true, { forward: true });   // 空白处鼠标穿透，不挡你干活
  secure(w);
  w.loadFile(page('arena.html'), { query: SELFTEST ? { speed: '3' } : {} });
  w.once('ready-to-show', () => w.showInactive());
  w.on('closed', () => { if (arena === w) arena = undefined; });
  arena = w;
  return w;
}

interface FightPayload { question: unknown; team: unknown; mode: unknown; dir: unknown }

async function startFight(p: FightPayload): Promise<{ ok: true } | { ok: false; error: string }> {
  const question = typeof p.question === 'string' ? p.question.trim().slice(0, 2000) : '';
  const team = Array.isArray(p.team) ? [...new Set(p.team.filter((x): x is string => typeof x === 'string' && (FIGHTER_IDS as readonly string[]).includes(x)))] : [];
  const mode = p.mode === 'team' ? 'team' : 'ffa';
  const dir = typeof p.dir === 'string' ? p.dir.trim() : '';
  if (!question) return { ok: false, error: '先写一个问题' };
  if (team.length < 2 || team.length > 6) return { ok: false, error: '需要 2–6 名选手' };
  if (dir) {
    try { if (!(await stat(dir)).isDirectory()) return { ok: false, error: '文件夹路径不是文件夹' }; }
    catch { return { ok: false, error: '找不到这个文件夹' }; }
  }
  await saveSettings({ team, mode, dir, question });
  launcher?.hide();

  const w = createArena();
  const queue: MatchEvent[] = [];
  let ready = false;
  const send = (e: MatchEvent) => { if (!w.isDestroyed()) w.webContents.send('arena:event', e); };
  ipcMain.once('arena:ready', ev => {
    if (ev.sender !== w.webContents) return;
    ready = true;
    queue.splice(0).forEach(send);
  });
  runLocalMatch({ question, team, mode, dir: dir || undefined, outDir: matchesDir(), onEvent: e => (ready ? send(e) : queue.push(e)) })
    .then(r => {
      lastMatchDir = r.matchDir;
      if (!w.isDestroyed()) w.webContents.send('arena:done', { battleLog: r.battleLog, matchDir: r.matchDir });
    })
    .catch(err => { console.error(err); if (!w.isDestroyed()) w.webContents.send('arena:done', { error: String(err?.message ?? err) }); });
  return { ok: true };
}

function registerIpc() {
  ipcMain.handle('settings:get', async () => ({ ...(await loadSettings()), hotkey, roster: FIGHTER_IDS }));
  ipcMain.handle('folder:pick', async () => {
    pickingFolder = true;
    try {
      const r = await dialog.showOpenDialog(launcher!, { title: '选择要讨论的文件夹（只读）', properties: ['openDirectory'] });
      return r.canceled ? '' : r.filePaths[0];
    } finally { pickingFolder = false; launcher?.focus(); }
  });
  ipcMain.handle('fight', (_e, p: FightPayload) => startFight(p));
  ipcMain.on('launcher:hide', () => launcher?.hide());
  ipcMain.on('arena:interactive', (e, on: boolean) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    w?.setIgnoreMouseEvents(!on, { forward: true });
    if (on) w?.focus();
  });
  ipcMain.on('arena:close', () => arena?.close());
  ipcMain.on('arena:open-match', () => { if (lastMatchDir) shell.openPath(lastMatchDir); });
  ipcMain.on('clipboard', (_e, text: string) => clipboard.writeText(text));
}

function createTray() {
  tray = new Tray(nativeImage.createFromBuffer(crabPng(2), { scaleFactor: 2 }));
  tray.setToolTip(`Crux Arena · ${hotkey || '未注册快捷键'} 唤出`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `提一个问题（${hotkey || '无快捷键'}）`, click: showLauncher },
    { label: '打开存档文件夹', click: async () => { await mkdir(matchesDir(), { recursive: true }); shell.openPath(matchesDir()); } },
    { type: 'separator' },
    { label: '退出 Crux Arena', click: () => app.quit() },
  ]));
  tray.on('click', showLauncher);
}

function registerHotkey() {
  for (const k of HOTKEYS) {
    try { if (globalShortcut.register(k, toggleLauncher)) { hotkey = k.replace('CommandOrControl', process.platform === 'darwin' ? 'Cmd' : 'Ctrl'); return; } }
    catch { /* 这个组合不可用，试下一个 */ }
  }
}

// 自测：自动唤出输入框、开打一场、在关键时刻截图，然后退出。CI / README 截图都用它
async function selftest() {
  const out = process.env.CRUX_SELFTEST_DIR || path.join(app.getPath('temp'), 'crux-selftest');
  await mkdir(out, { recursive: true });
  const snap = async (w: BrowserWindow | undefined, name: string) => {
    if (!w || w.isDestroyed()) return;
    const file = path.join(out, name);
    await writeFile(file, (await w.webContents.capturePage()).toPNG());
    console.log(`[selftest] 截图 ${file}`);
  };
  showLauncher();
  await new Promise(r => setTimeout(r, 3500));   // 等像素字体从 CDN 加载完
  await snap(launcher, 'launcher.png');
  const team = (process.env.CRUX_SELFTEST_TEAM || 'claude,codex,gemini,deepseek,doubao,kimi').split(',');
  const r = await startFight({ question: '这个仓库的后端该继续单体，还是拆成微服务？', team, mode: process.env.CRUX_SELFTEST_MODE || 'ffa', dir: process.env.CRUX_SELFTEST_FOLDER || '' });
  if (!r.ok) { console.error('[selftest] 开打失败', r.error); app.exit(1); return; }
  const shots = new Map([['concede', 'arena-battle.png'], ['final', 'arena-result.png']]);
  ipcMain.on('arena:progress', async (_e, info: { type: string; seq: number }) => {
    const name = shots.get(info.type);
    if (!name) return;
    shots.delete(info.type);
    await new Promise(r => setTimeout(r, info.type === 'final' ? 900 : 350));
    await snap(arena, name);
    if (info.type === 'final') { console.log(`[selftest] 完成，存档在 ${lastMatchDir}`); app.quit(); }
  });
  setTimeout(() => { console.error('[selftest] 超时'); app.exit(2); }, 120_000);
}

app.setName('Crux Arena');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showLauncher);
  app.on('window-all-closed', () => { /* 托盘常驻，窗口关了也不退出 */ });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.whenReady().then(async () => {
    registerIpc();
    registerHotkey();
    createTray();
    createLauncher();
    if (SELFTEST) await selftest();
    else showLauncher();
  });
}
