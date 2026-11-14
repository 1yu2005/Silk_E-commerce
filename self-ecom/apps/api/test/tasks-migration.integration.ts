// 作用：用本轮专用空库和0003升级库验证0004、旧数据保留、真实唯一索引竞争及客户端关系。
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { assertSafeTestDatabase } from '../scripts/database-env.js';
import { runPrisma } from '../scripts/database.js';
import { PasswordService } from '../src/auth/password.service.js';
import { loadConfiguration } from '../src/config/environment.js';
import { seedPermissionCatalog } from '../src/permissions/permission-seed.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { cursorRow, deadlineRow, fixtureDue, fixtureTime, insertSchemaRow, settingRow, taskRow,
  taskTables, type SchemaRow } from './fixtures/task-schema.js';

const base = assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('集成测试仅可在test环境执行');
const previousMigrations = ['0001_bootstrap', '0002_auth_employee_permission_audit', '0003_files_communication_history'];
const expectedMigrations = [...previousMigrations, '0004_store_settings_tasks_deadlines','0005_categories_products_skus_inventory_accounts','0006_inventory_sources_adjustments_ledger','0007_customer_status_addresses_cart'];
const oldTables = ['employee', 'customer', 'auth_session', 'permission_definition', 'role_permission',
  'employee_extra_permission', 'audit_log', 'system_guard', 'file_asset', 'file_reference',
  'communication', 'business_state_history'] as const;
const createdDatabases = new Set<string>();
const scratchFiles: string[] = []; const scratchDirectories: string[] = [];
const databaseUrl = () => {
  const url = new URL(base.testUrl); url.pathname = `/tasks_migration_${randomUUID().replaceAll('-', '')}_test`;
  return assertSafeTestDatabase(base.developmentUrl, url.toString());
};
const fresh = databaseUrl(); const upgrade = databaseUrl();
const adminUrl = new URL(base.testUrl); adminUrl.pathname = '/postgres';
const admin = new Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 2000 });
const freshClient = new Client({ connectionString: fresh.testUrl });
const upgradeClient = new Client({ connectionString: upgrade.testUrl });
const passwords = new PasswordService(); const fixturePassword = 'MigrationFixture#2026';
const employeeId = randomUUID(); const adminId = randomUUID(); const customerId = randomUUID();
let before: Record<string, Record<string, unknown>[]>;

async function createDatabase(target: typeof fresh) {
  const checked = assertSafeTestDatabase(base.developmentUrl, target.testUrl);
  if (!/^tasks_migration_[a-f0-9]{32}_test$/.test(checked.testName)) throw new Error('临时测试库名称不合法');
  await admin.query(`CREATE DATABASE "${checked.testName}" ENCODING 'UTF8' TEMPLATE template0`);
  // 仅登记CREATE成功的本轮独占库；绝不复用、重置或删除预先存在的数据库。
  createdDatabases.add(checked.testName);
}
function deploy(target: typeof fresh, config?: string) {
  assertSafeTestDatabase(base.developmentUrl, target.testUrl);
  runPrisma(['migrate', 'deploy', ...(config ? ['--config', config] : [])], { ...process.env, DATABASE_URL: target.testUrl });
}
async function snapshot(client: Client) {
  const rows: Record<string, Record<string, unknown>[]> = {};
  for (const table of oldTables) rows[table] = (await client.query<Record<string, unknown>>(`SELECT * FROM "${table}"`)).rows
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return rows;
}
function baselineConfiguration() {
  const scratch = mkdtempSync(join(tmpdir(), 'self-ecom-m004-migrations-')); scratchDirectories.push(scratch);
  const migrations = join(scratch, 'migrations'); mkdirSync(migrations); scratchDirectories.push(migrations);
  for (const name of previousMigrations) {
    const directory = join(migrations, name); mkdirSync(directory); scratchDirectories.push(directory);
    const sql = join(directory, 'migration.sql');
    copyFileSync(resolve(__dirname, '../prisma/migrations', name, 'migration.sql'), sql); scratchFiles.push(sql);
  }
  const lock = join(migrations, 'migration_lock.toml');
  copyFileSync(resolve(__dirname, '../prisma/migrations/migration_lock.toml'), lock); scratchFiles.push(lock);
  const config = join(scratch, 'prisma.config.ts');
  writeFileSync(config, `export default { schema: ${JSON.stringify(resolve(__dirname, '../prisma/schema.prisma'))},
    migrations: { path: ${JSON.stringify(migrations)} }, datasource: { url: process.env.DATABASE_URL } };\n`);
  scratchFiles.push(config); return config;
}
async function prismaFor(target: typeof fresh, run: (prisma: PrismaService) => Promise<void>) {
  const prisma = new PrismaService({ ...loadConfiguration(), databaseUrl: target.testUrl });
  try { await prisma.onModuleInit(); await run(prisma); } finally { await prisma.$disconnect(); }
}

