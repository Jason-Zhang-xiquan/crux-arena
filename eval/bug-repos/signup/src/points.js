import { config } from './config.js';
import { HttpError } from './errors.js';

/** 签到加分 */
export async function checkIn(store, user) {
  const name = typeof user === 'string' ? user.trim() : '';
  if (!name) throw new HttpError(400, '需要签到人');
  await store.addPoints(name, config.checkInPoints);
  return { user: name, points: await store.getPoints(name) };
}

/** 一组用户的总积分 */
export async function totalPoints(store, users) {
  let total = 0;
  users.forEach(async u => {
    total += await store.getPoints(u);
  });
  return total;
}

/** 最高的 n 个积分（并列只算一次），从高到低 */
export async function topScores(store, n = 3) {
  const scores = [...new Set((await store.allPoints()).map(r => r.points))];
  return scores.sort().reverse().slice(0, n);
}
