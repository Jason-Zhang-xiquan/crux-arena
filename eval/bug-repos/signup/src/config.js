import path from 'node:path';

export const config = {
  port: Number(process.env.PORT ?? 8080),
  exportDir: path.resolve(process.env.EXPORT_DIR ?? 'exports'),
  defaultCapacity: 50,
  waitlistHoldMs: 10 * 60 * 1000,
  checkInPoints: 10,
};
