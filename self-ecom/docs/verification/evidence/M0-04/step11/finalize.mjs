// 作用：核对本轮全部验收证据、定向检查新增验证脚本，保护既有文件/Git状态；不重跑全量、不操作数据库或容器。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

const directory = 'docs/verification/evidence/M0-04/step11';
const outputs = ['lint-followup-final.json', 'lint-followup-final.txt', 'protection-final.json', 'final-summary.json'];
for (const name of outputs) assert.ok(!existsSync(`${directory}/${name}`), '不能覆盖最终证据：' + name);
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
function check(name) {
  const report = read(`${directory}/${name}.json`); assert.equal(report.passed, true, name);
  assert.ok(report.checks.length > 0);
  for (const row of report.checks) { assert.equal(row.exitCode, 0, row.name); assert.equal(row.error, null); assert.ok(existsSync(row.log)); }
  return report;
}
const unit = check('unit-attempt1'); const integration = check('integration-attempt1');
const types = check('types-attempt1'); check('build-attempt1'); const production = check('web-build-production-final');
check('contracts-attempt1'); check('lint-final'); check('dead-locals-attempt1'); check('unit-retention-fix');
assert.equal(types.checks.length, 6); assert.equal(production.checks.length, 2);
assert.ok(integration.database.created && integration.database.removed);
function vitestCount(path, files, tests) {
  const log = stripVTControlCharacters(readFileSync(path, 'utf8'));
  assert.match(log, new RegExp(`Test Files\\s+${files} passed \\(${files}\\)`));
  assert.match(log, new RegExp(`Tests\\s+${tests} passed \\(${tests}\\)`));
  return tests;
}
const unitCounts = { api: vitestCount(`${directory}/unit-attempt1-api.txt`, 25, 492) };
for (const [workspace, expected] of [['packages-shared', 19], ['packages-api-client', 133], ['apps-admin-web', 75], ['apps-store-web', 37]]) {
  const log = stripVTControlCharacters(readFileSync(`${directory}/unit-attempt1-${workspace}.txt`, 'utf8'));
  assert.match(log, new RegExp(`tests ${expected}\\b`)); assert.match(log, new RegExp(`pass ${expected}\\b`));
  assert.match(log, /fail 0\b/); assert.match(log, /skipped 0\b/); unitCounts[workspace] = expected;
}
const ordinaryTests = Object.values(unitCounts).reduce((sum, count) => sum + count, 0); assert.equal(ordinaryTests, 756);
const integrationTests = vitestCount(`${directory}/integration-attempt1-all.txt`, 33, 1373);
vitestCount(`${directory}/unit-retention-fix-api.txt`, 2, 54);
const tasks = read('output/playwright/M0-04-step11/browser-tasks-attempt1/result.json');
const settings = read('output/playwright/M0-04-step11/browser-settings-attempt1/result.json');
for (const report of [tasks, settings]) { assert.equal(report.passed, true); assert.deepEqual(report.pageErrors, []); }
assert.equal(tasks.checks.length, 17); assert.equal(settings.checks.length, 11); assert.equal(settings.databaseRemoved, true);
assert.equal(tasks.groups.length, 5); assert.ok(tasks.groups.every(group => group.passed && group.databaseRemoved));
const docker = read('output/playwright/M0-04-step11/docker-attempt1/result.json');
assert.equal(docker.status, 'passed'); assert.equal(docker.checks.length, 21); assert.equal(docker.requests.length, 164);
assert.deepEqual(docker.pageErrors, []); assert.ok(docker.cleaned && docker.originalResourcesPreserved);
const deployment = read(`${directory}/deployment.json`); const development = read(`${directory}/development-readonly-deployed-final.json`);
assert.ok(deployment.passed && deployment.databaseContainerUnchanged && deployment.databaseVolumePreserved && deployment.noSeedsOrBusinessWrites);
assert.equal(deployment.containers.length, 4); assert.ok(deployment.containers.every(row => row.running && row.health === 'healthy'));
assert.ok(development.passed && development.databaseReadOnly && development.unchangedSinceStep09);
assert.equal(Object.keys(development.tables).length, 12); assert.equal(development.migrations.length, 4);
assert.equal(development.temporaryDatabasesRemaining, 0);
assert.deepEqual(development.settingHead, [{ id: 1, current_version_id: null, version: 0 }]);
const retained = read(`${directory}/retained-artifacts.json`); assert.ok(retained.passed); assert.equal(retained.paths.length, 7);
assert.ok(retained.paths.every(row => row.exists && existsSync(row.path)));

// 全工程Lint通过后只增加验证辅助脚本，按直接影响范围定向复验。
const lint = spawnSync(process.execPath, [resolve('node_modules/eslint/bin/eslint.js'), directory, 'apps/api/test/verification'],
  { encoding: 'utf8', windowsHide: true, timeout: 120000 });
writeFileSync(`${directory}/lint-followup-final.txt`, (lint.stdout ?? '') + (lint.stderr ?? ''));
writeFileSync(`${directory}/lint-followup-final.json`, JSON.stringify({ checkedAt: new Date().toISOString(),
  passed: lint.status === 0 && !lint.error, exitCode: lint.status, error: lint.error?.code ?? null,
  scope: [directory, 'apps/api/test/verification'], log: `${directory}/lint-followup-final.txt` }, null, 2) + '\n');
assert.equal(lint.status, 0, '收尾定向Lint失败'); assert.ok(!lint.error);

