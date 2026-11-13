// 作用：核对合并步骤9的授权改动，保护全部既有未提交文件、真实配置、迁移、旧证据和Git状态。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const directory = 'docs/verification/evidence/M0-04/step09'; const label = process.argv[2] ?? 'final'; assert.match(label, /^[a-z0-9-]+$/);
const destination = `${directory}/protection-${label}.json`; assert.ok(!existsSync(destination), '不能覆盖保护证据');
const baseline = JSON.parse(readFileSync(`${directory}/baseline.json`, 'utf8'));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const authorized = new Set(['apps/api/src/tasks/task-business-adapters.ts', 'apps/api/src/tasks/task-entry.service.ts',
  'apps/api/src/tasks/task-deadline-events.service.ts', 'apps/api/src/tasks/task.errors.ts', 'apps/api/src/tasks/tasks.module.ts',
  'apps/api/src/audit/audit.service.ts', 'docs/design/M0-04.md', 'docs/verification/M0-04.md']);
const protectedFiles = baseline.files.map(row => ({ path: row.path, unchanged: existsSync(row.path) && hash(row.path) === row.sha256, authorizedChange: authorized.has(row.path) }));
assert.ok(protectedFiles.every(row => row.unchanged || row.authorizedChange), '出现范围外既有文件变化');
function git(args) { const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { encoding: 'utf8', windowsHide: true }); assert.equal(result.status, 0); return result.stdout.trim(); }
assert.equal(git(['rev-parse', 'HEAD']), baseline.head); assert.equal(git(['branch', '--show-current']), baseline.branch);
assert.equal(git(['diff', '--cached', '--name-only']), baseline.staged); git(['diff', '--check']);
const oldPaths = new Set(baseline.files.map(row => row.path));
const newPaths = git(['ls-files', '--others', '--exclude-standard', '--', '.']).split(/\r?\n/).filter(path => path && !oldPaths.has(path));
const sources = ['task-lifecycle.service.ts', 'task-source.contract.ts', 'task-source.service.ts', 'task-overdue-scan.service.ts', 'task-scheduler.service.ts', 'order-timer.rules.ts', 'order-timer.service.ts'].map(name => 'apps/api/src/tasks/' + name);
const tests = ['apps/api/test/task-kernel.spec.ts', 'apps/api/test/order-timer.spec.ts', 'apps/api/test/task-kernel.integration.ts', 'apps/api/test/fixtures/task-kernel-business.ts'];
assert.ok(newPaths.every(path => path.startsWith(directory + '/') || [...sources, ...tests].includes(path)), '出现范围外新增文件');
for (const path of newPaths.filter(path => /\.(ts|mjs|md)$/.test(path))) assert.ok(readFileSync(path, 'utf8').split(/\r?\n/).every(line => !/[\t ]+$/.test(line)), `行尾空白：${path}`);
const contractShaUnchanged = hash('docs/openapi/openapi.json') === baseline.files.find(row => row.path === 'docs/openapi/openapi.json').sha256;
assert.ok(contractShaUnchanged);
const report = { checkedAt: new Date().toISOString(), headUnchanged: true, branchUnchanged: true, stagedUnchanged: true, diffCheckPassed: true,
  contractShaUnchanged, operations: 40, protectedFiles, newPaths, sourceSha256: [...authorized, ...sources, ...tests].map(path => ({ path, sha256: hash(path) })) };
writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ baselineFiles: protectedFiles.length, unchanged: protectedFiles.filter(row => row.unchanged).length,
  authorizedChanges: protectedFiles.filter(row => !row.unchanged).map(row => row.path), newFiles: newPaths.length,
  headUnchanged: true, branchUnchanged: true, stagedUnchanged: true, diffCheckPassed: true, contractShaUnchanged }));
