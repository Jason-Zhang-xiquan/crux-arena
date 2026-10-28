// 吉祥物工具（Node 端）：把自带的程序化形象导出成可编辑的像素表、校验用户画的形象、渲染预览 PNG。
// 形象数据格式见 docs/mascots.md；文件放在 数据目录/mascots/<id>.json，桌面版启动时加载。
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { encodePng, parseHex } from './png.ts';
import { dataDir } from './settings.ts';

export const MW = 24, MH = 20;
export const POSES = ['idle', 'idle2', 'atk', 'hurt'] as const;
export type Pose = typeof POSES[number];

export interface MascotData {
  id: string;
  name?: string;
  zh?: string;
  maker?: string;
  color?: string;                    // 名字、弹道、论点卡边框用的主题色
  idea?: string;                     // 一句话设计说明
  palette: Record<string, string | null>;   // 字符 → 颜色（#RRGGBB 或 #RRGGBBAA）；"." 固定是透明
  poses: Partial<Record<Pose, string[]>>;    // 每个姿势 20 行，每行 24 个字符；只有 idle 必填，其余缺省时沿用 idle
}

export const mascotsDir = () => path.join(dataDir(), 'mascots');

interface SpriteLib {
  MASCOTS: Record<string, (g: unknown, pose: string) => void>;
  ROSTER: Array<{ id: string; kind: string; name: string; zh: string; maker: string; color: string; idea: string }>;
}

/** 在 Node 里加载浏览器用的 mascots.js（它只用到 fillStyle / fillRect / clearRect） */
let lib: SpriteLib | undefined;
async function spriteLib(): Promise<SpriteLib> {
  if (lib) return lib;
  const file = path.resolve(import.meta.dirname, '..', '..', 'sprites', 'mascots.js');
  const code = await readFile(file, 'utf8');
  lib = vm.runInNewContext(`${code}\n;({ MASCOTS, ROSTER })`, {}, { filename: file }) as SpriteLib;
  return lib;
}

/** 画一个姿势，得到 24×20 的颜色表（undefined 是透明） */
function rasterize(draw: (g: unknown, pose: string) => void, pose: string): Array<Array<string | undefined>> {
  const grid: Array<Array<string | undefined>> = Array.from({ length: MH }, () => Array(MW).fill(undefined));
  const fill = (x: number, y: number, w: number, h: number, c: string | undefined) => {
    for (let j = Math.max(0, Math.floor(y)); j < Math.min(MH, Math.floor(y + h)); j++)
      for (let i = Math.max(0, Math.floor(x)); i < Math.min(MW, Math.floor(x + w)); i++) grid[j][i] = c;
  };
  const g = { fillStyle: '#000000', fillRect(x: number, y: number, w: number, h: number) { fill(x, y, w, h, String(this.fillStyle)); }, clearRect(x: number, y: number, w: number, h: number) { fill(x, y, w, h, undefined); } };
  draw(g, pose);
  return grid;
}

const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#@$%&*+=?!~^';

/** 自带角色 → 可编辑的像素表（用户改完放进 mascots 目录，同 id 就覆盖自带形象） */
export async function exportBuiltin(id: string): Promise<MascotData> {
  const { MASCOTS, ROSTER } = await spriteLib();
  const r = ROSTER.find(x => x.id === id);
  if (!r) throw new Error(`没有自带角色 ${id}。自带的有：${ROSTER.map(x => x.id).join('、')}`);
  const grids = Object.fromEntries(POSES.map(p => [p, rasterize(MASCOTS[r.kind], p)])) as Record<Pose, Array<Array<string | undefined>>>;
  // 按出现次数给颜色分配字符，常用色用小写字母
  const count = new Map<string, number>();
  for (const g of Object.values(grids)) for (const row of g) for (const c of row) if (c) count.set(c.toUpperCase(), (count.get(c.toUpperCase()) ?? 0) + 1);
  const colors = [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)!);
  if (colors.length > CHARS.length) throw new Error(`${id} 用了 ${colors.length} 种颜色，超过可用字符数`);
  const charOf = new Map(colors.map((c, i) => [c, CHARS[i]]));
  return {
    id: r.id, name: r.name, zh: r.zh, maker: r.maker, color: r.color, idea: r.idea,
    palette: { '.': null, ...Object.fromEntries(colors.map(c => [charOf.get(c)!, c])) },
    poses: Object.fromEntries(POSES.map(p => [p, grids[p].map(row => row.map(c => (c ? charOf.get(c.toUpperCase())! : '.')).join(''))])),
  };
}

export async function builtinIds(): Promise<string[]> { return (await spriteLib()).ROSTER.map(r => r.id); }

const shade = (c: string, k: number) => {
  const [r, g, b] = parseHex(c) ?? [155, 227, 125, 255];
  return '#' + [r, g, b].map(v => Math.round(v * k).toString(16).padStart(2, '0')).join('');
};

