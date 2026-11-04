import { issueToken } from '../src/auth.js';
import { config } from '../src/config.js';

const [user, role] = process.argv.slice(2);
if (!user || !config.secret) {
  console.error('用法：TOKEN_SECRET=… node scripts/issue-token.js <用户名> [user|admin]');
  process.exit(1);
}
console.log(issueToken(user, role === 'admin' ? 'admin' : 'user'));
