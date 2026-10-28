// 桌面竞技场：完全由引擎事件驱动（不是写死的剧本）。事件先进队列，按动画节奏逐条播放。
// 同一套播放逻辑以后也用于回放 events.jsonl。
const $ = s => document.querySelector(s);
const stage = $('#stage'), cardsEl = $('#cards'), lines = $('#lines');
const QS = new URLSearchParams(location.search);
let speed = Number(QS.get('speed')) || 1;
const sleep = ms => new Promise(r => setTimeout(r, ms / speed));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtK = n => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));
const sumT = t => (t ? t.in + t.out : 0);
const KIND = { attack: '攻', defend: '守', concede: '让', shift: '改' };
const TAGC = { attack: 'atk', defend: 'def', concede: 'con', shift: 'con' };
const LABEL = { fact: '事实', inference: '推断', speculation: '猜测' };
const TEAM_COLOR = { red: '#ff4d6d', blue: '#4cc9f0' };
const BY_ID = Object.fromEntries(ROSTER.map(r => [r.id, r]));

const S = { start: null, fighters: {}, claims: {}, actions: {}, edges: [], tokens: 0, reads: 0, saved: 0, round: 0, final: null, done: null, poses: {} };

/* ---------- 布局 ---------- */
const logW = () => ($('#log').classList.contains('collapsed') ? 0 : 380);
const cx = () => (innerWidth - logW()) / 2;
const BASE = () => innerHeight - 22;            // 选手脚底
if (innerWidth < 1500) $('#log').classList.add('collapsed');

function layoutFighters() {
  const ids = S.start?.fighters.map(f => f.id) ?? [];
  const perSide = Math.ceil(ids.length / 2);
  const room = cx() - 300 - 60;
  const gap = Math.max(84, Math.min(112, perSide > 1 ? room / (perSide - 1) : 112));
  ids.forEach((id, i) => {
    const f = S.fighters[id], side = i % 2, j = Math.floor(i / 2);
    f.x = side ? cx() + 290 + j * gap : cx() - 290 - j * gap;
    f.el.style.left = `${f.x - 48}px`;
    f.el.style.top = `${BASE() - 80}px`;
  });
}

function layoutCards() {
  const vis = Object.values(S.claims).filter(c => c.status !== 'merged');
  const total = vis.length * 184 + Math.max(0, vis.length - 1) * 16;
  vis.forEach((c, i) => { c.x = cx() - total / 2 + i * 200; c.y = 84; c.el.style.left = `${c.x}px`; c.el.style.top = `${c.y}px`; });
  const cs = $('#consensus');
  cs.style.top = '204px'; cs.style.left = `${cx()}px`;
}
addEventListener('resize', () => { layoutFighters(); layoutCards(); });

/* ---------- 选手 ---------- */
function addFighter(f, i) {
  const r = BY_ID[f.id] ?? { kind: 'crab', color: '#f0896a', name: f.name, zh: '' };
  const el = document.createElement('div');
  el.className = 'fighter' + (i % 2 ? ' flip' : '');
  el.style.setProperty('--fc', r.color);
  if (f.team) el.style.setProperty('--team', TEAM_COLOR[f.team] + 'aa');
  el.innerHTML = `<div class="shadow"></div><div class="bob" style="animation-delay:${(i * 0.17) % 0.9}s"></div><div class="ntag">${esc((f.team ? (f.team === 'red' ? '红·' : '蓝·') : '') + f.name)}</div><div class="status"></div>`;
  const spr = mascot(r.kind, 'idle', 4); spr.className = 'spr';
  el.querySelector('.bob').appendChild(spr);
  stage.appendChild(el);
  S.fighters[f.id] = { ...f, kind: r.kind, color: r.color, el, spr, x: 0 };
}
function setPose(id, pose, ms) {
  const f = S.fighters[id]; if (!f) return;
  S.poses[id] = pose; drawPose(f.spr, f.kind, pose);
  if (ms) setTimeout(() => { if (S.poses[id] === pose) setPose(id, 'idle'); }, ms / speed);
}
setInterval(() => { for (const id in S.fighters) { const p = S.poses[id] ?? 'idle'; if (p === 'idle' || p === 'idle2') setPose(id, p === 'idle' ? 'idle2' : 'idle'); } }, 480);
function setStatus(id, html) { const f = S.fighters[id]; if (f) f.el.querySelector('.status').innerHTML = html ? `<div class="tag-bubble">${html}</div>` : ''; }
const fname = id => (!id ? 'JUDGE' : S.fighters[id]?.name ?? (id === 'scout' ? 'SCOUT' : String(id).toUpperCase()));
const fcolor = id => S.fighters[id]?.color ?? '#b8a6ff';

