// 作用：验证真实会话创建、当前身份、撤销、期限和主体版本失效。
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { loadConfiguration } from '../src/config/environment.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { assertSafeTestDatabase } from '../scripts/database-env.js';
import { PermissionService } from '../src/permissions/permission.service.js';
import { seedPermissionCatalog } from '../src/permissions/permission-seed.js';
import { AuthSessionService } from '../src/auth/auth-session.service.js';
import { CurrentIdentityService } from '../src/auth/current-identity.service.js';
import { JwtTokenService } from '../src/auth/jwt-token.service.js';
import { SessionAuthenticationError, type SubjectReference } from '../src/auth/session-support.js';

assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('集成测试仅可在test环境执行');
const prisma = new PrismaService(loadConfiguration());
const peer = new PrismaService(loadConfiguration());
const permissions = new PermissionService();
const secret = 'session-test-only-secret-'.repeat(3);
const fixedNow = new Date('2026-11-11T11:00:00.500Z');
const passwordHash = '仅为已验证密码快照的测试占位值';
const expectedTokenVersion = 3;
beforeAll(async () => {
  await Promise.all([prisma.onModuleInit(), peer.onModuleInit()]);
  await seedPermissionCatalog(prisma);
});
afterAll(async () => { await Promise.all([prisma.$disconnect(), peer.$disconnect()]); });

function services() {
  let now = fixedNow;
  const clock = () => now;
  const tokens = new JwtTokenService({ secret, ttlSeconds: 7200 }, clock);
  return { tokens, sessions: new AuthSessionService(tokens, clock),
    identities: new CurrentIdentityService(tokens, permissions, clock), setNow: (value: Date) => { now = value; } };
}
function employeeData() {
  const id = randomUUID();
  return { id, username: `s_${id.replaceAll('-', '').slice(0, 20)}`, displayName: '会话测试员工', createdAt: new Date('2026-01-01T00:00:00Z'),
    passwordHash, role: 'CUSTOMER_SERVICE' as const, tokenVersion: expectedTokenVersion, mustChangePassword: false };
}
function snapshot(subject: SubjectReference) { return { ...subject, expectedPasswordHash: passwordHash, expectedTokenVersion }; }
async function fixture(run: (tx: Prisma.TransactionClient, employee: SubjectReference, customer: SubjectReference) => Promise<void>) {
  const rollback = new Error('会话测试主动回滚');
  await expect(prisma.$transaction(async tx => {
    const employee = await tx.employee.create({ data: employeeData() });
    // 所有顾客夹具只存在于外层回滚事务，同一手机号不会留在既有测试库。
    const customer = await tx.customer.create({ data: { phone: '13900008888', nickname: '会话测试顾客',
      passwordHash, tokenVersion: expectedTokenVersion, createdAt: new Date('2026-01-01T00:00:00Z') } });
    await run(tx, { subjectType: 'EMPLOYEE', subjectId: employee.id }, { subjectType: 'CUSTOMER', subjectId: customer.id });
    throw rollback;
  }, { timeout: 15_000 })).rejects.toBe(rollback);
}

