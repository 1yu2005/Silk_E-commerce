// 作用：验证最小审计字段约束、敏感数据拒绝及事务失败回滚。
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AuditService, type AuditPayload } from '../src/audit/audit.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { loadConfiguration } from '../src/config/environment.js';
import { assertSafeTestDatabase } from '../scripts/database-env.js';

assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('集成测试仅可在test环境执行');
const prisma = new PrismaService(loadConfiguration());
const audit = new AuditService();
beforeAll(async () => { await prisma.onModuleInit(); });
afterAll(async () => { await prisma.$disconnect(); });

function employeeData() {
  const id = randomUUID();
  return { id, username: `t_${id.replaceAll('-', '').slice(0, 20)}`, displayName: '审计测试员工',
    passwordHash: '约束测试占位值', role: 'CUSTOMER_SERVICE' as const };
}
function payload(id: string): AuditPayload {
  return { actor: { type: 'EMPLOYEE', id }, action: 'employee.profile.update', targetId: id,
    requestId: randomUUID(), reason: '验证同事务写入', before: { displayName: '旧名' }, after: { displayName: '新名' } };
}

it('审计与主体变更在同一事务可见，外层回滚后均不存在', async () => {
  const data = employeeData(); const input = payload(data.id);
  const rollback = new Error('测试主动回滚');
  await expect(prisma.$transaction(async tx => {
    await tx.employee.create({ data });
    await tx.employee.update({ where: { id: data.id }, data: { displayName: '新名' } });
    await audit.appendAudit(tx, input);
    const row = await tx.auditLog.findFirstOrThrow({ where: { requestId: input.requestId } });
    expect(row).toMatchObject({ actorEmployeeId: data.id, targetType: 'Employee', targetId: data.id,
      reason: input.reason, beforeData: input.before, afterData: input.after });
    expect(JSON.stringify(row)).not.toContain(data.passwordHash);
    throw rollback;
  })).rejects.toBe(rollback);
  expect(await prisma.employee.findUnique({ where: { id: data.id } })).toBeNull();
  expect(await prisma.auditLog.count({ where: { requestId: input.requestId } })).toBe(0);
});

it.each(['创建', '启停', '重置', '调岗', '授权'])('审计外键失败使%s相关数据全部回滚', async operation => {
  const base = await prisma.employee.create({ data: employeeData() });
  const session = await prisma.authSession.create({ data: { subjectType: 'EMPLOYEE', employeeId: base.id,
    tokenVersion: 0, expiresAt: new Date(Date.now() + 60_000) } });
  const code = `test.${randomUUID()}`;
  await prisma.permissionDefinition.create({ data: { code, name: '测试权限', description: '仅本项测试', adminOnly: false, dependencies: [] } });
  const newEmployee = employeeData();
  const input = payload(base.id);
  const actions = { 创建: 'employee.create', 启停: 'employee.disable', 重置: 'employee.password.reset',
    调岗: 'employee.role.change', 授权: 'employee.permission.replace' } as const;
  input.action = actions[operation as keyof typeof actions];
  input.before = undefined;
  input.after = operation === '创建' ? { username: newEmployee.username }
    : operation === '启停' ? { status: 'DISABLED' }
    : operation === '重置' ? { passwordChanged: true, mustChangePassword: true }
    : operation === '调岗' ? { role: 'MERCH_WAREHOUSE', extraPermissions: [] }
    : { extraPermissions: [code] };
  // 格式合法但不存在的操作者触发真实数据库外键错误，不提供生产故障注入API。
  input.actor = { type: 'EMPLOYEE', id: randomUUID() };
  try {
    await expect(prisma.$transaction(async tx => {
      if (operation === '创建') await tx.employee.create({ data: newEmployee });
      if (operation === '启停') {
        await tx.employee.update({ where: { id: base.id }, data: { status: 'DISABLED', tokenVersion: 1, version: 1 } });
        await tx.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokeReason: 'DISABLED' } });
      }
      if (operation === '重置') {
        await tx.employee.update({ where: { id: base.id }, data: { passwordHash: '新占位值', tokenVersion: 1, version: 1 } });
        await tx.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokeReason: 'PASSWORD_CHANGED' } });
      }
      if (operation === '调岗') await tx.employee.update({ where: { id: base.id }, data: { role: 'MERCH_WAREHOUSE', permissionVersion: 1, version: 1 } });
      if (operation === '授权') {
        await tx.employeeExtraPermission.create({ data: { employeeId: base.id, permissionCode: code, grantedById: base.id } });
        await tx.employee.update({ where: { id: base.id }, data: { permissionVersion: 1, version: 1 } });
      }
      await audit.appendAudit(tx, input);
    })).rejects.toMatchObject({ code: 'P2003' });
    expect(await prisma.employee.findUniqueOrThrow({ where: { id: base.id } })).toEqual(base);
    expect(await prisma.authSession.findUniqueOrThrow({ where: { id: session.id } })).toEqual(session);
    expect(await prisma.employee.findUnique({ where: { id: newEmployee.id } })).toBeNull();
    expect(await prisma.employeeExtraPermission.count({ where: { employeeId: base.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { requestId: input.requestId } })).toBe(0);
  } finally {
    // 仅删除本项创建的夹具，按外键顺序清理，不影响已有记录。
    await prisma.auditLog.deleteMany({ where: { requestId: input.requestId } });
    await prisma.employeeExtraPermission.deleteMany({ where: { employeeId: base.id } });
    await prisma.authSession.deleteMany({ where: { employeeId: base.id } });
    await prisma.employee.deleteMany({ where: { id: { in: [base.id, newEmployee.id] } } });
    await prisma.permissionDefinition.delete({ where: { code } });
  }
});

