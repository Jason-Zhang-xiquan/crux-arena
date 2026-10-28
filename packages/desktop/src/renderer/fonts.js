// 像素字体从 CDN 异步加载：不阻塞页面脚本；离线时自动退回系统字体
for (const href of [
  'https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap',
  'https://cdn.jsdelivr.net/npm/@vp-tw/cjk-web-fonts-fusion-pixel-font@0.0.1/dist/12px/proportional/zh_hans/Fusion-Pixel-12px-Proportional-Simplified-Chinese.css',
]) {
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href;
  document.head.appendChild(l);
}
