// 作用：核对步骤4仅改授权前端与记录，保护真实配置、已应用迁移、旧证据及未提交改动。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const directory = 'docs/verification/evidence/M0-04/step04';
const label = process.argv[2] ?? 'final'; assert.match(label, /^[a-z0-9-]+$/);
const destination = `${directory}/protection-${label}.json`; assert.ok(!existsSync(destination), '不能覆盖保护报告');
const baseline = JSON.parse(readFileSync(`${directory}/baseline.json`, 'utf8'));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const authorized = new Set(['apps/admin-web/src/app/AppLayout.tsx', 'apps/admin-web/src/app/router.tsx',
  'apps/admin-web/src/services/api.ts', 'apps/admin-web/src/employees/query-controller.ts', 'apps/admin-web/src/styles.css',
  'apps/store-web/src/app/AppLayout.tsx', 'apps/store-web/src/services/api.ts', 'apps/store-web/src/styles.css',
  'docs/design/M0-04.md', 'docs/verification/M0-04.md']);
const protectedFiles = baseline.files.map(row => ({ path: row.path, unchanged: hash(row.path) === row.sha256, authorizedChange: authorized.has(row.path) }));
assert.ok(protectedFiles.every(row => row.unchanged || row.authorizedChange), '出现范围外的既有文件修改');
function git(args) {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0); return result.stdout.trim();
}
assert.equal(git(['rev-parse', 'HEAD']), baseline.head); assert.equal(git(['diff', '--cached', '--name-only']), baseline.staged); git(['diff', '--check']);
const originalPaths = new Set(baseline.files.map(row => row.path));
const newPaths = git(['ls-files', '--others', '--exclude-standard', '--', '.']).split(/\r?\n/).filter(path => path && !originalPaths.has(path));
const allowed = path => path.startsWith(directory + '/') || path.startsWith('apps/admin-web/src/settings/')
  || (path.startsWith('output/playwright/M0-04-step04/') && /\.(png|json)$/.test(path))
  || path.startsWith('apps/store-web/src/contact/') || ['StoreSettingsPage', 'SettingsHistoryPage', 'SettingsVersionPage'].some(name => path === `apps/admin-web/src/pages/${name}.tsx`)
  || path === 'apps/admin-web/test/settings.test.mjs' || path === 'apps/admin-web/test/verify-settings-browser.mjs';
assert.ok(newPaths.every(allowed), '出现范围外新增文件');
for (const path of newPaths.filter(path => /\.(tsx?|mjs|md)$/.test(path))) assert.ok(readFileSync(path, 'utf8').split(/\r?\n/).every(line => !/[\t ]+$/.test(line)), `新文件含行尾空白：${path}`);
const sources = [...authorized, ...newPaths].filter(path => /\.(tsx?|mjs|css)$/.test(path));
const report = { checkedAt: new Date().toISOString(), headUnchanged: true, stagedUnchanged: true, diffCheckPassed: true,
  protectedFiles, newPaths, sourceSha256: sources.map(path => ({ path, sha256: hash(path) })), status: git(['status', '--short', '--untracked-files=all']) };
writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ baselineFiles: protectedFiles.length, unchanged: protectedFiles.filter(row => row.unchanged).length,
  authorizedChanges: protectedFiles.filter(row => !row.unchanged).map(row => row.path), newFiles: newPaths.length,
  headUnchanged: true, stagedUnchanged: true, diffCheckPassed: true }));
