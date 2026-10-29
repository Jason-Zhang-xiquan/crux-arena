// 预加载脚本：只把需要的几个 IPC 暴露给页面，页面本身拿不到 Node 和文件系统。
const { contextBridge, ipcRenderer } = require('electron');

// 用户自定义的形象和选手：页面脚本（mascots.js）加载时同步读取
contextBridge.exposeInMainWorld('cruxCustom', ipcRenderer.sendSync('custom:get'));

contextBridge.exposeInMainWorld('crux', {
  // 设置
  settings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: patch => ipcRenderer.invoke('settings:save', patch),
  openSettings: () => ipcRenderer.send('settings:open'),
  closeSettings: () => ipcRenderer.send('settings:close'),
  openPath: which => ipcRenderer.send('open:path', which),
  pickFolder: title => ipcRenderer.invoke('folder:pick', title),
  // 输入框
  fight: payload => ipcRenderer.invoke('fight', payload),
  hideLauncher: () => ipcRenderer.send('launcher:hide'),
  onShown: cb => ipcRenderer.on('launcher:shown', () => cb()),
  // 存档与回放
  listMatches: () => ipcRenderer.invoke('matches:list'),
  replay: dir => ipcRenderer.invoke('replay', dir),
  pickReplay: () => ipcRenderer.send('replay:pick'),
  // 桌面竞技场
  arenaReady: () => ipcRenderer.send('arena:ready'),
  onEvent: cb => ipcRenderer.on('arena:event', (_e, ev) => cb(ev)),
  onDone: cb => ipcRenderer.on('arena:done', (_e, d) => cb(d)),
  progress: info => ipcRenderer.send('arena:progress', info),
  setInteractive: on => ipcRenderer.send('arena:interactive', !!on),
  closeArena: () => ipcRenderer.send('arena:close'),
  replayCurrent: () => ipcRenderer.send('arena:replay'),
  openMatch: () => ipcRenderer.send('arena:open-match'),
  copy: text => ipcRenderer.send('clipboard', String(text)),
  // 通道：真实模型模式下哪些选手能上场
  channels: () => ipcRenderer.invoke('channels:status'),
  useDemo: () => ipcRenderer.invoke('brains:demo'),
  // 命令行：安装包自带的 crux
  cliStatus: () => ipcRenderer.invoke('cli:status'),
  installCli: () => ipcRenderer.invoke('cli:install'),
  // 角落小窗（agent 拉起的后台对局）
  onMini: cb => ipcRenderer.on('mini:update', (_e, d) => cb(d)),
  miniExpand: () => ipcRenderer.send('mini:expand'),
  miniClose: () => ipcRenderer.send('mini:close'),
});