beforeAll(async () => {
  await admin.connect(); await createDatabase(fresh); await createDatabase(upgrade);
  deploy(upgrade, baselineConfiguration()); await upgradeClient.connect();
  expect((await upgradeClient.query('SELECT migration_name FROM _prisma_migrations ORDER BY migration_name')).rows
    .map(row => row.migration_name)).toEqual(previousMigrations);
  const hash = await passwords.hash(fixturePassword);
  await prismaFor(upgrade, async prisma => { await seedPermissionCatalog(prisma); });
  await upgradeClient.query(`INSERT INTO employee
    (id,username,display_name,password_hash,role,must_change_password,token_version,permission_version,version,updated_at)
    VALUES ($1,'migration_employee','迁移测试员工',$3,'CUSTOMER_SERVICE',false,2,3,7,now()),
           ($2,'migration_admin','迁移测试管理员',$3,'SUPER_ADMIN',false,0,0,0,now())`, [employeeId, adminId, hash]);
  await upgradeClient.query(`INSERT INTO customer (id,phone,password_hash,nickname,status,token_version,updated_at)
    VALUES ($1,'13900000001',$2,'迁移测试顾客','TRADE_RESTRICTED',4,now())`, [customerId, hash]);
  await upgradeClient.query(`INSERT INTO auth_session (id,subject_type,employee_id,customer_id,token_version,expires_at)
    VALUES ($1,'EMPLOYEE',$2,NULL,2,now()+interval '1 hour'),($3,'CUSTOMER',NULL,$4,4,now()+interval '1 hour')`,
  [randomUUID(), employeeId, randomUUID(), customerId]);
  await upgradeClient.query(`INSERT INTO employee_extra_permission (employee_id,permission_code,granted_by_id)
    VALUES ($1,'shipment.tracking.correct',$2)`, [employeeId, adminId]);
  await upgradeClient.query(`INSERT INTO audit_log (id,actor_type,actor_employee_id,action,target_type,target_id,reason,after_data,request_id)
    VALUES ($1,'EMPLOYEE',$2,'employee.permission.replace','Employee',$3,'迁移保护测试',$4,$5)`,
  [randomUUID(), adminId, employeeId, { extraPermissions: ['shipment.tracking.correct'] }, randomUUID()]);
  // 这里只创建文件元数据与引用，验证迁移保护；不伪造真实上传或磁盘图片验收。
  await prismaFor(upgrade, async prisma => {
    const id = randomUUID();
    await prisma.fileAsset.create({ data: { id, uploaderType: 'CUSTOMER', uploaderCustomerId: customerId,
      purpose: 'CUSTOMER_AVATAR', state: 'RETAINED', visibility: 'PUBLIC', storageKey: `${id}.png`, originalName: '隔离测试.png',
      mimeType: 'image/png', byteSize: 1, width: 1, height: 1, sha256: 'a'.repeat(64) } });
    await prisma.customer.update({ where: { id: customerId }, data: { avatarAssetId: id }, select: { id: true } });
    await prisma.fileReference.create({ data: { fileAssetId: id, ownerType: 'CUSTOMER_AVATAR', ownerId: customerId,
      slot: 'avatar', audience: 'PUBLIC', createdByType: 'CUSTOMER', createdByCustomerId: customerId } });
    const original = await prisma.communication.create({ data: { scopeType: 'ORDER', scopeId: randomUUID(),
      authorEmployeeId: employeeId, channel: 'PHONE', occurredAt: fixtureTime, result: '隔离旧沟通记录', requestId: randomUUID() } });
    await prisma.communication.create({ data: { scopeType: original.scopeType, scopeId: original.scopeId,
      authorEmployeeId: employeeId, channel: 'PHONE', occurredAt: fixtureDue, result: '隔离追加更正', correctsId: original.id,
      correctionReason: '迁移保护测试', requestId: randomUUID() } });
    await prisma.businessStateHistory.create({ data: { aggregateType: 'ORDER', aggregateId: original.scopeId,
      dimension: 'main', commandKey: randomUUID(), toState: 'WAIT_PAYMENT', actorType: 'EMPLOYEE',
      actorEmployeeId: employeeId, requestId: randomUUID() } });
  });
  before = await snapshot(upgradeClient);
  deploy(fresh); deploy(upgrade); await freshClient.connect();
}, 90_000);

