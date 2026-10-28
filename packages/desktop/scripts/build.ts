// 打包前的构建：把主进程（含引擎、只读工具、zod 等依赖）打成一个 main.mjs，
// 连同预加载脚本、页面和吉祥物精灵放进 app/，再交给 electron-builder 生成安装包。
import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crabPng } from '../src/icon.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const app = path.join(root, 'app');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

await rm(app, { recursive: true, force: true });
await mkdir(path.join(app, 'renderer'), { recursive: true });

await build({
  entryPoints: [path.join(src, 'main.ts')],
  outfile: path.join(app, 'main.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['electron'],
  // 打进来的 CommonJS 依赖可能用到 require
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'warning',
});

await cp(path.join(src, 'preload.cjs'), path.join(app, 'preload.cjs'));
for (const f of await readdir(path.join(src, 'renderer'))) {
  const from = path.join(src, 'renderer', f), to = path.join(app, 'renderer', f);
  if (f.endsWith('.html')) await writeFile(to, (await readFile(from, 'utf8')).replace('../../../sprites/mascots.js', 'mascots.js'));
  else await cp(from, to);
}
await cp(path.join(root, '..', 'sprites', 'mascots.js'), path.join(app, 'renderer', 'mascots.js'));

await writeFile(path.join(app, 'package.json'), JSON.stringify({
  name: 'crux-arena', productName: 'Crux Arena', version: pkg.version, description: pkg.description,
  author: pkg.author, license: 'MIT', type: 'module', main: 'main.mjs',
}, null, 2));

await mkdir(path.join(root, 'build'), { recursive: true });
await writeFile(path.join(root, 'build', 'icon.png'), crabPng(16));   // 256×256 应用图标

console.log(`已构建到 ${app}`);
