// 作用：保护步骤5开始前的文件、真实配置和已应用迁移，仅允许本步任务内核、审计及记录变化。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const directory = 'docs/verification/evidence/M0-04/step05';
const label = process.argv[2] ?? 'final'; assert.match(label, /^[a-z0-9-]+$/);
const destination = `${directory}/protection-${label}.json`; assert.ok(!existsSync(destination), '不能覆盖保护报告');
const baseline = JSON.parse(readFileSync(`${directory}/baseline.json`, 'utf8'));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const authorized = new Set(['apps/api/src/app.module.ts', 'apps/api/src/audit/audit.service.ts',
  'apps/api/src/common/http/api-exception.filter.ts', 'docs/design/M0-04.md', 'docs/verification/M0-04.md']);
const protectedFiles = baseline.files.map(row => ({ path: row.path, unchanged: hash(row.path) === row.sha256, authorizedChange: authorized.has(row.path) }));
assert.ok(protectedFiles.every(row => row.unchanged || row.authorizedChange), '出现范围外的既有文件修改');
function git(args) { const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0); return result.stdout.trim(); }
assert.equal(git(['rev-parse', 'HEAD']), baseline.head); assert.equal(git(['diff', '--cached', '--name-only']), baseline.staged); git(['diff', '--check']);
const originalPaths = new Set(baseline.files.map(row => row.path));
const newPaths = git(['ls-files', '--others', '--exclude-standard', '--', '.']).split(/\r?\n/).filter(path => path && !originalPaths.has(path));
const allowed = path => path.startsWith(directory + '/') || path.startsWith('apps/api/src/tasks/')
  || ['apps/api/test/task-stage.spec.ts', 'apps/api/test/task-entry.integration.ts', 'apps/api/test/fixtures/task-entry-business.ts'].includes(path);
assert.ok(newPaths.every(allowed), '出现范围外新增文件');
for (const path of newPaths.filter(path => /\.(ts|mjs|md)$/.test(path))) assert.ok(readFileSync(path, 'utf8').split(/\r?\n/).every(line => !/[\t ]+$/.test(line)), `新文件含行尾空白：${path}`);
const sources = [...authorized, ...newPaths].filter(path => /\.(ts|mjs)$/.test(path));
const report = { checkedAt: new Date().toISOString(), headUnchanged: true, stagedUnchanged: true, diffCheckPassed: true, protectedFiles, newPaths,
  sourceSha256: sources.map(path => ({ path, sha256: hash(path) })), status: git(['status', '--short', '--untracked-files=all']) };
writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ baselineFiles: protectedFiles.length, unchanged: protectedFiles.filter(row => row.unchanged).length,
  authorizedChanges: protectedFiles.filter(row => !row.unchanged).map(row => row.path), newFiles: newPaths.length,
  headUnchanged: true, stagedUnchanged: true, diffCheckPassed: true }));
