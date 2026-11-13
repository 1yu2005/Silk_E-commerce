// 作用：保护步骤10开始前的全部文件、真实配置、生产后端与Git状态，只允许任务页面和隔离验收范围变化。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const directory = 'docs/verification/evidence/M0-04/step10'; const label = process.argv[2] ?? 'final'; assert.match(label, /^[a-z0-9-]+$/);
const destination = `${directory}/protection-${label}.json`; assert.ok(!existsSync(destination), '不能覆盖保护证据');
const baseline = JSON.parse(readFileSync(`${directory}/baseline.json`, 'utf8'));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const authorized = new Set(['apps/admin-web/package.json', 'apps/api/package.json', 'apps/admin-web/src/app/AppLayout.tsx',
  'apps/admin-web/src/app/router.tsx', 'apps/admin-web/src/services/api.ts', 'apps/admin-web/src/styles.css', 'docs/design/M0-04.md', 'docs/verification/M0-04.md']);
const protectedFiles = baseline.files.map(row => ({ path: row.path, unchanged: existsSync(row.path) && hash(row.path) === row.sha256, authorizedChange: authorized.has(row.path) }));
assert.ok(protectedFiles.every(row => row.unchanged || row.authorizedChange), '出现范围外既有文件变化');
function git(args) {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0); return result.stdout.trim();
}
assert.equal(git(['rev-parse', 'HEAD']), baseline.head); assert.equal(git(['branch', '--show-current']), baseline.branch);
assert.equal(git(['diff', '--cached', '--name-only']), baseline.staged); git(['diff', '--check']);
const oldPaths = new Set(baseline.files.map(row => row.path));
const newPaths = git(['ls-files', '--others', '--exclude-standard', '--', '.']).split(/\r?\n/).filter(path => path && !oldPaths.has(path));
const added = new Set(['apps/admin-web/src/pages/TaskListPage.tsx', 'apps/admin-web/src/pages/TaskDetailPage.tsx', 'apps/admin-web/test/tasks.test.mjs',
  'apps/admin-web/test/verify-tasks-browser.mjs', 'apps/admin-web/scripts/tasks-acceptance.mjs', 'apps/api/scripts/task-acceptance.mjs', 'apps/api/tsconfig.acceptance.json']);
const prefixes = ['apps/admin-web/src/tasks/', 'apps/api/test/acceptance/', directory + '/', 'output/playwright/M0-04-step10/'];
assert.ok(newPaths.every(path => added.has(path) || prefixes.some(prefix => path.startsWith(prefix))), '出现范围外新增文件');
for (const path of newPaths.filter(path => /\.(ts|tsx|mjs|md)$/.test(path)))
  assert.ok(readFileSync(path, 'utf8').split(/\r?\n/).every(line => !/[\t ]+$/.test(line)), `行尾空白：${path}`);
const contractShaUnchanged = hash('docs/openapi/openapi.json') === baseline.files.find(row => row.path === 'docs/openapi/openapi.json').sha256;
assert.ok(contractShaUnchanged);
const sourcePaths = [...new Set([...authorized, ...newPaths.filter(path => /\.(ts|tsx|mjs|json|md)$/.test(path) && !path.startsWith(directory + '/') && !path.startsWith('output/'))])];
writeFileSync(destination, JSON.stringify({ checkedAt: new Date().toISOString(), headUnchanged: true, branchUnchanged: true, stagedUnchanged: true,
  diffCheckPassed: true, contractShaUnchanged, protectedFiles, newPaths, sourceSha256: sourcePaths.map(path => ({ path, sha256: hash(path) })) }, null, 2) + '\n');
console.log(JSON.stringify({ baselineFiles: protectedFiles.length, unchanged: protectedFiles.filter(row => row.unchanged).length,
  authorizedChanges: protectedFiles.filter(row => !row.unchanged).map(row => row.path), newFiles: newPaths.length,
  headUnchanged: true, branchUnchanged: true, stagedUnchanged: true, diffCheckPassed: true, contractShaUnchanged }));
