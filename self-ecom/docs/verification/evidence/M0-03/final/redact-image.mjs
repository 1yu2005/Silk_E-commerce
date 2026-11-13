// 作用：对已完成验收的Swagger长截图统一遮盖代码区，保留接口、输入、状态码与图片；不修改测试结果。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve('apps/api/package.json')); const sharp = require('sharp');
const file = 'output/playwright/M0-03-final/docker-attempt2/swagger-files.png'; const original = await readFile(file);
const { data, info } = await sharp(original).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const rows = [];
for (let y = 100; y < info.height; y++) {
  let dark = 0;
  for (let x = 35; x < info.width - 35; x++) { const i = (y * info.width + x) * info.channels;
    if (data[i] <= 75 && data[i + 1] <= 75 && data[i + 2] <= 75) dark++;
  }
  if (dark > info.width * 0.45) rows.push(y);
}
const bands = [];
for (const y of rows) { const last = bands.at(-1); if (last && y - last.end <= 16) last.end = y; else bands.push({ start: y, end: y }); }
assert.ok(bands.length >= 4);
const svg = `<svg width="${info.width}" height="${info.height}">${bands.map(({ start, end }) => `<rect x="35" y="${start - 2}" width="${info.width - 70}" height="${end - start + 5}" fill="#30343b"/>`).join('')}</svg>`;
const redacted = await sharp(original).composite([{ input: Buffer.from(svg) }]).png().toBuffer(); await writeFile(file, redacted);
const result = { timestamp: new Date().toISOString(), file, codeRegionsHidden: bands.length,
  originalSha256: createHash('sha256').update(original).digest('hex'), redactedSha256: createHash('sha256').update(redacted).digest('hex'),
  reason: 'Swagger长截图异步排版导致坐标遮罩错位；统一遮盖代码区域，真实状态码及JSON证据保留' };
await writeFile('docs/verification/evidence/M0-03/final/screenshot-redaction.json', JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result));
