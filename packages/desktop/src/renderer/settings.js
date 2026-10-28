// 设置页：快捷键录制、播放偏好、存档位置、开机自启。每一项改完立即生效并保存。
const $ = s => document.querySelector(s);
let s = {};

const MOD_ORDER = ['CommandOrControl', 'Alt', 'Shift', 'Super'];
const KEY_NAMES = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc', '+': 'Plus' };
const pretty = acc => (acc || '').replace('CommandOrControl', 'Ctrl');

/** 把一次按键变成 Electron 快捷键字符串；单独按修饰键返回空 */
function toAccelerator(e) {
  const mods = [];
  if (e.ctrlKey) mods.push('CommandOrControl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return '';
  let key = KEY_NAMES[e.key] ?? (e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : /^F\d{1,2}$/.test(e.key) ? e.key : '');
  if (!key) return '';
  if (!mods.length && !/^F\d{1,2}$/.test(key)) return '';
  return [...MOD_ORDER.filter(m => mods.includes(m)), key].join('+');
}

function msg(text, kind) { const m = $('#keyMsg'); m.textContent = text; m.className = `msg ${kind ?? 'hint'}`; }

function render() {
  $('#key').textContent = s.hotkeyActive || '未注册';
  document.querySelectorAll('#speed button').forEach(b => b.classList.toggle('on', Number(b.dataset.v) === s.speed));
  document.querySelectorAll('#logPanel button').forEach(b => b.classList.toggle('on', b.dataset.v === s.logPanel));
  $('#matches').textContent = s.matchesDir || `${s.defaultMatchesDir}（默认）`;
  $('#matches').title = s.matchesDir || s.defaultMatchesDir;
  $('#autoLaunch').checked = !!s.autoLaunch;
  $('#ver').textContent = `v${s.version}`;
}

async function save(patch) {
  const r = await window.crux.saveSettings(patch);
  s = await window.crux.settings();
  render();
  return r;
}

let recording = false;
$('#record').onclick = () => { recording = true; $('#key').classList.add('rec'); $('#key').textContent = '请按下组合键…'; msg('按 Esc 取消录制'); };
addEventListener('keydown', async e => {
  if (!recording) { if (e.key === 'Escape') window.crux.closeSettings(); return; }
  e.preventDefault();
  if (e.key === 'Escape') { recording = false; $('#key').classList.remove('rec'); render(); msg('已取消'); return; }
  const acc = toAccelerator(e);
  if (!acc) { $('#key').textContent = pretty([e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean).join('+') + '+…'); return; }
  recording = false; $('#key').classList.remove('rec');
  const r = await save({ hotkey: acc });
  r.ok ? msg(`已生效：${pretty(acc)}`, 'ok') : msg(r.error, 'bad');
});
$('#auto').onclick = async () => { const r = await save({ hotkey: '' }); msg(r.ok ? `已恢复自动：${s.hotkeyActive}` : r.error, r.ok ? 'ok' : 'bad'); };

document.querySelectorAll('#speed button').forEach(b => { b.onclick = () => save({ speed: Number(b.dataset.v) }); });
document.querySelectorAll('#logPanel button').forEach(b => { b.onclick = () => save({ logPanel: b.dataset.v }); });
$('#autoLaunch').onchange = e => save({ autoLaunch: e.target.checked });
$('#changeDir').onclick = async () => { const d = await window.crux.pickFolder('选择存档文件夹'); if (d) save({ matchesDir: d }); };
$('#resetDir').onclick = () => save({ matchesDir: '' });
$('#openDir').onclick = () => window.crux.openPath('matches');
$('#replayPick').onclick = () => window.crux.pickReplay();
$('#repo').onclick = e => { e.preventDefault(); window.crux.openPath('repo'); };
$('#close').onclick = () => window.crux.closeSettings();

window.crux.settings().then(v => { s = v; render(); if (s.hotkeyError) msg(s.hotkeyError, 'bad'); });
