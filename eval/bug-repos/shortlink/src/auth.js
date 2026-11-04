import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

const sign = body => createHmac('sha256', config.secret).update(body).digest('base64url');

/** 签发令牌：<payload 的 base64url>.<HMAC 签名>；payload.exp 是过期时刻（毫秒时间戳） */
export function issueToken(userId, role = 'user') {
  const payload = { sub: userId, role, exp: Date.now() + config.tokenTtlSeconds };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

/** 校验令牌：签名不对、格式不对、已过期都返回 null */
export function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
  if (payload.exp < Date.now()) return null;
  return payload;
}
