/** 文件作用：在独立临时目录验证生成稳定性和漂移失败，不改仓库契约或已有生成文件。 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url)); const directory = await mkdtemp(path.join(tmpdir(), 'self-ecom-contract-drift-'));
const generate = (check = false) => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/generate-api-client.mjs'), `--schema=${path.join(directory, 'openapi.json')}`,
    `--output=${path.join(directory, 'generated')}`, ...(check ? ['--check'] : [])], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error; return result;
};
try {
  const spec = JSON.parse(await readFile(path.join(root, 'docs/openapi/openapi.json'), 'utf8'));
  await writeFile(path.join(directory, 'openapi.json'), JSON.stringify(spec));
  assert.equal(generate().status, 0); assert.equal(generate(true).status, 0);
  const typeFile = path.join(directory, 'generated/schema.ts'); const clientFile = path.join(directory, 'generated/client.ts');
  const before = await Promise.all([readFile(typeFile, 'utf8'), readFile(clientFile, 'utf8')]);
  assert.equal(generate().status, 0);
  assert.deepEqual(await Promise.all([readFile(typeFile, 'utf8'), readFile(clientFile, 'utf8')]), before);
  // 模拟DTO字段变更：旧生成结果必须失败，--check不得自动修复文件。
  spec.paths['/api/v1/store/me/avatar'].put.requestBody.content['application/json'].schema.properties.materialVersion = { type: 'integer' };
  await writeFile(path.join(directory, 'openapi.json'), JSON.stringify(spec));
  assert.equal(generate(true).status, 1); assert.equal(await readFile(typeFile, 'utf8'), before[0]);
  assert.equal(generate().status, 0); assert.equal(generate(true).status, 0);
  await writeFile(clientFile, (await readFile(clientFile, 'utf8')) + '\n// 模拟旧调用器\n');
  assert.equal(generate(true).status, 1);
  console.log(JSON.stringify({ stableRegeneration: true, schemaDriftRejected: true, callerDriftRejected: true, checkDoesNotRewrite: true }));
} finally {
  const target = path.resolve(directory);
  assert.ok(target.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(target).startsWith('self-ecom-contract-drift-'));
  await rm(target, { recursive: true, force: true });
}