it.each(['EMPLOYEE', 'CUSTOMER'] as const)('%s签发与会话、lastLoginAt同事务且期限一致，身份不泄漏密码或手机号', async type => {
  await fixture(async (tx, employee, customer) => {
    const { tokens, sessions, identities } = services(); const subject = type === 'EMPLOYEE' ? employee : customer;
    const issued = await sessions.createAfterPasswordVerified(tx, snapshot(subject));
    const row = await tx.authSession.findUniqueOrThrow({ where: { id: issued.sessionId } });
    const claims = await tokens.verify(issued.accessToken, type);
    expect(row).toMatchObject({ subjectType: type, tokenVersion: 3, createdAt: issued.issuedAt,
      expiresAt: issued.expiresAt, revokedAt: null, revokeReason: null,
      employeeId: type === 'EMPLOYEE' ? subject.subjectId : null, customerId: type === 'CUSTOMER' ? subject.subjectId : null });
    expect(row.expiresAt.getTime()).toBe(claims.exp * 1000);
    const account = type === 'EMPLOYEE' ? await tx.employee.findUniqueOrThrow({ where: { id: subject.subjectId } })
      : await tx.customer.findUniqueOrThrow({ where: { id: subject.subjectId } });
    expect(account.lastLoginAt).toEqual(fixedNow);
    const identity = await identities.authenticate(tx, issued.accessToken, type);
    expect(identity).toMatchObject({ subjectType: type, subjectId: subject.subjectId, sessionId: row.id, tokenVersion: 3 });
    for (const field of ['passwordHash', 'phone', 'accessToken', 'expectedPasswordHash']) expect(identity).not.toHaveProperty(field);
    expect(JSON.stringify(identity)).not.toContain(passwordHash);
  });
});

it.each(['EMPLOYEE', 'CUSTOMER'] as const)('%s同秒创建后首次登录，不以整秒iat破坏主体生命周期', async type => {
  await fixture(async (tx, employee, customer) => {
    const subject = type === 'EMPLOYEE' ? employee : customer;
    const createdAt = new Date(fixedNow.getTime() - 100);
    if (type === 'EMPLOYEE') await tx.employee.update({ where: { id: subject.subjectId }, data: { createdAt } });
    else await tx.customer.update({ where: { id: subject.subjectId }, data: { createdAt } });
    const { sessions } = services(); const issued = await sessions.createAfterPasswordVerified(tx, snapshot(subject));
    expect(issued.issuedAt.getTime()).toBeLessThan(createdAt.getTime());
    const row = type === 'EMPLOYEE' ? await tx.employee.findUniqueOrThrow({ where: { id: subject.subjectId } })
      : await tx.customer.findUniqueOrThrow({ where: { id: subject.subjectId } });
    expect(row.lastLoginAt).toEqual(fixedNow); expect(row.lastLoginAt!.getTime()).toBeGreaterThanOrEqual(createdAt.getTime());
  });
});

it('同一主体可有多会话，单sid撤销幂等、不覆盖首个撤销事实且另一会话仍有效', async () => {
  await fixture(async (tx, _employee, customer) => {
    const { sessions, identities, setNow } = services();
    const first = await sessions.createAfterPasswordVerified(tx, snapshot(customer));
    const second = await sessions.createAfterPasswordVerified(tx, snapshot(customer));
    expect(first.sessionId).not.toBe(second.sessionId);
    expect(await sessions.revokeCurrent(tx, customer, first.sessionId)).toBe(true);
    const revoked = await tx.authSession.findUniqueOrThrow({ where: { id: first.sessionId } });
    setNow(new Date(fixedNow.getTime() + 1000));
    expect(await sessions.revokeCurrent(tx, customer, first.sessionId)).toBe(false);
    expect(await tx.authSession.findUniqueOrThrow({ where: { id: first.sessionId } })).toEqual(revoked);
    await expect(identities.authenticate(tx, first.accessToken, 'CUSTOMER')).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    await expect(identities.authenticate(tx, second.accessToken, 'CUSTOMER')).resolves.toMatchObject({ subjectId: customer.subjectId });
  });
});

