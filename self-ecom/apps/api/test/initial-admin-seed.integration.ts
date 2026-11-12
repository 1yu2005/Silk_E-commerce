// 作用：验证空库首管理员初始化、已有账号保护、并发仲裁及事务回滚。
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/common/configure-app.js';
import { assertSafeTestDatabase } from '../scripts/database-env.js';
import { prepareTestDatabase, runPrisma } from '../scripts/database.js';
import { APP_CONFIG, loadConfiguration } from '../src/config/environment.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuditService } from '../src/audit/audit.service.js';
import { PasswordService } from '../src/auth/password.service.js';
import { readInitialAdminConfig, seedInitialAdmin } from '../src/auth/initial-admin-seed.js';
import { EmployeeAuthController } from '../src/auth/employee-auth.controller.js';
import { EmployeeLoginDto } from '../src/auth/employee-login.dto.js';
import { seedPermissionCatalog } from '../src/permissions/permission-seed.js';

const base = assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('集成测试仅可在test环境执行');
// 每轮新建专用空库，不删除或重置原shop_test中的员工和权限数据。
const databaseName = `admin_seed_${randomUUID().replaceAll('-', '')}_test`;
const targetUrl = new URL(base.testUrl); targetUrl.pathname = `/${databaseName}`;
const safe = assertSafeTestDatabase(base.developmentUrl, targetUrl.toString());
const config = { ...loadConfiguration(), databaseUrl: safe.testUrl };
const prisma = new PrismaService(config); const peer = new PrismaService(config);
const passwords = new PasswordService();
const input = { username: 'seed_admin', password: 'SeedDemo#2026' };
let databaseCreated = false;

beforeAll(async () => {
  await prepareTestDatabase({ DATABASE_URL: base.developmentUrl, TEST_DATABASE_URL: safe.testUrl });
  databaseCreated = true;
  runPrisma(['migrate', 'deploy'], { ...process.env, DATABASE_URL: safe.testUrl });
  await Promise.all([prisma.onModuleInit(), peer.onModuleInit()]);
}, 30_000);

afterEach(async () => {
  // 仅清理本文件独占、刚新建的随机测试库；从不对原shop_test执行全表清理。
  await prisma.auditLog.deleteMany();
  await prisma.employeeExtraPermission.deleteMany();
  await prisma.authSession.deleteMany();
  await prisma.employee.deleteMany();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await Promise.all([prisma.$disconnect(), peer.$disconnect()]);
  if (!databaseCreated) return;
  // 删除前再次验证随机名称和完整URL，绝不FORCE或清理已有数据库。
  const checked = assertSafeTestDatabase(base.developmentUrl, safe.testUrl);
  if (!/^admin_seed_[a-f0-9]{32}_test$/.test(databaseName) || checked.testName !== databaseName) {
    throw new Error('临时测试库清理目标不合法');
  }
  const adminUrl = new URL(base.developmentUrl); adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 2000 });
  try { await admin.connect(); await admin.query(`DROP DATABASE "${databaseName}"`); }
  finally { await admin.end(); }
});

it('空库首次初始化创建可用管理员、bcrypt密码、无需强制改密及唯一SYSTEM审计', async () => {
  const result = await seedInitialAdmin(prisma, input);
  expect(result.created).toBe(true);
  const employee = await prisma.employee.findUniqueOrThrow({ where: { username: input.username } });
  expect(employee).toMatchObject({ role: 'SUPER_ADMIN', status: 'ACTIVE', mustChangePassword: false,
    tokenVersion: 0, permissionVersion: 0, version: 0 });
  expect(await passwords.verify(input.password, employee.passwordHash)).toBe(true);
  expect(await prisma.employee.count()).toBe(1);
  expect(await prisma.employeeExtraPermission.count()).toBe(0);
  expect(await prisma.permissionDefinition.count()).toBe(52);
  expect(await prisma.rolePermission.count()).toBe(89);
  const audit = await prisma.auditLog.findFirstOrThrow({ where: { requestId: result.requestId } });
  expect(audit).toMatchObject({ actorType: 'SYSTEM', actorEmployeeId: null, actorCustomerId: null,
    action: 'employee.create', targetId: employee.id, reason: '首次初始化超级管理员' });
  const serialized = JSON.stringify({ result, audit });
  expect(serialized.includes(input.password)).toBe(false);
  expect(serialized.includes(employee.passwordHash)).toBe(false);
  expect(await prisma.auditLog.count()).toBe(1);
});

