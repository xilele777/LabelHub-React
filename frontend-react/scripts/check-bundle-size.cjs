/**
 * Bundle Size 预算检查 — CI 门禁（React 版）。
 *
 * 与 Vue 版脚本（根 scripts/check-bundle-size.cjs 的 chunk 名前缀匹配）不同，
 * 这里直接解析 dist/index.html 的 entry <script> 与 <link rel="modulepreload">，
 * 度量口径与简历优化文档的「入口预加载 JS」完全一致。
 *
 * 基线对照（2026-07-27 实测）：
 * - Vue 版入口预加载：entry + vue + request 共 3 chunk，raw 306 kB / gzip 111 kB
 * - React 版入口预加载：entry + react + request + state 共 4 chunk，raw ~449 kB / gzip ~153 kB
 *   差额全部来自 react-dom + react-router 对 vue + vue-router + pinia 的框架固有体积差
 *   （react chunk 286 kB vs vue chunk 108 kB）；entry 本身 116 kB 反低于 Vue 版 153 kB，
 *   组件库（antd/echarts/dnd-kit）已全部排除出入口预加载链。
 *
 * 阈值（gzip 后大小，防回归线）：
 * - 入口预加载 JS 总 gzip < 160 kB
 * - 单 chunk gzip < 200 kB
 */
const { readdirSync, readFileSync } = require('fs');
const { join, resolve } = require('path');
const { gzipSync } = require('zlib');

const DIST_DIR = resolve(__dirname, '..', 'dist');
const JS_DIR = join(DIST_DIR, 'assets');

const BUDGET = {
  entryPreloadGzipMax: 160 * 1024,
  singleChunkGzipMax: 200 * 1024,
};

// ─── 从 index.html 解析入口预加载 JS 集合（entry module + modulepreload） ───
const html = readFileSync(join(DIST_DIR, 'index.html'), 'utf8');
const entryFiles = [];
for (const match of html.matchAll(
  /<(?:script[^>]+type="module"[^>]+src|link[^>]+rel="modulepreload"[^>]+href)="([^"]+\.js)"/g,
)) {
  entryFiles.push(match[1].replace(/^\//, ''));
}

if (entryFiles.length === 0) {
  console.error('未从 dist/index.html 解析到任何入口 JS，检查构建产物');
  process.exit(1);
}

function measure(filePath) {
  const buf = readFileSync(filePath);
  return { raw: buf.length, gzip: gzipSync(buf).length };
}

const kb = (bytes) => (bytes / 1024).toFixed(1);

// ─── 入口预加载预算 ───
let entryRaw = 0;
let entryGzip = 0;
console.log('Bundle Size Report (React)');
console.log('─'.repeat(60));
console.log(`Entry preload JS (${entryFiles.length} files, entry + modulepreload):`);
for (const file of entryFiles) {
  const { raw, gzip } = measure(join(DIST_DIR, file));
  entryRaw += raw;
  entryGzip += gzip;
  console.log(`  ${file}: ${kb(raw)} kB (gzip ${kb(gzip)} kB)`);
}
console.log(
  `  -> Total: ${kb(entryRaw)} kB raw / ${kb(entryGzip)} kB gzip` +
    ` (budget: ${kb(BUDGET.entryPreloadGzipMax)} kB gzip; Vue 基线 306 kB raw / 111 kB gzip)`,
);

// ─── 单 chunk 预算（全部 JS 产物） ───
const chunks = readdirSync(JS_DIR)
  .filter((f) => f.endsWith('.js'))
  .map((file) => ({ file, ...measure(join(JS_DIR, file)) }))
  .sort((a, b) => b.gzip - a.gzip);
const maxChunk = chunks[0];
console.log('');
console.log(
  `Largest chunk: ${maxChunk.file} — ${kb(maxChunk.gzip)} kB gzip` +
    ` (budget: ${kb(BUDGET.singleChunkGzipMax)} kB)`,
);

let failed = false;
if (entryGzip > BUDGET.entryPreloadGzipMax) {
  console.error(
    `\nENTRY PRELOAD BUDGET EXCEEDED: ${kb(entryGzip)} kB > ${kb(BUDGET.entryPreloadGzipMax)} kB`,
  );
  failed = true;
}
if (maxChunk.gzip > BUDGET.singleChunkGzipMax) {
  console.error(
    `\nSINGLE CHUNK BUDGET EXCEEDED: ${maxChunk.file} ${kb(maxChunk.gzip)} kB > ${kb(BUDGET.singleChunkGzipMax)} kB`,
  );
  failed = true;
}

if (!failed) {
  console.log('\nBundle size within budget');
} else {
  process.exit(1);
}
