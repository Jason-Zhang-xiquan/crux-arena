// 预加载脚本：只把需要的几个 IPC 暴露给页面，页面本身拿不到 Node 和文件系统。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('crux', {
  // 输入框
  settings: () => ipcRenderer.invoke('settings:get'),
  pickFolder: () => ipcRenderer.invoke('folder:pick'),
  fight: payload => ipcRenderer.invoke('fight', payload),
  hideLauncher: () => ipcRenderer.send('launcher:hide'),
  onShown: cb => ipcRenderer.on('launcher:shown', () => cb()),
  // 桌面竞技场
  arenaReady: () => ipcRenderer.send('arena:ready'),
  onEvent: cb => ipcRenderer.on('arena:event', (_e, ev) => cb(ev)),
  onDone: cb => ipcRenderer.on('arena:done', (_e, d) => cb(d)),
  progress: info => ipcRenderer.send('arena:progress', info),
  setInteractive: on => ipcRenderer.send('arena:interactive', !!on),
  closeArena: () => ipcRenderer.send('arena:close'),
  openMatch: () => ipcRenderer.send('arena:open-match'),
  copy: text => ipcRenderer.send('clipboard', String(text)),
});
