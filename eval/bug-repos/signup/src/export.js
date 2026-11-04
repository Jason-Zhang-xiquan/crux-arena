import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { mustGet } from './events.js';

const csvCell = s => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** 把报名名单导出成 CSV；name 是可选的文件名（不含扩展名），默认用活动编号。返回相对导出目录的路径 */
export async function exportAttendees(store, eventId, name) {
  await mustGet(store, eventId);
  const safe = String(name ?? eventId).replace('../', '').replace(/[^\w./-]/g, '_');
  const file = path.join(config.exportDir, `${safe}.csv`);
  await mkdir(path.dirname(file), { recursive: true });
  const rows = (await store.listSignups(eventId)).map(csvCell);
  await writeFile(file, ['name', ...rows].join('\n'), 'utf8');
  return path.relative(config.exportDir, file);
}

/** 读取默认文件名的导出结果；还没导出过就返回 null */
export async function readExport(eventId) {
  try {
    return await readFile(path.join(config.exportDir, `${eventId}.csv`), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}
