// 把一场存档的回放录成视频（Windows，需要 ffmpeg）。
// 用法：node packages/desktop/scripts/record.ts <存档文件夹> [输出.mp4] [--speed 1]
// 桌面版以 --backdrop 启动（深色背景，不会录到桌面上的其他窗口），报出竞技场区域后，ffmpeg 只录那一块；回放结束后自动收尾。
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

const app = spawn(electron, [appDir, '--replay', path.resolve(matchDir), '--speed', speed, '--exit-after-replay', '--backdrop'], { stdio: ['ignore', 'pipe', 'inherit'] });
let ffmpeg: ReturnType<typeof spawn> | undefined;

app.stdout.setEncoding('utf8');
app.stdout.on('data', (chunk: string) => {
  process.stdout.write(chunk);
  const m = chunk.match(/\[record\] region (\d+) (\d+) (\d+) (\d+)/);
  if (!m || ffmpeg) return;
  const [, x, y, w, h] = m;
  ffmpeg = spawn(process.env.FFMPEG ?? 'ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'gdigrab', '-framerate', '30', '-draw_mouse', '0', '-offset_x', x, '-offset_y', y, '-video_size', `${w}x${h}`, '-i', 'desktop',
    '-vf', 'scale=1920:-2:flags=neighbor', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  console.log(`[record] 开始录制 ${w}x${h} → ${out}`);
});

app.on('exit', code => {
  if (!ffmpeg) { console.error(`[record] 桌面版退出（${code}），没有开始录制`); process.exit(1); }
  ffmpeg.stdin?.end('q');   // 让 ffmpeg 正常收尾，写好文件头
  ffmpeg.on('exit', c => { console.log(c === 0 ? `[record] 完成：${out}` : `[record] ffmpeg 退出码 ${c}`); process.exit(c ?? 1); });
});
