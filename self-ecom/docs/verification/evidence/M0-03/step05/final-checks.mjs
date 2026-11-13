// 作用：保存本步最终漂移/语法/保护证据，只读测试库，不打印配置值；不重复已通过的功能回归。
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
const directory = 'docs/verification/evidence/M0-03/step05';
const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env };
const results = [];
for (const [name, args] of [
  ['drift', ['scripts/test-contract-drift.mjs']],
  ['generated-check', ['scripts/generate-api-client.mjs', '--check']],
  ['lint-final', ['node_modules/eslint/bin/eslint.js', 'scripts', 'packages/shared/src', 'packages/shared/test', 'packages/api-client/src',
    'packages/api-client/test', 'apps/api/test/swagger.spec.ts', 'apps/store-web/test/verify-avatar-browser.mjs', `${directory}/run-checks.mjs`, `${directory}/final-checks.mjs`]],
]) {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const output = String(result.stdout ?? '') + String(result.stderr ?? '');
  writeFileSync(`${directory}/${name}.txt`, output); assert.equal(result.status, 0, name); assert.equal(result.error, undefined);
  results.push({ name, exitCode: result.status });
}
const require = createRequire(resolve('node_modules/.contract-tools/package.json'));
const workflow = require('js-yaml').load(readFileSync('../.github/workflows/self-ecom-contracts.yml', 'utf8'));
assert.equal(workflow.jobs.contracts.defaults.run['working-directory'], 'self-ecom'); assert.ok(workflow.on.pull_request);
const before = JSON.parse(readFileSync(`${directory}/protected-before.json`, 'utf8'));
const protection = before.map(item => ({ path: item.path, unchanged: createHash('sha256').update(readFileSync(item.path)).digest('hex') === item.sha256 }));
const legacy = spawnSync('git', ['diff', '--quiet', 'HEAD', '--', 'apps/api/prisma/migrations/0001_bootstrap/migration.sql',
  'apps/api/prisma/migrations/0002_auth_employee_permission_audit/migration.sql'], { windowsHide: true });
const apiRequire = createRequire(resolve('apps/api/package.json')); const { Client } = apiRequire('pg');
const test = new URL(env.TEST_DATABASE_URL); const dev = new URL(env.DATABASE_URL);
assert.ok(test.pathname !== dev.pathname && /^[a-z][a-z0-9_]*_test$/.test(test.pathname.slice(1)));
const client = new Client({ connectionString: test.toString() }); let fixtures;
try {
  await client.connect(); await client.query('BEGIN READ ONLY');
  fixtures = (await client.query("SELECT (SELECT count(*) FROM customer WHERE nickname IN ('记录测试顾客','查询域隔离夹具','头像页面验收'))::int AS customers, (SELECT count(*) FROM employee WHERE display_name IN ('记录测试客服','查询管理员夹具'))::int AS employees")).rows[0];
  await client.query('ROLLBACK');
} finally { await client.end(); }
const secrets = Object.entries(env).filter(([key, value]) => /SECRET|PASSWORD|DATABASE_URL|TOKEN/i.test(key) && value?.length >= 8); const leaks = [];
for (const location of [directory, 'output/playwright/M0-03-step05', 'packages/api-client/src/generated']) {
  for (const file of readdirSync(location).filter(file => /\.(txt|json|ts)$/.test(file))) {
    const content = readFileSync(`${location}/${file}`, 'utf8');
    for (const [key, value] of secrets) if (content.includes(value)) leaks.push({ file: `${location}/${file}`, variable: key });
  }
}
const result = { timestamp: new Date().toISOString(), results, workflowYamlParsed: true, githubRunExecuted: false, protection,
  legacyMigrationsUnchangedFromHead: legacy.status === 0, fixturesWithKnownMarkersRemaining: fixtures,
  browserFixtureCleaned: JSON.parse(readFileSync('output/playwright/M0-03-step05/result.json', 'utf8')).fixtureCleaned,
  secretMatches: leaks, developmentDatabaseWritten: false };
writeFileSync(`${directory}/protection.json`, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result));
assert.ok(protection.every(item => item.unchanged)); assert.equal(legacy.status, 0);
assert.deepEqual(fixtures, { customers: 0, employees: 0 }); assert.equal(result.browserFixtureCleaned, true); assert.deepEqual(leaks, []);
