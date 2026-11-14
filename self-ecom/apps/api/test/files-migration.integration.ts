// 作用：在本轮专用空库和板块2升级库中验证0003迁移、旧数据保持、重复部署及Prisma关系。
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { assertSafeTestDatabase } from '../scripts/database-env.js';
import { runPrisma } from '../scripts/database.js';
import { loadConfiguration } from '../src/config/environment.js';
import { PasswordService } from '../src/auth/password.service.js';
import { seedPermissionCatalog } from '../src/permissions/permission-seed.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const base = assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('集成测试仅可在test环境执行');
const previousMigrations = ['0001_bootstrap', '0002_auth_employee_permission_audit'];
const expectedMigrations = [...previousMigrations, '0003_files_communication_history', '0004_store_settings_tasks_deadlines','0005_categories_products_skus_inventory_accounts','0006_inventory_sources_adjustments_ledger','0007_customer_status_addresses_cart','0008_orders_quotes_idempotency_blocks','0009_payments_stock_issues','0010_order_snapshot_file_reference','0011_fulfillment_shipments_handover','0012_fulfillment_fact_guards','0013_inventory_fact_guards','0014_after_sales_review_material_return'];
const oldTables = ['employee', 'customer', 'auth_session', 'permission_definition', 'role_permission',
  'employee_extra_permission', 'audit_log', 'system_guard'] as const;
const newTables = ['file_asset', 'file_reference', 'communication', 'business_state_history'];
const createdDatabases = new Set<string>();
const scratchFiles: string[] = []; const scratchDirectories: string[] = [];
const databaseUrl = () => {
  const url = new URL(base.testUrl); url.pathname = `/files_migration_${randomUUID().replaceAll('-', '')}_test`;
  return assertSafeTestDatabase(base.developmentUrl, url.toString());
};
const fresh = databaseUrl(); const upgrade = databaseUrl();
const adminUrl = new URL(base.testUrl); adminUrl.pathname = '/postgres';
const admin = new Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 2000 });
const freshClient = new Client({ connectionString: fresh.testUrl });
const upgradeClient = new Client({ connectionString: upgrade.testUrl });
const passwords = new PasswordService();
const fixturePassword = 'MigrationFixture#2026';
const employeeId = randomUUID(); const adminId = randomUUID(); const customerId = randomUUID();
let before: Record<string, Record<string, unknown>[]>;

