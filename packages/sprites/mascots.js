// @crux/sprites：13 个 AI 吉祥物的像素精灵（浏览器全局脚本，网页原型和桌面版共用）
const OUT = '#140d1f';
/* 吉祥物：每个 AI 一个原创像素形象（非官方同人），24×20，全部朝右画，右侧选手镜像 */
const MW = 24, MH = 20;
function rect(g, x, y, w, h, c){ g.fillStyle = c; g.fillRect(x, y, w, h); }
const mirror = (x, w) => MW - x - w;
// 通用眼睛：idle 竖条眼；atk 眯眼+怒眉；hurt 变成 > <
function eyePair(g, pose, pts, e, w = 2, h = 3){
  pts.forEach(([x, y], i) => {
    if (pose === 'hurt') { const a = i ? x + 1 : x, b = i ? x : x + 1; rect(g, a, y, 1, 1, e); rect(g, b, y + 1, 1, 1, e); rect(g, a, y + 2, 1, 1, e); }
    else if (pose === 'atk') { rect(g, x, y + 1, w, h - 1, e); rect(g, i ? x + w - 1 : x, y - 1, 1, 1, e); rect(g, i ? x : x + w - 1, y, 1, 1, e); }
    else rect(g, x, y, w, h, e);
  });
}
const MASCOTS = {
  crab(g, pose){ // CLAUDE：小螃蟹
    const o = '#D97757', O = '#B5573A', h = '#F0A383', e = '#1B1220';
    const dy = pose === 'idle2' || pose === 'atk' ? -1 : 0;
    const claw = m => {
      const X = (x, w) => m ? mirror(x, w) : x;
      const y = 1 + dy;
      if (pose === 'atk') { rect(g, X(1, 2), y, 2, 1, h); rect(g, X(0, 4), y + 1, 4, 1, o); } // 钳子夹紧
      else { rect(g, X(0, 2), y, 2, 1, h); rect(g, X(3, 2), y, 2, 1, h); rect(g, X(0, 2), y + 1, 2, 1, o); rect(g, X(3, 2), y + 1, 2, 1, o); }
      rect(g, X(0, 5), y + 2, 5, 1, o);
      rect(g, X(1, 3), y + 3, 3, 1, O);
      rect(g, X(2, 1), y + 4, 1, 6 - (y + 4), O);
      rect(g, X(2, 4), 6, 4, 1, O);
    };
    claw(false); claw(true);
    rect(g, 6, 6, 12, 1, o); rect(g, 5, 7, 14, 6, o); rect(g, 5, 13, 14, 1, O); rect(g, 6, 14, 12, 1, O);
    rect(g, 6, 7, 4, 1, h); rect(g, 6, 8, 1, 2, h);
    [6, 9, 13, 16].forEach(x => rect(g, x, 15, 2, pose === 'idle2' && (x === 6 || x === 13) ? 1 : 2, O));
    eyePair(g, pose, [[8, 8], [14, 8]], e);
  },
  bot(g, pose){ // CODEX：终端机器人
    const f = '#E9EDF2', F = '#AEB6C2', s = '#0E1316', gr = '#3DDC84', r = '#FF5D73', d = '#5B6573';
    rect(g, 11, 1, 2, 1, F);
    rect(g, 11, 0, 2, 1, pose === 'idle2' ? F : gr);
    rect(g, 4, 2, 16, 12, f);
    rect(g, 5, 2, 14, 1, '#ffffff'); rect(g, 4, 12, 16, 2, F);
    [[4, 2], [19, 2], [4, 13], [19, 13]].forEach(([x, y]) => g.clearRect(x, y, 1, 1));
    rect(g, 6, 4, 12, 8, s); rect(g, 6, 4, 12, 1, '#1c262c');
    const dots = (pts, c) => pts.forEach(([x, y]) => rect(g, x, y, 1, 1, c));
    if (pose === 'hurt') dots([[8,6],[10,6],[9,7],[8,8],[10,8],[13,6],[15,6],[14,7],[13,8],[15,8]], r);
    else if (pose === 'atk') { dots([[8,6],[9,7],[8,8],[11,6],[12,7],[11,8]], gr); rect(g, 15, 5, 1, 3, gr); rect(g, 15, 9, 1, 1, gr); }
    else { dots([[8,6],[9,7],[8,8]], gr); if (pose !== 'idle2') rect(g, 11, 8, 4, 1, gr); }
    rect(g, 10, 14, 4, 1, d);
    rect(g, 7, 15, 10, 2, F); rect(g, 7, 17, 3, 1, d); rect(g, 14, 17, 3, 1, d);
    [false, true].forEach(m => { const X = (x, w) => m ? mirror(x, w) : x; rect(g, X(2, 2), 9, 2, 1, F); rect(g, X(1, 2), pose === 'atk' && m ? 6 : 8, 2, 2, f); if (pose === 'atk' && m) rect(g, X(2, 1), 7, 1, 2, F); });
  },
  star(g, pose){ // GEMINI：双子星
    const cols = ['#4F8DF5', '#7381F4', '#9B72F2', '#C46FD8', '#E0708A'], e = '#1B1230';
    const sparkle = (cx, cy, r) => {
      for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
        if (Math.cbrt(x * x) + Math.cbrt(y * y) > Math.cbrt(r * r) + .5) continue;
        const t = (x + y + 2 * r) / (4 * r) * (cols.length - 1) + ((x + y) & 1 ? .25 : -.25);
        rect(g, cx + x, cy + y, 1, 1, cols[Math.max(0, Math.min(cols.length - 1, Math.round(t)))]);
      }
    };
    sparkle(10, 10, 8);
    sparkle(20, pose === 'idle2' ? 3 : 4, 3);
    rect(g, 10, 4, 1, 1, '#ffffff'); rect(g, 9, 6, 1, 1, '#cfe0ff');
    if (pose === 'atk') [[10, 1], [10, 19], [1, 10], [19, 10]].forEach(([x, y]) => rect(g, x, y, 1, 1, '#ffffff'));
    eyePair(g, pose, [[8, 8], [12, 8]], e, 1, 2);
    if (pose !== 'hurt') { rect(g, 9, 12, 1, 1, e); rect(g, 11, 12, 1, 1, e); rect(g, 10, 13, 1, 1, e); }
    else rect(g, 9, 13, 3, 1, e);
  },
  whale(g, pose){ // DEEPSEEK：小鲸鱼
    const b = '#4D6BFE', B = '#3550D8', l = '#C9D4FF', w = '#9BD7FF', e = '#10163A';
    const cx = 13, cy = 12, rx = 9, ry = 5;
    for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
      const v = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (v > 1.05) continue;
      rect(g, x, y, 1, 1, y >= cy + 2 && x > cx - 6 ? l : y === cy + ry || (v > .8 && y > cy) ? B : b);
    }
    rect(g, 9, 8, 4, 1, '#7F96FF');
    rect(g, 2, 10, 3, 3, b); rect(g, 0, 7, 2, 3, b); rect(g, 1, 6, 1, 1, b); rect(g, 0, 12, 2, 3, B); rect(g, 1, 15, 1, 1, B);
    rect(g, 11, 15, 2, 2, B);
    rect(g, 18, 14, 3, 1, B);
    if (pose === 'hurt') [[17,10],[19,10],[18,11],[17,12],[19,12]].forEach(([x, y]) => rect(g, x, y, 1, 1, e));
    else { rect(g, 17, 10, 2, 2, e); rect(g, 17, 10, 1, 1, '#ffffff'); if (pose === 'atk') { rect(g, 16, 8, 1, 1, e); rect(g, 17, 9, 2, 1, e); } }
    const up = pose === 'idle2' ? -1 : 0, big = pose === 'atk';
    rect(g, 16, 5 + up, 1, 2 - up, w);
    [[14, 3], [15, 2], [17, 2], [18, 3]].forEach(([x, y]) => rect(g, x, y + up, 1, 1, w));
    if (big) [[13, 1], [16, 0], [19, 1], [16, 3]].forEach(([x, y]) => rect(g, x, y, 1, 1, w));
  },
};
function blob(g, cx, cy, rx, ry, fn){
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    const v = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    if (v <= 1) { const c = fn(x, y, v); if (c) rect(g, x, y, 1, 1, c); }
  }
}
const dots = (g, pts, c) => pts.forEach(([x, y]) => rect(g, x, y, 1, 1, c));
// 通用嘴：idle 微笑；atk 张嘴喊；hurt 波浪嘴。x 为 4 格宽嘴的左端
function mouth(g, pose, x, y, c){
  if (pose === 'atk') rect(g, x + 1, y, 2, 2, c);
  else if (pose === 'hurt') dots(g, [[x, y + 1], [x + 1, y], [x + 2, y + 1], [x + 3, y]], c);
  else dots(g, [[x, y], [x + 1, y + 1], [x + 2, y + 1], [x + 3, y]], c);
}
Object.assign(MASCOTS, {
  grok(g, pose){ // GROK：黑洞小怪（土星环 = 吸积盘）
    const k = '#0B0B10', K = '#45405E', w = '#FFFFFF', o = '#FFB15C', e = pose === 'atk' ? '#FF4D4D' : w;
    const spin = pose === 'idle2' ? 1 : 0;
    const ring = front => blob(g, 12, 11, 11.5, 3.2, (x, y, v) => v < .55 || (front ? y < 11 : y >= 11) ? null : ((x + spin) % 3 ? w : o));
    ring(false);
    blob(g, 12, 10, 7, 7, (x, y, v) => v > .78 ? K : k);
    ring(true);
    eyePair(g, pose, [[9, 7], [14, 7]], e, 2, 2);
    if (pose === 'idle' || pose === 'idle2') dots(g, [[10, 12], [11, 12], [12, 12], [13, 11]], w); // 坏笑
    else mouth(g, pose, 10, 11, w);
  },
  muse(g, pose){ // MUSE（Meta）：眼镜精灵，头顶一颗 spark
    const b = '#1877F2', B = '#0B57C9', l = '#8DBBFF', lens = '#D8E8FF', e = '#0B1B3A', y = '#FFD54A';
    [6.5, 16.5].forEach(cx => blob(g, cx, 10, 5.5, 4.5, (x, yy, v) => v < .38 ? lens : (yy < 9 && v > .65 ? l : b)));
    rect(g, 11, 9, 2, 2, B);
    eyePair(g, pose, [[5, 9], [16, 9]], e, 2, 2);
    const s = pose === 'idle2' ? 1 : pose === 'atk' ? 3 : 2;
    rect(g, 12, 2, 1, 1, '#ffffff');
    for (let i = 1; i <= s; i++) dots(g, [[12, 2 - i], [12, 2 + i], [12 - i, 2], [12 + i, 2]], y);
    mouth(g, pose, 10, 15, B);
  },
  cat(g, pose){ // MISTRAL：橘猫（Le Chat），身上是渐变条纹
    const bands = ['#FFD800', '#FFAF00', '#FF8205', '#FA500F', '#E10500'], e = '#2A1200', w = '#FFF4E0', p = '#FF7FA0';
    [false, true].forEach(m => { const X = x => m ? mirror(x, 1) : x; dots(g, [[X(5), 3], [X(5), 4], [X(6), 4], [X(5), 5], [X(6), 5], [X(7), 5]], bands[0]); rect(g, X(6), 5, 1, 1, p); });
    for (let y = 6; y <= 15; y++) { const edge = y === 6 || y === 15; rect(g, edge ? 6 : 5, y, edge ? 12 : 14, 1, bands[Math.min(4, Math.floor((y - 6) / 2))]); }
    const ty = pose === 'idle2' ? -1 : 0;
    dots(g, [[4, 16], [3, 16], [2, 15], [1, 14], [1, 13 + ty], [1, 12 + ty]], bands[3]);
    rect(g, 7, 16, 2, 1, bands[4]); rect(g, 15, 16, 2, 1, bands[4]);
    [false, true].forEach(m => { rect(g, m ? mirror(2, 2) : 2, 10, 2, 1, w); rect(g, m ? mirror(2, 2) : 2, 12, 2, 1, w); });
    eyePair(g, pose, [[8, 8], [14, 8]], e, 2, 2);
    rect(g, 11, 11, 2, 1, p);
    if (pose === 'atk') rect(g, 11, 12, 2, 2, e);
    else if (pose === 'hurt') mouth(g, pose, 10, 12, e);
    else dots(g, [[9, 12], [10, 13], [11, 12], [12, 12], [13, 13], [14, 12]], e);
  },
  bun(g, pose){ // 豆包：豆沙包
    const w = '#FFF8F0', s = '#EBD9C6', S = '#D2B89C', r = '#E04848', p = '#FF9DB0', e = '#3A2A2A';
    const wide = pose === 'idle2';
    blob(g, 12, 12, wide ? 9.5 : 9, wide ? 5.5 : 6, (x, y, v) => y > 16 ? null : y === 16 ? S : (v > .8 && y > 12 ? s : w));
    dots(g, [[9, 8], [10, 7], [14, 7], [15, 8]], s);
    rect(g, 11, 7, 2, 1, r); rect(g, 11, 6, 2, 1, wide ? s : r);
    rect(g, 6, 13, 2, 1, p); rect(g, 16, 13, 2, 1, p);
    eyePair(g, pose, [[8, 10], [14, 10]], e, 2, 2);
    mouth(g, pose, 10, 13, e);
    if (pose === 'atk') dots(g, [[7, 3], [8, 2], [8, 4], [16, 3], [17, 2], [17, 4]], '#D8D8E0'); // 冒热气
    if (pose === 'hurt') rect(g, 17, 11, 1, 2, '#7FC8FF');
  },
  qwen(g, pose){ // 千问：问号精灵（六边形宝石 + 问号天线）
    const p = '#615CED', P = '#4A44C8', l = '#8F8BF7', q = '#FFD54A', w = '#FFFFFF';
    for (let y = 6; y <= 17; y++) { const hw = Math.min(8, 4 + (y - 6) * 2, 4 + (17 - y) * 2); for (let x = 12 - hw; x < 12 + hw; x++) rect(g, x, y, 1, 1, y < 9 && x < 12 ? l : y > 14 ? P : p); }
    const dy = pose === 'idle2' ? 1 : 0;
    dots(g, [[10, 1], [11, 0], [12, 0], [13, 1], [13, 2], [12, 3], [11, 4], [11, 5]].map(([x, y]) => [x, y + dy]), q);
    eyePair(g, pose, [[8, 9], [14, 9]], w, 2, 3);
    mouth(g, pose, 10, 13, w);
  },
  moon(g, pose){ // KIMI：登月小月亮 + 绕飞的小火箭
    const m = '#EDE9D8', M = '#CFC9B0', e = '#1B1B2A', bl = '#1783FF', wh = '#FFFFFF', r = '#FF5D73';
    blob(g, 11, 11, 7.5, 7.5, (x, y, v) => v > .75 && x + y > 22 ? M : m);
    dots(g, [[6, 7], [7, 7], [15, 15], [14, 15], [5, 13]], M);
    eyePair(g, pose, [[8, 9], [13, 9]], e, 2, 2);
    mouth(g, pose, 9, 13, e);
    const [rx, ry] = pose === 'idle2' ? [19, 2] : [20, 3];
    rect(g, rx, ry, 2, 1, r); rect(g, rx, ry + 1, 2, 3, wh); rect(g, rx, ry + 2, 1, 1, bl);
    rect(g, rx, ry + 4, 2, pose === 'atk' ? 3 : 1, bl);
  },
  ingot(g, pose){ // 元宝：金元宝
    const G = '#F5C542', L = '#FFE58A', S = '#C9971F', D = '#9C6F12', e = '#5A3A00';
    blob(g, 12, 9, 5.5, 4.5, (x, y) => y > 10 ? null : x < 11 && y < 8 ? L : G);
    rect(g, 1, 8, 3, 4, G); rect(g, 20, 8, 3, 4, G); rect(g, 1, 8, 3, 1, L); rect(g, 20, 8, 3, 1, L);
    [11, 11, 10, 9, 7, 5].forEach((hw, i) => { const y = 11 + i; for (let x = 12 - hw; x < 12 + hw; x++) rect(g, x, y, 1, 1, y === 11 ? L : y >= 15 ? D : y === 14 ? S : G); });
    eyePair(g, pose, [[8, 12], [14, 12]], e, 2, 2);
    mouth(g, pose, 10, 14, e);
    if (pose !== 'idle') dots(g, [[19, 3], [18, 4], [20, 4], [19, 5], [19, 4]], '#FFFFFF');
  },
  prism(g, pose){ // 智谱 GLM：光谱棱镜（智谱 ≈ 光谱）
    const gl = '#BFD7FF', L = '#E8F1FF', edge = '#5F7FD0', e = '#1C2A5A', rb = ['#FF5D5D', '#FF9F43', '#FFE066', '#5BE37D', '#4DA3FF', '#9B6BFF'];
    rect(g, 0, 11, 5, 1, '#FFFFFF');
    for (let y = 2; y <= 16; y++) {
      const hw = (y - 2) * .62, x0 = Math.ceil(11.5 - hw), x1 = Math.floor(11.5 + hw);
      for (let x = x0; x <= x1; x++) rect(g, x, y, 1, 1, x === x0 || x === x1 || y === 16 ? edge : x < 11 && y < 11 ? L : gl);
    }
    const len = pose === 'atk' ? 8 : 5;
    rb.forEach((c, i) => { const y = 8 + i, x = Math.floor(11.5 + (y - 2) * .62) + 1 + (pose === 'idle2' && i % 2 ? 1 : 0); rect(g, x, y, Math.min(len, MW - x), 1, c); });
    eyePair(g, pose, [[9, 10], [13, 10]], e, 2, 2);
    mouth(g, pose, 10, 13, e);
  },
  conch(g, pose){ // MINIMAX：小海螺（海螺 AI）
    const a = '#FF8FA3', b = '#FF5C7A', c = '#D93A5A', face = '#FFE3D6', e = '#3A0A1A';
    blob(g, 11, 11, 8, 7.5, (x, y, v) => { const dx = x - 11, dy = y - 11; const t = Math.atan2(dy, dx) / (2 * Math.PI) + Math.hypot(dx, dy) / 5 + (pose === 'idle2' ? .25 : 0); return v > .85 ? c : Math.floor(t * 2) % 2 ? a : b; });
    dots(g, [[16, 4], [17, 3], [18, 2], [17, 4], [16, 5]], c);
    blob(g, 9.5, 13, 4.2, 3, () => face);
    eyePair(g, pose, [[7, 12], [11, 12]], e, 1, 2);
    mouth(g, pose, 8, 14, e);
  },
});
// 全部角色（网页原型、桌面版共用）。id 与引擎里的选手编号一致，kind 是精灵画法
const ROSTER = [
  {id:'claude', kind:'crab',  name:'CLAUDE',   zh:'小螃蟹',     maker:'Anthropic',        color:'#f0896a', region:'intl', idea:'橙色方块身体、竖条眼、一对大钳子；待机钳子开合，攻击时夹紧。'},
  {id:'codex', kind:'bot',   name:'CODEX',    zh:'终端机器人', maker:'OpenAI',           color:'#3ddc84', region:'intl', idea:'CRT 显示器脑袋，屏幕上的 >_ 就是脸；攻击变 >>!，受击变 x x。'},
  {id:'gemini', kind:'star',  name:'GEMINI',   zh:'双子星',     maker:'Google',           color:'#a78bfa', region:'intl', idea:'蓝紫粉渐变四角星，旁边绕着一颗小星星；攻击时四个尖角发光。'},
  {id:'grok', kind:'grok',  name:'GROK',     zh:'黑洞小怪',   maker:'xAI',              color:'#e8e8e8', region:'intl', idea:'黑洞身体 + 旋转的吸积盘，挂着一脸坏笑；攻击时眼睛变红。'},
  {id:'muse', kind:'muse',  name:'MUSE',     zh:'眼镜精灵',   maker:'Meta',             color:'#4d94ff', region:'intl', idea:'无限符号 ∞ 变成一副眼镜（致敬 Meta 眼镜），头顶一颗 spark 闪烁。'},
  {id:'mistral', kind:'cat',   name:'MISTRAL',  zh:'橘猫',       maker:'Mistral AI',       color:'#ff8a1f', region:'intl', idea:'Le Chat 就是"猫"：黄到红的渐变条纹橘猫，尾巴会摇。'},
  {id:'deepseek', kind:'whale', name:'DEEPSEEK', zh:'小鲸鱼',     maker:'深度求索',         color:'#7d95ff', region:'cn',   idea:'蓝色小鲸鱼，头顶喷水；攻击时水花炸开。'},
  {id:'doubao', kind:'bun',   name:'DOUBAO',   zh:'豆沙包',     maker:'字节跳动 · 豆包',  color:'#ffb3c1', region:'cn',   idea:'白白胖胖的豆沙包，顶上一点红豆沙，会一鼓一鼓地呼吸；生气时冒热气。'},
  {id:'qwen', kind:'qwen',  name:'QWEN',     zh:'问号精灵',   maker:'阿里 · 千问',      color:'#8f8bf7', region:'cn',   idea:'"千问"：紫色六边形宝石，头顶一根问号天线。'},
  {id:'kimi', kind:'moon',  name:'KIMI',     zh:'登月小月亮', maker:'月之暗面',         color:'#e9e4cc', region:'cn',   idea:'"Moonshot"：一颗小月亮，一枚小火箭绕着它飞，攻击时火焰变长。'},
  {id:'yuanbao', kind:'ingot', name:'YUANBAO',  zh:'金元宝',     maker:'腾讯 · 元宝',      color:'#f5c542', region:'cn',   idea:'金灿灿的元宝，两头翘起，旁边一闪一闪。'},
  {id:'glm', kind:'prism', name:'GLM',      zh:'光谱棱镜',   maker:'智谱',             color:'#8fb4ff', region:'cn',   idea:'"智谱 ≈ 光谱"：白光射进棱镜，分成彩虹射向对手。'},
  {id:'minimax', kind:'conch', name:'MINIMAX',  zh:'小海螺',     maker:'MiniMax · 海螺',   color:'#ff7a93', region:'cn',   idea:'致敬"海螺 AI"：粉色螺旋小海螺，花纹会转。'},
];
/* ---------- 自定义形象（数据格式见 docs/mascots.md） ---------- */
// 用户自己画的形象是 24×20 的像素表：palette 把字符映射成颜色（"." 是透明），poses 是四个姿势的 20 行字符串。
// id 和自带角色相同就覆盖它的形象（名字、颜色等没写的沿用自带的），不同就是新角色。
const POSES = ['idle', 'idle2', 'atk', 'hurt'];
function registerMascot(m){
  const kind = 'custom:' + m.id;
  MASCOTS[kind] = (g, pose) => {
    (m.poses[pose] || m.poses.idle).forEach((row, y) => { for (let x = 0; x < MW; x++) { const c = m.palette[row[x]]; if (c) rect(g, x, y, 1, 1, c); } });
  };
  const own = Object.fromEntries(['name', 'zh', 'maker', 'color', 'idea'].filter(k => m[k]).map(k => [k, m[k]]));
  const i = ROSTER.findIndex(r => r.id === m.id);
  if (i >= 0) ROSTER[i] = { ...ROSTER[i], ...own, kind, custom: true };
  else ROSTER.push({ id: m.id, name: m.id.toUpperCase(), zh: '', maker: '', color: '#c9c2e8', region: 'custom', idea: '', ...own, kind, custom: true });
}
// 用户加了新 AI 但还没画形象：先用一只同色的小史莱姆顶上
function registerFighter(f){
  if (ROSTER.some(r => r.id === f.id)) return;
  const color = f.color || '#9be37d', dark = '#00000055', e = '#1B1220';
  const kind = 'slime:' + f.id;
  MASCOTS[kind] = (g, pose) => {
    const squash = pose === 'idle2' ? 1 : 0;
    blob(g, 12, 12 + squash, 9, 7 - squash, (x, y) => (y > 15 ? dark : color));
    blob(g, 8, 8 + squash, 2, 1.5, () => '#ffffff66');
    eyePair(g, pose, [[8, 10 + squash], [14, 10 + squash]], e, 2, 3);
    mouth(g, pose, 10, 15, e);
  };
  ROSTER.push({ id: f.id, kind, name: f.name || f.id.toUpperCase(), zh: '', maker: f.maker || '自定义', color, region: 'custom', idea: '还没有专属形象（crux mascot new 画一个）' });
}
// 桌面版预加载时把用户的形象和新选手放在 window.cruxCustom 里
if (typeof window !== 'undefined' && window.cruxCustom) {
  (window.cruxCustom.mascots || []).forEach(registerMascot);
  (window.cruxCustom.fighters || []).forEach(registerFighter);
}

function drawPose(c, kind, pose){ const g = c.getContext('2d'); g.clearRect(0, 0, MW, MH); (MASCOTS[kind] || MASCOTS.crab)(g, pose || 'idle'); }
function mascot(kind, pose, scale){
  const c = document.createElement('canvas'); c.width = MW; c.height = MH;
  drawPose(c, kind, pose);
  c.style.width = MW * scale + 'px'; c.style.height = MH * scale + 'px';
  return c;
}