it('默认admin和admin123能通过真实HTTP登录并直接查询权限，无须先改密', async () => {
  const initial = readInitialAdminConfig({});
  await seedInitialAdmin(prisma, initial);
  // 补齐Vitest转换器未生成的DTO元数据，保持与生产tsc编译结果一致。
  Reflect.defineMetadata('design:paramtypes', [EmployeeLoginDto, Object], EmployeeAuthController.prototype, 'login');
  const apiConfig = { ...config, logLevel: 'silent' as const };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG).useValue(apiConfig)
    .overrideProvider(PrismaService).useValue(new PrismaService(apiConfig)).compile();
  const app = module.createNestApplication();
  configureApp(app);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const login = await fetch(`${origin}/api/v1/admin/auth/login`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(initial) });
    expect(login.status).toBe(200);
    const body = await login.json() as { data: { accessToken: string; mustChangePassword: boolean;
      employee: { username: string; mustChangePassword: boolean } } };
    expect(body.data.mustChangePassword).toBe(false);
    expect(body.data.employee).toMatchObject({ username: 'admin', mustChangePassword: false });
    const permissions = await fetch(`${origin}/api/v1/admin/me/permissions`, {
      headers: { Authorization: `Bearer ${body.data.accessToken}` } });
    expect(permissions.status).toBe(200);
    expect((await permissions.json() as { data: { effectivePermissions: string[] } }).data.effectivePermissions).toHaveLength(52);
  } finally { await app.close(); }
});

it('重复seed不覆盖已修改的密码、岗位、状态、授权、版本、会话或审计', async () => {
  await seedInitialAdmin(prisma, input);
  const employee = await prisma.employee.findUniqueOrThrow({ where: { username: input.username } });
  const changedHash = await passwords.hash('ChangedDemo#2026');
  await prisma.employee.create({ data: { username: 'other_admin', displayName: '另一管理员', passwordHash: changedHash,
    role: 'SUPER_ADMIN', status: 'ACTIVE' } });
  const changed = await prisma.employee.update({ where: { id: employee.id }, data: { role: 'CUSTOMER_SERVICE',
    status: 'DISABLED', passwordHash: changedHash, mustChangePassword: false, version: 7, tokenVersion: 3, permissionVersion: 2 } });
  const grant = await prisma.employeeExtraPermission.create({ data: { employeeId: employee.id,
    permissionCode: 'shipment.tracking.correct', grantedById: employee.id } });
  const session = await prisma.authSession.create({ data: { employeeId: employee.id, subjectType: 'EMPLOYEE',
    tokenVersion: 3, expiresAt: new Date(Date.now() + 60_000) } });
  const audits = await prisma.auditLog.findMany();
  expect((await seedInitialAdmin(prisma, { ...input, password: 'AnotherDemo#2026' })).created).toBe(false);
  expect(await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } })).toEqual(changed);
  expect(await prisma.employeeExtraPermission.findMany()).toEqual([grant]);
  expect(await prisma.authSession.findUniqueOrThrow({ where: { id: session.id } })).toEqual(session);
  expect(await prisma.auditLog.findMany()).toEqual(audits);
  expect(await prisma.employee.count()).toBe(2);
});

it('已有其他可用管理员时不额外创建配置中的初始化账号', async () => {
  await seedInitialAdmin(prisma, { ...input, username: 'other_admin' });
  expect((await seedInitialAdmin(prisma, input)).created).toBe(false);
  expect(await prisma.employee.findUnique({ where: { username: input.username } })).toBeNull();
  expect(await prisma.employee.count()).toBe(1);
});

it.each(['CUSTOMER_SERVICE', 'DISABLED_ADMIN'])('已有员工但无可用管理员时拒绝恢复：%s', async kind => {
  const employee = await prisma.employee.create({ data: { username: input.username, displayName: '恢复保护测试',
    passwordHash: '仅为夹具占位值', role: kind === 'CUSTOMER_SERVICE' ? 'CUSTOMER_SERVICE' : 'SUPER_ADMIN',
    status: kind === 'DISABLED_ADMIN' ? 'DISABLED' : 'ACTIVE' } });
  await expect(seedInitialAdmin(prisma, input)).rejects.toMatchObject({ code: 'ADMIN_RECOVERY_REQUIRED' });
  expect(await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } })).toEqual(employee);
  expect(await prisma.employee.count()).toBe(1);
  expect(await prisma.auditLog.count()).toBe(0);
});

