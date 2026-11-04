import { config } from './config.js';
import { HttpError } from './errors.js';
import { mustGet } from './events.js';

/** 去掉已经过期的候补 */
export function removeExpired(waitlist, now) {
  for (let i = waitlist.length - 1; i >= 0; i--) {
    if (waitlist[i].until <= now) waitlist.splice(i, 1);
  }
}

/** 报名：有空位就确认，满员就进候补名单（保留 waitlistHoldMs） */
export async function signup(store, eventId, user, now = Date.now()) {
  const name = user == null ? '' : String(user).trim();
  if (!name) throw new HttpError(400, '需要报名人');
  const ev = await mustGet(store, eventId);
  const list = await store.listSignups(eventId);
  if (list.includes(name)) throw new HttpError(409, '已经报过名了');

  if (list.length >= ev.capacity) {
    removeExpired(ev.waitlist, now);
    if (!ev.waitlist.some(w => w.user === name)) ev.waitlist.push({ user: name, until: now + config.waitlistHoldMs });
    await store.putEvent(ev);
    return { status: 'waitlist', position: ev.waitlist.findIndex(w => w.user === name) + 1 };
  }

  await store.addSignup(eventId, name);
  return { status: 'confirmed', seat: list.length + 1 };
}
