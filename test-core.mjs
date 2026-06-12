// 扩展核心引擎测试 — 用 jsdom 模拟浏览器 DOM，实测 core 提取能力
// 不需要启动 Chrome，纯 Node 运行
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';
import { scrape } from '@media-scraper/core';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const html = readFileSync(resolve(__dirname, 'test-page.html'), 'utf-8');
const dom = new JSDOM(html, { url: 'https://example.com/' });
const doc = dom.window.document;

// 构建 DocumentLike 适配器
function wrapElement(el) {
  return {
    tagName: el.tagName,
    getAttribute(name) { return el.getAttribute(name); },
    querySelectorAll(sel) {
      const nodes = el.querySelectorAll(sel);
      return Array.from(nodes).map(wrapElement);
    },
    querySelector(sel) {
      const node = el.querySelector(sel);
      return node ? wrapElement(node) : null;
    },
    textContent: el.textContent,
  };
}

const documentLike = {
  querySelectorAll(sel) {
    return Array.from(doc.querySelectorAll(sel)).map(wrapElement);
  },
  querySelector(sel) {
    const el = doc.querySelector(sel);
    return el ? wrapElement(el) : null;
  },
  title: doc.title,
  head: doc.head ? wrapElement(doc.head) : null,
  body: doc.body ? wrapElement(doc.body) : null,
};

console.log('=== Media Scraper Core 引擎测试 ===');
console.log(`测试页面: test-page.html`);
console.log(`页面标题: "${doc.title}"`);
console.log();

// 运行刮取
const result = await scrape(documentLike, 'https://example.com/');

console.log('📊 刮取结果:');
console.log(`  总资源数: ${result.total}`);
console.log(`  图片: ${result.images.length}`);
console.log(`  视频: ${result.videos.length}`);
console.log(`  音频: ${result.audio.length}`);
console.log(`  文档: ${result.documents.length}`);
console.log(`  耗时: ${result.duration}ms`);
console.log();

// 按来源分类统计
const bySource = {};
for (const r of [...result.images, ...result.videos, ...result.audio, ...result.documents]) {
  bySource[r.source] = (bySource[r.source] || 0) + 1;
}
console.log('📂 按来源分类:');
for (const [src, count] of Object.entries(bySource)) {
  console.log(`  ${src}: ${count}`);
}
console.log();

// 列出所有图片
console.log('🖼️ 图片列表:');
for (const img of result.images.slice(0, 15)) {
  console.log(`  [${img.source}] ${img.filename}  (${img.extension})  ← ${img.url.substring(0, 80)}`);
}
if (result.images.length > 15) console.log(`  ... 还有 ${result.images.length - 15} 张`);

console.log();
console.log('🎬 视频列表:');
for (const v of result.videos) {
  console.log(`  [${v.source}] ${v.filename}  (${v.extension})  ${v.thumbnail ? '✓有缩略图' : ''}`);
}

console.log();
console.log('🎵 音频列表:');
for (const a of result.audio) {
  console.log(`  [${a.source}] ${a.filename}`);
}

console.log();
console.log('📄 文档列表:');
for (const d of result.documents) {
  console.log(`  [${d.source}] ${d.filename}`);
}

// 验证
console.log();
console.log('=== 验证 ===');
const checks = [
  { name: 'og:image 元数据提取', pass: result.images.some(i => i.source === 'head-meta' && i.url.includes('picsum')) },
  { name: '标准 img 提取', pass: result.images.some(i => i.source === 'img') },
  { name: 'lazy-load data-src 提取', pass: result.images.some(i => i.source === 'lazy-load') },
  { name: 'video 元素提取', pass: result.videos.some(v => v.source === 'video') },
  { name: 'YouTube iframe 识别', pass: result.videos.some(v => v.source === 'iframe' && v.url.includes('youtube')) },
  { name: 'audio 提取', pass: result.audio.length > 0 },
  { name: '文档链接提取', pass: result.documents.length > 0 },
  { name: 'CSS background-image', pass: result.images.some(i => i.source === 'background') },
  { name: '去重有效', pass: new Set(result.images.map(i => i.url)).size === result.images.length },
];

let passCount = 0;
for (const c of checks) {
  console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}`);
  if (c.pass) passCount++;
}
console.log(`\n${passCount}/${checks.length} 项通过`);
