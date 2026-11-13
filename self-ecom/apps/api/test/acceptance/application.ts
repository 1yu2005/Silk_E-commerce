// 作用：独立test应用复用真实Nest/Guard/事务/SQL，替代尚未建立的业务领域；生产入口不导入本文件。
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { EmployeeRole, Task } from '@prisma/client';
import { Client } from 'pg';
import { assertSafeTestDatabase } from '../../scripts/database-env.js';
import { AppModule } from '../../src/app.module.js';
import { AuthSessionService } from '../../src/auth/auth-session.service.js';
import { CurrentIdentityService } from '../../src/auth/current-identity.service.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { JwtTokenService } from '../../src/auth/jwt-token.service.js';
import { configureApp } from '../../src/common/configure-app.js';
import { APP_CONFIG, loadConfiguration } from '../../src/config/environment.js';
import { seedPermissionCatalog } from '../../src/permissions/permission-seed.js';
import { PermissionService } from '../../src/permissions/permission.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { TaskBusinessAdapters, type TaskBusinessAccess } from '../../src/tasks/task-business-adapters.js';
import { TaskCommandService } from '../../src/tasks/task-command.service.js';
import { TaskEntryService } from '../../src/tasks/task-entry.service.js';
import { TaskOverdueScanService } from '../../src/tasks/task-overdue-scan.service.js';
import { createFixture } from '../fixtures/task-entry-business.js';
import { FixtureDeadlineAdapters, installDeadlineFixture } from '../fixtures/task-deadline-business.js';

