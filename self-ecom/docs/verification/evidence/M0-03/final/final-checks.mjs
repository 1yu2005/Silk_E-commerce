// 作用：收尾检查受保护文件、生成契约、测试夹具和证据脱敏；只读数据库，不修改正常账号或旧容器。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { parseEnv } from 'node:util';
const output = 'docs/verification/evidence/M0-03/final';
const configured = parseEnv(readFileSync('.env', 'utf8'));
const secrets = Object.entries(configured).filter(([key, value]) => /SECRET|PASSWORD|DATABASE_URL|TOKEN/i.test(key) && value.length >= 8);
const redact = text => secrets.reduce((text, [, secret]) => text.replaceAll(secret, '[REDACTED]'), text);
const refresh = process.argv.includes('--refresh');
const checks = refresh ? JSON.parse(readFileSync(`${output}/protection.json`, 'utf8')).checks : [];
for (const [name, args] of [
  ['contracts-final', ['scripts/check-contracts.mjs']],
  ['drift', ['scripts/test-contract-drift.mjs']],
  ['generated-types', ['node_modules/typescript/bin/tsc', '-p', 'packages/api-client/tsconfig.contracts.json']],
  ['affected-api-types', ['node_modules/typescript/bin/tsc', '-p', 'apps/api/tsconfig.json', '--noEmit']],
  ['affected-lint', ['node_modules/eslint/bin/eslint.js', 'scripts', 'infra/verify-auth-compose.mjs', 'infra/verify-files-http.mjs',
    'apps/api/test/customer-auth.integration.ts', `${output}/run-checks.mjs`, `${output}/run-targeted.mjs`, `${output}/final-checks.mjs`, `${output}/redact-image.mjs`]],
]) {
  if (refresh && name !== 'affected-lint') continue;
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  writeFileSync(`${output}/${name}.txt`, redact(String(result.stdout ?? '') + String(result.stderr ?? '')));
  const prior = checks.findIndex(check => check.name === name); if (prior !== -1) checks.splice(prior, 1);
  checks.push({ name, exitCode: result.status, spawnError: result.error?.code ?? null });
  assert.equal(result.status, 0, name); assert.equal(result.error, undefined);
}
const before = JSON.parse(readFileSync(`${output}/protected-before.json`, 'utf8'));
const protection = before.map(item => ({ path: item.path, unchanged: createHash('sha256').update(readFileSync(item.path)).digest('hex') === item.sha256 }));
assert.ok(protection.every(item => item.unchanged));
const git = args => { const r = spawnSync('git', args, { encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0); return r.stdout.trim(); };
git(['diff', '--check']);
git(['diff', '--quiet', 'HEAD', '--', 'apps/api/prisma/migrations/0001_bootstrap/migration.sql', 'apps/api/prisma/migrations/0002_auth_employee_permission_audit/migration.sql']);
const sourceFiles = git(['ls-files', '-c', '-o', '--exclude-standard', '--', 'apps', 'packages', 'scripts', 'infra', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', '.dockerignore', 'turbo.json']).split(/\r?\n/)
  .filter(file => file && !file.includes('/dist/') && !file.includes('/node_modules/'));
writeFileSync(`${output}/source-sha256.json`, JSON.stringify([...new Set(sourceFiles)].sort().map(file => ({ path: file,
  sha256: createHash('sha256').update(readFileSync(file)).digest('hex') })), null, 2) + '\n');
const require = createRequire(resolve('apps/api/package.json')); const { Client } = require('pg');
const test = new URL(configured.TEST_DATABASE_URL); const dev = new URL(configured.DATABASE_URL);
assert.ok(test.pathname !== dev.pathname && /^[a-z][a-z0-9_]*_test$/.test(test.pathname.slice(1)));
const db = new Client({ connectionString: test.toString() }); let fixtures;
try {
  await db.connect(); await db.query('BEGIN READ ONLY');
  fixtures = (await db.query(`SELECT (SELECT count(*) FROM file_asset)::int AS file_assets,
    (SELECT count(*) FROM customer WHERE nickname IN ('记录测试顾客','查询域隔离夹具','头像页面验收','顾客登录夹具'))::int AS known_customers,
    (SELECT count(*) FROM employee WHERE display_name IN ('记录测试客服','查询管理员夹具','域隔离员工'))::int AS known_employees,
    (SELECT count(*) FROM communication)::int AS communications,
    (SELECT count(*) FROM business_state_history)::int AS state_histories`)).rows[0];
  await db.query('ROLLBACK');
} finally { await db.end(); }
assert.ok(Object.values(fixtures).every(value => value === 0), '测试夹具残留须人工辨别来源，禁止清空测试库');
const paths = [];
function walk(directory) { for (const entry of readdirSync(directory, { withFileTypes: true })) {
  const file = join(directory, entry.name); if (entry.isDirectory()) walk(file); else if (/\.(txt|json|log|js|css|html)$/.test(entry.name)) paths.push(file);
} }
for (const directory of [output, 'output/playwright/M0-03-final', 'apps/admin-web/dist', 'apps/store-web/dist']) walk(directory);
const leaks = [];
for (const file of paths) for (const [key, value] of secrets) if (readFileSync(file, 'utf8').includes(value)) leaks.push({ file, variable: key });
assert.deepEqual(leaks, []);
const docker = JSON.parse(readFileSync('output/playwright/M0-03-final/docker-attempt2/result.json', 'utf8'));
assert.equal(docker.status, 'passed'); assert.equal(docker.cleaned, true); assert.equal(docker.originalResourcesPreserved, true);
const result = { timestamp: new Date().toISOString(), git: { branch: git(['branch', '--show-current']), head: git(['rev-parse', '--short', 'HEAD']),
  stagedPaths: git(['diff', '--cached', '--name-only']), diffCheckPassed: true }, checks, protection,
  legacyMigrationsUnchangedFromHead: true, testFixtures: fixtures, secretMatches: leaks,
  developmentDatabaseWritten: false, originalContainersAndVolumesPreserved: true,
  avatarFixtureCleaned: JSON.parse(readFileSync('output/playwright/M0-03-final/avatar/result.json', 'utf8')).fixtureCleaned,
  githubWorkflowExecuted: false };
writeFileSync(`${output}/protection.json`, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result));
