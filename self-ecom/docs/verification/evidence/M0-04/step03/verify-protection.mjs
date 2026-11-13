// 作用：核对步骤3授权文件、旧证据和已应用迁移；确认原27个接口未改变，不自动提交代码。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const directory = 'docs/verification/evidence/M0-04/step03';
const baseline = JSON.parse(readFileSync(`${directory}/baseline.json`, 'utf8'));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const authorized = new Set(['apps/api/src/app.module.ts', 'apps/api/src/audit/audit.service.ts',
  'apps/api/src/common/http/api-exception.filter.ts', 'apps/api/test/swagger.spec.ts', 'packages/api-client/src/auth-client.ts',
  'packages/api-client/src/generated/schema.ts', 'packages/api-client/src/generated/client.ts',
  'packages/api-client/test/generated-types.ts', 'docs/openapi/openapi.json', 'scripts/generate-api-client.mjs',
  'docs/design/M0-04.md', 'docs/verification/M0-04.md']);
const protectedFiles = baseline.files.map(row => ({ path: row.path, unchanged: hash(row.path) === row.sha256,
  authorizedChange: authorized.has(row.path) }));
assert.ok(protectedFiles.every(row => row.unchanged || row.authorizedChange), '有授权范围外的文件变化');
function git(args) {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0); return result.stdout.trim();
}
assert.equal(git(['rev-parse', 'HEAD']), baseline.head); assert.equal(git(['diff', '--cached', '--name-only']), baseline.staged);
git(['diff', '--check']);
const original = JSON.parse(git(['show', 'HEAD:self-ecom/docs/openapi/openapi.json']));
const current = JSON.parse(readFileSync('docs/openapi/openapi.json', 'utf8'));
for (const [path, item] of Object.entries(original.paths)) for (const [method, operation] of Object.entries(item))
  assert.deepEqual(current.paths[path][method], operation, `原接口变化：${method} ${path}`);
const newOperations = [];
for (const [path, item] of Object.entries(current.paths)) for (const [method, operation] of Object.entries(item))
  if (!original.paths[path]?.[method]) newOperations.push({ path, method, operationId: operation.operationId });
assert.equal(newOperations.length, 5);
const newPaths = git(['ls-files', '--others', '--exclude-standard', '--', '.']).split(/\r?\n/).filter(Boolean);
const originalPaths = new Set(baseline.files.map(row => row.path));
const newAllowed = path => path.startsWith('apps/api/src/settings/') || path === 'apps/api/test/settings.integration.ts'
  || path === 'apps/api/test/settings-audit.spec.ts' || path === 'packages/api-client/test/settings-client.test.mjs' || path.startsWith(directory + '/');
assert.ok(newPaths.every(path => originalPaths.has(path) || newAllowed(path)), '出现本步计划外的新文件');
const textFiles = newPaths.filter(path => newAllowed(path) && /\.(ts|mjs|md)$/.test(path));
assert.ok(textFiles.every(path => readFileSync(path, 'utf8').split(/\r?\n/).every(line => !/[\t ]+$/.test(line))));
const sources = [...authorized].filter(path => /\.(ts|mjs)$/.test(path)).concat(textFiles.filter(path => /\.(ts|mjs)$/.test(path)));
const report = { checkedAt: new Date().toISOString(), headUnchanged: true, stagedUnchanged: true, diffCheckPassed: true,
  protectedFiles, originalOperationsUnchanged: 27, newOperations, sourceSha256: [...new Set(sources)].map(path => ({ path, sha256: hash(path) })),
  status: git(['status', '--short', '--untracked-files=all']) };
writeFileSync(`${directory}/protection.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ baselineFiles: protectedFiles.length, unchanged: protectedFiles.filter(row => row.unchanged).length,
  authorizedChanges: protectedFiles.filter(row => !row.unchanged).map(row => row.path), originalOperationsUnchanged: 27, newOperations,
  headUnchanged: true, stagedUnchanged: true, diffCheckPassed: true }));
