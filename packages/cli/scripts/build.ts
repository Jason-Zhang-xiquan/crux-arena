// CLI 打包：把 crux 命令（含引擎、通道、只读工具、zod）打成一个 crux.mjs，连同资源放进 dist/。
// dist/ 本身就是一个可以发布的 npm 包（crux-arena）；桌面安装包也带上它，用 Electron 自带的 Node 运行。
import { build } from 'esbuild';
import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(root, '..', '..');
const dist = path.join(root, 'dist');
const version = JSON.parse(await readFile(path.join(repo, 'packages', 'desktop', 'package.json'), 'utf8')).version as string;

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  entryPoints: [path.join(root, 'src', 'main.ts')],
  outfile: path.join(dist, 'crux.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // 入口文件自带的 #! 行 esbuild 会保留在最前面，banner 里不再加
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'warning',
});
await chmod(path.join(dist, 'crux.mjs'), 0o755);

// 资源：吉祥物脚本（crux mascot 用）、skill 和通道模板（crux setup 用）
const assets = path.join(dist, 'assets');
await cp(path.join(repo, 'packages', 'sprites', 'mascots.js'), path.join(assets, 'packages', 'sprites', 'mascots.js'));
await cp(path.join(repo, 'integrations'), path.join(assets, 'integrations'), { recursive: true });
await cp(path.join(repo, 'LICENSE'), path.join(dist, 'LICENSE'));

await writeFile(path.join(dist, 'package.json'), JSON.stringify({
  name: 'crux-arena',
  version,
  description: 'Let AI models argue it out in a pixel arena, then hand you the champion answer with a traceable battle log.',
  license: 'MIT',
  author: 'Jason Zhang',
  repository: { type: 'git', url: 'git+https://github.com/Jason-Zhang-xiquan/crux-arena.git' },
  homepage: 'https://github.com/Jason-Zhang-xiquan/crux-arena',
  type: 'module',
  bin: { crux: './crux.mjs' },
  files: ['crux.mjs', 'assets', 'README.md', 'LICENSE'],
  engines: { node: '>=20.11' },
  keywords: ['ai', 'llm', 'debate', 'multi-agent', 'claude', 'cursor', 'pixel-art', 'cli'],
}, null, 2) + '\n');

await writeFile(path.join(dist, 'README.md'), `# crux-arena

命令行版 [Crux Arena](https://github.com/Jason-Zhang-xiquan/crux-arena)：让多个 AI 匿名辩论同一个问题，再给你一个可追溯的冠军答案。

\`\`\`bash
npm i -g crux-arena
crux channels                 # 本机能上场哪些选手（需要已登录的 Cursor Agent / Claude Code，或 channels.json 里的自定义通道）
crux fight "这套代码有哪些 bug？" --team claude,codex,gemini,deepseek --dir . --detach
crux result latest --wait
crux setup                    # 安装 Claude Code skill
\`\`\`

完整文档：${'https://github.com/Jason-Zhang-xiquan/crux-arena#readme'}
`);

console.log(`已构建到 ${dist}（crux-arena@${version}）`);
