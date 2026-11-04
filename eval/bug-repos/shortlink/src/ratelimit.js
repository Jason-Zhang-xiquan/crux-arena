/** 固定窗口限流：每个客户端在每个窗口内最多 max 次 */
export function createLimiter({ windowMs, max }) {
  const hits = new Map(); // 客户端 → { start, count }
  return {
    check(key, now = Date.now()) {
      let h = hits.get(key);
      if (!h || now - h.start >= windowMs) {
        h = { start: now, count: 0 };
        hits.set(key, h);
      }
      h.count++;
      return h.count <= max;
    },
    /** 清掉已经过了窗口的记录，免得内存一直涨 */
    sweep(now = Date.now()) {
      for (const [key, h] of hits) if (now - h.start >= windowMs) hits.delete(key);
    },
  };
}

/** 客户端标识：放在反向代理后面时取 X-Forwarded-For 里的第一个地址，否则取连接的对端地址 */
export function clientKey(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
}
