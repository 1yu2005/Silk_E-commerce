// 作用：保护步骤6既有源码、证据、真实配置与已应用迁移，并对比旧32个OpenAPI操作逐项未变。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const directory = 'docs/verification/evidence/M0-04/step06'; const label = process.argv[2] ?? 'final'; assert.match(label, /^[a-z0-9-]+$/);
const destination = `${directory}/protection-${label}.json`; assert.ok(!existsSync(destination), '不得覆盖保护记录');
const baseline = JSON.parse(readFileSync(`${directory}/baseline.json`, 'utf8')); const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const authorized = new Set(['apps/api/src/tasks/task-business-adapters.ts', 'apps/api/src/tasks/task-entry.service.ts', 'apps/api/src/tasks/task.errors.ts',
  'apps/api/src/tasks/tasks.module.ts', 'apps/api/src/auth/auth-transaction.ts', 'apps/api/src/audit/audit.service.ts', 'apps/api/test/swagger.spec.ts',
  'docs/openapi/openapi.json', 'packages/api-client/src/generated/schema.ts', 'packages/api-client/src/generated/client.ts', 'docs/design/M0-04.md', 'docs/verification/M0-04.md']);
const protectedFiles = baseline.files.map(row => ({ path: row.path, unchanged: hash(row.path) === row.sha256, authorizedChange: authorized.has(row.path) }));
assert.ok(protectedFiles.every(row => row.unchanged || row.authorizedChange), '出现范围外既有文件变化');
function git(args) { const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { encoding: 'utf8', windowsHide: true }); assert.equal(result.status, 0); return result.stdout.trim(); }
assert.equal(git(['rev-parse', 'HEAD']), baseline.head); assert.equal(git(['branch', '--show-current']), baseline.branch); assert.equal(git(['diff', '--cached', '--name-only']), baseline.staged); git(['diff', '--check']);
const oldPaths = new Set(baseline.files.map(row => row.path)); const newPaths = git(['ls-files', '--others', '--exclude-standard', '--', '.']).split(/\r?\n/).filter(path => path && !oldPaths.has(path));
assert.ok(newPaths.every(path => path.startsWith(directory + '/') || path.startsWith('apps/api/src/tasks/') || ['apps/api/test/task-access.spec.ts',
  'apps/api/test/task-access.integration.ts', 'apps/api/test/fixtures/task-access-business.ts', 'packages/api-client/test/tasks-client.test.mjs', 'packages/api-client/test/tasks-types.ts'].includes(path)), '出现范围外新增文件');
for (const path of newPaths.filter(path => /\.(ts|mjs|md)$/.test(path))) assert.ok(readFileSync(path, 'utf8').split(/\r?\n/).every(line => !/[\t ]+$/.test(line)), `新文件行尾空白：${path}`);
// 移除精确新增路径后，整个文档必须与步骤6基线SHA相同，不能仅靠当前契约推测旧操作未变。
const spec = JSON.parse(readFileSync('docs/openapi/openapi.json', 'utf8')); const previous = structuredClone(spec);
for (const path of ['/api/v1/admin/tasks', '/api/v1/admin/tasks/summary', '/api/v1/admin/tasks/{id}',
  '/api/v1/admin/tasks/{id}/history', '/api/v1/admin/tasks/{id}/claim', '/api/v1/admin/tasks/{id}/release']) delete previous.paths[path];
assert.equal(createHash('sha256').update(JSON.stringify(previous, null, 2) + '\n').digest('hex'), baseline.files.find(row => row.path === 'docs/openapi/openapi.json').sha256);
let oldOperations = 0;
for (const [path, item] of Object.entries(previous.paths)) for (const method of ['get', 'post', 'put', 'patch', 'delete']) if (item[method]) {
  assert.deepEqual(spec.paths[path]?.[method], item[method]); oldOperations++;
}
assert.equal(oldOperations, 32);
const report = { checkedAt: new Date().toISOString(), headUnchanged: true, branchUnchanged: true, stagedUnchanged: true, diffCheckPassed: true,
  oldOperationsUnchanged: oldOperations, protectedFiles, newPaths, sourceSha256: [...authorized, ...newPaths].filter(path => /\.(ts|mjs|json)$/.test(path)).map(path => ({ path, sha256: hash(path) })) };
writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ baselineFiles: protectedFiles.length, unchanged: protectedFiles.filter(row => row.unchanged).length,
  authorizedChanges: protectedFiles.filter(row => !row.unchanged).map(row => row.path), newFiles: newPaths.length, oldOperationsUnchanged: oldOperations,
  headUnchanged: true, branchUnchanged: true, stagedUnchanged: true, diffCheckPassed: true }));
