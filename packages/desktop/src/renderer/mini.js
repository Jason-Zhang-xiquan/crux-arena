// 角落小窗：agent 在后台拉起的对局缩成一张小卡片，显示回合、token、最近一步；点一下展开完整竞技场。
const $ = s => document.querySelector(s);
const BY_ID = Object.fromEntries(ROSTER.map(r => [r.id, r]));
const fmtK = n => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));
let faces = '';

window.crux.onMini(d => {
  $('#mini').classList.toggle('done', d.done);
  $('#state').textContent = d.done ? 'DONE' : d.error ? 'STOP' : 'LIVE';
  $('#state').classList.toggle('done', d.done);
  $('#round').textContent = d.done ? 'CHAMPION' : `ROUND ${d.round}`;
  $('#tok').textContent = `${fmtK(d.tokens)} / ${fmtK(d.budget)} tok`;
  $('#q').textContent = `Q：${d.question}`;
  $('#last').textContent = d.error ? d.error : d.done ? `冠军答案已出 · 点击查看` : d.last || '盲答中…';
  const key = d.fighters.map(f => f.id + (f.out ? '!' : '')).join(',');
  if (key !== faces) {
    faces = key;
    const box = $('#faces'); box.textContent = '';
    for (const f of d.fighters) {
      const r = BY_ID[f.id];
      const c = r ? mascot(r.kind, 'idle', 1) : document.createElement('canvas');
      c.title = f.name;
      if (f.out) c.classList.add('ko');
      box.appendChild(c);
    }
  }
});

$('#mini').onclick = e => { if (e.target.id !== 'close') window.crux.miniExpand(); };
$('#close').onclick = () => window.crux.miniClose();
