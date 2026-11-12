// 文件作用：检查本轮维护文档的本地链接及新增验收锚点，不改写历史证据或产物。
import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const documents = ['README.md', '项目文档/开发进度总览.md', 'docs/design/M0-02.md', 'docs/verification/M0-02.md'];
const results = [];
for (const file of documents) {
  const contents = await readFile(file, 'utf8'); const links = [...contents.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)];
  for (const [, value] of links) {
    if (/^(?:https?:|mailto:|#)/.test(value)) continue;
    const target = value.split('#')[0].replace(/^<|>$/g, '');
    await access(path.resolve(path.dirname(file), decodeURIComponent(target)));
  }
  results.push({ file, checkedLocalLinks: links.filter(([, value]) => !/^(?:https?:|mailto:|#)/.test(value)).length });
}
assert.match(await readFile('docs/verification/M0-02.md', 'utf8'), /id="module2-final-acceptance"/);
const result = { status: 'passed', results };
await writeFile('output/playwright/final-acceptance/document-links.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