afterAll(async () => {
  await Promise.all([freshClient.end(), upgradeClient.end()]);
  try {
    for (const target of [fresh, upgrade]) {
      const checked = assertSafeTestDatabase(base.developmentUrl, target.testUrl);
      if (!createdDatabases.has(checked.testName)) continue;
      if (!/^tasks_migration_[a-f0-9]{32}_test$/.test(checked.testName)) throw new Error('临时测试库清理目标不合法');
      // 不使用FORCE，不终止未知连接；仅删除本轮已登记的数据库。
      await admin.query(`DROP DATABASE "${checked.testName}"`); createdDatabases.delete(checked.testName);
    }
    expect(createdDatabases.size).toBe(0);
  } finally {
    await admin.end();
    console.log('保留迁移测试临时目录：' + scratchDirectories.join(', '));
  }
}, 30_000);

it('空库通过五条正式迁移，仅Head有未配置行，不提前建立订单和来源表', async () => {
  expect((await freshClient.query('SHOW server_version')).rows[0].server_version).toMatch(/^16\./);
  expect((await freshClient.query('SELECT migration_name,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name')).rows)
    .toEqual(expectedMigrations.map(migration_name => ({ migration_name, finished_at: expect.any(Date), rolled_back_at: null })));
  for (const table of taskTables) expect((await freshClient.query(`SELECT count(*)::int AS count FROM "${table}"`)).rows[0].count)
    .toBe(table === 'store_setting_head' ? 1 : 0);
  expect((await freshClient.query('SELECT * FROM store_setting_head')).rows).toEqual([{ id: 1, current_version_id: null, version: 0 }]);
  expect((await freshClient.query("SELECT to_regclass('public.inventory_adjustment') AS name")).rows[0].name).toBe('inventory_adjustment');
  for (const table of ['order', 'after_sale', 'task_business_source', 'order_block', 'timer_pause']) {
    expect((await freshClient.query('SELECT to_regclass($1) AS relation', [`public.${table}`])).rows[0].relation).toBeNull();
  }
});
it('0003升级保留12张旧表的每一行、真实密码哈希、会话、权限、头像引用和历史', async () => {
  const after = await snapshot(upgradeClient);
  after.customer=after.customer!.map(({status_version:statusVersion,...row})=>{expect(statusVersion).toBe(0);return row;});
  expect(after.system_guard?.find(row=>row.key==='CATEGORY_TREE')).toEqual({key:'CATEGORY_TREE',created_at:expect.any(Date)});
  after.system_guard=after.system_guard!.filter(row=>row.key!=='CATEGORY_TREE');expect(after).toEqual(before);
  expect(after.permission_definition).toHaveLength(52); expect(after.role_permission).toHaveLength(89);
  expect(after.auth_session).toHaveLength(2); expect(after.file_reference).toHaveLength(1);
  expect(after.communication).toHaveLength(2); expect(after.business_state_history).toHaveLength(1);
  expect(await passwords.verify(fixturePassword, after.employee!.find(row => row.id === employeeId)!.password_hash as string)).toBe(true);
  expect(await passwords.verify(fixturePassword, after.customer![0]!.password_hash as string)).toBe(true);
});
it('重复deploy保留原迁移记录、旧数据和新Head', async () => {
  const data = await snapshot(upgradeClient);
  const records = (await upgradeClient.query('SELECT * FROM _prisma_migrations ORDER BY migration_name')).rows;
  deploy(upgrade);
  expect(await snapshot(upgradeClient)).toEqual(data);
  expect((await upgradeClient.query('SELECT * FROM _prisma_migrations ORDER BY migration_name')).rows).toEqual(records);
  expect((await upgradeClient.query('SELECT * FROM store_setting_head')).rows).toEqual([{ id: 1, current_version_id: null, version: 0 }]);
}, 30_000);
it('空库和0003升级库的字段、CHECK、FK和索引一致', async () => {
  async function structure(client: Client) {
    const columns = (await client.query(`SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default
      FROM information_schema.columns WHERE table_schema='public' AND table_name<>'_prisma_migrations'
      ORDER BY table_name,ordinal_position`)).rows;
    const constraints = (await client.query(`SELECT c.relname AS table_name,p.conname,pg_get_constraintdef(p.oid) AS definition
      FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname<>'_prisma_migrations' ORDER BY c.relname,p.conname`)).rows;
    const indexes = (await client.query(`SELECT tablename,indexname,indexdef FROM pg_indexes
      WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename,indexname`)).rows;
    return { columns, constraints, indexes };
  }
  expect(await structure(upgradeClient)).toEqual(await structure(freshClient));
});

