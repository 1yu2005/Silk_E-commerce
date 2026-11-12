// 作用：验证固定目录初始化的幂等、并发锁、冲突拒绝及回滚。
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { loadConfiguration } from '../src/config/environment.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { assertSafeTestDatabase } from '../scripts/database-env.js';
import { permissionDefinitions, roleTemplates } from '../src/permissions/permission-catalog.js';
import { seedPermissionCatalog, syncPermissionCatalog, PermissionSeedConflictError } from '../src/permissions/permission-seed.js';

assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('集成测试仅可在test环境执行');
const prisma = new PrismaService(loadConfiguration());
const peer = new PrismaService(loadConfiguration());
beforeAll(async () => { await Promise.all([prisma.onModuleInit(), peer.onModuleInit()]); });
afterAll(async () => { await Promise.all([prisma.$disconnect(), peer.$disconnect()]); });

async function snapshot() {
  return { definitions: await prisma.permissionDefinition.findMany({ orderBy: { code: 'asc' } }),
    bindings: await prisma.rolePermission.findMany({ orderBy: [{ role: 'asc' }, { permissionCode: 'asc' }] }) };
}

it('同事务内重复seed得到完整52项目录与89项岗位绑定，外层回滚不留下数据', async () => {
  const before = await snapshot(); const rollback = new Error('测试主动回滚');
  await expect(prisma.$transaction(async tx => {
    expect(await syncPermissionCatalog(tx)).toEqual({ version: 'M0-02.permissions.v1', permissions: 52, rolePermissions: 89 });
    await syncPermissionCatalog(tx);
    expect(await tx.permissionDefinition.count()).toBe(52);
    expect(await tx.rolePermission.count()).toBe(89);
    throw rollback;
  }, { timeout: 15_000 })).rejects.toBe(rollback);
  expect(await snapshot()).toEqual(before);
});

it('真实提交和重复提交结果一致，目录元数据和三个岗位均与版本清单匹配', async () => {
  await seedPermissionCatalog(prisma);
  const first = await snapshot();
  await seedPermissionCatalog(prisma);
  expect(await snapshot()).toEqual(first);
  expect(first.definitions).toHaveLength(52);
  expect(first.bindings).toHaveLength(89);
  for (const item of permissionDefinitions) {
    expect(first.definitions.find(row => row.code === item.code)).toEqual({ code: item.code,
      name: item.name, description: item.description, adminOnly: item.adminOnly, dependencies: [...item.dependencies] });
  }
  for (const role of ['SUPER_ADMIN', 'MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'] as const) {
    expect(first.bindings.filter(row => row.role === role).map(row => row.permissionCode).sort())
      .toEqual([...roleTemplates[role]].sort());
  }
});

