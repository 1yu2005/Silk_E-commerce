// 作用：核对步骤10已有证据并汇总独立场景，不重新运行测试，不把文件壳或重复复验算成新增用例。
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const directory = 'docs/verification/evidence/M0-04/step10'; const target = directory + '/final-summary.json';
assert.ok(!existsSync(target), '不能覆盖最终汇总');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const checks = ['api-types-attempt1', 'admin-types-button-disabled-final', 'admin-build-attempt1',
  'acceptance-build-permission-dependencies-fix', 'contracts-attempt1', 'lint-evidence-final', 'unit-error-constructor-fix',
  'acceptance-cli-attempt1', 'acceptance-page-cli-attempt1'].map(name => {
  const path = `${directory}/${name}.json`; const result = read(path); assert.equal(result.exitCode, 0); assert.equal(result.spawnError, null);
  return { path, exitCode: result.exitCode };
});
const initialUnit = readFileSync(directory + '/unit-attempt1.txt', 'utf8');
assert.match(initialUnit, /tests 44/); assert.match(initialUnit, /pass 40/); assert.match(initialUnit, /fail 4/);
const repairedUnit = readFileSync(directory + '/unit-error-constructor-fix.txt', 'utf8');
for (const code of ['404', '409', '500', '网络失败']) assert.ok(repairedUnit.includes('✔ 任务错误' + code));
const browserSources = [
  ['core', 'pending-button-fix', 6], ['deadline', 'targeted-selectors', 3], ['scope', 'targeted-selectors', 4],
  ['resilience', 'installed-browser', 3], ['empty', 'installed-browser', 1],
];
const browser = browserSources.map(([name, label, count]) => {
  const path = `output/playwright/M0-04-step10/${label}/result.json`; const result = read(path);
  const group = result.groups.find(group => group.name === name); assert.ok(group.passed && group.databaseRemoved);
  assert.equal(result.checks.filter(check => check.group === name).length, count);
  assert.ok(!result.pageErrors.some(error => error.group === name)); return { group: name, count, path };
});
const smoke = read(directory + '/acceptance-smoke-permission-dependencies-fix.json');
assert.ok(smoke.passed && smoke.databaseRemoved); assert.equal(smoke.checks.length, 7);
const development = read(directory + '/development-readonly-final.json');
const initial = read(directory + '/development-readonly-initial.json');
assert.ok(development.passed && development.unchangedSinceStep09); assert.equal(development.temporaryDatabasesRemaining, 0);
const protection = read(directory + '/protection-final.json');
assert.equal(protection.protectedFiles.length, 1201);
assert.ok(protection.protectedFiles.every(file => file.unchanged || file.authorizedChange));
for (const key of ['headUnchanged', 'branchUnchanged', 'stagedUnchanged', 'diffCheckPassed', 'contractShaUnchanged']) assert.ok(protection[key]);
const report = { checkedAt: new Date().toISOString(), scope: '合并步骤10：任务页面与独立隔离验收', passed: true, checks,
  ordinaryTests: { distinct: 44, firstRunPassed: 40, repairedFailures: 4, targetedActualCases: 5, targetedFileShellsExcluded: 3, finalWholeSuiteRerun: false },
  browser: { distinct: browser.reduce((sum, group) => sum + group.count, 0), finalWholeSuiteRerun: false, groups: browser },
  httpSmokeChecks: 7, temporaryDatabasesRemaining: 0,
  development: { originalTablesUnchanged: Object.keys(development.tables).length, schedulerRunsAtFinal: development.schedulerRuns.length,
    normalSchedulerRunIncrease: development.schedulerRuns.length - initial.schedulerRuns.length },
  protection: { baselineFiles: 1201, authorizedChanges: protection.protectedFiles.filter(file => !file.unchanged).map(file => file.path),
    realEnvironmentProtected: true, productionBackendProtected: true, migrationsProtected: true, contractsProtected: true },
  notRun: ['全工程回归', '四服务Docker部署', '人工逐条Swagger', '整板块验收'],
  deferred: ['SW-L真实领域补验', '真实服装订单/库存/售后及BR-05业务闭环'], nextStep: '11：全量回归与Docker收尾，等待用户执行' };
writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: true, ordinaryDistinctCases: 44, browserDistinctCases: report.browser.distinct,
  httpSmokeChecks: 7, temporaryDatabasesRemaining: 0, protectedBaselineFiles: 1201, remainingAuthorizedSteps: 0 }));