it('Prisma新增关系可访问且外层失败时8张表的整组变更一起回滚', async () => {
  const rollback = new Error('关系测试主动回滚'); const id = randomUUID();
  await prismaFor(fresh, async prisma => {
    await expect(prisma.$transaction(async tx => {
      const employee = await tx.employee.create({ data: { id, username: 'task_relation_employee', displayName: '任务关系测试员工',
        passwordHash: '仅隔离结构测试占位值', role: 'CUSTOMER_SERVICE' } });
      const row = settingRow();
      const setting = await tx.storeSettingVersion.create({ data: { versionNumber: 1, createdByEmployeeId: employee.id,
        reason: row.reason as string, shippingFeeCents: 0, freeShippingEnabled: false, freeShippingThresholdCents: 0,
        returnReceiver: row.return_receiver as string, returnPhone: row.return_phone as string, returnProvince: row.return_province as string,
        returnCity: row.return_city as string, returnDistrict: row.return_district as string, returnDetail: row.return_detail as string,
        servicePhone: row.service_phone as string, paymentMinutes: 30, autoReceiptDays: 10, afterSaleWindowDays: 7,
        reviewWorkdays: 2, supplementDays: 7, returnShipDays: 7, inspectionWorkdays: 2, refundWorkdays: 1 } });
      await tx.storeSettingHead.update({ where: { id: 1 }, data: { currentVersionId: setting.id, version: 1 } });
      const cursor = await tx.taskStageCursor.create({ data: { businessType: 'AFTER_SALE', businessId: randomUUID(),
        stage: 'AFTER_SALE_REVIEW', lastRound: 1 } });
      const task = await tx.task.create({ data: { cursorId: cursor.id, businessType: cursor.businessType, businessId: cursor.businessId,
        stage: cursor.stage, round: 1, entryKey: randomUUID(), requiredPermissions: ['after-sale.review'],
        status: 'CLAIMED', assigneeId: id, startedAt: fixtureTime, originalDueAt: fixtureDue, dueAt: fixtureDue,
        settingsVersionId: setting.id, ruleSnapshot: { unit: 'WORKDAY', amount: 2 } } });
      await tx.taskHistory.create({ data: { taskId: task.id, action: 'CLAIMED', actorType: 'EMPLOYEE', actorEmployeeId: id,
        beforeStatus: 'OPEN', afterStatus: 'CLAIMED', toAssigneeId: id, commandKey: randomUUID(), requestId: randomUUID() } });
      await tx.deadlineEvent.create({ data: { taskId: task.id, eventType: 'OVERDUE', deadlineAt: fixtureDue, occurredAt: fixtureDue,
        detectedAt: fixtureDue, actorType: 'SYSTEM', commandKey: randomUUID(), requestId: randomUUID() } });
      const run = await tx.schedulerRun.create({ data: { jobName: '关系测试', instanceId: 'test', requestId: randomUUID() } });
      await tx.schedulerFailure.create({ data: { runId: run.id, taskId: task.id, errorCode: 'TEST_ERROR', sanitizedMessage: '隔离测试' } });
      const result = await tx.task.findUniqueOrThrow({ where: { id: task.id }, include: { cursor: true, assignee: true,
        settingsVersion: { include: { heads: true, createdByEmployee: true } }, history: { include: { actorEmployee: true, toAssignee: true } },
        deadlineEvents: true, schedulerFailures: { include: { run: true } } } });
      expect(result.assignee?.id).toBe(id); expect(result.cursor.id).toBe(cursor.id);
      expect(result.settingsVersion?.heads[0]?.version).toBe(1); expect(result.settingsVersion?.createdByEmployee?.id).toBe(id);
      expect(result.history[0]?.toAssignee?.id).toBe(id); expect(result.deadlineEvents).toHaveLength(1);
      expect(result.schedulerFailures[0]?.run.id).toBe(run.id); throw rollback;
    })).rejects.toBe(rollback);
    expect(await prisma.employee.findUnique({ where: { id } })).toBeNull();
  });
  for (const table of taskTables) expect((await freshClient.query(`SELECT count(*)::int AS count FROM "${table}"`)).rows[0].count)
    .toBe(table === 'store_setting_head' ? 1 : 0);
  expect((await freshClient.query('SELECT version FROM store_setting_head')).rows[0].version).toBe(0);
});

