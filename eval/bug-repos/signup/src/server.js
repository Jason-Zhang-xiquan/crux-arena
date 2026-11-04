import { HttpError } from './errors.js';
import { addTag, createEvent } from './events.js';
import { exportAttendees, readExport } from './export.js';
import { checkIn, topScores, totalPoints } from './points.js';
import { signup } from './signup.js';
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
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, '请求体不是 JSON');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, '请求体必须是 JSON 对象');
  return body;
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function createApp({ store = createStore() } = {}) {
  return async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const ev = /^\/events\/([0-9a-f]{8})\/(tags|signup|export)$/.exec(url.pathname);

      if (req.method === 'POST' && url.pathname === '/events') return send(res, 201, await createEvent(store, await readJson(req)));
      if (req.method === 'POST' && ev?.[2] === 'tags') return send(res, 200, { tags: await addTag(store, ev[1], (await readJson(req)).tag) });
      if (req.method === 'POST' && ev?.[2] === 'signup') return send(res, 200, await signup(store, ev[1], (await readJson(req)).user));
      if (req.method === 'POST' && ev?.[2] === 'export') return send(res, 200, { file: await exportAttendees(store, ev[1], (await readJson(req)).name) });
      if (req.method === 'GET' && ev?.[2] === 'export') {
        const csv = await readExport(ev[1]);
        if (csv === null) throw new HttpError(404, '还没有导出过');
        res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8' });
        return res.end(csv);
      }
      if (req.method === 'POST' && url.pathname === '/checkin') return send(res, 200, await checkIn(store, (await readJson(req)).user));
      if (req.method === 'GET' && url.pathname === '/points') {
        const users = (url.searchParams.get('users') ?? '').split(',').map(s => s.trim()).filter(Boolean);
        return send(res, 200, { users, total: await totalPoints(store, users) });
      }
      if (req.method === 'GET' && url.pathname === '/leaderboard') return send(res, 200, { top: await topScores(store) });

      throw new HttpError(404, '没有这个接口');
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error(err);
      return send(res, 500, { error: '服务器内部错误' });
    }
  };
}
