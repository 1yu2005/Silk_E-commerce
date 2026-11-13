// 作用：保护步骤7的既有文件与Git状态，核对契约只有授权的转交、动作提示和员工回池说明变化。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const directory = 'docs/verification/evidence/M0-04/step07'; const label = process.argv[2] ?? 'final'; assert.match(label, /^[a-z0-9-]+$/);
const destination = `${directory}/protection-${label}.json`; assert.ok(!existsSync(destination), '不得覆盖保护记录');
const baseline = JSON.parse(readFileSync(`${directory}/baseline.json`, 'utf8')); const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const authorized = new Set(['apps/api/src/tasks/task-business-adapters.ts', 'apps/api/src/tasks/task-command.service.ts',
  'apps/api/src/tasks/task-access.service.ts', 'apps/api/src/tasks/task-lock.service.ts', 'apps/api/src/tasks/task.errors.ts',
  'apps/api/src/tasks/task.dto.ts', 'apps/api/src/tasks/tasks.module.ts', 'apps/api/src/tasks/tasks.controller.ts', 'apps/api/src/tasks/tasks.openapi.ts',
  'apps/api/src/employees/employee-eligibility.service.ts', 'apps/api/src/employees/employee-eligibility.module.ts',
  ...['status', 'role', 'extra-permission'].flatMap(name => [`apps/api/src/employees/employee-${name}.service.ts`,
    `apps/api/src/employees/employee-${name}.controller.ts`, `apps/api/test/employee-${name}.integration.ts`]),
  'apps/api/src/audit/audit.service.ts', 'apps/api/test/task-access.spec.ts', 'apps/api/test/task-access.integration.ts', 'apps/api/test/swagger.spec.ts',
  'docs/openapi/openapi.json', 'packages/api-client/src/generated/schema.ts', 'packages/api-client/src/generated/client.ts',
  'packages/api-client/test/tasks-client.test.mjs', 'packages/api-client/test/tasks-types.ts', 'docs/design/M0-04.md', 'docs/verification/M0-04.md']);
const protectedFiles = baseline.files.map(row => ({ path: row.path, unchanged: hash(row.path) === row.sha256, authorizedChange: authorized.has(row.path) }));
assert.ok(protectedFiles.every(row => row.unchanged || row.authorizedChange), '出现范围外既有文件变化');
function git(args) { const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { encoding: 'utf8', windowsHide: true }); assert.equal(result.status, 0); return result.stdout.trim(); }
assert.equal(git(['rev-parse', 'HEAD']), baseline.head); assert.equal(git(['branch', '--show-current']), baseline.branch);
assert.equal(git(['diff', '--cached', '--name-only']), baseline.staged); git(['diff', '--check']);
const oldPaths = new Set(baseline.files.map(row => row.path));
const newPaths = git(['ls-files', '--others', '--exclude-standard', '--', '.']).split(/\r?\n/).filter(path => path && !oldPaths.has(path));
assert.ok(newPaths.every(path => path.startsWith(directory + '/') || ['apps/api/src/tasks/task-eligibility.service.ts',
  'apps/api/test/task-reassign.integration.ts', 'apps/api/test/fixtures/task-reassign-business.ts'].includes(path)), '出现范围外新增文件');
for (const path of newPaths.filter(path => /\.(ts|mjs|md)$/.test(path))) {
  assert.ok(readFileSync(path, 'utf8').split(/\r?\n/).every(line => !/[\t ]+$/.test(line)), `新文件行尾空白：${path}`);
}
// 将明确授权的契约增量还原后比对整个旧文档SHA；不从操作数量推断其它字段未改。
const spec = JSON.parse(readFileSync('docs/openapi/openapi.json', 'utf8')); const previous = structuredClone(spec);
delete previous.paths['/api/v1/admin/tasks/{id}/transfer'];
function removeAction(value) {
  if (!value || typeof value !== 'object') return;
  if (value.properties?.allowedActions?.items?.enum) value.properties.allowedActions.items.enum = value.properties.allowedActions.items.enum.filter(item => item !== 'transfer');
  for (const nested of Object.values(value)) removeAction(nested);
}
removeAction(previous);
previous.paths['/api/v1/admin/tasks/{id}'].get.description = previous.paths['/api/v1/admin/tasks/{id}'].get.description.replace('尚未实现的延期不显示', '尚未实现的转交/延期不显示');
const suffix = ' 员工写入前合并全部失资格任务的完整业务锁；任务回池、领域经办同步、历史及审计与员工变更同事务，失败整体回滚。锁集合变化整笔最多重试3次。';
const employeeCommands = ['/api/v1/admin/employees/{id}/disable', '/api/v1/admin/employees/{id}/enable',
  '/api/v1/admin/employees/{id}/change-role', '/api/v1/admin/employees/{id}/extra-permissions'];
for (const path of employeeCommands) {
  const operation = previous.paths[path][path.endsWith('extra-permissions') ? 'put' : 'post'];
  operation.description = operation.description.replace(suffix, '');
  const codes = operation.responses['409'].content['application/json'].schema.properties.code.enum;
  operation.responses['409'].content['application/json'].schema.properties.code.enum = codes.filter(code => !['TASK_LOCK_PLAN_CHANGED', 'BUSINESS_MODULE_NOT_READY', 'TASK_VERSION_EXHAUSTED'].includes(code));
}
const restoredSha = createHash('sha256').update(JSON.stringify(previous, null, 2) + '\n').digest('hex');
assert.equal(restoredSha, baseline.files.find(row => row.path === 'docs/openapi/openapi.json').sha256);
const report = { checkedAt: new Date().toISOString(), headUnchanged: true, branchUnchanged: true, stagedUnchanged: true, diffCheckPassed: true,
  previousContractRestoredShaMatches: true, oldOperations: 38, currentOperations: 39, protectedFiles, newPaths,
  sourceSha256: [...authorized, ...newPaths].filter(path => /\.(ts|mjs|json)$/.test(path)).map(path => ({ path, sha256: hash(path) })) };
writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ baselineFiles: protectedFiles.length, unchanged: protectedFiles.filter(row => row.unchanged).length,
  authorizedChanges: protectedFiles.filter(row => !row.unchanged).map(row => row.path), newFiles: newPaths.length,
  previousContractRestoredShaMatches: true, headUnchanged: true, branchUnchanged: true, stagedUnchanged: true, diffCheckPassed: true }));
