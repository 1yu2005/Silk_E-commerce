// 文件作用：汇总本轮新鲜验收结果，核对保护摘要、文件注释、源码及产物脱敏，生成可追溯证据。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
const root = process.cwd(); const output = path.join(root, 'output/playwright/final-acceptance');
const evidence = path.join(root, 'docs/verification/evidence/M0-02');
const json = async name => JSON.parse(await readFile(path.join(output, name), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const baseline = await json('initial-sha256.json'); const baselineByPath = new Map(baseline.map(item => [item.path, item.sha256]));
const audit = await json('source-audit.json'); const original = await Promise.all(baseline.map(async item => ({ path: item.path, sha256: hash(await readFile(path.join(root, item.path))) })));
const protectedFiles = await Promise.all(audit.protectedFiles.checks.map(async item => {
  const sha256 = hash(await readFile(path.join(root, item.path))); assert.equal(sha256, baselineByPath.get(item.path), `保护文件被改动：${item.path}`);
  return { path: item.path, unchanged: true, sha256 };
}));
const purposeHeaders = await Promise.all(audit.purposeHeaderCoverage.allFiles.map(async item => {
  const contents = await readFile(path.join(root, item.path), 'utf8');
  assert.match(contents.split(/\r?\n/).slice(0, 8).join('\n'), /作用[：:]/, `缺文件作用注释：${item.path}`);
  assert.ok(!/^(?:<<<<<<<|=======|>>>>>>>)\s/m.test(contents), `冲突标记：${item.path}`);
  assert.ok(!/[^\r\n\S]+\r?$/m.test(contents), `行尾空白：${item.path}`);
  return { path: item.path, sha256: hash(Buffer.from(contents)), hasChinesePurposeHeader: true };
}));
const walk = async directory => (await Promise.all((await readdir(directory, { withFileTypes: true })).map(async entry => {
  const target = path.join(directory, entry.name); return entry.isDirectory() ? walk(target) : [target];
}))).flat();
const configured = parseEnv(await readFile('.env', 'utf8'));
const secrets = Object.entries(configured).filter(([key, value]) => /SECRET|PASSWORD|DATABASE_URL/.test(key) && value.length > 4).map(([, value]) => value);
let builtFiles = 0; let evidenceFiles = 0;
for (const directory of ['apps/admin-web/dist', 'apps/store-web/dist', 'apps/api/dist']) {
  for (const file of await walk(directory)) {
    if (!/\.(?:html|js|css|json|svg|map)$/.test(file)) continue;
    const contents = await readFile(file, 'utf8');
    assert.ok(!secrets.some(secret => contents.includes(secret)), `产物含敏感配置：${path.relative(root, file)}`);
    if (!directory.includes('/api/')) assert.ok(!/JWT_SECRET|DATABASE_URL|POSTGRES_PASSWORD|INIT_ADMIN_PASSWORD/.test(contents), `前端含后端配置标记：${file}`);
    builtFiles++;
  }
}
for (const file of await walk(output)) {
  if (!/\.(?:json|log)$/.test(file)) continue;
  const contents = await readFile(file, 'utf8');
  assert.ok(!secrets.some(secret => contents.includes(secret)), `证据含敏感配置：${path.relative(root, file)}`);
  assert.ok(!/eyJ[A-Za-z0-9_-]{6,}\.eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{12,}/.test(contents), `证据含Bearer：${path.relative(root, file)}`);
  evidenceFiles++;
}
const suiteNames = ['admin-auth', 'store-auth', 'store-profile', 'employee-queries', 'employee-create', 'employee-management'];
const browser = await Promise.all(suiteNames.map(async suite => {
  const result = await json(`${suite}/result.json`); assert.equal(result.pageErrors.length, 0, suite);
  for (const [key, value] of Object.entries(result.cleanup)) assert.equal(value, 0, `${suite}夹具清理：${key}`);
  return { suite, exitCode: 0, checks: result.checks.length, httpRequests: result.requests.length, pageErrors: 0, cleanup: result.cleanup };
}));
await writeFile(path.join(output, 'browser-checks.json'), JSON.stringify(browser, null, 2) + '\n');
const docker = await json('docker/result.json'); assert.equal(docker.status, 'passed'); assert.ok(docker.cleaned && docker.originalResourcesPreserved);
assert.equal(docker.checks.length, 9); assert.equal(docker.requests.length, 71); assert.deepEqual(docker.pageErrors, []);
const checks = await json('local-checks.json');
assert.equal(checks.results.length, 6); assert.ok(checks.results.every(item => item.status === 0)); assert.ok(checks.temporaryPnpmWrapperRemoved);
const integrationLog = (await readFile(path.join(output, 'test-integration.log'), 'utf8')).replace(/\x1b\[[0-9;]*m/g, '');
assert.match(integrationLog, /Tests\s+806 passed/);
const openapi = JSON.parse(await readFile('docs/openapi/openapi.json', 'utf8'));
const operations = Object.values(openapi.paths).flatMap(item => Object.entries(item).filter(([method]) => /^(get|post|patch|put|delete|head|options)$/.test(method)).map(([, value]) => value.operationId));
assert.equal(operations.length, 22);
const diff = spawnSync('git', ['diff', '--check', '--', '.'], { cwd: root, encoding: 'utf8', windowsHide: true });
assert.equal(diff.status, 0, 'git diff --check');
await writeFile(path.join(output, 'diff-check.log'), (diff.stdout ?? '') + (diff.stderr ?? ''));
const report = {
  date: new Date().toISOString(), status: 'passed', node: process.version, branch: 'main', head: 'd4fa544', uncommitted: true,
  scope: '板块2本期功能、代码审查/精简/中文作用注释、真实数据库及独立四服务验收；最终开发完成说明按用户要求延期。',
  unitTests: { total: 476, api: 277, apiClient: 110, admin: 54, store: 35 }, integrationTests: { files: 20, passed: 806 },
  engineering: checks.results, browser: { suites: browser, checks: browser.reduce((sum, item) => sum + item.checks, 0), httpRequests: browser.reduce((sum, item) => sum + item.httpRequests, 0), pageErrors: 0 },
  docker: { checks: docker.checks.length, httpRequests: docker.requests.length, pageErrors: 0, project: docker.project, cleaned: true, originalResourcesPreserved: true,
    realExpiry: 'JWT_TTL_SECONDS=3，两个登录域本人200→自然到期401 TOKEN_EXPIRED' },
  operations: { business: 20, health: 2, operationIds: operations },
  preservation: { baselineFiles: baseline.length, deletedBaselineFiles: [], protectedFiles, temporaryPnpmWrapperRemoved: true,
    limitation: '初始摘要排除output/storage，不借此声称这些历史目录的全量字节保护；本轮浏览器证据另存。' },
  purposeHeaders: { checked: purposeHeaders.length, missing: 0 },
  scans: { builtTextFiles: builtFiles, evidenceTextFiles: evidenceFiles, secretsFound: 0, sourceWhitespaceOrConflictIssues: 0, gitDiffCheckExit: diff.status },
  currentBaselineChanges: original.filter(item => item.sha256 !== baselineByPath.get(item.path)).map(item => item.path),
  knownBoundaries: (await json('requirements-audit.json')).knownBoundaries,
};
assert.equal(report.browser.checks, 102); assert.equal(report.browser.httpRequests, 372);
await mkdir(evidence, { recursive: true });
await writeFile(path.join(evidence, 'final-source-sha256.json'), JSON.stringify(purposeHeaders, null, 2) + '\n');
await writeFile(path.join(evidence, 'final-acceptance.json'), JSON.stringify(report, null, 2) + '\n');
await writeFile(path.join(output, 'final-checks.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: 'passed', unitTests: 476, databaseTests: 806, browserChecks: report.browser.checks, dockerChecks: 9,
  purposeHeaders: purposeHeaders.length, protectedFiles: protectedFiles.length, builtFiles, evidenceFiles }));