it('不同数据库连接并发seed通过事务锁串行完成，不产生重复绑定', async () => {
  let release!: () => void; let signalReady!: () => void; let signalSecond!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { signalReady = resolve; });
  const secondStarted = new Promise<void>(resolve => { signalSecond = resolve; });
  let firstPid = 0; let secondPid = 0;
  const first = prisma.$transaction(async tx => {
    firstPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    const result = await syncPermissionCatalog(tx);
    signalReady();
    await hold;
    return result;
  }, { timeout: 5_000 });
  // 先确定第一条连接已持锁，再让第二条连接进入，避免靠随机Promise.all猜测竞争顺序。
  await Promise.race([ready, first.then(() => { throw new Error('第一事务未进入屏障'); })]);
  const second = peer.$transaction(async tx => {
    secondPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    signalSecond();
    return syncPermissionCatalog(tx);
  }, { timeout: 5_000 });
  try {
    await secondStarted;
    expect(firstPid).not.toBe(secondPid);
    const deadline = performance.now() + 300;
    let waiting = false;
    while (performance.now() < deadline) {
      const rows = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (
        SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=52002 AND objid=1
        AND pid=${secondPid} AND NOT granted) AS waiting`;
      if (rows[0]?.waiting) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(waiting).toBe(true);
  } finally {
    release();
    const results = await Promise.allSettled([first, second]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
  }
  expect(await prisma.permissionDefinition.count()).toBe(52);
  expect(await prisma.rolePermission.count()).toBe(89);
});

it('目录seed保留已有员工字段、个人授权、会话和审计，不创建管理员', async () => {
  const rollback = new Error('测试主动回滚');
  const employeeCount = await prisma.employee.count();
  await expect(prisma.$transaction(async tx => {
    const id = randomUUID();
    const employee = await tx.employee.create({ data: { id, username: `t_${id.replaceAll('-', '').slice(0, 20)}`,
      displayName: 'seed保留测试', passwordHash: '仅为测试占位值', role: 'CUSTOMER_SERVICE', status: 'DISABLED',
      tokenVersion: 3, permissionVersion: 4, version: 5, mustChangePassword: false } });
    const grant = await tx.employeeExtraPermission.create({ data: { employeeId: id, permissionCode: 'shipment.tracking.correct', grantedById: id } });
    const session = await tx.authSession.create({ data: { subjectType: 'EMPLOYEE', employeeId: id,
      tokenVersion: 3, expiresAt: new Date(Date.now() + 60_000) } });
    const audit = await tx.auditLog.create({ data: { actorType: 'SYSTEM', action: 'test.fixture',
      targetType: 'Employee', targetId: id, requestId: randomUUID() } });
    await syncPermissionCatalog(tx);
    expect(await tx.employee.findUniqueOrThrow({ where: { id } })).toEqual(employee);
    expect(await tx.employeeExtraPermission.findMany({ where: { employeeId: id } })).toEqual([grant]);
    expect(await tx.authSession.findUniqueOrThrow({ where: { id: session.id } })).toEqual(session);
    expect(await tx.auditLog.findUniqueOrThrow({ where: { id: audit.id } })).toEqual(audit);
    expect(await tx.employee.count()).toBe(employeeCount + 1);
    throw rollback;
  }, { timeout: 15_000 })).rejects.toBe(rollback);
  expect(await prisma.employee.count()).toBe(employeeCount);
});

it.each(['旧权限码', '额外岗位绑定'])('发现%s时明确失败且不删除、不半更新', async kind => {
  const before = await snapshot();
  await expect(prisma.$transaction(async tx => {
    if (kind === '旧权限码') await tx.permissionDefinition.create({ data: { code: `test.${randomUUID()}`,
      name: '旧权限测试', description: '不应自动删除', adminOnly: false, dependencies: [] } });
    else await tx.rolePermission.create({ data: { role: 'CUSTOMER_SERVICE', permissionCode: 'shipment.handover' } });
    await syncPermissionCatalog(tx);
  })).rejects.toBeInstanceOf(PermissionSeedConflictError);
  expect(await snapshot()).toEqual(before);
});

it('岗位写入真实失败时，之前已更新的目录元数据同事务回滚', async () => {
  const original = await prisma.permissionDefinition.findUniqueOrThrow({ where: { code: 'category.read' } });
  await prisma.permissionDefinition.update({ where: { code: original.code }, data: { name: '故障前测试值' } });
  const before = await snapshot();
  try {
    await expect(prisma.$transaction(async tx => {
      // 故障触发器仅存在于测试事务，回滚后消失，不向应用提供故障注入入口。
      await tx.$executeRaw`CREATE FUNCTION pg_temp.fail_permission_seed() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.permission_code = 'after-sale.refund.retry' AND NEW.role = 'CUSTOMER_SERVICE' THEN
            IF (SELECT name FROM permission_definition WHERE code='category.read') <> '查看后台分类' THEN
              RAISE EXCEPTION 'PERMISSION_SEED_UPDATE_NOT_REACHED';
            END IF;
            RAISE EXCEPTION 'PERMISSION_SEED_TEST_FAILURE';
          END IF;
          RETURN NEW;
        END $$`;
      await tx.$executeRaw`CREATE TRIGGER permission_seed_test_failure BEFORE INSERT ON role_permission
        FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_permission_seed()`;
      await syncPermissionCatalog(tx);
    }, { timeout: 15_000 })).rejects.toThrow('PERMISSION_SEED_TEST_FAILURE');
    expect(await snapshot()).toEqual(before);
  } finally {
    await prisma.permissionDefinition.update({ where: { code: original.code }, data: { name: original.name } });
  }
});
