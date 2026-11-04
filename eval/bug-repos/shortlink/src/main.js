import http from 'node:http';
import { config } from './config.js';
import { createApp } from './server.js';

if (!config.secret) {
  console.error('需要设置环境变量 TOKEN_SECRET');
  process.exit(1);
}

http.createServer(createApp()).listen(config.port, () => {
  console.log(`shortlink listening on :${config.port}`);
});
