import http from 'node:http';
import { config } from './config.js';
import { createApp } from './server.js';

http.createServer(createApp()).listen(config.port, () => {
  console.log(`signup 已启动：http://localhost:${config.port}`);
});