// 两条真实连接产生唯一索引等待；观察到阻塞后才提交第一条，验证数据库底线而非业务领取服务。
async function race(table: 'task' | 'deadline_event', first: SchemaRow, second: SchemaRow, constraint: string) {
  const left = new Client({ connectionString: fresh.testUrl, statement_timeout: 8000 });
  const right = new Client({ connectionString: fresh.testUrl, statement_timeout: 8000 });
  let pending: Promise<unknown> | undefined;
  try {
    await Promise.all([left.connect(), right.connect()]);
    const leftPid = (await left.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
    const rightPid = (await right.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
    await left.query('BEGIN'); await right.query('BEGIN'); await insertSchemaRow(left, table, first);
    pending = insertSchemaRow(right, table, second).then(() => ({ code: 'UNEXPECTED_SUCCESS' }), (error: unknown) => error);
    let blocked = false; const until = performance.now() + 2000;
    while (performance.now() < until) {
      const row = (await freshClient.query('SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked', [leftPid, rightPid])).rows[0];
      if (row.blocked) { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(blocked).toBe(true); await left.query('COMMIT');
    expect(await pending).toMatchObject({ code: '23505', constraint });
  } finally {
    await Promise.allSettled([left.query('ROLLBACK'), right.query('ROLLBACK')]);
    await pending; await Promise.all([left.end(), right.end()]);
  }
}
it('并发插入同一有效阶段，提交赢家后另一连接被唯一索引拒绝', async () => {
  const cursor = cursorRow(); const first = taskRow(cursor); const second = taskRow(cursor, { round: 2 });
  await insertSchemaRow(freshClient, 'task_stage_cursor', cursor);
  try {
    await race('task', first, second, 'task_one_active_stage_key');
    expect((await freshClient.query('SELECT id FROM task WHERE cursor_id=$1', [cursor.id])).rows).toEqual([{ id: first.id }]);
  } finally {
    await freshClient.query('DELETE FROM task WHERE cursor_id=$1', [cursor.id]);
    await freshClient.query('DELETE FROM task_stage_cursor WHERE id=$1', [cursor.id]);
  }
});
it('并发写同一截止的逾期事实，仅一连接提交成功', async () => {
  const cursor = cursorRow(); const task = taskRow(cursor);
  await insertSchemaRow(freshClient, 'task_stage_cursor', cursor); await insertSchemaRow(freshClient, 'task', task);
  try {
    await race('deadline_event', deadlineRow(task.id), deadlineRow(task.id), 'deadline_event_one_overdue_key');
    expect((await freshClient.query('SELECT count(*)::int AS count FROM deadline_event WHERE task_id=$1', [task.id])).rows[0].count).toBe(1);
  } finally {
    await freshClient.query('DELETE FROM deadline_event WHERE task_id=$1', [task.id]);
    await freshClient.query('DELETE FROM task WHERE id=$1', [task.id]);
    await freshClient.query('DELETE FROM task_stage_cursor WHERE id=$1', [cursor.id]);
  }
});
