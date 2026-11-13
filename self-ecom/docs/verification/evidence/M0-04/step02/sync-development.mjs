// 作用：先核对隔离验证及数据库摘要，再应用已授权的0004；只保存摘要，不导出账号、密码或配置值。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
const root = process.cwd(); const api = resolve(root, 'apps/api');
const directory = resolve(root, 'docs/verification/evidence/M0-04/step02');
const require = createRequire(resolve(api, 'package.json')); const { Client } = require('pg');
const env = { ...parseEnv(readFileSync(resolve(root, '.env'), 'utf8')), ...process.env };
const dev = new URL(env.DATABASE_URL); const test = new URL(env.TEST_DATABASE_URL);
assert.notEqual(dev.pathname, test.pathname); assert.match(test.pathname, /^\/[a-z][a-z0-9_]*_test$/);
assert.ok(['localhost', '127.0.0.1'].includes(dev.hostname));
assert.equal(dev.port, test.port); assert.equal(dev.hostname, test.hostname);
assert.equal(process.argv[2], 'apply-authorized-0004');
for (const name of ['generate-attempt1', 'lint-final2', 'typecheck-final', 'integration-schema-fixture-fix', 'diff-test-attempt1']) {
  assert.equal(JSON.parse(readFileSync(resolve(directory, name + '.json'), 'utf8')).exitCode, 0, name + '必须已通过');
}
assert.match(readFileSync(resolve(directory, 'integration-outside-sandbox.txt'), 'utf8'), /Test Files\s+1 failed \| 3 passed \(4\)/);
const services = JSON.parse(readFileSync(resolve(directory, 'services-before.json'), 'utf8'));
assert.ok(services.checks.every(row => row.status === 200));
const tables = ['employee', 'customer', 'auth_session', 'permission_definition', 'role_permission',
  'employee_extra_permission', 'audit_log', 'system_guard', 'file_asset', 'file_reference', 'communication', 'business_state_history'];
const newTables = ['store_setting_head', 'store_setting_version', 'task_stage_cursor', 'task',
  'task_history', 'deadline_event', 'scheduler_run', 'scheduler_failure'];
const names = ['0001_bootstrap', '0002_auth_employee_permission_audit', '0003_files_communication_history', '0004_store_settings_tasks_deadlines'];
const hash = text => createHash('sha256').update(text).digest('hex');
const files = names.map(name => ({ name, checksum: hash(readFileSync(resolve(api, 'prisma/migrations', name, 'migration.sql'))) }));
const devClient = new Client({ connectionString: dev.toString(), connectionTimeoutMillis: 2000 });
const testClient = new Client({ connectionString: test.toString(), connectionTimeoutMillis: 2000 });
async function snapshot(client) {
  const rows = {};
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    for (const table of tables) {
      // 每行哈希含所有原字段；仅摘要写证据，真实数据与密码哈希仅留在本进程内存。
      rows[table] = (await client.query(`SELECT row_to_json(t)::text AS value FROM "${table}" t`)).rows
        .map(row => hash(row.value)).sort();
    }
    await client.query('COMMIT'); return rows;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
const summary = rows => Object.fromEntries(Object.entries(rows).map(([table, values]) => [table, { count: values.length, sha256: hash(JSON.stringify(values)) }]));
const report = { startedAt: new Date().toISOString(), database: dev.pathname.slice(1), files };
const save = () => writeFileSync(resolve(directory, 'development-migration.json'), JSON.stringify(report, null, 2) + '\n');
function command(name, args) {
  const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), ...args],
    { cwd: api, env, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  let log = String(result.stdout ?? '') + String(result.stderr ?? '');
  for (const [key, secret] of Object.entries(env)) if (/SECRET|PASSWORD|DATABASE_URL|TOKEN/i.test(key) && secret?.length >= 8)
    log = log.replaceAll(secret, '[REDACTED]');
  writeFileSync(resolve(directory, `${name}.txt`), log);
  report[name] = { exitCode: result.status, spawnError: result.error?.code ?? null }; save();
  assert.equal(result.status, 0, name + '须退出0'); assert.equal(result.error, undefined);
  return log;
}
try {
  await Promise.all([devClient.connect(), testClient.connect()]);
  const appliedTest = (await testClient.query('SELECT migration_name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows;
  assert.deepEqual(appliedTest, files.map(row => ({ migration_name: row.name, checksum: row.checksum })));
  const recordsBefore = (await devClient.query('SELECT * FROM _prisma_migrations ORDER BY migration_name')).rows;
  assert.deepEqual(recordsBefore.map(row => ({ migration_name: row.migration_name, checksum: row.checksum })),
    files.slice(0, 3).map(row => ({ migration_name: row.name, checksum: row.checksum })));
  assert.ok(recordsBefore.every(row => row.finished_at && !row.rolled_back_at));
  report.beforeMigrations = recordsBefore.map(row => ({ name: row.migration_name, checksum: row.checksum, finishedAt: row.finished_at }));
  report.databaseVersion = (await devClient.query("SELECT current_setting('server_version') AS version, current_setting('TimeZone') AS timezone")).rows[0];
  const before = await snapshot(devClient); report.before = summary(before); save();
  command('development-deploy', ['migrate', 'deploy']);
  const after = await snapshot(devClient); report.after = summary(after);
  report.preservation = {};
  for (const table of tables) {
    const remaining = [...after[table]];
    for (const row of before[table]) { const index = remaining.indexOf(row); assert.ok(index >= 0, `${table}有旧行变化，须核查`); remaining.splice(index, 1); }
    report.preservation[table] = { originalRowsUnchanged: true, newRowCount: remaining.length };
  }
  const recordsAfter = (await devClient.query('SELECT * FROM _prisma_migrations ORDER BY migration_name')).rows;
  assert.deepEqual(recordsAfter.slice(0, 3), recordsBefore);
  assert.deepEqual(recordsAfter.map(row => ({ migration_name: row.migration_name, checksum: row.checksum })),
    files.map(row => ({ migration_name: row.name, checksum: row.checksum })));
  assert.ok(recordsAfter.every(row => row.finished_at && !row.rolled_back_at));
  report.afterMigrations = recordsAfter.map(row => ({ name: row.migration_name, checksum: row.checksum, finishedAt: row.finished_at }));
  report.newTables = {};
  for (const table of newTables) {
    const count = (await devClient.query(`SELECT count(*)::int AS count FROM "${table}"`)).rows[0].count;
    assert.equal(count, table === 'store_setting_head' ? 1 : 0); report.newTables[table] = count;
  }
  assert.deepEqual((await devClient.query('SELECT * FROM store_setting_head')).rows, [{ id: 1, current_version_id: null, version: 0 }]);
  report.temporaryDatabasesRemaining = (await devClient.query("SELECT datname FROM pg_database WHERE datname ~ '^(tasks|files)_migration_[a-f0-9]{32}_test$'")).rows.length;
  assert.equal(report.temporaryDatabasesRemaining, 0);
  command('development-status', ['migrate', 'status']);
  command('development-diff', ['migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--exit-code']);
  report.completedAt = new Date().toISOString(); report.passed = true; save();
  console.log(JSON.stringify(report));
} catch (error) {
  report.passed = false; report.failure = error.code ?? error.name; save();
  // eslint-disable-next-line preserve-caught-error -- 禁止把可能含连接信息或原始数据的cause写入终端。
  throw new Error('开发库同步检查未全部通过，请查看脱敏证据');
} finally { await Promise.all([devClient.end(), testClient.end()]); }
