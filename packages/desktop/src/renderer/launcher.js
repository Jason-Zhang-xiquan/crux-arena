// 输入框：写问题、选文件夹（只读）、选模式和选手，Ctrl+Enter 开打。
const $ = s => document.querySelector(s);
const MAX = 6;
let state = { team: [], mode: 'ffa', dir: '' };
const tiles = {};
const teamColor = i => (i % 2 ? '#4cc9f0' : '#ff4d6d');

for (const r of ROSTER) {
  const t = document.createElement('div');
  t.className = 'tile'; t.style.setProperty('--c', r.color); t.title = `${r.name} · ${r.zh} · ${r.maker}`;
  const c = mascot(r.kind, 'idle', 2);
  t.append(c);
  t.insertAdjacentHTML('beforeend', `<span class="nm">${r.name}</span><span class="badge"></span>`);
  t.onclick = () => toggle(r.id);
  $('#tiles').appendChild(t);
  tiles[r.id] = { el: t, canvas: c, kind: r.kind };
}

function toggle(id) {
  const i = state.team.indexOf(id);
  if (i >= 0) state.team.splice(i, 1); else if (state.team.length < MAX) state.team.push(id);
  render();
}

function render() {
  for (const [id, t] of Object.entries(tiles)) {
    const i = state.team.indexOf(id);
    t.el.classList.toggle('sel', i >= 0);
    const b = t.el.querySelector('.badge');
    b.textContent = i < 0 ? '' : state.mode === 'team' ? (i % 2 ? 'B' : 'R') + (Math.floor(i / 2) + 1) : 'P' + (i + 1);
    b.style.setProperty('--b', state.mode === 'team' && i >= 0 ? teamColor(i) : '');
  }
  document.querySelectorAll('#mode button').forEach(b => b.classList.toggle('on', b.dataset.k === state.mode));
  $('#modeHint').textContent = state.mode === 'team' ? '单号进红队、双号进蓝队' : '各自立论，自由攻守';
  $('#count').textContent = `${state.team.length} / ${MAX}，至少 2 名，按点选顺序出场`;
  const dir = $('#dir');
  dir.textContent = state.dir || '不读文件，只讨论问题';
  dir.title = state.dir;
  dir.classList.toggle('empty', !state.dir);
  $('#go').disabled = state.team.length < 2 || !$('#q').value.trim();
}

document.querySelectorAll('#mode button').forEach(b => { b.onclick = () => { state.mode = b.dataset.k; render(); }; });
$('#pick').onclick = async () => { const d = await window.crux.pickFolder(); if (d) { state.dir = d; render(); } };
$('#clear').onclick = () => { state.dir = ''; render(); };
$('#close').onclick = () => window.crux.hideLauncher();
$('#q').addEventListener('input', render);

async function fight() {
  if ($('#go').disabled) return;
  $('#err').textContent = '';
  const r = await window.crux.fight({ question: $('#q').value, team: state.team, mode: state.mode, dir: state.dir });
  if (!r.ok) $('#err').textContent = r.error;
}
$('#go').onclick = fight;
addEventListener('keydown', e => {
  if (e.key === 'Escape') window.crux.hideLauncher();
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); fight(); }
});

// 待机动画：选中的选手两帧交替
let frame = 0;
setInterval(() => {
  frame++;
  for (const [id, t] of Object.entries(tiles)) drawPose(t.canvas, t.kind, state.team.includes(id) && frame % 2 ? 'idle2' : 'idle');
}, 450);

window.crux.onShown(() => { $('#err').textContent = ''; $('#q').focus(); $('#q').select(); });

window.crux.settings().then(s => {
  state = { team: s.team.filter(id => tiles[id]).slice(0, MAX), mode: s.mode, dir: s.dir };
  $('#q').value = s.question || '';
  $('#hotkey').textContent = s.hotkey || '未注册';
  render();
  $('#q').focus();
  $('#q').select();
});