/** 只改变测试业务摘要；沿用真实SQL可见范围、领域经办和期限同步，不注入成功响应。 */
class AcceptanceAdapters extends FixtureDeadlineAdapters {
  readonly labels = new Map<string, { number: string; label: string }>();
  override access(type: Parameters<FixtureDeadlineAdapters['access']>[0]): TaskBusinessAccess | undefined {
    const access = super.access(type); if (!access) return;
    return { ...access, describe: async (tx, actor, task) => ({ ...await access.describe(tx, actor, task), ...this.labels.get(task.id) }) };
  }
}
export interface AcceptanceOptions { root: string; env: NodeJS.ProcessEnv; fixtures?: boolean; port?: number }
/** 必须显式test环境；每次只创建随机专属库，不连接现有shop_test写入，不提供造任务HTTP。 */
export async function startTaskAcceptance({ root, env, fixtures = false, port = 3001 }: AcceptanceOptions) {
  if (env.NODE_ENV !== 'test') throw new Error('隔离任务应用仅允许NODE_ENV=test');
  const safe = assertSafeTestDatabase(env.DATABASE_URL, env.TEST_DATABASE_URL);
  const name = `task_acceptance_${randomUUID().replaceAll('-', '')}_test`;
  assert.match(name, /^task_acceptance_[a-f0-9]{32}_test$/);
  const url = new URL(safe.testUrl); url.pathname = '/' + name;
  const target = assertSafeTestDatabase(safe.developmentUrl, url.toString());
  const server = new URL(safe.testUrl); server.pathname = '/postgres';
  const admin = new Client({ connectionString: server.toString(), connectionTimeoutMillis: 2000 });
  const password = randomBytes(18).toString('base64url'); const secret = randomBytes(48).toString('hex');
  const configEnv = { ...env, DATABASE_URL: target.testUrl, NODE_ENV: 'test', LOG_LEVEL: 'silent', JWT_SECRET: secret, PORT: String(port || 3001), SWAGGER_ENABLED: 'true',
    UPLOAD_DIR: resolve(root, 'storage/acceptance', name) };
  let app: INestApplication | undefined; let created = false; let connected = false; let closed = false;
  const close = async () => {
    if (closed) return; closed = true;
    try {
      await app?.close();
      if (created) { assertSafeTestDatabase(safe.developmentUrl, target.testUrl); await admin.query(`DROP DATABASE "${name}"`); created = false; }
    } finally { if (connected) { await admin.end(); connected = false; } }
  };
  try {
    await admin.connect(); connected = true; await admin.query(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`); created = true;
    const migration = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], { cwd: resolve(root, 'apps/api'), env: configEnv,
      windowsHide: true, encoding: 'utf8', timeout: 60_000 });
    if (migration.status !== 0 || migration.error) throw new Error('隔离任务库迁移失败');
    const adapters = new AcceptanceAdapters();
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(APP_CONFIG).useValue(loadConfiguration(configEnv))
      .overrideProvider(JwtTokenService).useValue(new JwtTokenService({ secret, ttlSeconds: 7200 }))
      .overrideProvider(TaskBusinessAdapters).useValue(adapters).compile();
    app = module.createNestApplication(); configureApp(app); await app.init();
    const prisma = app.get(PrismaService); await seedPermissionCatalog(prisma); await prisma.$transaction(installDeadlineFixture);
    const passwordHash = await new PasswordService().hash(password);
    const accounts: { id: string; username: string; displayName: string; role: EmployeeRole }[] = [];
    for (const [username, displayName, role] of [
      ['task_admin', '验收管理员', 'SUPER_ADMIN'], ['warehouse_a', '仓储甲', 'MERCH_WAREHOUSE'], ['warehouse_b', '仓储乙', 'MERCH_WAREHOUSE'],
      ['support_a', '客服甲', 'CUSTOMER_SERVICE'], ['support_b', '客服乙', 'CUSTOMER_SERVICE'],
    ] as const) {
      const row = await prisma.employee.create({ data: { username, displayName, role, passwordHash, mustChangePassword: false } });
      accounts.push({ id: row.id, username, displayName, role });
    }
    const taskIds: Record<string, string> = {};
    if (fixtures) {
      const manager = accounts[0]!; const support = accounts[3]!;
      const settings = await prisma.storeSettingVersion.create({ data: { versionNumber: 1, createdByEmployeeId: manager.id, reason: '隔离任务验收设置',
        shippingFeeCents: 1000, freeShippingEnabled: true, freeShippingThresholdCents: 9900, returnReceiver: '验收仓库', returnPhone: '01000000000',
        returnProvince: '测试省', returnCity: '测试市', returnDistrict: '测试区', returnDetail: '仅用于隔离任务验收', servicePhone: '01000000000',
        paymentMinutes: 30, autoReceiptDays: 10, afterSaleWindowDays: 7, reviewWorkdays: 2, supplementDays: 7, returnShipDays: 7, inspectionWorkdays: 2, refundWorkdays: 1 } });
      await prisma.storeSettingHead.update({ where: { id: 1 }, data: { currentVersionId: settings.id, version: 1 } });
      const customer = await prisma.customer.create({ data: { phone: '19900000091', nickname: '隔离服装验收顾客', passwordHash } });
      const entry = app.get(TaskEntryService); const now = new Date();
      const make = async (key: string, businessType: 'ORDER' | 'AFTER_SALE', stage: Task['stage'], title: string, startedAt = new Date(+now - 3600_000)) => {
        const business = await createFixture(prisma, customer.id, { businessType, allowedStage: stage, startedAt });
        const reference = { businessType, businessId: business.id };
        const task = await prisma.$transaction(tx => entry.withContext(tx, { type: 'SYSTEM' }, [reference], randomUUID(), async context =>
          (await entry.enterStage(context, { ...reference, stage, entryKey: `acceptance:${key}`, reason: `隔离验收：${title}` })).task));
        await prisma.$executeRaw`INSERT INTO task_deadline_fixture(task_id,due_at,payment_due_at,application_window_at,receipt_base_due_at,actual_handover_at)
          VALUES(${task.id}::uuid,${task.dueAt},${new Date(+now + 30 * 60_000)},${new Date(+now + 7 * 86400_000)},${new Date(+now + 10 * 86400_000)},${new Date(+now - 86400_000)})`;
        adapters.labels.set(task.id, { number: `验收-${key}`, label: title }); taskIds[key] = task.id; return task;
      };
      await make('T1', 'ORDER', 'SHIPMENT_PROCESS', '棉质衬衫 · 藏青 · M，发货处理');
      await make('T2', 'AFTER_SALE', 'AFTER_SALE_REVIEW', '针织开衫 · 米白 · L，售后审核', new Date(+now - 10 * 86400_000));
      const t3 = await make('T3', 'AFTER_SALE', 'AFTER_SALE_REVIEW', '卫衣 · 灰 · S，附加资格任务');
      const extra = app.get(PermissionService).resolveExtraPermissions('CUSTOMER_SERVICE', [], ['inventory.read']).resolvedExtraPermissions;
      await prisma.employeeExtraPermission.createMany({ data: extra.map(permissionCode => ({ employeeId: support.id, permissionCode, grantedById: manager.id })) });
      await prisma.task.update({ where: { id: t3.id }, data: { requiredPermissions: [...t3.requiredPermissions as string[], 'inventory.read'] } });
      const sessions = app.get(AuthSessionService); const identities = app.get(CurrentIdentityService);
      const credential = await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, { subjectType: 'EMPLOYEE', subjectId: support.id, expectedPasswordHash: passwordHash, expectedTokenVersion: 0 }));
      const identity = await identities.authenticate(prisma, credential.accessToken, 'EMPLOYEE');
      await app.get(TaskCommandService).claim(identity, credential.accessToken, t3.id, { expectedVersion: 0 }, randomUUID());
      const t4 = await make('T4', 'ORDER', 'SHIPMENT_PROCESS', '长裤 · 黑 · XL，交运状态待核实');
      // 先真实领取，再设置领域阻塞；释放接口仍由真实领域条件拒绝。
      const warehouse = accounts[1]!;
      const warehouseSession = await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, { subjectType: 'EMPLOYEE', subjectId: warehouse.id, expectedPasswordHash: passwordHash, expectedTokenVersion: 0 }));
      const warehouseIdentity = await identities.authenticate(prisma, warehouseSession.accessToken, 'EMPLOYEE');
      await app.get(TaskCommandService).claim(warehouseIdentity, warehouseSession.accessToken, t4.id, { expectedVersion: 0 }, randomUUID());
      await prisma.$executeRaw`UPDATE task_entry_fixture SET safe_release=false WHERE id=${t4.businessId}::uuid`;
    }
    await app.listen(port, '127.0.0.1');
    return { app, prisma, password, accounts, taskIds, databaseName: name, base: (await app.getUrl()) + '/api/v1', close,
      scan: () => app!.get(TaskOverdueScanService).scan() };
  } catch (error) { await close(); throw error; }
}