// 文件保护比较开始时的真实内容摘要，包含所有前序未提交文件；不只看Git跟踪文件。
const baseline = read(`${directory}/baseline.json`); assert.equal(baseline.files.length, 1315);
const authorized = new Set(['.dockerignore', 'apps/admin-web/src/services/api.ts', 'infra/api.Dockerfile',
  'infra/verify-auth-compose.mjs', 'docs/design/M0-04.md', 'docs/verification/M0-04.md']);
const protectedFiles = baseline.files.map(row => ({ path: row.path, unchanged: existsSync(row.path) && hash(row.path) === row.sha256,
  authorizedChange: authorized.has(row.path) }));
assert.ok(protectedFiles.every(row => row.unchanged || row.authorizedChange), '存在范围外既有文件变化');
for (const row of protectedFiles) assert.ok(existsSync(row.path), '既有文件不得删除：' + row.path);
const explicit = ['.env', 'apps/api/prisma/schema.prisma', 'docs/openapi/openapi.json', 'packages/api-client/src/generated/client.ts',
  'packages/api-client/src/generated/schema.ts', 'pnpm-lock.yaml', '../.github/workflows/self-ecom-contracts.yml'];
assert.ok(explicit.every(path => protectedFiles.some(row => row.path === path && row.unchanged)));
assert.ok(protectedFiles.filter(row => row.path.startsWith('apps/api/prisma/migrations/')).every(row => row.unchanged));
function git(args) {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, 'Git核对失败'); return result.stdout.trim();
}
assert.equal(git(['rev-parse', 'HEAD']), baseline.head); assert.equal(git(['branch', '--show-current']), baseline.branch);
assert.equal(git(['diff', '--cached', '--name-only']), baseline.staged); git(['diff', '--check']);
const oldPaths = new Set(baseline.files.map(row => row.path));
const newPaths = git(['ls-files', '--others', '--exclude-standard', '--', '.']).split(/\r?\n/).filter(path => path && !oldPaths.has(path));
const added = new Set(['infra/verify-settings-http.mjs', 'apps/api/test/verification/retained.config.mts', 'apps/api/test/verification/retained.setup.mjs']);
const prefixes = [directory + '/', 'output/build/M0-04-step11/', 'output/playwright/M0-04-step11/'];
assert.ok(newPaths.every(path => added.has(path) || prefixes.some(prefix => path.startsWith(prefix))), '存在范围外新增文件');
for (const path of [...authorized, ...newPaths].filter(path => /\.(ts|tsx|mts|mjs|md)$/.test(path)))
  assert.ok(readFileSync(path, 'utf8').split(/\r?\n/).every(line => !/[\t ]+$/.test(line)), '行尾空白：' + path);
const sourcePaths = [...new Set([...baseline.files.map(row => row.path).filter(path => /^(apps|packages|infra)\//.test(path)
  && !path.includes('/test/') && !path.includes('/dist/')), '.dockerignore', 'infra/verify-settings-http.mjs'])];
const sourceSha256 = sourcePaths.map(path => ({ path, sha256: hash(path) }));
const protection = { checkedAt: new Date().toISOString(), passed: true, baselineFiles: baseline.files.length, protectedFiles,
  changedExisting: protectedFiles.filter(row => !row.unchanged).map(row => row.path), newPaths, sourceSha256,
  headUnchanged: true, branchUnchanged: true, stagedUnchanged: true, diffCheckPassed: true, configurationAndMigrationsPreserved: true };
writeFileSync(`${directory}/protection-final.json`, JSON.stringify(protection, null, 2) + '\n');
const summary = { checkedAt: new Date().toISOString(), passed: true, scope: '板块4本期内核/页面全量、部署与自动化整体验收',
  head: baseline.head, branch: baseline.branch, ordinaryTests, unitCounts, integrationTests, integrationFiles: 33,
  ordinaryReport: `${directory}/unit-attempt1.json`, integrationReport: `${directory}/integration-attempt1.json`,
  retentionTargetedTests: { count: 54, additionalUniqueTests: 0 }, typeWorkspaces: types.checks.length,
  browser: { tasks: tasks.checks.length, settings: settings.checks.length, allGroupsPassed: true, pageErrors: 0 },
  docker: { project: docker.project, groups: docker.checks.length, requests: docker.requests.length, cleaned: true, originalResourcesPreserved: true },
  deployment: { report: `${directory}/deployment.json`, healthyServices: 4, imageIds: deployment.images.map(row => ({ service: row.service, digest: row.digest })) },
  protection: { report: `${directory}/protection-final.json`, baselineFiles: baseline.files.length, changedExisting: protection.changedExisting,
    configurationAndMigrationsPreserved: true, headBranchAndStagingPreserved: true },
  data: { report: `${directory}/development-readonly-deployed-final.json`, oldTablesUnchanged: 12, migrationsUnchanged: 4,
    settingVersion: 0, tasks: 0, temporaryDatabasesRemaining: 0, schedulerRunsInSnapshot: development.schedulerRuns.length },
  retainedTemporaryDirectories: retained.paths.length, requirements: `${directory}/requirements-checklist.md`,
  pending: ['SW-L01/02及真实订单/库存/售后/暂停领域接入补验', '用户逐条人工验收', '总览/项目README/板块交付清单/最终完成说明等待后续指令'],
  results: [unit.mode, integration.mode, types.mode, 'production-build', 'contracts', 'lint', 'dead-locals', 'browser', 'docker', 'deployment', 'file-protection'] };
writeFileSync(`${directory}/final-summary.json`, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ passed: true, ordinaryTests, integrationTests, browserScenarios: 28, dockerGroups: 21, dockerRequests: 164,
  healthyServices: 4, baselineFiles: baseline.files.length, changedExisting: protection.changedExisting, retainedTemporaryDirectories: retained.paths.length }));