/* ---------- 对话气泡 ---------- */
let bubble;
async function say(id, act, text, ev) {
  bubble?.remove();
  const f = S.fighters[id];
  const b = document.createElement('div');
  b.className = 'bubble'; b.style.setProperty('--fc', f?.color ?? '#b8a6ff');
  b.innerHTML = `<span class="who">${esc(fname(id))}</span>${act ? `<span class="act">${esc(act)}</span>` : ''}<span class="t">${esc(text)}</span>${ev ? `<span class="ev">🔍 ${esc(ev)}</span>` : ''}`;
  stage.appendChild(b); bubble = b;
  const x = f ? f.x : cx();
  const left = Math.max(8, Math.min(innerWidth - logW() - b.offsetWidth - 8, x - 40));
  b.style.left = `${left}px`;
  b.style.top = `${(f ? BASE() - 92 : 260) - b.offsetHeight}px`;
  b.style.setProperty('--tail', `${Math.max(12, Math.min(b.offsetWidth - 24, x - left - 6))}px`);
  const t = b.querySelector('.t'); t.textContent = '';
  for (const ch of String(text)) { t.textContent += ch; await sleep(16); }
}

/* ---------- 论点卡 ---------- */
function addCard(e) {
  const f = S.fighters[e.actor];
  const el = document.createElement('div');
  el.className = 'card drop'; el.style.setProperty('--oc', f?.color ?? '#999');
  el.innerHTML = `<div class="stripe"></div><div class="sup"></div><div class="hd"><span class="cid">${e.id}</span><span class="lbl ${e.label === 'fact' ? 'fact' : ''}">${LABEL[e.label]}</span></div><span class="own">${esc(fname(e.actor))}</span><div class="txt">${esc(e.text)}</div><div class="hp">${'<i></i>'.repeat(10)}<span class="hpn">100HP</span></div><div class="stamp">K.O.</div>`;
  cardsEl.appendChild(el);
  S.claims[e.id] = { id: e.id, owner: e.actor, short: e.short, hp: 100, status: 'alive', supporters: [e.actor], el, x: 0, y: 0 };
  layoutCards();
}
function renderHP(c) {
  c.el.querySelectorAll('.hp i').forEach((i, n) => i.classList.toggle('off', n >= Math.ceil(c.hp / 10)));
  c.el.querySelector('.hpn').textContent = `${c.hp}HP`;
}
function renderSup(c) { c.el.querySelector('.sup').innerHTML = c.supporters.slice(1).map(id => `<i style="--sc:${fcolor(id)}"></i>`).join(''); }
function moveSupport(id, to) {
  for (const c of Object.values(S.claims)) if (c.id !== to && c.owner !== id && c.supporters.includes(id)) { c.supporters = c.supporters.filter(x => x !== id); renderSup(c); }
  const t = S.claims[to]; if (t && !t.supporters.includes(id)) { t.supporters.push(id); renderSup(t); }
}
const cardPt = id => { const c = S.claims[id]; return { x: c.x + 92, y: c.y + 54 }; };