it.each(['EMPLOYEE', 'CUSTOMER'] as const)('%s全部撤销仅影响目标，重复调用为0且不覆盖旧原因', async type => {
  await fixture(async (tx, employee, customer) => {
    const { sessions, identities } = services(); const target = type === 'EMPLOYEE' ? employee : customer;
    const other = type === 'EMPLOYEE' ? customer : employee;
    const first = await sessions.createAfterPasswordVerified(tx, snapshot(target));
    const second = await sessions.createAfterPasswordVerified(tx, snapshot(target));
    const otherSession = await sessions.createAfterPasswordVerified(tx, snapshot(other));
    await sessions.revokeCurrent(tx, target, first.sessionId);
    const original = await tx.authSession.findUniqueOrThrow({ where: { id: first.sessionId } });
    expect(await sessions.revokeAll(tx, target, 'PASSWORD_CHANGED')).toBe(1);
    expect(await sessions.revokeAll(tx, target, 'PASSWORD_RESET')).toBe(0);
    expect(await tx.authSession.findUniqueOrThrow({ where: { id: first.sessionId } })).toEqual(original);
    expect(await tx.authSession.findUniqueOrThrow({ where: { id: second.sessionId } })).toMatchObject({ revokeReason: 'PASSWORD_CHANGED' });
    await expect(identities.authenticate(tx, second.accessToken, type)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    await expect(identities.authenticate(tx, otherSession.accessToken, other.subjectType)).resolves.toBeDefined();
  });
});

it.each(['哈希', '版本'])('创建前锁内复核%s，旧密码验证快照不能继续签发', async changed => {
  await fixture(async (tx, employee) => {
    const { sessions } = services();
    await tx.employee.update({ where: { id: employee.subjectId }, data: changed === '哈希'
      ? { passwordHash: '重置后的测试占位值' } : { tokenVersion: 4 } });
    await expect(sessions.createAfterPasswordVerified(tx, snapshot(employee))).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(await tx.authSession.count({ where: { employeeId: employee.subjectId } })).toBe(0);
    expect((await tx.employee.findUniqueOrThrow({ where: { id: employee.subjectId } })).lastLoginAt).toBeNull();
  });
});

it.each(['EMPLOYEE', 'CUSTOMER'] as const)('%s不可用时拒绝创建及旧token；恢复状态不会恢复已撤销会话', async type => {
  await fixture(async (tx, employee, customer) => {
    const { sessions, identities } = services(); const subject = type === 'EMPLOYEE' ? employee : customer;
    const issued = await sessions.createAfterPasswordVerified(tx, snapshot(subject));
    if (type === 'EMPLOYEE') await tx.employee.update({ where: { id: subject.subjectId }, data: { status: 'DISABLED' } });
    else await tx.customer.update({ where: { id: subject.subjectId }, data: { status: 'LOGIN_FROZEN' } });
    await expect(sessions.createAfterPasswordVerified(tx, snapshot(subject))).rejects.toMatchObject({ code: 'ACCOUNT_UNAVAILABLE' });
    await expect(identities.authenticate(tx, issued.accessToken, type)).rejects.toMatchObject({ code: 'ACCOUNT_UNAVAILABLE' });
    await sessions.revokeAll(tx, subject, type === 'EMPLOYEE' ? 'ACCOUNT_DISABLED' : 'LOGIN_FROZEN');
    if (type === 'EMPLOYEE') await tx.employee.update({ where: { id: subject.subjectId }, data: { status: 'ACTIVE' } });
    else await tx.customer.update({ where: { id: subject.subjectId }, data: { status: 'NORMAL' } });
    await expect(identities.authenticate(tx, issued.accessToken, type)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
  });
});

it('顾客TRADE_RESTRICTED仍能创建会话和读取身份，保留状态供后续下单规则使用', async () => {
  await fixture(async (tx, _employee, customer) => {
    const { sessions, identities } = services();
    await tx.customer.update({ where: { id: customer.subjectId }, data: { status: 'TRADE_RESTRICTED' } });
    const issued = await sessions.createAfterPasswordVerified(tx, snapshot(customer));
    await expect(identities.authenticate(tx, issued.accessToken, 'CUSTOMER')).resolves.toMatchObject({ status: 'TRADE_RESTRICTED' });
  });
});

it('每次读取最新角色、强制改密标志与权限版本，不缓存旧身份', async () => {
  await fixture(async (tx, employee) => {
    const { sessions, identities } = services();
    await tx.employee.update({ where: { id: employee.subjectId }, data: { mustChangePassword: true } });
    const issued = await sessions.createAfterPasswordVerified(tx, snapshot(employee));
    const first = await identities.authenticate(tx, issued.accessToken, 'EMPLOYEE');
    expect(first).toMatchObject({ role: 'CUSTOMER_SERVICE', mustChangePassword: true, permissionVersion: 0 });
    await tx.employee.update({ where: { id: employee.subjectId }, data: {
      role: 'MERCH_WAREHOUSE', permissionVersion: 1, mustChangePassword: false } });
    const next = await identities.authenticate(tx, issued.accessToken, 'EMPLOYEE');
    expect(next).toMatchObject({ role: 'MERCH_WAREHOUSE', mustChangePassword: false, permissionVersion: 1 });
    if (next.subjectType !== 'EMPLOYEE') throw new Error('测试身份不匹配');
    expect(next.effectivePermissions).toEqual(permissions.effectivePermissions('MERCH_WAREHOUSE', []));
    expect(first).toMatchObject({ role: 'CUSTOMER_SERVICE', mustChangePassword: true });
  });
});

it('授予和撤销额外权限即时读取，旧token及其它默认权限继续有效', async () => {
  await fixture(async (tx, employee) => {
    const { sessions, identities } = services(); const issued = await sessions.createAfterPasswordVerified(tx, snapshot(employee));
    await tx.employeeExtraPermission.createMany({ data: ['order.fulfillment.read', 'shipment.claim'].map(permissionCode => ({
      employeeId: employee.subjectId, permissionCode, grantedById: employee.subjectId })) });
    await tx.employee.update({ where: { id: employee.subjectId }, data: { permissionVersion: 1 } });
    const granted = await identities.authenticate(tx, issued.accessToken, 'EMPLOYEE');
    if (granted.subjectType !== 'EMPLOYEE') throw new Error('测试身份不匹配');
    expect(granted.effectivePermissions).toContain('shipment.claim');
    await tx.employeeExtraPermission.deleteMany({ where: { employeeId: employee.subjectId } });
    await tx.employee.update({ where: { id: employee.subjectId }, data: { permissionVersion: 2 } });
    const revoked = await identities.authenticate(tx, issued.accessToken, 'EMPLOYEE');
    if (revoked.subjectType !== 'EMPLOYEE') throw new Error('测试身份不匹配');
    expect(revoked.effectivePermissions).not.toContain('shipment.claim');
    expect(revoked.effectivePermissions).toContain('customer.read');
    expect(revoked.permissionVersion).toBe(2);
    expect(await tx.authSession.findUniqueOrThrow({ where: { id: issued.sessionId } })).toMatchObject({ revokedAt: null, tokenVersion: 3 });
  });
});

it('数据库中缺依赖的授权明确失败，不在读取时自动补发权限', async () => {
  await fixture(async (tx, employee) => {
    const { sessions, identities } = services(); const issued = await sessions.createAfterPasswordVerified(tx, snapshot(employee));
    await tx.employeeExtraPermission.create({ data: { employeeId: employee.subjectId,
      permissionCode: 'shipment.claim', grantedById: employee.subjectId } });
    await expect(identities.authenticate(tx, issued.accessToken, 'EMPLOYEE')).rejects.toThrow('已保存的员工权限缺少依赖');
  });
});

it.each(['会话版本', '主体版本'])('%s与JWT不一致时拒绝', async changed => {
  await fixture(async (tx, employee) => {
    const { sessions, identities } = services(); const issued = await sessions.createAfterPasswordVerified(tx, snapshot(employee));
    if (changed === '会话版本') await tx.authSession.update({ where: { id: issued.sessionId }, data: { tokenVersion: 4 } });
    else await tx.employee.update({ where: { id: employee.subjectId }, data: { tokenVersion: 4 } });
    await expect(identities.authenticate(tx, issued.accessToken, 'EMPLOYEE')).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });
});

it.each(['不存在sid', '错误sub', '错误会话域', '跨接口域'])('拒绝%s，即使JWT签名合法', async kind => {
  await fixture(async (tx, employee) => {
    const { tokens, sessions, identities } = services(); const issued = await sessions.createAfterPasswordVerified(tx, snapshot(employee));
    const forged = await tokens.issue({ subjectType: kind === '错误会话域' ? 'CUSTOMER' : 'EMPLOYEE',
      subjectId: kind === '错误sub' ? randomUUID() : employee.subjectId,
      sessionId: kind === '不存在sid' ? randomUUID() : issued.sessionId, tokenVersion: 3 });
    const expectedSubject = kind === '错误会话域' || kind === '跨接口域' ? 'CUSTOMER' : 'EMPLOYEE';
    const code = kind === '错误会话域' || kind === '跨接口域' ? 'TOKEN_SUBJECT_MISMATCH' : 'TOKEN_INVALID';
    await expect(identities.authenticate(tx, forged.accessToken, expectedSubject)).rejects.toMatchObject({ code });
  });
});

it.each(['DB到期等号', 'JWT到期等号', '期限不一致'])('拒绝%s，时钟由测试注入不修改系统时间', async kind => {
  await fixture(async (tx, employee) => {
    const { sessions, identities, setNow } = services(); const issued = await sessions.createAfterPasswordVerified(tx, snapshot(employee));
    if (kind === 'JWT到期等号') setNow(issued.expiresAt);
    else await tx.authSession.update({ where: { id: issued.sessionId }, data: {
      expiresAt: kind === 'DB到期等号' ? fixedNow : new Date(issued.expiresAt.getTime() + 1000) } });
    await expect(identities.authenticate(tx, issued.accessToken, 'EMPLOYEE')).rejects.toMatchObject({
      code: kind === '期限不一致' ? 'TOKEN_INVALID' : 'TOKEN_EXPIRED' });
  });
});

it('签名检查后数据库读取跨过JWT期限仍拒绝', async () => {
  await fixture(async (tx, employee) => {
    const { tokens, sessions } = services(); const issued = await sessions.createAfterPasswordVerified(tx, snapshot(employee));
    const identities = new CurrentIdentityService(tokens, permissions, () => issued.expiresAt);
    await expect(identities.authenticate(tx, issued.accessToken, 'EMPLOYEE')).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
  });
});

it('UUID大小写输入按同一主体处理', async () => {
  await fixture(async (tx, employee) => {
    const { tokens, sessions, identities } = services();
    const issued = await sessions.createAfterPasswordVerified(tx, snapshot({ ...employee, subjectId: employee.subjectId.toUpperCase() }));
    const upper = await tokens.issue({ subjectType: 'EMPLOYEE', subjectId: employee.subjectId.toUpperCase(),
      sessionId: issued.sessionId.toUpperCase(), tokenVersion: 3 });
    await expect(identities.authenticate(tx, upper.accessToken, 'EMPLOYEE')).resolves.toMatchObject({ subjectId: employee.subjectId });
    expect(await sessions.revokeCurrent(tx, employee, issued.sessionId.toUpperCase())).toBe(true);
  });
});

it('单会话撤销拒绝他人sid或跨域，且不影响真实所有者', async () => {
  await fixture(async (tx, employee, customer) => {
    const { sessions, identities } = services(); const issued = await sessions.createAfterPasswordVerified(tx, snapshot(customer));
    await expect(sessions.revokeCurrent(tx, employee, issued.sessionId)).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
    await expect(sessions.revokeCurrent(tx, customer, randomUUID())).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
    await expect(identities.authenticate(tx, issued.accessToken, 'CUSTOMER')).resolves.toBeDefined();
  });
});

it.each(['EMPLOYEE', 'CUSTOMER'] as const)('%s不存在时拒绝创建', async subjectType => {
  const { sessions } = services();
  await expect(prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx,
    snapshot({ subjectType, subjectId: randomUUID() })))).rejects.toMatchObject({ code: 'ACCOUNT_UNAVAILABLE' });
});

