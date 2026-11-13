// 作用：只读核对本步受保护文件与测试夹具清理结果，不输出真实配置，不修改开发库。
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
const require = createRequire(resolve('apps/api/package.json')); const { Client } = require('pg');
const directory = 'docs/verification/evidence/M0-03/step03';
const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)) };
const before = JSON.parse(readFileSync(`${directory}/protected-before.json`, 'utf8').replace(/^\uFEFF/, ''));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const protection = before.map(item => ({ path: item.path, unchanged: hash(item.path).toUpperCase() === item.sha256 }));
const test = new URL(env.TEST_DATABASE_URL); const dev = new URL(env.DATABASE_URL);
if (!/^[a-z][a-z0-9_]*_test$/.test(test.pathname.slice(1)) || test.pathname === dev.pathname) throw new Error('隔离校验失败');
const client = new Client({ connectionString: test.toString() }); let database;
try {
  await client.connect(); await client.query('BEGIN READ ONLY');
  const tables = await client.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'files_scope_%_test'");
  const staff = await client.query("SELECT count(*)::int AS count FROM employee WHERE display_name='文件隔离测试员工'");
  const customers = await client.query("SELECT count(*)::int AS count FROM customer WHERE nickname='文件隔离测试顾客'");
  database = { fixtureTablesRemaining: tables.rows[0].count, fixtureEmployeesRemaining: staff.rows[0].count, fixtureCustomersRemaining: customers.rows[0].count };
  await client.query('ROLLBACK');
} finally { await client.end(); }
const secrets = Object.entries(env).filter(([key, value]) => /SECRET|PASSWORD|DATABASE_URL|TOKEN/i.test(key) && value?.length >= 8);
const leaks = [];
for (const name of readdirSync(directory).filter(name => /\.(txt|json)$/.test(name))) {
  const content = readFileSync(`${directory}/${name}`, 'utf8');
  for (const [key, value] of secrets) if (content.includes(value)) leaks.push({ file: name, variable: key });
}
// 开始快照只登记了0003；0001/0002用本轮Git基线HEAD补充核对，不伪造开始时的摘要。
const migrations = spawnSync('git', ['diff', '--quiet', 'HEAD', '--', 'apps/api/prisma/migrations/0001_bootstrap/migration.sql',
  'apps/api/prisma/migrations/0002_auth_employee_permission_audit/migration.sql'], { windowsHide: true });
const legacyMigrationsUnchangedFromHead = migrations.status === 0 && !migrations.error;
const result = { timestamp: new Date().toISOString(), protection, legacyMigrationsUnchangedFromHead, database, secretMatches: leaks, developmentDatabaseWritten: false };
writeFileSync(`${directory}/protection.json`, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result));
if (protection.some(item => !item.unchanged) || !legacyMigrationsUnchangedFromHead || Object.values(database).some(value => value !== 0) || leaks.length) process.exitCode = 1;
