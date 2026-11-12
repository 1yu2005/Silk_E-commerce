// 作用：在真实数据库中验证登录域隔离、强制改密与最新权限守卫。
import 'reflect-metadata';
import { randomInt, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { CustomerStatus, EmployeeRole } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { ConfigModule } from '../src/config/config.module.js';
import { HealthModule } from '../src/health/health.module.js';
import { configureApp } from '../src/common/configure-app.js';
import { APP_CONFIG, loadConfiguration } from '../src/config/environment.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { assertSafeTestDatabase } from '../scripts/database-env.js';
import { PermissionService } from '../src/permissions/permission.service.js';
import { seedPermissionCatalog } from '../src/permissions/permission-seed.js';
import { AuthGuardModule } from '../src/auth/auth-guard.module.js';
import { AuthSessionService } from '../src/auth/auth-session.service.js';
import { CurrentIdentityService } from '../src/auth/current-identity.service.js';
import { JwtTokenService } from '../src/auth/jwt-token.service.js';
import { authGuardTestControllers, guardCalls } from './fixtures/auth-guard.controllers.js';

assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('集成测试仅可在test环境执行');
const secret = 'guard-integration-test-only-key-'.repeat(3);
const fixedNow = new Date('2026-11-11T12:00:00.500Z');
let now = fixedNow;
const clock = () => now;
const tokens = new JwtTokenService({ secret, ttlSeconds: 7200 }, clock);
const sessions = new AuthSessionService(tokens, clock);
const identities = new CurrentIdentityService(tokens, new PermissionService(), clock);
const passwordHash = 'HTTP Guard夹具的已验证哈希占位值';
const employeeIds = new Set<string>(); const customerIds = new Set<string>();
let app: INestApplication; let prisma: PrismaService; let baseUrl = '';

beforeAll(async () => {
  const module = await Test.createTestingModule({ imports: [ConfigModule, HealthModule, AuthGuardModule], controllers: authGuardTestControllers })
    .overrideProvider(APP_CONFIG).useValue(loadConfiguration({ ...process.env, LOG_LEVEL: 'silent' }))
    .overrideProvider(JwtTokenService).useValue(tokens)
    .overrideProvider(AuthSessionService).useValue(sessions)
    .overrideProvider(CurrentIdentityService).useValue(identities).compile();
  app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl(); prisma = app.get(PrismaService); await seedPermissionCatalog(prisma);
});
beforeEach(() => { now = fixedNow; guardCalls.protected = 0; });
afterEach(async () => {
  // 只清理本文件创建的UUID夹具，保留原测试库的员工、授权和会话。
  await prisma.employeeExtraPermission.deleteMany({ where: { employeeId: { in: [...employeeIds] } } });
  await prisma.authSession.deleteMany({ where: { OR: [
    { employeeId: { in: [...employeeIds] } }, { customerId: { in: [...customerIds] } },
  ] } });
  await prisma.employee.deleteMany({ where: { id: { in: [...employeeIds] } } });
  await prisma.customer.deleteMany({ where: { id: { in: [...customerIds] } } });
  employeeIds.clear(); customerIds.clear();
});
afterAll(async () => { await app?.close(); });

async function employee(role: EmployeeRole = 'CUSTOMER_SERVICE', mustChangePassword = false) {
  const id = randomUUID();
  await prisma.employee.create({ data: { id, username: `g_${id.replaceAll('-', '').slice(0, 20)}`,
    displayName: 'Guard测试员工', passwordHash, role, mustChangePassword, createdAt: new Date('2026-01-01T00:00:00Z') } }); employeeIds.add(id);
  const subject = { subjectType: 'EMPLOYEE' as const, subjectId: id };
  const issued = await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx,
    { ...subject, expectedPasswordHash: passwordHash, expectedTokenVersion: 0 }));
  return { ...issued, ...subject };
}
async function customer(status: CustomerStatus = 'NORMAL') {
  const id = randomUUID();
  await prisma.customer.create({ data: { id, phone: `139${String(randomInt(100_000_000)).padStart(8, '0')}`,
    nickname: 'Guard测试顾客', passwordHash, status, createdAt: new Date('2026-01-01T00:00:00Z') } }); customerIds.add(id);
  const subject = { subjectType: 'CUSTOMER' as const, subjectId: id };
  const issued = await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx,
    { ...subject, expectedPasswordHash: passwordHash, expectedTokenVersion: 0 }));
  return { ...issued, ...subject };
}
async function call(path: string, token?: string, method = 'GET') {
  return fetch(`${baseUrl}/api/v1${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
}
async function rejected(response: Response, status: number, code: string, privateValues: string[] = []) {
  expect(response.status).toBe(status);
  const body = await response.json() as { code: string; message: string; requestId: string };
  expect(body.code).toBe(code); expect(Object.keys(body).sort()).toEqual(['code', 'message', 'requestId']);
  expect(body.requestId).toBe(response.headers.get('x-request-id'));
  expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  for (const value of [secret, passwordHash, ...privateValues]) expect(JSON.stringify(body)).not.toContain(value);
}

it('公开接口与健康检查保持公开，携带无效token不触发身份认证', async () => {
  expect((await call('/guard-public', 'not-a-valid-token')).status).toBe(200);
  expect((await call('/health/live')).status).toBe(200);
});

it.each(['查询参数', 'Cookie', '客户端身份头'])('缺少Bearer时不能从%s补出身份', async source => {
  const actor = await employee();
  const response = await fetch(`${baseUrl}/api/v1/admin/me${source === '查询参数' ? `?token=${actor.accessToken}` : ''}`, {
    headers: source === 'Cookie' ? { Cookie: `token=${actor.accessToken}` } : source === '客户端身份头'
      ? { 'X-Subject-Id': actor.subjectId, 'X-Role': 'SUPER_ADMIN' } : {},
  });
  await rejected(response, 401, 'TOKEN_INVALID', [actor.accessToken]); expect(guardCalls.protected).toBe(0);
});

it.each([true, false])('重复Authorization头拒绝，不取决于合法头是否在前：%s', async validFirst => {
  const actor = await employee(); const valid = `Bearer ${actor.accessToken}`;
  const result = await new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = httpRequest(`${baseUrl}/api/v1/admin/me`, { headers: [
      // 原始头数组不会自动补Host，缺少它会在进入Nest之前被Node拒绝。
      'Host', new URL(baseUrl).host,
      'Authorization', validFirst ? valid : 'Bearer invalid', 'authorization', validFirst ? 'Bearer invalid' : valid,
    ] }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += String(chunk); });
      res.on('end', () => resolve({ status: res.statusCode!, text: body })); res.on('error', reject);
    });
    req.on('error', reject); req.end();
  });
  expect(result.status).toBe(401); expect(JSON.parse(result.text)).toMatchObject({ code: 'TOKEN_INVALID' });
  expect(result.text).not.toContain(actor.accessToken); expect(guardCalls.protected).toBe(0);
});

it('真实签名错误返回401且不执行处理器', async () => {
  const actor = await employee();
  const otherKey = new JwtTokenService({ secret: 'different-guard-test-key-'.repeat(3), ttlSeconds: 7200 }, clock);
  const forged = await otherKey.issue({ subjectType: 'EMPLOYEE', subjectId: actor.subjectId, sessionId: actor.sessionId, tokenVersion: 0 });
  await rejected(await call('/admin/me', forged.accessToken), 401, 'TOKEN_INVALID', [forged.accessToken]);
  expect(guardCalls.protected).toBe(0);
});

it.each(['EMPLOYEE', 'CUSTOMER'] as const)('%s不能访问另一登录域的私有接口', async type => {
  const actor = type === 'EMPLOYEE' ? await employee() : await customer();
  await rejected(await call(type === 'EMPLOYEE' ? '/store/me' : '/admin/me', actor.accessToken),
    401, 'TOKEN_SUBJECT_MISMATCH', [actor.accessToken]); expect(guardCalls.protected).toBe(0);
});

it('JWT恰好到期返回401 TOKEN_EXPIRED', async () => {
  const actor = await employee(); now = actor.expiresAt;
  await rejected(await call('/admin/me', actor.accessToken), 401, 'TOKEN_EXPIRED', [actor.accessToken]);
  expect(guardCalls.protected).toBe(0);
});

it('会话实际撤销后旧token返回401 SESSION_REVOKED，其它设备继续有效', async () => {
  const actor = await employee();
  const other = await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx,
    { subjectType: actor.subjectType, subjectId: actor.subjectId, expectedPasswordHash: passwordHash, expectedTokenVersion: 0 }));
  await prisma.$transaction(tx => sessions.revokeCurrent(tx, actor, actor.sessionId));
  await rejected(await call('/admin/me', actor.accessToken), 401, 'SESSION_REVOKED', [actor.accessToken]);
  expect(guardCalls.protected).toBe(0); expect((await call('/admin/me', other.accessToken)).status).toBe(200);
});

it.each(['不存在sid', '主体版本', '会话版本'])('%s变化被Guard映射401 TOKEN_INVALID', async kind => {
  const actor = await employee(); let token = actor.accessToken;
  if (kind === '不存在sid') token = (await tokens.issue({ subjectType: 'EMPLOYEE', subjectId: actor.subjectId,
    sessionId: randomUUID(), tokenVersion: 0 })).accessToken;
  else if (kind === '主体版本') await prisma.employee.update({ where: { id: actor.subjectId }, data: { tokenVersion: 1 } });
  else await prisma.authSession.update({ where: { id: actor.sessionId }, data: { tokenVersion: 1 } });
  await rejected(await call('/admin/me', token), 401, 'TOKEN_INVALID', [token]); expect(guardCalls.protected).toBe(0);
});

it.each(['停用员工', '冻结顾客'])('%s即使尚未撤销会话也被Guard拒绝', async kind => {
  const actor = kind === '停用员工' ? await employee() : await customer();
  if (actor.subjectType === 'EMPLOYEE') await prisma.employee.update({ where: { id: actor.subjectId }, data: { status: 'DISABLED' } });
  else await prisma.customer.update({ where: { id: actor.subjectId }, data: { status: 'LOGIN_FROZEN' } });
  await rejected(await call(actor.subjectType === 'EMPLOYEE' ? '/admin/me' : '/store/me', actor.accessToken),
    401, 'ACCOUNT_UNAVAILABLE', [actor.accessToken]); expect(guardCalls.protected).toBe(0);
});

it.each(['NORMAL', 'TRADE_RESTRICTED'] as const)('%s顾客通过私有本人接口，也能通过共用注销入口认证', async status => {
  const actor = await customer(status);
  expect((await call('/store/me', actor.accessToken)).status).toBe(200);
  expect((await call('/auth/logout', actor.accessToken, 'POST')).status).toBe(200);
});

it('无权返回403且不撤销会话，旧token仍能访问已有权限', async () => {
  const actor = await employee();
  await rejected(await call('/admin/fulfillment', actor.accessToken), 403, 'FORBIDDEN', [actor.accessToken]);
  expect(guardCalls.protected).toBe(0);
  expect((await call('/admin/service', actor.accessToken)).status).toBe(200);
  expect((await prisma.authSession.findUniqueOrThrow({ where: { id: actor.sessionId } })).revokedAt).toBeNull();
});

it('超级管理员按完整目录权限通过管理员能力，普通岗位不能使用', async () => {
  const admin = await employee('SUPER_ADMIN'); const ordinary = await employee('MERCH_WAREHOUSE');
  expect((await call('/admin/employees', admin.accessToken)).status).toBe(200);
  await rejected(await call('/admin/employees', ordinary.accessToken), 403, 'FORBIDDEN');
});

it('同一旧token在授权及撤权提交后按最新权限返回200/403，其它能力保持可用', async () => {
  const actor = await employee();
  await rejected(await call('/admin/fulfillment', actor.accessToken), 403, 'FORBIDDEN');
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM employee WHERE id=${actor.subjectId}::uuid FOR UPDATE`;
    await tx.employeeExtraPermission.create({ data: { employeeId: actor.subjectId, permissionCode: 'order.fulfillment.read', grantedById: actor.subjectId } });
    await tx.employee.update({ where: { id: actor.subjectId }, data: { permissionVersion: { increment: 1 } } });
  });
  expect((await call('/admin/fulfillment', actor.accessToken)).status).toBe(200);
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM employee WHERE id=${actor.subjectId}::uuid FOR UPDATE`;
    await tx.employeeExtraPermission.deleteMany({ where: { employeeId: actor.subjectId } });
    await tx.employee.update({ where: { id: actor.subjectId }, data: { permissionVersion: { increment: 1 } } });
  });
  await rejected(await call('/admin/fulfillment', actor.accessToken), 403, 'FORBIDDEN');
  expect((await call('/admin/service', actor.accessToken)).status).toBe(200);
  expect((await prisma.authSession.findUniqueOrThrow({ where: { id: actor.sessionId } })).revokedAt).toBeNull();
});

it('方法要求的多个权限须全部满足，角色变化下一请求即时生效', async () => {
  const actor = await employee('MERCH_WAREHOUSE');
  await rejected(await call('/admin/two-permissions', actor.accessToken), 403, 'FORBIDDEN');
  await prisma.employee.update({ where: { id: actor.subjectId }, data: { role: 'SUPER_ADMIN', permissionVersion: 1 } });
  expect((await call('/admin/two-permissions', actor.accessToken)).status).toBe(200);
});

it('方法权限与控制器权限合并，方法的空权限声明不能清掉控制器约束', async () => {
  const warehouse = await employee('MERCH_WAREHOUSE'); const service = await employee();
  await rejected(await call('/guard-inherited/merged', warehouse.accessToken), 403, 'FORBIDDEN');
  await rejected(await call('/guard-inherited/merged', service.accessToken), 403, 'FORBIDDEN');
  await rejected(await call('/guard-inherited/empty-method', warehouse.accessToken), 403, 'FORBIDDEN');
  expect((await call('/guard-inherited/empty-method', service.accessToken)).status).toBe(200);
  expect(guardCalls.protected).toBe(1);
});

it.each([['GET', '/admin/me'], ['POST', '/admin/auth/change-password'], ['POST', '/auth/logout']])(
  '强制改密员工允许%s %s', async (method, path) => {
    const actor = await employee('SUPER_ADMIN', true);
    expect((await call(path!, actor.accessToken, method)).status).toBe(200); expect(guardCalls.protected).toBe(1);
  },
);

it.each([['GET', '/admin/employees'], ['GET', '/admin/permissions'], ['GET', '/admin/fulfillment'],
  ['GET', '/admin/alias-me'], ['POST', '/admin/me'], ['GET', '/admin/auth/change-password'], ['GET', '/auth/logout'],
])('强制改密员工不能绕过白名单访问%s %s', async (method, path) => {
  const actor = await employee('SUPER_ADMIN', true);
  await rejected(await call(path!, actor.accessToken, method), 403, 'PASSWORD_CHANGE_REQUIRED', [actor.accessToken]);
  expect(guardCalls.protected).toBe(0);
});

it('HEAD不能沿GET本人白名单绕过，查询参数不能把其它接口伪装成白名单', async () => {
  const actor = await employee('SUPER_ADMIN', true);
  const head = await call('/admin/me', actor.accessToken, 'HEAD');
  expect(head.status).toBe(403); expect(await head.text()).toBe('');
  await rejected(await call('/admin/employees?path=/api/v1/admin/me&mustChangePassword=false', actor.accessToken),
    403, 'PASSWORD_CHANGE_REQUIRED'); expect(guardCalls.protected).toBe(0);
});

it('同一会话的强制改密标志变化在下一请求生效', async () => {
  const actor = await employee('SUPER_ADMIN');
  expect((await call('/admin/employees', actor.accessToken)).status).toBe(200);
  await prisma.employee.update({ where: { id: actor.subjectId }, data: { mustChangePassword: true } });
  await rejected(await call('/admin/employees', actor.accessToken), 403, 'PASSWORD_CHANGE_REQUIRED');
  expect((await call('/admin/me', actor.accessToken)).status).toBe(200);
});

it('控制器和方法的登录域冲突安全失败，不执行处理器或泄漏配置细节', async () => {
  const actor = await employee();
  await rejected(await call('/admin/conflicting-domain', actor.accessToken), 500, 'INTERNAL_ERROR');
  expect(guardCalls.protected).toBe(0);
});
