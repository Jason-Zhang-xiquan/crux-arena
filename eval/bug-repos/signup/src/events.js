import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { HttpError } from './errors.js';

const DEFAULTS = { capacity: config.defaultCapacity, tags: [], waitlist: [] };
const TAG = /^[\w-]{1,20}$/;

/** 创建活动：没给的字段用默认值 */
export async function createEvent(store, input) {
  const title = typeof input?.title === 'string' ? input.title.trim() : '';
  if (!title) throw new HttpError(400, '活动需要标题');
  const capacity = input.capacity ?? DEFAULTS.capacity;
  if (!Number.isInteger(capacity) || capacity < 1) throw new HttpError(400, '容量必须是正整数');
  const ev = { ...DEFAULTS, id: randomUUID().slice(0, 8), title, capacity, createdAt: Date.now() };
  if (Array.isArray(input.tags)) ev.tags = input.tags.filter(t => typeof t === 'string' && TAG.test(t));
  await store.putEvent(ev);
  return ev;
}

export async function mustGet(store, id) {
  const ev = await store.getEvent(id);
  if (!ev) throw new HttpError(404, '活动不存在');
  return ev;
}

/** 给活动加一个标签（已有就不重复加），返回全部标签 */
export async function addTag(store, id, tag) {
  if (typeof tag !== 'string' || !TAG.test(tag)) throw new HttpError(400, '标签只能是 1–20 位字母、数字、下划线或 -');
  const ev = await mustGet(store, id);
  if (!ev.tags.includes(tag)) ev.tags.push(tag);
  await store.putEvent(ev);
  return ev.tags;
}
