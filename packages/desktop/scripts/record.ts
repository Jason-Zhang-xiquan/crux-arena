// 把一场存档的回放录成视频（需要 ffmpeg；FFMPEG 环境变量可以指定路径）。
// 用法：node packages/desktop/scripts/record.ts <存档文件夹> [输出.mp4] [--speed 1]
// 离屏录制：桌面版以 --record 启动，竞技场在后台渲染（不显示窗口），每一帧直接交给 ffmpeg。
// 不截屏，所以录制时照常用电脑也不会录进别的窗口；回放结束、结果卡停留 12 秒后自动收尾。
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const speed = flag('--speed') ?? '1';
const [matchDir, outArg] = args;
if (!matchDir) { console.error('用法：node packages/desktop/scripts/record.ts <存档文件夹> [输出.mp4] [--speed 1]'); process.exit(1); }
const out = path.resolve(outArg ?? path.join(matchDir, 'replay.mp4'));
const electron = createRequire(import.meta.url)('electron') as unknown as string;
const appDir = path.resolve(import.meta.dirname, '..');

const app = spawn(electron, [appDir, '--replay', path.resolve(matchDir), '--speed', speed, '--record', out], { stdio: ['ignore', 'inherit', 'inherit'] });
app.on('exit', code => process.exit(code ?? 1));
