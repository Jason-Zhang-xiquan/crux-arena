import { verifyToken } from './auth.js';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { createLink, listLinks, resolveLink } from './links.js';
import { clientKey, createLimiter } from './ratelimit.js';
import { createStore } from './store.js';

const MAX_BODY = 10 * 1024;

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, '请求体太大');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, '请求体不是 JSON');
  }
}

function requireUser(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  const user = m && verifyToken(m[1]);
  if (!user) throw new HttpError(401, '需要登录');
  return user;
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function createApp({ store = createStore(), limiter = createLimiter(config.rateLimit) } = {}) {
  setInterval(() => limiter.sweep(), config.rateLimit.windowMs).unref();

  return async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const one = /^\/api\/links\/([a-z0-9-]+)$/.exec(url.pathname);

      if (req.method === 'POST' && url.pathname === '/api/links') {
        const user = requireUser(req);
        if (!limiter.check(clientKey(req))) throw new HttpError(429, '请求太频繁，稍后再试');
        const body = await readJson(req);
        return send(res, 201, createLink(store, { owner: user.sub, target: body.target, code: body.code }));
      }

      if (req.method === 'GET' && url.pathname === '/api/links') {
        const user = requireUser(req);
        const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
        return send(res, 200, listLinks(store, user.sub, page));
      }

      if (req.method === 'DELETE' && one) {
        requireUser(req);
        if (!store.get(one[1])) throw new HttpError(404, '短链不存在');
        store.delete(one[1]);
        return send(res, 200, { deleted: one[1] });
      }

      const code = /^\/([a-z0-9-]+)$/.exec(url.pathname);
      if (req.method === 'GET' && code) {
        res.writeHead(302, { location: resolveLink(store, code[1]) });
        return res.end();
      }

      throw new HttpError(404, '没有这个接口');
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error(err);
      return send(res, 500, { error: '服务器内部错误' });
    }
  };
}