/** 新角色的空白模板：一只单色小团子，方便在上面改 */
export function blankMascot(id: string, name = id.toUpperCase(), color = '#9be37d'): MascotData {
  const rows = (eyes: string, mouth: string) => Array.from({ length: MH }, (_, y) => Array.from({ length: MW }, (_, x) => {
    const v = ((x - 11.5) / 9) ** 2 + ((y - 11.5) / 7.5) ** 2;
    if (v > 1) return '.';
    if (y === 10 && (x === 8 || x === 15) || y === 11 && (x === 8 || x === 15) && eyes === 'tall') return 'e';
    if (y === 14 && mouth.includes(String(x - 10))) return 'e';
    return y > 16 ? 'b' : 'a';
  }).join(''));
  return {
    id, name, zh: '', maker: '', color, idea: '',
    palette: { '.': null, a: color, b: shade(color, 0.7), e: '#1b1220' },
    poses: { idle: rows('tall', '0123'), idle2: rows('short', '0123'), atk: rows('tall', '12'), hurt: rows('short', '03') },
  };
}

/** 写文件用的格式：每行像素单独一行，方便直接在编辑器里对着改 */
export const formatMascot = (m: MascotData) => JSON.stringify(m, null, 2) + '\n';

/** 校验：返回问题列表（空 = 合格） */
export function checkMascot(m: unknown): string[] {
  const e: string[] = [];
  const o = m as Partial<MascotData>;
  if (!o || typeof o !== 'object') return ['不是 JSON 对象'];
  if (typeof o.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(o.id)) e.push('id 必须是小写字母、数字或短横线，最长 32 个字符（和选手编号一致）');
  if (o.color !== undefined && !parseHex(String(o.color))) e.push(`color 不是合法颜色：${o.color}`);
  if (!o.palette || typeof o.palette !== 'object') e.push('缺少 palette');
  else for (const [k, v] of Object.entries(o.palette)) {
    if ([...k].length !== 1) e.push(`palette 的键必须是单个字符：${k}`);
    if (k === '.' && v !== null) e.push('"." 固定表示透明，值必须是 null');
    if (k !== '.' && (typeof v !== 'string' || !parseHex(v))) e.push(`palette.${k} 不是合法颜色：${v}`);
  }
  if (!o.poses || typeof o.poses !== 'object' || !o.poses.idle) e.push('poses.idle 必填');
  else for (const [pose, rows] of Object.entries(o.poses)) {
    if (!(POSES as readonly string[]).includes(pose)) { e.push(`未知姿势 ${pose}（只有 ${POSES.join(' / ')}）`); continue; }
    if (!Array.isArray(rows) || rows.length !== MH) { e.push(`${pose} 必须正好 ${MH} 行`); continue; }
    rows.forEach((row, y) => {
      if (typeof row !== 'string' || [...row].length !== MW) e.push(`${pose} 第 ${y + 1} 行必须正好 ${MW} 个字符（现在 ${typeof row === 'string' ? [...row].length : '不是字符串'}）`);
      else for (const ch of row) if (o.palette && !(ch in o.palette)) { e.push(`${pose} 第 ${y + 1} 行用了 palette 里没有的字符 "${ch}"`); break; }
    });
  }
  return e;
}

/** 读用户目录里的全部形象；不合格的跳过并报告 */
export async function loadUserMascots(dir = mascotsDir()): Promise<{ mascots: MascotData[]; errors: string[] }> {
  const mascots: MascotData[] = [], errors: string[] = [];
  let files: string[] = [];
  try { files = (await readdir(dir)).filter(f => f.endsWith('.json')); } catch { return { mascots, errors }; }
  for (const f of files.sort()) {
    try {
      const m = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
      const problems = checkMascot(m);
      if (problems.length) errors.push(`${f}：${problems[0]}${problems.length > 1 ? ` 等 ${problems.length} 处` : ''}`);
      else mascots.push(m);
    } catch (err) { errors.push(`${f}：${(err as Error).message}`); }
  }
  return { mascots, errors };
}

/** 预览图：四个姿势横排，左边是原图大小、右边按 scale 放大；深色底方便看清 */
export function previewPng(m: MascotData, scale = 8): Buffer {
  const pad = scale * 2, cell = MW * scale;
  const W = pad + POSES.length * (cell + pad), H = MH * scale + pad * 2;
  const px = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { const y = Math.floor(i / W); px.set(y % (scale * 2) < scale ? [0x1a, 0x12, 0x33, 255] : [0x22, 0x18, 0x3f, 255], i * 4); }
  POSES.forEach((pose, k) => {
    const rows = m.poses[pose] ?? m.poses.idle!;
    const ox = pad + k * (cell + pad);
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      const c = m.palette[ch];
      const rgba = c ? parseHex(c) : undefined;
      if (!rgba) return;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const i = ((pad + y * scale + dy) * W + ox + x * scale + dx) * 4;
        const a = rgba[3] / 255;
        px[i] = Math.round(rgba[0] * a + px[i] * (1 - a)); px[i + 1] = Math.round(rgba[1] * a + px[i + 1] * (1 - a)); px[i + 2] = Math.round(rgba[2] * a + px[i + 2] * (1 - a));
      }
    }));
  });
  return encodePng(W, H, px);
}
