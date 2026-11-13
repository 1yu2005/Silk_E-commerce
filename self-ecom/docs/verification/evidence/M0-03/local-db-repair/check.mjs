// 作用：记录本次开发库迁移前后摘要，复现头像字段错误，并在回滚事务中检查顾客默认返回字段；不输出账号或凭据。
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

const require = createRequire(resolve('apps/api/package.json'));
const { Client } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)) };
const phase = process.argv[2];
if (!['before', 'after'].includes(phase)) throw new Error('仅支持before或after检查');
const target = new URL(env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.pathname.endsWith('_test')
  || target.pathname === new URL(env.TEST_DATABASE_URL).pathname) throw new Error('本轮只允许本机独立于测试库的开发库');
const directory = resolve('docs/verification/evidence/M0-03/local-db-repair');
const tables = ['employee', 'customer', 'auth_session', 'permission_definition', 'role_permission', 'employee_extra_permission', 'audit_log', 'system_guard'];
const files = ['.env', 'apps/api/package.json', 'pnpm-lock.yaml', 'apps/api/prisma/schema.prisma',
  'apps/api/prisma/migrations/0001_bootstrap/migration.sql', 'apps/api/prisma/migrations/0002_auth_employee_permission_audit/migration.sql',
  'apps/api/prisma/migrations/0003_files_communication_history/migration.sql', 'docs/openapi/openapi.json'];
const digest = value => createHash('sha256').update(value).digest('hex');
const options = { connectionString: env.DATABASE_URL, connectionTimeoutMillis: 2500, statement_timeout: 5000, query_timeout: 6000 };
const client = new Client({ ...options, options: '-c default_transaction_read_only=on' });
const prisma = new PrismaClient({ adapter: new PrismaPg({ ...options, max: 1 }) });
try {
  await client.connect();
  const result = { phase, recordedAt: new Date().toISOString(), tables: {}, files: {}, migrations: [], avatarColumnExists: false };
  // 一致只读快照中只输出行数与整体摘要，密码哈希等原始内容不写入证据。
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  for (const table of tables) {
    const projection = table === 'customer' ? "to_jsonb(t) - 'avatar_asset_id'" : 'to_jsonb(t)';
    const { rows } = await client.query('SELECT count(*)::int AS count, COALESCE(jsonb_agg(x ORDER BY x::text), \'[]\'::jsonb)::text AS content FROM (SELECT '
      + projection + ' AS x FROM "' + table + '" t) snapshot');
    result.tables[table] = { rows: rows[0].count, sha256: digest(rows[0].content) };
  }
  result.migrations = (await client.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name')).rows;
  for (const migration of result.migrations) {
    if (!migration.finished_at || migration.rolled_back_at || migration.checksum !== digest(readFileSync(resolve('apps/api/prisma/migrations', migration.migration_name, 'migration.sql')))) {
      throw new Error('迁移记录未完成或源码摘要不一致');
    }
  }
  result.avatarColumnExists = (await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customer' AND column_name='avatar_asset_id'")).rowCount === 1;
  await client.query('COMMIT');
  for (const file of files) result.files[file] = digest(readFileSync(file));
  try {
    await prisma.customer.findFirst({ select: { avatarAssetId: true } });
    result.avatarRead = { status: 'passed' };
  } catch (error) {
    if (error.code !== 'P2022') throw error;
    result.avatarRead = { status: 'failed', code: error.code };
  }
  if (phase === 'before') {
    if (result.avatarColumnExists || result.avatarRead.code !== 'P2022'
      || result.migrations.map(row => row.migration_name).join(',') !== '0001_bootstrap,0002_auth_employee_permission_audit') {
      throw new Error('现场状态与已授权的0002到0003修复不一致');
    }
  } else {
    if (!result.avatarColumnExists || result.avatarRead.status !== 'passed'
      || result.migrations.map(row => row.migration_name).join(',') !== '0001_bootstrap,0002_auth_employee_permission_audit,0003_files_communication_history') {
      throw new Error('迁移后状态不符合预期');
    }
    // 重现登录中的默认UPDATE RETURNING路径；不跳过密码验证去创建真实会话。
    const rollback = new Error('验证后主动回滚');
    let checked = false;
    try {
      await prisma.$transaction(async tx => {
        const customer = await tx.customer.findFirst({ select: { id: true, lastLoginAt: true } });
        if (!customer) throw new Error('没有现有顾客可验证');
        const returned = await tx.customer.update({ where: { id: customer.id }, data: { lastLoginAt: customer.lastLoginAt } });
        if (!Object.hasOwn(returned, 'avatarAssetId')) throw new Error('默认返回中缺少新字段');
        checked = true;
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    result.customerUpdateReturning = { status: checked ? 'passed' : 'failed', transaction: 'rolled_back' };
    result.newTables = {};
    for (const table of ['file_asset', 'file_reference', 'communication', 'business_state_history']) {
      result.newTables[table] = (await client.query('SELECT count(*)::int AS count FROM "' + table + '"')).rows[0].count;
    }
    result.avatarsRemainNull = (await client.query('SELECT count(*)::int AS count FROM customer WHERE avatar_asset_id IS NOT NULL')).rows[0].count === 0;
    const baseline = JSON.parse(readFileSync(resolve(directory, 'before.json'), 'utf8'));
    result.oldTableSnapshotsUnchanged = tables.every(table => JSON.stringify(result.tables[table]) === JSON.stringify(baseline.tables[table]));
    result.protectedFilesUnchanged = files.every(file => result.files[file] === baseline.files[file]);
    result.oldMigrationRecordsUnchanged = JSON.stringify(result.migrations.slice(0, 2)) === JSON.stringify(baseline.migrations);
    if (!result.oldTableSnapshotsUnchanged || !result.protectedFilesUnchanged || !result.oldMigrationRecordsUnchanged) {
      writeFileSync(resolve(directory, 'after.json'), JSON.stringify(result, null, 2) + '\n');
      throw new Error('保护对比发生变化，保留现场并人工核对');
    }
  }
  writeFileSync(resolve(directory, phase + '.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ phase, migrations: result.migrations.map(row => row.migration_name), avatarRead: result.avatarRead,
    customerUpdateReturning: result.customerUpdateReturning, oldTableSnapshotsUnchanged: result.oldTableSnapshotsUnchanged,
    protectedFilesUnchanged: result.protectedFilesUnchanged, oldMigrationRecordsUnchanged: result.oldMigrationRecordsUnchanged }));
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', code: error.code ?? null, message: error.code ? '数据库操作失败，原始异常未输出' : error.message }));
  process.exitCode = 1;
} finally { await prisma.$disconnect(); await client.end(); }