async function createDatabase(target: typeof fresh) {
  const checked = assertSafeTestDatabase(base.developmentUrl, target.testUrl);
  if (!/^files_migration_[a-f0-9]{32}_test$/.test(checked.testName)) throw new Error('临时测试库名称不合法');
  // CREATE失败不会登记所有权；只删除本轮明确创建成功的库，不复用或重置现有库。
  await admin.query(`CREATE DATABASE "${checked.testName}" ENCODING 'UTF8' TEMPLATE template0`);
  createdDatabases.add(checked.testName);
}
function deploy(target: typeof fresh, config?: string) {
  assertSafeTestDatabase(base.developmentUrl, target.testUrl);
  runPrisma(['migrate', 'deploy', ...(config ? ['--config', config] : [])], { ...process.env, DATABASE_URL: target.testUrl });
}
async function snapshot(client: Client) {
  const rows: Record<string, Record<string, unknown>[]> = {};
  for (const table of oldTables) {
    // 表名仅来自上面的固定清单；按行内容稳定排序，不依赖数据库的默认返回次序。
    rows[table] = (await client.query<Record<string, unknown>>(`SELECT * FROM "${table}"`)).rows
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  return rows;
}
function baselineConfiguration() {
  const scratch = mkdtempSync(join(tmpdir(), 'self-ecom-m003-migrations-')); scratchDirectories.push(scratch);
  const migrations = join(scratch, 'migrations'); mkdirSync(migrations); scratchDirectories.push(migrations);
  for (const name of previousMigrations) {
    const directory = join(migrations, name); mkdirSync(directory); scratchDirectories.push(directory);
    const sql = join(directory, 'migration.sql');
    copyFileSync(resolve(__dirname, '../prisma/migrations', name, 'migration.sql'), sql); scratchFiles.push(sql);
  }
  const lock = join(migrations, 'migration_lock.toml');
  copyFileSync(resolve(__dirname, '../prisma/migrations/migration_lock.toml'), lock); scratchFiles.push(lock);
  const config = join(scratch, 'prisma.config.ts');
  // 临时配置不写任何连接串；Prisma仅从受控子进程环境读取目标库。
  writeFileSync(config, `export default { schema: ${JSON.stringify(resolve(__dirname, '../prisma/schema.prisma'))},
    migrations: { path: ${JSON.stringify(migrations)} }, datasource: { url: process.env.DATABASE_URL } };\n`);
  scratchFiles.push(config); return config;
}

beforeAll(async () => {
  await admin.connect();
  await createDatabase(fresh); await createDatabase(upgrade);
  deploy(upgrade, baselineConfiguration());
  await upgradeClient.connect();
  expect((await upgradeClient.query('SELECT migration_name FROM _prisma_migrations ORDER BY migration_name')).rows
    .map(row => row.migration_name)).toEqual(previousMigrations);
  expect((await upgradeClient.query("SELECT column_name FROM information_schema.columns WHERE table_name='customer' AND column_name='avatar_asset_id'"))
    .rowCount).toBe(0);
  const hash = await passwords.hash(fixturePassword);
  const prisma = new PrismaService({ ...loadConfiguration(), databaseUrl: upgrade.testUrl });
  try { await prisma.onModuleInit(); await seedPermissionCatalog(prisma); }
  finally { await prisma.$disconnect(); }
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
  before = await snapshot(upgradeClient);
  deploy(fresh); deploy(upgrade);
  await freshClient.connect();
}, 60_000);

afterAll(async () => {
  await Promise.all([freshClient.end(), upgradeClient.end()]);
  try {
    for (const target of [fresh, upgrade]) {
      const checked = assertSafeTestDatabase(base.developmentUrl, target.testUrl);
      if (!createdDatabases.has(checked.testName)) continue;
      if (!/^files_migration_[a-f0-9]{32}_test$/.test(checked.testName)) throw new Error('临时测试库清理目标不合法');
      // 不使用FORCE，不终止未知连接，不删除任何预先存在的库。
      await admin.query(`DROP DATABASE "${checked.testName}"`); createdDatabases.delete(checked.testName);
    }
    expect(createdDatabases.size).toBe(0);
  } finally {
    await admin.end();
    // 只逐个删除本轮登记的文件和空目录，不递归扫描临时目录。
    console.log('保留迁移测试临时目录：' + scratchDirectories.join(', '));
  }
}, 30_000);

it('PostgreSQL16空库通过十四条正式迁移，文件表为空且订单基础表已建立', async () => {
  expect((await freshClient.query('SHOW server_version')).rows[0].server_version).toMatch(/^16\./);
  const migrations = await freshClient.query('SELECT migration_name,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name');
  expect(migrations.rows).toEqual(expectedMigrations.map(migration_name => ({ migration_name, finished_at: expect.any(Date), rolled_back_at: null })));
  for (const table of newTables) expect((await freshClient.query(`SELECT count(*)::int AS count FROM "${table}"`)).rows[0].count).toBe(0);
  expect((await freshClient.query("SELECT to_regclass('public.inventory_adjustment') AS name")).rows[0].name).toBe('inventory_adjustment');
  for (const table of ['after_sale']) {
    expect((await freshClient.query('SELECT to_regclass($1) AS relation', [`public.${table}`])).rows[0].relation).toBe(table);
  }
});

it('已有板块2的账号、真实密码哈希、状态版本、会话、52项权限、89项绑定和审计完整保持', async () => {
  const after = await snapshot(upgradeClient);
  after.customer = after.customer!.map(({ avatar_asset_id: avatarAssetId, status_version: statusVersion, ...customer }) => {
    expect(avatarAssetId).toBeNull(); expect(statusVersion).toBe(0); return customer;
  });
  expect(after.system_guard?.find(row=>row.key==='CATEGORY_TREE')).toEqual({key:'CATEGORY_TREE',created_at:expect.any(Date)});
  after.system_guard=after.system_guard!.filter(row=>row.key!=='CATEGORY_TREE');
  expect(after).toEqual(before);
  expect(after.permission_definition).toHaveLength(52); expect(after.role_permission).toHaveLength(89);
  expect(after.auth_session).toHaveLength(2); expect(after.audit_log).toHaveLength(1);
  expect(await passwords.verify(fixturePassword, after.employee!.find(row => row.id === employeeId)!.password_hash as string)).toBe(true);
  expect(await passwords.verify(fixturePassword, after.customer![0]!.password_hash as string)).toBe(true);
});

it('重复migrate deploy不再执行迁移，也不重置账号和业务记录', async () => {
  const dataBefore = await snapshot(upgradeClient);
  const migrationsBefore = (await upgradeClient.query('SELECT * FROM _prisma_migrations ORDER BY migration_name')).rows;
  deploy(upgrade);
  expect(await snapshot(upgradeClient)).toEqual(dataBefore);
  expect((await upgradeClient.query('SELECT * FROM _prisma_migrations ORDER BY migration_name')).rows).toEqual(migrationsBefore);
}, 30_000);

it('空库与升级库的实际字段、CHECK、外键和索引完全一致', async () => {
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

it('生成的Prisma客户端能访问新增关系，并在外层回滚后撤销整组数据', async () => {
  const prisma = new PrismaService({ ...loadConfiguration(), databaseUrl: fresh.testUrl });
  const rollback = new Error('关系测试主动回滚'); const id = randomUUID(); const fileId = randomUUID();
  try {
    await prisma.onModuleInit();
    await expect(prisma.$transaction(async tx => {
      const employee = await tx.employee.create({ data: { username: 'relation_employee', displayName: '关系测试员工',
        passwordHash: '仅为结构测试占位值', role: 'CUSTOMER_SERVICE' } });
      await tx.customer.create({ data: { id, phone: '13900000002', nickname: '关系测试顾客', passwordHash: '仅为结构测试占位值' } });
      await tx.fileAsset.create({ data: { id: fileId, uploaderType: 'CUSTOMER', uploaderCustomerId: id,
        purpose: 'CUSTOMER_AVATAR', state: 'RETAINED', visibility: 'PUBLIC', storageKey: `${fileId}.png`, originalName: '测试.png',
        mimeType: 'image/png', byteSize: 1, width: 1, height: 1, sha256: 'a'.repeat(64) } });
      await tx.customer.update({ where: { id }, data: { avatarAssetId: fileId } });
      await tx.fileReference.create({ data: { fileAssetId: fileId, ownerType: 'CUSTOMER_AVATAR', ownerId: id, slot: 'avatar',
        audience: 'PUBLIC', createdByType: 'CUSTOMER', createdByCustomerId: id } });
      const original = await tx.communication.create({ data: { scopeType: 'ORDER', scopeId: randomUUID(), authorEmployeeId: employee.id,
        channel: 'PHONE', occurredAt: new Date(), result: '测试内部记录', requestId: randomUUID() } });
      const correction = await tx.communication.create({ data: { scopeType: original.scopeType, scopeId: original.scopeId,
        authorEmployeeId: employee.id, channel: 'PHONE', occurredAt: new Date(), result: '测试补充记录', correctsId: original.id,
        correctionReason: '测试追加更正关系', requestId: randomUUID() }, include: { corrects: true, authorEmployee: true } });
      expect(correction.corrects?.id).toBe(original.id); expect(correction.authorEmployee.id).toBe(employee.id);
      await tx.businessStateHistory.create({ data: { aggregateType: 'ORDER', aggregateId: original.scopeId, dimension: 'main',
        commandKey: randomUUID(), toState: 'WAIT_PAYMENT', actorType: 'EMPLOYEE', actorEmployeeId: employee.id, requestId: randomUUID() } });
      const customer = await tx.customer.findUniqueOrThrow({ where: { id }, include: { avatarAsset: true,
        uploadedFiles: { include: { references: true, currentAvatars: true } } } });
      expect(customer.avatarAsset?.id).toBe(fileId); expect(customer.uploadedFiles[0]?.references).toHaveLength(1);
      expect(customer.uploadedFiles[0]?.currentAvatars.map(row => row.id)).toEqual([id]);
      throw rollback;
    })).rejects.toBe(rollback);
    expect(await prisma.customer.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.fileAsset.findUnique({ where: { id: fileId } })).toBeNull();
    for (const table of newTables) expect((await freshClient.query(`SELECT count(*)::int AS count FROM "${table}"`)).rows[0].count).toBe(0);
  } finally { await prisma.$disconnect(); }
});