/* ---------- 特效 ---------- */
function pop(x, y, text, cls, rise = 40, dur = 900) {
  const p = document.createElement('div'); p.className = `pop ${cls}`; p.textContent = text;
  p.style.left = `${x}px`; p.style.top = `${y}px`; stage.appendChild(p);
  p.animate([{ transform: 'translate(-50%,0)', opacity: 1 }, { transform: `translate(-50%,-${rise}px)`, opacity: 0 }], { duration: dur / speed, easing: 'steps(8)', fill: 'forwards' }).finished.then(() => p.remove());
}
function burst(pt, color, n) {
  for (let i = 0; i < n; i++) {
    const s = document.createElement('div'); s.className = 'spark'; s.style.setProperty('--pc', i % 3 ? color : '#fff'); stage.appendChild(s);
    const a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 60;
    s.animate([{ transform: `translate(${pt.x}px,${pt.y}px)`, opacity: 1 }, { transform: `translate(${pt.x + Math.cos(a) * d}px,${pt.y + Math.sin(a) * d}px)`, opacity: 0 }], { duration: 520 / speed, easing: 'steps(6)', fill: 'forwards' }).finished.then(() => s.remove());
  }
}
async function projectile(from, to, color, crit) {
  const p = document.createElement('div'); p.className = 'proj' + (crit ? ' crit' : ''); p.style.setProperty('--pc', color); stage.appendChild(p);
  const dur = 440 / speed, t0 = performance.now();
  await new Promise(res => {
    const tick = now => {
      const t = Math.min(1, (now - t0) / dur);
      const x = Math.round((from.x + (to.x - from.x) * t) / 4) * 4, y = Math.round((from.y + (to.y - from.y) * t - Math.sin(t * Math.PI) * 60) / 4) * 4;
      p.style.transform = `translate(${x - 6}px,${y - 6}px)`;
      const tr = document.createElement('div'); tr.className = 'trail'; tr.style.setProperty('--pc', color); tr.style.transform = p.style.transform;
      stage.appendChild(tr); setTimeout(() => tr.remove(), 300);
      t < 1 ? requestAnimationFrame(tick) : res();
    };
    requestAnimationFrame(tick);
  });
  p.remove(); burst(to, color, crit ? 18 : 10);
}
const shake = () => stage.animate([{ transform: 'translate(0,0)' }, { transform: 'translate(-8px,4px)' }, { transform: 'translate(8px,-4px)' }, { transform: 'translate(0,0)' }], { duration: 300 / speed, easing: 'steps(4)' });
async function banner(big, small, ms = 800) {
  const b = $('#banner'); b.innerHTML = `${esc(big)}${small ? `<small>${esc(small)}</small>` : ''}`; b.style.display = 'block';
  b.animate([{ transform: 'translate(-50%,-50%) scale(2.2)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }], { duration: 280 / speed, easing: 'steps(5)' });
  await sleep(ms); b.style.display = 'none';
}

/* ---------- HUD ---------- */
function addTokens(t) {
  S.tokens += sumT(t);
  const budget = S.start?.budget ?? 60000;
  $('#manaFill').style.width = `${Math.max(0, 100 - (S.tokens / budget) * 100)}%`;
  $('#tok').textContent = `${fmtK(S.tokens)} / ${fmtK(budget)} tok`;
}

/* ---------- 迷你战报 ---------- */
const lineEls = {};
function logLine(o) {
  const d = document.createElement('div');
  d.className = 'ln'; d.dataset.id = o.id ?? '';
  d.style.setProperty('--lc', o.color ?? fcolor(o.who));
  const refs = (o.refs ?? []).map(r => `<span class="ref" data-ref="${r}">←${r.startsWith('A') ? '#' : ''}${r}</span>`).join('');
  d.innerHTML = `<div class="r1"><span class="lid">${o.id ? (o.id.startsWith('A') ? '#' : '') + o.id : ''}</span><span class="rd">R${o.round ?? S.round}</span><span class="tag ${o.tagc}">${o.tag}</span><span class="who" style="color:${o.color ?? fcolor(o.who)}">${esc(o.name ?? fname(o.who))}</span>${o.tgt ? `<span class="tg">&gt; ${o.tgt}</span>` : ''}<span class="res ${o.resc ?? ''}">${esc(o.res ?? '')}</span></div><div class="r2">${esc(o.why)}<span class="rl">${o.ruling ? `｜${esc(o.ruling)}` : ''}</span>${refs}</div>`;
  lines.appendChild(d); lines.scrollTop = lines.scrollHeight;
  if (o.id) lineEls[o.id] = d;
  return d;
}
lines.addEventListener('click', e => {
  const ref = e.target.closest('.ref'); if (!ref) return;
  const t = lines.querySelector(`.ln[data-id="${ref.dataset.ref}"]`);
  if (t) { t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash'); lines.scrollTop = t.offsetTop - lines.clientHeight / 2; }
});
function addEdges(e) {
  const by = new Map();
  for (const r of e.causedBy) {
    const who = S.actions[r]?.actor ?? S.claims[r]?.owner;
    if (!who || who === e.actor) continue;
    by.set(who, [...(by.get(who) ?? []), r]);
  }
  for (const [from, causes] of by) S.edges.push({ from, to: e.actor, on: e.kind === 'concede' ? e.target : (S.actions[causes[0]]?.target ?? e.target), why: S.actions[causes[0]]?.why ?? '', chain: `${causes.map(c => '#' + c).join(' ')} → #${e.id}` });
  $('#edgeList').innerHTML = S.edges.map(x => `<div class="edge"><div class="e1"><span style="color:${fcolor(x.from)}">${esc(fname(x.from))}</span> =&gt; <span style="color:${fcolor(x.to)}">${esc(fname(x.to))}</span> <span style="color:#fff">${x.on}</span></div>${esc(x.why)} · ${x.chain}</div>`).join('');
}

/* ---------- 事件处理 ---------- */
const H = {
  async match_started(e) {
    S.start = e;
    $('#question').textContent = `Q：${e.question}`;
    e.fighters.forEach(addFighter);
    layoutFighters(); layoutCards(); addTokens({ in: 0, out: 0 });
    if (e.workspace) { $('#reads').hidden = false; $('#reads').textContent = '📁 只读 · 读 0 · 写 0'; }
  },
  async round_started(e) {
    S.round = e.round;
    $('#round').textContent = e.round === 0 ? 'ROUND 0' : `ROUND ${e.round}`;
    await banner(e.round === 0 ? 'ROUND 0' : `ROUND ${e.round}`, e.round === 0 ? '匿名盲答' : 'FIGHT!', 750);
  },
  async tool_call(e) {
    S.reads++;
    $('#reads').textContent = `📁 只读 · 读 ${S.reads} · 写 0`;
    const p = e.input.path ? `${e.input.path}${e.input.to ? `:${e.input.from}-${e.input.to}` : ''}` : e.tool === 'repo_map' ? '仓库地图' : e.input.pattern ?? '';
    logLine({ who: e.actor, name: e.actor === 'scout' ? 'SCOUT' : fname(e.actor), color: '#9ad1ff', tag: '读', tagc: 'read', why: `${e.tool} ${p}`, res: e.ok ? `${fmtK(e.bytes)}B` : `拒 ${e.note ?? ''}`, resc: e.ok ? '' : 'ko' });
    await sleep(120);
  },
  async claim(e) {
    setStatus(e.actor, '…'); await sleep(350); setStatus(e.actor, '');
    addCard(e); addTokens(e.tokens);
    logLine({ id: e.id, who: e.actor, round: 0, tag: '立', tagc: 'clm', why: e.short, res: `[${LABEL[e.label]}]` });
    await say(e.actor, `立 ${e.id}`, e.text); await sleep(450);
  },
  async second(e) {
    const c = S.claims[e.target]; if (c && !c.supporters.includes(e.actor)) { c.supporters.push(e.actor); renderSup(c); }
    logLine({ who: e.actor, round: 0, tag: '附', tagc: 'clm', tgt: e.target, why: e.why });
    setStatus(e.actor, `附议 ${e.target}`); await sleep(600); setStatus(e.actor, '');
  },
  async crux(e) {
    bubble?.remove();
    for (const m of e.merges) { const c = S.claims[m.from], into = S.claims[m.into]; if (!c) continue; c.status = 'merged'; c.el.classList.add('merged'); for (const s of c.supporters) if (into && !into.supporters.includes(s)) into.supporters.push(s); into && renderSup(into); }
    layoutCards();
    e.clash.forEach(id => S.claims[id]?.el.classList.add('clash'));
    if (e.consensus.length) { const cs = $('#consensus'); cs.textContent = `共识：${e.consensus.join('；')}`; cs.style.display = 'block'; cs.style.transform = 'translateX(-50%)'; }
    addTokens(e.tokens);
    logLine({ who: 'judge', name: 'JUDGE', color: '#b8a6ff', round: 0, tag: '裁', tagc: 'jdg', why: `分歧 ${e.clash.join('/')}${e.merges.length ? ` · 合并 ${e.merges.map(m => `${m.from}→${m.into}`).join(' ')}` : ''}`, res: `${e.consensus.length} 共识`, resc: 'ok' });
    await say(null, '裁判', e.why); await sleep(900);
    e.clash.forEach(id => S.claims[id]?.el.classList.remove('clash'));
  },
  async action(e) {
    S.actions[e.id] = e;
    const f = S.fighters[e.actor];
    setStatus(e.actor, '…'); await sleep(300);
    if (e.evidence.length) { setStatus(e.actor, '🔍'); await sleep(450); }
    setStatus(e.actor, '');
    addTokens(e.tokens);
    const ev = e.evidence[0] ? `${e.evidence[0].kind === 'file' ? e.evidence[0].ref : '[web]'} ${e.evidence[0].quote ?? ''}` : '';
    await say(e.actor, `${KIND[e.kind]} > ${e.target}`, e.detail || e.why, ev);
    const tag = { round: e.round, id: e.id, who: e.actor, tag: KIND[e.kind], tagc: TAGC[e.kind], tgt: e.target, why: e.why + (e.evidence.length ? ' [证据]' : ''), refs: e.causedBy };
    if (e.kind === 'attack' && f) {
      setPose(e.actor, 'atk', 650);
      f.el.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${f.el.classList.contains('flip') ? -26 : 26}px)` }, { transform: 'translateX(0)' }], { duration: 300 / speed, easing: 'steps(3)' });
      await projectile({ x: f.x, y: BASE() - 50 }, cardPt(e.target), f.color, e.evidence.length > 0);
      logLine(tag);
    } else if (e.kind === 'defend') {
      logLine(tag);
    } else {
      setStatus(e.actor, '🏳'); setPose(e.actor, 'hurt');
      logLine({ ...tag, res: e.kind === 'concede' ? `${e.target} K.O.` : `→ ${e.target}`, resc: e.kind === 'concede' ? 'ko' : 'ok' });
      addEdges(e);
      if (e.kind === 'concede') {
        const c = S.claims[e.target];
        if (c) { c.status = 'ko'; c.hp = 0; renderHP(c); c.el.classList.add('ko'); burst(cardPt(e.target), '#ff4d6d', 22); shake(); }
        if (e.shiftTo) moveSupport(e.actor, e.shiftTo);
        await banner('K.O.', `${e.target} 出局`, 650);
      } else moveSupport(e.actor, e.target);
      setStatus(e.actor, ''); setPose(e.actor, 'idle');
      await sleep(400);
    }
  },
  async ruling(e) {
    const a = S.actions[e.action]; if (!a) return;
    const c = S.claims[a.target];
    addTokens(e.tokens);
    const line = lineEls[a.id];
    if (a.kind === 'attack' && c) {
      c.hp = Math.max(0, c.hp - e.damage); renderHP(c);
      c.el.classList.remove('hitfx'); void c.el.offsetWidth; c.el.classList.add('hitfx');
      const p = cardPt(a.target);
      pop(p.x, p.y - 30, e.damage ? `-${e.damage}` : 'MISS', 'dmg');
      if (e.crit) { shake(); pop(p.x, p.y - 64, 'CRITICAL!', 'crit', 28, 1200); }
      const owner = S.fighters[c.owner];
      if (owner && e.damage) { setPose(c.owner, 'hurt', 700); owner.el.classList.remove('hurt'); void owner.el.offsetWidth; owner.el.classList.add('hurt'); }
      if (c.hp === 0 && c.status === 'alive') { c.status = 'ko'; c.el.classList.add('ko'); await banner('K.O.', `${c.id} 被击穿`, 650); }
      if (line) { line.querySelector('.res').textContent = `-${e.damage}${e.crit ? ' 暴击' : ''}`; line.querySelector('.res').classList.add('dmg'); }
    }
    if (a.kind === 'defend' && c) {
      c.hp = Math.min(100, c.hp + e.heal); renderHP(c);
      c.el.classList.add('shield'); setTimeout(() => c.el.classList.remove('shield'), 900 / speed);
      const p = cardPt(a.target); pop(p.x, p.y - 30, `+${e.heal}`, 'heal');
      if (line) { line.querySelector('.res').textContent = `+${e.heal}`; line.querySelector('.res').classList.add('heal'); }
    }
    if (line) line.querySelector('.rl').textContent = `｜${e.text}`;
    await sleep(750);
  },
  async skip(e) {
    if (e.tokens) addTokens(e.tokens);
    if (!e.savedTokens) return;
    setStatus(e.actor, 'Zz'); S.fighters[e.actor]?.el.classList.add('dim');
    S.saved += e.savedTokens;
    pop(innerWidth / 2, 46, `+${fmtK(e.savedTokens)} SAVED`, 'save', 18, 1300);
    logLine({ who: e.actor, round: e.round, tag: '略', tagc: 'skp', why: e.reason, res: `+${fmtK(e.savedTokens)} tok`, resc: 'save' });
    await say(null, '稀疏化', `${fname(e.actor)} ${e.reason}`); await sleep(500);
  },
  async flag(e) {
    if (e.tokens) addTokens(e.tokens);
    const name = { no_cause: '无因认输', why_truncated: '理由截断', invalid_action: '不合规', budget: '预算用尽' }[e.kind];
    logLine({ who: e.actor ?? 'judge', name: e.actor ? undefined : 'JUDGE', color: '#ff4d6d', tag: '标', tagc: 'flg', why: `${name}：${e.note}` });
  },
  async converged(e) {
    S.saved += e.savedTokens;
    const text = { flawless: ['FLAWLESS', '没有分歧，直接出答案'], settled: ['FINISH', '立场收敛 · 提前结束'], budget: ['TIME UP', '预算用尽，直接综合'], max_rounds: ['FINISH', '打满回合，进入综合'] }[e.reason];
    logLine({ who: 'judge', name: 'JUDGE', color: '#b8a6ff', round: e.round, tag: '裁', tagc: 'jdg', why: text[1], res: e.savedTokens ? `+${fmtK(e.savedTokens)} tok` : '', resc: 'save' });
    for (const id in S.fighters) { S.fighters[id].el.classList.remove('dim'); setStatus(id, ''); }
    bubble?.remove();
    await banner(text[0], text[1], 1000);
  },
  async final(e) { S.final = e; addTokens(e.tokens); },
  async match_ended(e) { S.ended = e; showResult(); },
};

/* ---------- 结果卡 ---------- */
function showResult() {
  const r = $('#result'), f = S.final;
  if (!f) return;
  const ws = S.start?.workspace;
  r.innerHTML = `<h2>CHAMPION ANSWER</h2>
    <div class="sub">${S.start.mode === 'team' ? 'TEAM · 红 vs 蓝' : 'FFA · 混战'} · 演示大脑（未接真实模型，内容为演示剧本）${ws ? ` · 📁 只读：读取 ${S.reads} 次，写入 0 次` : ''}</div>
    <div class="champ">${esc(f.answer)}</div>
    <div class="notes"><div class="note"><b>MINORITY · 少数派</b>${esc(f.minority.join('；') || '无')}</div><div class="note"><b>YOUR CALL · 需要你判断</b>${esc(f.userCruxes.join('；') || '无')}</div></div>
    <div class="acts">
      <button class="btn" id="copyAns">复制答案</button>
      <button class="btn" id="viewLog">查看战报</button>
      <button class="btn" id="openDir">打开存档</button>
      <button class="btn" id="closeRes">关闭</button>
      <span class="stats">${fmtK(S.ended?.totalTokens ?? S.tokens)} tok · 省 ${fmtK(S.saved)} · 置信度 ${Math.round(f.confidence * 100)}%</span>
    </div>`;
  r.hidden = false;
  $('#cards').style.opacity = '.25'; $('#consensus').style.opacity = '.25';
  $('#copyAns').onclick = () => { window.crux.copy(f.answer); $('#copyAns').textContent = '已复制'; };
  $('#viewLog').onclick = () => { $('#fullText').textContent = S.done?.battleLog ?? '战报还在写入…'; $('#full').hidden = false; };
  $('#openDir').onclick = () => window.crux.openMatch();
  $('#closeRes').onclick = () => window.crux.closeArena();
}
$('#copyLog').onclick = () => window.crux.copy($('#fullText').textContent);
$('#closeFull').onclick = () => { $('#full').hidden = true; };
window.crux.onDone(d => {
  S.done = d;
  if (d.error) { const r = $('#result'); r.innerHTML = `<h2>出错了</h2><div class="sub">${esc(d.error)}</div><div class="acts"><button class="btn" id="closeRes">关闭</button></div>`; r.hidden = false; $('#closeRes').onclick = () => window.crux.closeArena(); }
});

/* ---------- 交互：空白处穿透，面板和按钮可点 ---------- */
let interactive = false;
addEventListener('mousemove', e => {
  const on = !!e.target.closest('.hit');
  if (on !== interactive) { interactive = on; window.crux.setInteractive(on); }
});
addEventListener('keydown', e => { if (e.key === 'Escape') window.crux.closeArena(); });
$('#close').onclick = () => window.crux.closeArena();
$('#toggleLog').onclick = () => { $('#log').classList.toggle('collapsed'); layoutFighters(); layoutCards(); };
$('#speed').onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; $('#speed').textContent = `${speed}X`; };
$('#speed').textContent = `${speed}X`;

/* ---------- 事件队列 ---------- */
const queue = [];
let wake;
window.crux.onEvent(e => { queue.push(e); wake?.(); });
(async () => {
  for (;;) {
    while (!queue.length) await new Promise(r => { wake = r; });
    wake = undefined;
    const e = queue.shift();
    try { await H[e.type]?.(e); } catch (err) { console.error('播放事件出错', e.type, err); }
    window.crux.progress({ type: e.type === 'action' ? e.kind : e.type, seq: e.seq });
  }
})();
window.crux.arenaReady();