it.each([
  { password: '不应记录的密码' }, { passwordHash: '不应记录的哈希' },
  { token: '不应记录的令牌' }, { phone: '13800138001' },
  { displayName: { password: '嵌套秘密' } }, { displayName: ['非法数组'] },
])('拒绝非白名单或嵌套快照，不回显载荷', async after => {
  const data = employeeData(); const input = { ...payload(data.id), after };
  await expect(prisma.$transaction(async tx => {
    await tx.employee.create({ data });
    await audit.appendAudit(tx, input);
  })).rejects.toThrow('审计载荷不符合动作白名单');
  expect(await prisma.employee.findUnique({ where: { id: data.id } })).toBeNull();
});

it('拒绝将根客户端误当事务客户端传入', async () => {
  await expect(audit.appendAudit(prisma, payload(randomUUID()))).rejects.toThrow('审计写入必须使用事务客户端');
});

it('SYSTEM初始化记录与改密标记可写入，但密码原文不可写入', async () => {
  const data = employeeData(); const rollback = new Error('测试主动回滚');
  await expect(prisma.$transaction(async tx => {
    await tx.employee.create({ data });
    await audit.appendAudit(tx, { actor: { type: 'SYSTEM' }, action: 'employee.create', targetId: data.id,
      requestId: randomUUID(), reason: '初始化管理员', after: { username: data.username, role: 'SUPER_ADMIN', mustChangePassword: true } });
    await audit.appendAudit(tx, { ...payload(data.id), action: 'employee.password.change',
      before: undefined, after: { passwordChanged: true, mustChangePassword: false } });
    expect(await tx.auditLog.count({ where: { targetId: data.id } })).toBe(2);
    throw rollback;
  })).rejects.toBe(rollback);
});


it('成功提交后主体变更与审计记录同时持久化', async () => {
  const data = employeeData(); const input = payload(data.id);
  try {
    await prisma.$transaction(async tx => {
      await tx.employee.create({ data });
      await tx.employee.update({ where: { id: data.id }, data: { displayName: '新名' } });
      await audit.appendAudit(tx, input);
    });
    expect(await prisma.employee.findUniqueOrThrow({ where: { id: data.id } })).toMatchObject({ displayName: '新名' });
    expect(await prisma.auditLog.findFirstOrThrow({ where: { requestId: input.requestId } }))
      .toMatchObject({ action: input.action, actorEmployeeId: data.id, beforeData: input.before, afterData: input.after });
  } finally {
    await prisma.auditLog.deleteMany({ where: { requestId: input.requestId } });
    await prisma.employee.deleteMany({ where: { id: data.id } });
  }
});