it('所有会话写入入口拒绝根客户端，读取失败不泄漏输入', async () => {
  const { sessions } = services(); const subject = { subjectType: 'EMPLOYEE' as const, subjectId: randomUUID() };
  await expect(sessions.createAfterPasswordVerified(prisma, snapshot(subject))).rejects.toThrow('会话写入必须使用事务客户端');
  await expect(sessions.revokeCurrent(prisma, subject, randomUUID())).rejects.toThrow('会话写入必须使用事务客户端');
  await expect(sessions.revokeAll(prisma, subject, 'PASSWORD_RESET')).rejects.toThrow('会话写入必须使用事务客户端');
  const error = new SessionAuthenticationError('INVALID_CREDENTIALS');
  expect(error).not.toHaveProperty('cause');
  expect(JSON.stringify(error)).not.toContain(passwordHash);
});

it('外层失败使会话创建及lastLoginAt一起回滚；返回token不可使用', async () => {
  const data = employeeData(); const { sessions, identities } = services();
  const subject = { subjectType: 'EMPLOYEE' as const, subjectId: data.id }; let token = ''; let sessionId = '';
  await prisma.employee.create({ data }); const failure = new Error('模拟调用方后续操作失败');
  try {
    await expect(prisma.$transaction(async tx => {
      const issued = await sessions.createAfterPasswordVerified(tx, snapshot(subject)); token = issued.accessToken; sessionId = issued.sessionId;
      throw failure;
    })).rejects.toBe(failure);
    expect(await prisma.authSession.findUnique({ where: { id: sessionId } })).toBeNull();
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: data.id } })).lastLoginAt).toBeNull();
    await expect(identities.authenticate(prisma, token, 'EMPLOYEE')).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  } finally { await prisma.employee.delete({ where: { id: data.id } }); }
});