it('审计抛错使管理员及目录更新一起回滚，解除故障后可正常重试', async () => {
  await seedPermissionCatalog(prisma);
  const original = await prisma.permissionDefinition.findUniqueOrThrow({ where: { code: 'category.read' } });
  await prisma.permissionDefinition.update({ where: { code: original.code }, data: { name: '审计故障前测试值' } });
  const fault = new Error('测试审计失败');
  const audit = new AuditService();
  const append = audit.appendAudit.bind(audit);
  const spy = vi.spyOn(audit, 'appendAudit').mockImplementation(async (tx, payload) => {
    await append(tx, payload);
    expect(await tx.employee.count()).toBe(1);
    expect(await tx.auditLog.count()).toBe(1);
    throw fault;
  });
  try {
    await expect(seedInitialAdmin(prisma, input, { passwords, audit })).rejects.toBe(fault);
    expect(spy).toHaveBeenCalledOnce();
    expect(await prisma.employee.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
    expect((await prisma.permissionDefinition.findUniqueOrThrow({ where: { code: original.code } })).name).toBe('审计故障前测试值');
    spy.mockRestore();
    expect((await seedInitialAdmin(prisma, input)).created).toBe(true);
  } finally {
    spy.mockRestore();
    await prisma.permissionDefinition.update({ where: { code: original.code }, data: { name: original.name } });
  }
});

it('并发不同账号初始化由稳定行锁仲裁，只创建一个管理员和一条审计', async () => {
  let release!: () => void; let ready!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const locked = new Promise<void>(resolve => { ready = resolve; });
  const blocker = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT key FROM system_guard WHERE key='ADMIN_AVAILABILITY' FOR UPDATE`;
    ready(); await hold;
  }, { timeout: 5_000 });
  await Promise.race([locked, blocker.then(() => { throw new Error('稳定锁未进入屏障'); })]);
  const first = seedInitialAdmin(prisma, { ...input, username: 'first_admin' });
  const second = seedInitialAdmin(peer, { ...input, username: 'second_admin' });
  // 提前挂接拒绝处理器，故障时也不会产生未处理Promise。
  const outcomes = Promise.allSettled([first, second]);
  try {
    const deadline = performance.now() + 650;
    let waiters = 0;
    while (performance.now() < deadline) {
      const rows = await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'
        AND query LIKE '%system_guard%'`;
      waiters = rows[0]!.count;
      if (waiters === 2) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(waiters).toBe(2);
  } finally { release(); await blocker; }
  const results = await outcomes;
  expect(results.map(item => item.status)).toEqual(['fulfilled', 'fulfilled']);
  const values = results.flatMap(item => item.status === 'fulfilled' ? [item.value] : []);
  expect(values.filter(item => item.created)).toHaveLength(1);
  expect(values.filter(item => !item.created)).toHaveLength(1);
  expect(await prisma.employee.count()).toBe(1);
  expect(await prisma.employee.count({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' } })).toBe(1);
  expect(await prisma.auditLog.count({ where: { action: 'employee.create' } })).toBe(1);
});

it('稳定锁行缺失时拒绝初始化，不临时补行绕过保护', async () => {
  await prisma.systemGuard.delete({ where: { key: 'ADMIN_AVAILABILITY' } });
  try {
    await expect(seedInitialAdmin(prisma, input)).rejects.toMatchObject({ code: 'ADMIN_AVAILABILITY_GUARD_MISSING' });
    expect(await prisma.employee.count()).toBe(0);
  } finally { await prisma.systemGuard.create({ data: { key: 'ADMIN_AVAILABILITY' } }); }
});

it('目录存在未声明旧码时整体失败，不创建管理员', async () => {
  const code = `test.${randomUUID()}`;
  await prisma.permissionDefinition.create({ data: { code, name: '测试旧码', description: '需迁移处理', adminOnly: false, dependencies: [] } });
  try {
    await expect(seedInitialAdmin(prisma, input)).rejects.toThrow('数据库包含当前版本未声明的权限或岗位绑定');
    expect(await prisma.employee.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  } finally { await prisma.permissionDefinition.delete({ where: { code } }); }
});

it('测试CLI首次及重复执行均成功，输出不含密码、哈希或连接串', () => {
  const cli = resolve(require.resolve('tsx/package.json'), '../dist/cli.mjs');
  const run = () => spawnSync(process.execPath, [cli, resolve(__dirname, '../scripts/seed-admin.ts'), '--test'], {
    env: { ...process.env, DATABASE_URL: base.developmentUrl, TEST_DATABASE_URL: safe.testUrl,
      INIT_ADMIN_USERNAME: input.username, INIT_ADMIN_PASSWORD: input.password },
    encoding: 'utf8', timeout: 10_000, windowsHide: true,
  });
  const first = run(); const second = run();
  expect(first.status).toBe(0); expect(second.status).toBe(0);
  expect(JSON.parse(first.stdout)).toMatchObject({ target: 'test', created: true });
  expect(JSON.parse(second.stdout)).toMatchObject({ target: 'test', created: false });
  const output = first.stdout + first.stderr + second.stdout + second.stderr;
  expect(output.includes(input.password)).toBe(false);
  expect(output.includes(safe.testUrl)).toBe(false);
  expect(output.includes('$2b$')).toBe(false);
});

it('测试CLI误指开发库时在连接前失败', () => {
  const cli = resolve(require.resolve('tsx/package.json'), '../dist/cli.mjs');
  const result = spawnSync(process.execPath, [cli, resolve(__dirname, '../scripts/seed-admin.ts'), '--test'], {
    env: { ...process.env, DATABASE_URL: base.developmentUrl, TEST_DATABASE_URL: base.developmentUrl,
      INIT_ADMIN_USERNAME: input.username, INIT_ADMIN_PASSWORD: input.password },
    encoding: 'utf8', timeout: 10_000, windowsHide: true,
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr.includes(base.developmentUrl)).toBe(false);
});
