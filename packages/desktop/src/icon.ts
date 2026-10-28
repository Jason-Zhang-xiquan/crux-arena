// 托盘图标：直接用代码画一只 16×16 的像素小螃蟹并编码成 PNG，不依赖图片文件。
import { deflateSync } from 'node:zlib';

const CRAB = [
  '................',
  '.hh.hh....hh.hh.',
  '.oo.oo....oo.oo.',
  '.ooooo....ooooo.',
  '..ooo......ooo..',
  '...o..oooo..o...',
  '...oooooooooo...',
  '...ookkookkoo...',
  '...ookkookkoo...',
  '...oooooooooo...',
  '...oooooooooo...',
  '...OOOOOOOOOO...',
  '....O.O..O.O....',
  '....O.O..O.O....',
  '................',
  '................',
];
const PAL: Record<string, [number, number, number]> = { o: [0xd9, 0x77, 0x57], O: [0xb5, 0x57, 0x3a], h: [0xf0, 0xa3, 0x83], k: [0x1b, 0x12, 0x20] };

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** 返回 PNG 二进制；scale 为整数放大倍数（像素不糊） */
export function crabPng(scale = 2): Buffer {
  const size = 16 * scale;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const px = PAL[CRAB[Math.floor(y / scale)][Math.floor(x / scale)]];
      if (px) raw.set([...px, 255], row + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