it('撤销与同事务后续失败一起回滚，原token继续有效', async () => {
  const data = employeeData(); const { sessions, identities } = services();
  const subject = { subjectType: 'EMPLOYEE' as const, subjectId: data.id };
  await prisma.employee.create({ data });
  try {
    const issued = await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, snapshot(subject)));
    const failure = new Error('模拟撤销后失败');
    await expect(prisma.$transaction(async tx => {
      await sessions.revokeAll(tx, subject, 'PASSWORD_CHANGED'); throw failure;
    })).rejects.toBe(failure);
    await expect(identities.authenticate(prisma, issued.accessToken, 'EMPLOYEE')).resolves.toBeDefined();
  } finally {
    await prisma.authSession.deleteMany({ where: { employeeId: data.id } });
    await prisma.employee.delete({ where: { id: data.id } });
  }
});

it('另一连接提交撤权后下一请求看到新权限，原会话仍有效', async () => {
  const data = employeeData(); const { sessions, identities } = services();
  const subject = { subjectType: 'EMPLOYEE' as const, subjectId: data.id }; await prisma.employee.create({ data });
  try {
    const issued = await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, snapshot(subject)));
    await prisma.employeeExtraPermission.create({ data: { employeeId: data.id, permissionCode: 'order.fulfillment.read', grantedById: data.id } });
    expect(await identities.authenticate(prisma, issued.accessToken, 'EMPLOYEE')).toMatchObject({ extraPermissions: ['order.fulfillment.read'] });
    await peer.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM employee WHERE id=${data.id}::uuid FOR UPDATE`;
      await tx.employeeExtraPermission.deleteMany({ where: { employeeId: data.id } });
      await tx.employee.update({ where: { id: data.id }, data: { permissionVersion: { increment: 1 } } });
    });
    expect(await identities.authenticate(prisma, issued.accessToken, 'EMPLOYEE')).toMatchObject({ extraPermissions: [], permissionVersion: 1 });
  } finally {
    await prisma.employeeExtraPermission.deleteMany({ where: { employeeId: data.id } });
    await prisma.authSession.deleteMany({ where: { employeeId: data.id } });
    await prisma.employee.delete({ where: { id: data.id } });
  }
});

async function waitForLock(pid: number) {
  const deadline = performance.now() + 300;
  while (performance.now() < deadline) {
    const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=${pid} AND wait_event_type='Lock') AS waiting`;
    if (row?.waiting) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('未观察到主体行锁等待');
}

