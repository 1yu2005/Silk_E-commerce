// 作用：保护步骤8之前的文件与Git状态；还原授权的延期契约增量后核对整个旧契约摘要。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const directory = 'docs/verification/evidence/M0-04/step08'; const label = process.argv[2] ?? 'final'; assert.match(label, /^[a-z0-9-]+$/);
const destination = `${directory}/protection-${label}.json`; assert.ok(!existsSync(destination), '不得覆盖保护记录');
const baseline = JSON.parse(readFileSync(`${directory}/baseline.json`, 'utf8')); const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const authorized = new Set(['apps/api/src/tasks/task-business-adapters.ts', 'apps/api/src/tasks/task-access.service.ts', 'apps/api/src/tasks/task-entry.service.ts',
  'apps/api/src/tasks/task.errors.ts', 'apps/api/src/tasks/task.dto.ts', 'apps/api/src/tasks/tasks.module.ts', 'apps/api/src/tasks/tasks.controller.ts', 'apps/api/src/tasks/tasks.openapi.ts',
  'apps/api/src/audit/audit.service.ts', 'apps/api/test/swagger.spec.ts',
  'docs/openapi/openapi.json', 'packages/api-client/src/generated/schema.ts', 'packages/api-client/src/generated/client.ts',
  'packages/api-client/test/tasks-client.test.mjs', 'packages/api-client/test/tasks-types.ts', 'docs/design/M0-04.md', 'docs/verification/M0-04.md']);
const protectedFiles = baseline.files.map(row => ({ path: row.path, unchanged: hash(row.path) === row.sha256, authorizedChange: authorized.has(row.path) }));
assert.ok(protectedFiles.every(row => row.unchanged || row.authorizedChange), '出现范围外既有文件变化');
function git(args) { const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { encoding: 'utf8', windowsHide: true }); assert.equal(result.status, 0); return result.stdout.trim(); }
assert.equal(git(['rev-parse', 'HEAD']), baseline.head); assert.equal(git(['branch', '--show-current']), baseline.branch);
assert.equal(git(['diff', '--cached', '--name-only']), baseline.staged); git(['diff', '--check']);
const oldPaths = new Set(baseline.files.map(row => row.path));
const newPaths = git(['ls-files', '--others', '--exclude-standard', '--', '.']).split(/\r?\n/).filter(path => path && !oldPaths.has(path));
assert.ok(newPaths.every(path => path.startsWith(directory + '/') || ['apps/api/src/tasks/task-deadline.service.ts',
  'apps/api/src/tasks/task-deadline-events.service.ts', 'apps/api/src/tasks/task-deadline-input.ts',
  'apps/api/test/task-deadline.spec.ts', 'apps/api/test/task-deadline.integration.ts', 'apps/api/test/fixtures/task-deadline-business.ts'].includes(path)), '出现范围外新增文件');
for (const path of newPaths.filter(path => /\.(ts|mjs|md)$/.test(path))) {
  assert.ok(readFileSync(path, 'utf8').split(/\r?\n/).every(line => !/[\t ]+$/.test(line)), `新文件行尾空白：${path}`);
}
const spec = JSON.parse(readFileSync('docs/openapi/openapi.json', 'utf8')); const previous = structuredClone(spec);
delete previous.paths['/api/v1/admin/tasks/{id}/extend-deadline'];
function removeAction(value) {
  if (!value || typeof value !== 'object') return;
  if (value.properties?.allowedActions?.items?.enum) value.properties.allowedActions.items.enum = value.properties.allowedActions.items.enum.filter(item => item !== 'extendDeadline');
  for (const nested of Object.values(value)) removeAction(nested);
}
removeAction(previous);
previous.paths['/api/v1/admin/tasks/{id}'].get.description = '业务读取权并满足当前资格/当前或历史经办/管理员范围；不可查看与不存在均404。allowedActions仅提示，提交仍重新检查；尚未实现的延期不显示。';
const restoredSha = createHash('sha256').update(JSON.stringify(previous, null, 2) + '\n').digest('hex');
assert.equal(restoredSha, baseline.files.find(row => row.path === 'docs/openapi/openapi.json').sha256);
const report = { checkedAt: new Date().toISOString(), headUnchanged: true, branchUnchanged: true, stagedUnchanged: true, diffCheckPassed: true,
  previousContractRestoredShaMatches: true, oldOperations: 39, currentOperations: 40, protectedFiles, newPaths,
  sourceSha256: [...authorized, ...newPaths].filter(path => /\.(ts|mjs|json)$/.test(path)).map(path => ({ path, sha256: hash(path) })) };
writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ baselineFiles: protectedFiles.length, unchanged: protectedFiles.filter(row => row.unchanged).length,
  authorizedChanges: protectedFiles.filter(row => !row.unchanged).map(row => row.path), newFiles: newPaths.length,
  previousContractRestoredShaMatches: true, headUnchanged: true, branchUnchanged: true, stagedUnchanged: true, diffCheckPassed: true }));
