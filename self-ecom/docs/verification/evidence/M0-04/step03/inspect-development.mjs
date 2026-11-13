// 作用：只读检查本机API/页面、容器、迁移与开发数据；不登录、不初始化设置或修改账号。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
const directory = 'docs/verification/evidence/M0-04/step03';
assert.ok(!existsSync(`${directory}/development-readonly.json`), '不能覆盖核查记录');
const require = createRequire(resolve('apps/api/package.json')); const { Client } = require('pg');
const env = parseEnv(readFileSync('.env', 'utf8')); const dev = new URL(env.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1'].includes(dev.hostname));
const client = new Client({ connectionString: dev.toString() }); const hash = text => createHash('sha256').update(text).digest('hex');
const previous = JSON.parse(readFileSync('docs/verification/evidence/M0-04/step02/development-migration.json', 'utf8'));
const result = { checkedAt: new Date().toISOString(), databaseReadOnly: true, tables: {}, checks: [] };
try {
  await client.connect(); await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  for (const table of Object.keys(previous.after)) {
    // 表名固定来自步骤2证据；比较全部行摘要，不将密码哈希或原始行写入证据。
    assert.match(table, /^[a-z_]+$/);
    const rows = (await client.query(`SELECT row_to_json(t)::text AS value FROM "${table}" t`)).rows.map(row => hash(row.value)).sort();
    result.tables[table] = { count: rows.length, sha256: hash(JSON.stringify(rows)) };
    assert.deepEqual(result.tables[table], previous.after[table]);
  }
  result.unchangedSinceStep02 = true;
  result.migrations = (await client.query('SELECT migration_name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows;
  assert.deepEqual(result.migrations, previous.files.map(row => ({ migration_name: row.name, checksum: row.checksum })));
  for (const row of result.migrations) assert.equal(hash(readFileSync(`apps/api/prisma/migrations/${row.migration_name}/migration.sql`)), row.checksum);
  result.settingHead = (await client.query('SELECT * FROM store_setting_head')).rows;
  assert.deepEqual(result.settingHead, [{ id: 1, current_version_id: null, version: 0 }]);
  for (const table of ['store_setting_version', 'task_stage_cursor', 'task', 'task_history', 'deadline_event', 'scheduler_run', 'scheduler_failure'])
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count, 0);
  result.temporaryDatabasesRemaining = (await client.query("SELECT datname FROM pg_database WHERE datname ~ '^settings(_smoke)?_[a-f0-9]{32}_test$'")).rows.length;
  assert.equal(result.temporaryDatabasesRemaining, 0); await client.query('COMMIT');
} finally { await client.end(); }
for (const [port, path] of [[3000, '/api/v1/health/ready'], [3000, '/api/v1/store/contact'], [3000, '/api/docs-json'], [5173, '/'], [5174, '/']]) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(5000) });
  const row = { port, path, status: response.status, requestId: response.headers.get('x-request-id') }; assert.equal(response.status, 200);
  if (path.endsWith('/store/contact')) {
    row.data = (await response.json()).data;
    assert.deepEqual(row.data, { configured: false, servicePhone: null, serviceHours: null, settingsVersion: 0 });
  }
  if (path.endsWith('docs-json')) {
    const doc = await response.json(); row.operations = Object.values(doc.paths).reduce((count, item) => count + Object.keys(item)
      .filter(key => ['get', 'post', 'put', 'patch', 'delete'].includes(key)).length, 0); assert.equal(row.operations, 32);
  }
  result.checks.push(row);
}
result.containers = await new Promise((resolve, reject) => {
  const request = http.get({ socketPath: '\\\\.\\pipe\\docker_engine', path: '/v1.45/containers/json?all=true&filters='
    + encodeURIComponent(JSON.stringify({ label: ['com.docker.compose.project=self-ecom'] })) }, response => {
    let body = ''; response.setEncoding('utf8'); response.on('data', part => { body += part; });
    response.on('end', () => { if (response.statusCode !== 200) { reject(new Error('无法读取容器状态')); return; }
      resolve(JSON.parse(body).map(row => ({ service: row.Labels['com.docker.compose.service'], state: row.State, status: row.Status }))); });
  });
  request.setTimeout(5000, () => request.destroy(new Error('读取容器状态超时'))); request.on('error', reject);
});
assert.equal(result.containers.length, 4);
for (const row of result.containers) { assert.equal(row.state, row.service === 'db' ? 'running' : 'exited');
  if (row.service === 'db') assert.match(row.status, /healthy/); }
result.passed = true;
writeFileSync(`${directory}/development-readonly.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ unchangedSinceStep02: true, checks: result.checks, containers: result.containers, temporaryDatabasesRemaining: 0 }));