it.each(['重置密码', '停用员工'])('%s先锁定并提交时，等待的旧密码快照不能创建会话', async operation => {
  const data = employeeData(); const { sessions } = services();
  const subject = { subjectType: 'EMPLOYEE' as const, subjectId: data.id }; await prisma.employee.create({ data });
  let release!: () => void; let signal!: () => void; let signalSecond!: () => void; let pid = 0;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { signal = resolve; });
  const started = new Promise<void>(resolve => { signalSecond = resolve; });
  const first = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM employee WHERE id=${data.id}::uuid FOR UPDATE`;
    await tx.employee.update({ where: { id: data.id }, data: operation === '重置密码'
      ? { passwordHash: '并发重置后的测试占位值', tokenVersion: 4 } : { status: 'DISABLED', tokenVersion: 4 } });
    signal(); await hold;
  }, { timeout: 5000 });
  let second: Promise<unknown> | undefined;
  try {
    await Promise.race([ready, first.then(() => { throw new Error('修改事务未到达屏障'); })]);
    // 立即捕获结果，避免预期认证失败成为未处理的Promise拒绝。
    second = peer.$transaction(async tx => {
      pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
      signalSecond(); return sessions.createAfterPasswordVerified(tx, snapshot(subject));
    }, { timeout: 5000 }).then(value => ({ value }), error => ({ error }));
    await started; await waitForLock(pid); release();
    await first;
    expect(await second).toMatchObject({ error: { code: operation === '重置密码' ? 'INVALID_CREDENTIALS' : 'ACCOUNT_UNAVAILABLE' } });
    expect(await prisma.authSession.count({ where: { employeeId: data.id } })).toBe(0);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: data.id } })).lastLoginAt).toBeNull();
  } finally {
    release(); await Promise.allSettled([first, ...(second ? [second] : [])]);
    await prisma.authSession.deleteMany({ where: { employeeId: data.id } });
    await prisma.employee.delete({ where: { id: data.id } });
  }
});

it('不同连接并发注销同sid由主体锁串行化，仅首次改变且不覆盖时间', async () => {
  const data = employeeData(); const { sessions } = services();
  const subject = { subjectType: 'EMPLOYEE' as const, subjectId: data.id }; await prisma.employee.create({ data });
  let release!: () => void; let signal!: () => void; let signalSecond!: () => void; let pid = 0;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { signal = resolve; });
  const started = new Promise<void>(resolve => { signalSecond = resolve; });
  let first: Promise<boolean> | undefined; let second: Promise<boolean> | undefined;
  try {
    const issued = await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, snapshot(subject)));
    first = prisma.$transaction(async tx => {
      const changed = await sessions.revokeCurrent(tx, subject, issued.sessionId); signal(); await hold; return changed;
    }, { timeout: 5000 });
    await Promise.race([ready, first.then(() => { throw new Error('首次注销未到达屏障'); })]);
    second = peer.$transaction(async tx => {
      pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
      signalSecond(); return sessions.revokeCurrent(tx, subject, issued.sessionId);
    }, { timeout: 5000 });
    await started; await waitForLock(pid); release();
    expect(await first).toBe(true); expect(await second).toBe(false);
    expect(await prisma.authSession.findUniqueOrThrow({ where: { id: issued.sessionId } }))
      .toMatchObject({ revokedAt: fixedNow, revokeReason: 'LOGOUT' });
  } finally {
    release(); await Promise.allSettled([...(first ? [first] : []), ...(second ? [second] : [])]);
    await prisma.authSession.deleteMany({ where: { employeeId: data.id } });
    await prisma.employee.delete({ where: { id: data.id } });
  }
});
