// 资源文件（吉祥物脚本、skill、模板）的位置：在仓库里直接用源文件；打包后（npm 包、桌面安装包）用旁边的 assets 目录。
import { existsSync } from 'node:fs';
import path from 'node:path';

/** rel 是相对仓库根目录的路径，如 'packages/sprites/mascots.js'、'integrations/claude-code' */
export function assetPath(...rel: string[]): string {
  const bundled = path.join(import.meta.dirname, 'assets', ...rel);
  const repo = path.resolve(import.meta.dirname, '..', '..', '..', ...rel);
  return existsSync(bundled) ? bundled : repo;
}

export const DOCS_URL = 'https://github.com/Jason-Zhang-xiquan/crux-arena/blob/main/docs';
/** 文档：仓库里有就给本地路径，否则给 GitHub 链接 */
export const docPath = (name: string) => {
  const local = path.resolve(import.meta.dirname, '..', '..', '..', 'docs', name);
  return existsSync(local) ? local : `${DOCS_URL}/${name}`;
};
