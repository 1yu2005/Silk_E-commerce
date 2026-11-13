// 作用：仅在隔离库事务内用临时表复现历史经办CHECK的NULL边界，不应用任何迁移。
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
const root = process.cwd();
const require = createRequire(resolve(root, 'apps/api/package.json'));
const { Client } = require('pg');
const env = parseEnv(readFileSync('.env', 'utf8'));
const dev = new URL(env.DATABASE_URL); const test = new URL(env.TEST_DATABASE_URL);
assert.notEqual(dev.pathname, test.pathname); assert.match(test.pathname, /^\/[a-z][a-z0-9_]*_test$/);
const sql = readFileSync('apps/api/prisma/migrations/0004_store_settings_tasks_deadlines/migration.sql', 'utf8');
const predicate = sql.match(/ADD CONSTRAINT task_history_assignees_valid CHECK \(([\s\S]*?)\),\r?\n ADD CONSTRAINT task_history_values_valid/)[1];
const client = new Client({ connectionString: test.toString() });
const result = { checkedAt: new Date().toISOString(), mode: process.argv[2], pending0004: false, rejectedInvalidAssignee: false, code: null };
try {
  await client.connect();
  const applied = await client.query("SELECT count(*)::int AS count FROM _prisma_migrations WHERE migration_name='0004_store_settings_tasks_deadlines'");
  assert.equal(applied.rows[0].count, 0); result.pending0004 = true;
  await client.query('BEGIN');
  await client.query(`CREATE TEMP TABLE null_check_probe (before_status text, after_status text NOT NULL,
    from_assignee_id uuid, to_assignee_id uuid, CHECK (${predicate})) ON COMMIT DROP`);
  try { await client.query("INSERT INTO null_check_probe VALUES (NULL,'OPEN','00000000-0000-0000-0000-000000000001',NULL)"); }
  catch (error) { result.rejectedInvalidAssignee = true; result.code = error.code; }
  await client.query('ROLLBACK');
  assert.equal(result.rejectedInvalidAssignee, process.argv[2] === 'fixed');
  console.log(JSON.stringify(result));
  writeFileSync(resolve(root, `docs/verification/evidence/M0-04/step02/null-check-${process.argv[2]}.json`), JSON.stringify(result, null, 2) + '\n');
} finally { await client.end(); }
