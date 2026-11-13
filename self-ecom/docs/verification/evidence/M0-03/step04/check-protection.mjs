// 作用：只读检查配置、已有依赖和迁移保护，以及本轮隔离夹具清理；只报告变量名，不输出秘密。
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
const directory = 'docs/verification/evidence/M0-03/step04';
const json = file => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const before = json(`${directory}/protected-before.json`);
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex').toUpperCase();
const protection = before.filter(item => item.path !== 'pnpm-lock.yaml')
  .map(item => ({ path: item.path, unchanged: hash(item.path) === item.sha256 }));
const migration = json('docs/verification/evidence/M0-03/step03/protected-before.json').find(item => item.path.includes('/0003_'));
protection.push({ path: migration.path, unchanged: hash(migration.path) === migration.sha256 });
const oldMigrations = spawnSync('git', ['diff', '--quiet', 'HEAD', '--', 'apps/api/prisma/migrations/0001_bootstrap/migration.sql',
  'apps/api/prisma/migrations/0002_auth_employee_permission_audit/migration.sql'], { windowsHide: true });
const apiPackage = json('apps/api/package.json');
assert.equal(apiPackage.dependencies.busboy, '1.6.0'); assert.equal(apiPackage.dependencies.sharp, '0.35.5');
for (const name of ['store-web', 'admin-web']) assert.equal(json(`apps/${name}/package.json`).dependencies['@shop/ui'], 'workspace:*');
const lock = readFileSync('pnpm-lock.yaml', 'utf8');
assert.ok(lock.includes('  packages/ui:') && lock.includes('busboy@1.6.0') && lock.includes('sharp@0.35.5'));
const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env };
const test = new URL(env.TEST_DATABASE_URL); const dev = new URL(env.DATABASE_URL);
assert.ok(test.pathname !== dev.pathname && /^[a-z][a-z0-9_]*_test$/.test(test.pathname.slice(1)));
const require = createRequire(resolve('apps/api/package.json')); const { Client } = require('pg');
const client = new Client({ connectionString: test.toString() }); let fixtureCustomersRemaining;
try {
  await client.connect(); await client.query('BEGIN READ ONLY');
  const result = await client.query("SELECT count(*)::int AS count FROM customer WHERE nickname IN ('头像隔离顾客','新的服装顾客','头像页面验收')");
  fixtureCustomersRemaining = result.rows[0].count; await client.query('ROLLBACK');
} finally { await client.end(); }
const secrets = Object.entries(env).filter(([key, value]) => /SECRET|PASSWORD|DATABASE_URL|TOKEN/i.test(key) && value?.length >= 8);
const leaks = [];
for (const location of [directory, 'output/playwright/M0-03-step04']) {
  for (const name of readdirSync(location).filter(name => /\.(txt|json)$/.test(name))) {
    const content = readFileSync(`${location}/${name}`, 'utf8');
    for (const [key, value] of secrets) if (content.includes(value)) leaks.push({ file: `${location}/${name}`, variable: key });
  }
}
const result = { timestamp: new Date().toISOString(), protection, legacyMigrationsUnchangedFromHead: oldMigrations.status === 0,
  lockfileUpdatedForWorkspaceUi: true, existingBusboySharpPreserved: true, fixtureCustomersRemaining,
  browserFixtureCleaned: json('output/playwright/M0-03-step04/result.json').fixtureCleaned, secretMatches: leaks,
  developmentDatabaseWritten: false };
writeFileSync(`${directory}/protection.json`, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result));
if (protection.some(item => !item.unchanged) || oldMigrations.status !== 0 || oldMigrations.error
  || fixtureCustomersRemaining !== 0 || !result.browserFixtureCleaned || leaks.length) process.exitCode = 1;
