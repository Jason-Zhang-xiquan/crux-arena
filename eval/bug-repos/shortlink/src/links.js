import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import { HttpError } from './errors.js';

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // 32 个字符，去掉了容易看错的 l、o、0、1

export function newCode(len = config.codeLength) {
  let s = '';
  for (const b of randomBytes(len)) s += ALPHABET[b % ALPHABET.length];
  return s;
}

/** 只接受 http / https，返回规范化后的网址 */
export function normalizeTarget(raw) {
  let u;
  try {
    u = new URL(String(raw ?? ''));
  } catch {
    throw new HttpError(400, '不是合法的网址');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new HttpError(400, '只支持 http / https 网址');
  return u.toString();
}

/** 创建短链：不给 code 就随机生成，给了就用自定义短码 */
export function createLink(store, { owner, target, code }) {
  const url = normalizeTarget(target);
  if (code !== undefined && (typeof code !== 'string' || !/^[a-z0-9-]{3,32}$/.test(code))) throw new HttpError(400, '自定义短码只能用 3–32 位小写字母、数字和 -');
  let c = code;
  if (c === undefined) {
    do c = newCode(); while (store.get(c));
  }
  const link = { code: c, owner, target: url, hits: 0, createdAt: Date.now() };
  store.put(c, link);
  return link;
}

/** 分页列出某个用户的短链，新的在前；page 从 1 开始 */
export function listLinks(store, owner, page = 1) {
  const mine = store.all().filter(l => l.owner === owner).sort((a, b) => b.createdAt - a.createdAt);
  const size = config.pageSize;
  const start = (page - 1) * size;
  return { page, total: mine.length, pages: Math.ceil(mine.length / size), items: mine.slice(start, size) };
}

/** 跳转：返回目标网址并记一次点击 */
export function resolveLink(store, code) {
  const link = store.get(code);
  if (!link) throw new HttpError(404, '短链不存在');
  link.hits++;
  return link.target;
}
