// 作用：验证员工真实登录、账号规范化、会话创建、限流与状态竞态。
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { INestApplication } from '@nestjs/common';
import type { EmployeeRole, Prisma, SubjectType } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/common/configure-app.js';
import { APP_CONFIG, loadConfiguration } from '../src/config/environment.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { assertSafeTestDatabase } from '../scripts/database-env.js';
import { JwtTokenService } from '../src/auth/jwt-token.service.js';
import { AuthSessionService } from '../src/auth/auth-session.service.js';
import { PasswordService } from '../src/auth/password.service.js';
import { LoginRateLimiter } from '../src/auth/login-rate-limiter.js';
import { CurrentIdentityService, type CurrentIdentity } from '../src/auth/current-identity.service.js';
import { PermissionService } from '../src/permissions/permission.service.js';
import { EmployeeAuthController } from '../src/auth/employee-auth.controller.js';
import { EmployeeLoginDto } from '../src/auth/employee-login.dto.js';
import { roleTemplates } from '../src/permissions/permission-catalog.js';
import { seedPermissionCatalog } from '../src/permissions/permission-seed.js';

assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('集成测试仅可在test环境执行');
// 与板块1测试相同，补齐Vitest转换器未生成、生产tsc会生成的DTO元数据。
Reflect.defineMetadata('design:paramtypes', [EmployeeLoginDto, Object], EmployeeAuthController.prototype, 'login');
const password = 'EmployeeDemo#2026'; const wrongPassword = 'WrongEmployee#2026';
let millis = Date.parse('2026-11-12T01:00:00.500Z');
const clock = () => new Date(millis);
const tokens = new JwtTokenService({ secret: 'employee-api-test-only-key-'.repeat(3), ttlSeconds: 7200 }, clock);
const sessions = new AuthSessionService(tokens, clock);
class ControlledPasswords extends PasswordService {
  afterVerified: (() => Promise<void>) | undefined;
  checks = 0;
  override async verify(value: string, hash: string) {
    this.checks++; const correct = await super.verify(value, hash);
    if (correct) await this.afterVerified?.(); return correct;
  }
}
const passwords = new ControlledPasswords();
class ControlledIdentities extends CurrentIdentityService {
  afterRead: ((identity: CurrentIdentity) => Promise<void>) | undefined;
  override async authenticate(db: Pick<Prisma.TransactionClient, '$queryRaw'>, token: string, subject: SubjectType) {
    const identity = await super.authenticate(db, token, subject); await this.afterRead?.(identity); return identity;
  }
}
const identities = new ControlledIdentities(tokens, new PermissionService(), clock);
const limiter = new LoginRateLimiter(() => millis);
let hash = ''; let replacementHash = ''; let spaceHash = '';
let app: INestApplication; let prisma: PrismaService; let peer: PrismaService; let baseUrl = '';
const employeeIds = new Set<string>();
interface LoginData { accessToken: string; tokenType: string; expiresAt: string; mustChangePassword: boolean;
  employee: { id: string; username: string; displayName: string; role: string; status: string; mustChangePassword: boolean } }
interface PermissionData { role: EmployeeRole; permissionVersion: number;
  defaultPermissions: string[]; extraPermissions: string[]; effectivePermissions: string[] }

beforeAll(async () => {
  [hash, replacementHash, spaceHash] = await Promise.all([passwords.hash(password), passwords.hash('ReplacementDemo#2026'), passwords.hash('        ')]);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG).useValue(loadConfiguration({ ...process.env, LOG_LEVEL: 'silent', SWAGGER_ENABLED: 'true' }))
    .overrideProvider(JwtTokenService).useValue(tokens).overrideProvider(AuthSessionService).useValue(sessions)
    .overrideProvider(PasswordService).useValue(passwords).overrideProvider(LoginRateLimiter).useValue(limiter)
    .overrideProvider(CurrentIdentityService).useValue(identities).compile();
  app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1');
  prisma = app.get(PrismaService); baseUrl = await app.getUrl();
  await seedPermissionCatalog(prisma);
  peer = new PrismaService(loadConfiguration()); await peer.onModuleInit();
});
beforeEach(() => { millis += 360_000; passwords.afterVerified = undefined; passwords.checks = 0; identities.afterRead = undefined; });
afterEach(async () => {
  passwords.afterVerified = undefined; identities.afterRead = undefined;
  await prisma.employeeExtraPermission.deleteMany({ where: { employeeId: { in: [...employeeIds] } } });
  await prisma.authSession.deleteMany({ where: { employeeId: { in: [...employeeIds] } } });
  await prisma.employee.deleteMany({ where: { id: { in: [...employeeIds] } } }); employeeIds.clear();
});
afterAll(async () => { await peer?.$disconnect(); await app?.close(); });

async function employee(role: EmployeeRole = 'CUSTOMER_SERVICE', mustChangePassword = false, passwordHash = hash) {
  const id = randomUUID();
  const result = await prisma.employee.create({ data: { id, username: `l_${id.replaceAll('-', '').slice(0, 20)}`,
    displayName: '员工登录测试', role, mustChangePassword, passwordHash, createdAt: new Date('2026-01-01T00:00:00Z') } }); employeeIds.add(id); return result;
}
async function login(input: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/api/v1/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input) });
}
async function me(token?: string) {
  return fetch(`${baseUrl}/api/v1/admin/me`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}
async function errorBody(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  const body = await response.json() as { code: string; message: string; requestId: string; details?: unknown };
  expect(body.code).toBe(code); expect(body.requestId).toBe(response.headers.get('x-request-id'));
  for (const value of [password, wrongPassword, hash, replacementHash]) expect(JSON.stringify(body)).not.toContain(value);
  return body;
}

it.each(['SUPER_ADMIN', 'MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'] as const)('%s通过真实bcrypt登录、会话提交和本人查询', async role => {
  const account = await employee(role);
  const response = await login({ username: account.username, password }, { 'X-Request-Id': 'caller-id' });
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json() as { data: LoginData; requestId: string };
  expect(body.requestId).toBe(response.headers.get('x-request-id')); expect(body.requestId).not.toBe('caller-id');
  expect(Object.keys(body.data).sort()).toEqual(['accessToken', 'employee', 'expiresAt', 'mustChangePassword', 'tokenType']);
  expect(body.data.tokenType).toBe('Bearer'); expect(body.data.mustChangePassword).toBe(false);
  expect(body.data.employee).toEqual({ id: account.id, username: account.username, displayName: account.displayName,
    role, status: 'ACTIVE', mustChangePassword: false });
  const claims = await tokens.verify(body.data.accessToken, 'EMPLOYEE');
  const session = await prisma.authSession.findUniqueOrThrow({ where: { id: claims.sid } });
  expect(session).toMatchObject({ employeeId: account.id, tokenVersion: 0, revokedAt: null });
  expect(session.expiresAt.toISOString()).toBe(body.data.expiresAt);
  expect((await prisma.employee.findUniqueOrThrow({ where: { id: account.id } })).lastLoginAt).toEqual(clock());
  const profile = await me(body.data.accessToken); expect(profile.status).toBe(200);
  expect(profile.headers.get('cache-control')).toBe('no-store');
  const result = await profile.json() as { data: unknown };
  expect(result.data).toEqual(body.data.employee);
  expect(JSON.stringify(result)).not.toContain(hash); expect(JSON.stringify(result)).not.toContain(body.data.accessToken);
});

it('账号去空白并转小写；密码原文的八个空格不被trim', async () => {
  const account = await employee('CUSTOMER_SERVICE', false, spaceHash);
  const response = await login({ username: ` ${account.username.toUpperCase()} `, password: '        ' });
  expect(response.status).toBe(200);
  expect((await response.json() as { data: LoginData }).data.employee.username).toBe(account.username);
});

it('不存在账号与错误密码统一401且均执行真实bcrypt，不创建会话或更新登录时间', async () => {
  const account = await employee();
  const missing = await errorBody(await login({ username: `missing_${randomUUID().slice(0, 8)}`, password }), 401, 'INVALID_CREDENTIALS');
  const wrong = await errorBody(await login({ username: account.username, password: wrongPassword }), 401, 'INVALID_CREDENTIALS');
  expect({ ...missing, requestId: '' }).toEqual({ ...wrong, requestId: '' }); expect(passwords.checks).toBe(2);
  expect(await prisma.authSession.count({ where: { employeeId: account.id } })).toBe(0);
  expect((await prisma.employee.findUniqueOrThrow({ where: { id: account.id } })).lastLoginAt).toBeNull();
});

it('停用账号先验证密码：错误密码仍为通用401，正确密码才返回不可用', async () => {
  const account = await employee(); await prisma.employee.update({ where: { id: account.id }, data: { status: 'DISABLED' } });
  await errorBody(await login({ username: account.username, password: wrongPassword }), 401, 'INVALID_CREDENTIALS');
  await errorBody(await login({ username: account.username, password }), 401, 'ACCOUNT_UNAVAILABLE');
  expect(await prisma.authSession.count({ where: { employeeId: account.id } })).toBe(0);
});

it('首次登录返回强制改密标志，真实本人接口仍可读且不返回密码、权限或版本', async () => {
  const account = await employee('SUPER_ADMIN', true);
  const response = await login({ username: account.username, password }); expect(response.status).toBe(200);
  const { data } = await response.json() as { data: LoginData };
  expect(data.mustChangePassword).toBe(true); expect(data.employee.mustChangePassword).toBe(true);
  const profile = await me(data.accessToken); expect(profile.status).toBe(200);
  expect(Object.keys((await profile.json() as { data: object }).data).sort())
    .toEqual(['id', 'username', 'displayName', 'role', 'status', 'mustChangePassword'].sort());
});

it('重复登录创建独立会话，当前登录不会撤销其它设备', async () => {
  const account = await employee();
  const first = await (await login({ username: account.username, password })).json() as { data: LoginData };
  const second = await (await login({ username: account.username, password })).json() as { data: LoginData };
  expect(first.data.accessToken).not.toBe(second.data.accessToken);
  expect(await prisma.authSession.count({ where: { employeeId: account.id, revokedAt: null } })).toBe(2);
  expect((await me(first.data.accessToken)).status).toBe(200); expect((await me(second.data.accessToken)).status).toBe(200);
});

it.each([{}, { username: 123, password }, { username: 'abc', password }, { username: 'valid_name', password: 123 },
  { username: 'valid_name', password: 'short' }, { username: 'valid_name', password: '密'.repeat(25) },
  { username: 'valid_name', password, role: 'SUPER_ADMIN' }, { username: 'valid_name', password, passwordHash: 'private-input' },
])('DTO拒绝缺失、错类型、超字节或额外字段 %#，在bcrypt前返回400', async input => {
  const body = await errorBody(await login(input), 400, 'VALIDATION_FAILED');
  expect(body.details).toBeDefined(); expect(passwords.checks).toBe(0); expect(JSON.stringify(body)).not.toContain('private-input');
});

it('同规范化账号及IP五次失败后第六次429，Retry-After可被浏览器读取，到期恢复', async () => {
  const account = await employee();
  for (let index = 0; index < 5; index++) await errorBody(await login({ username: index % 2 ? ` ${account.username.toUpperCase()} ` : account.username,
    password: wrongPassword }), 401, 'INVALID_CREDENTIALS');
  const blocked = await login({ username: account.username, password }, { Origin: 'http://localhost:5173' });
  await errorBody(blocked, 429, 'AUTH_RATE_LIMITED'); expect(blocked.headers.get('retry-after')).toBe('300');
  expect(blocked.headers.get('access-control-expose-headers')).toContain('Retry-After'); expect(passwords.checks).toBe(5);
  millis += 300_000;
  expect((await login({ username: account.username, password })).status).toBe(200);
});

it('每IP每分钟30次预算在DTO前生效，伪造X-Forwarded-For不能绕过', async () => {
  for (let index = 0; index < 30; index++) await errorBody(await login({}, { 'X-Forwarded-For': `192.0.2.${index + 1}` }), 400, 'VALIDATION_FAILED');
  const blocked = await login({}, { 'X-Forwarded-For': '203.0.113.7' });
  await errorBody(blocked, 429, 'AUTH_RATE_LIMITED'); expect(blocked.headers.get('retry-after')).toBe('60');
  expect(passwords.checks).toBe(0);
  millis += 60_000; await errorBody(await login({}), 400, 'VALIDATION_FAILED');
});

it('六个并发错误密码最多完成五次验证，第六个被预留名额拦截', async () => {
  const account = await employee();
  const responses = await Promise.all(Array.from({ length: 6 }, () => login({ username: account.username, password: wrongPassword })));
  expect(responses.map(response => response.status).sort()).toEqual([401, 401, 401, 401, 401, 429]);
  expect(passwords.checks).toBe(5); expect(await prisma.authSession.count({ where: { employeeId: account.id } })).toBe(0);
});

it.each(['密码重置', '员工停用'])('真实bcrypt验证完成后并发%s，旧登录不能创建会话', async operation => {
  const account = await employee(); let release!: () => void; let ready!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const verified = new Promise<void>(resolve => { ready = resolve; });
  passwords.afterVerified = async () => { ready(); await hold; };
  const pending = login({ username: account.username, password });
  try {
    await Promise.race([verified, pending.then(() => { throw new Error('登录未进入密码验证屏障'); })]);
    await peer.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM employee WHERE id=${account.id}::uuid FOR UPDATE`;
      await tx.employee.update({ where: { id: account.id }, data: operation === '密码重置'
        ? { passwordHash: replacementHash, tokenVersion: 1, mustChangePassword: true } : { status: 'DISABLED', tokenVersion: 1 } });
      await sessions.revokeAll(tx, { subjectType: 'EMPLOYEE', subjectId: account.id }, operation === '密码重置' ? 'PASSWORD_RESET' : 'ACCOUNT_DISABLED');
    });
    release(); await errorBody(await pending, 401, operation === '密码重置' ? 'INVALID_CREDENTIALS' : 'ACCOUNT_UNAVAILABLE');
    expect(await prisma.authSession.count({ where: { employeeId: account.id } })).toBe(0);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: account.id } })).lastLoginAt).toBeNull();
  } finally { release(); await pending; passwords.afterVerified = undefined; }
});

it('本人接口拒绝缺失、顾客域和已撤销凭证，使用数据库最新显示名', async () => {
  const account = await employee();
  const { data } = await (await login({ username: account.username, password })).json() as { data: LoginData };
  await errorBody(await me(), 401, 'TOKEN_INVALID');
  const otherDomain = await tokens.issue({ subjectType: 'CUSTOMER', subjectId: randomUUID(), sessionId: randomUUID(), tokenVersion: 0 });
  await errorBody(await me(otherDomain.accessToken), 401, 'TOKEN_SUBJECT_MISMATCH');
  await prisma.employee.update({ where: { id: account.id }, data: { displayName: '新的员工显示名' } });
  expect((await (await me(data.accessToken)).json() as { data: { displayName: string } }).data.displayName).toBe('新的员工显示名');
  const claims = await tokens.verify(data.accessToken, 'EMPLOYEE');
  await prisma.$transaction(tx => sessions.revokeCurrent(tx, { subjectType: 'EMPLOYEE', subjectId: account.id }, claims.sid));
  await errorBody(await me(data.accessToken), 401, 'SESSION_REVOKED');
});

async function myPermissions(token?: string, suffix = '', headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/api/v1/admin/me/permissions${suffix}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  });
}
async function permissionData(response: Response): Promise<PermissionData> {
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json() as { data: PermissionData; requestId: string };
  expect(Object.keys(body).sort()).toEqual(['data', 'requestId']); expect(body.requestId).toBe(response.headers.get('x-request-id'));
  expect(Object.keys(body.data).sort()).toEqual(['role', 'permissionVersion', 'defaultPermissions', 'extraPermissions', 'effectivePermissions'].sort());
  for (const array of [body.data.defaultPermissions, body.data.extraPermissions, body.data.effectivePermissions]) {
    expect(array).toEqual([...new Set(array)].sort());
  }
  for (const secret of [hash, replacementHash, password]) expect(JSON.stringify(body)).not.toContain(secret);
  return body.data;
}

it.each([
  ['SUPER_ADMIN', 52], ['MERCH_WAREHOUSE', 25], ['CUSTOMER_SERVICE', 12],
] as const)('%s本人权限准确返回%d项默认权限，不要求管理员权限且查询无副作用', async (role, count) => {
  const account = await employee(role); const { data } = await (await login({ username: account.username, password })).json() as { data: LoginData };
  const beforeAccount = await prisma.employee.findUniqueOrThrow({ where: { id: account.id } });
  const beforeSession = await prisma.authSession.findMany({ where: { employeeId: account.id } });
  const result = await permissionData(await myPermissions(data.accessToken));
  expect(result).toEqual({ role, permissionVersion: 0, defaultPermissions: [...roleTemplates[role]].sort(),
    extraPermissions: [], effectivePermissions: [...roleTemplates[role]].sort() });
  expect(result.defaultPermissions).toHaveLength(count);
  expect(await prisma.employee.findUniqueOrThrow({ where: { id: account.id } })).toEqual(beforeAccount);
  expect(await prisma.authSession.findMany({ where: { employeeId: account.id } })).toEqual(beforeSession);
  expect(await prisma.auditLog.count({ where: { actorEmployeeId: account.id } })).toBe(0);
});

it('另一连接提交授权与撤权后同一旧token立即看到权限版本和三组结果，保留其它能力及同岗隔离', async () => {
  const account = await employee(); const coworker = await employee(); const admin = await employee('SUPER_ADMIN');
  const { data } = await (await login({ username: account.username, password })).json() as { data: LoginData };
  const coworkerLogin = await (await login({ username: coworker.username, password })).json() as { data: LoginData };
  const original = await permissionData(await myPermissions(data.accessToken));
  const extras = ['order.fulfillment.read', 'shipment.claim', 'shipment.handover'];
  // 员工管理API尚未实现；只用另一连接在同事务写入完整授权夹具，验证读取即时性。
  await peer.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM employee WHERE id=${account.id}::uuid FOR UPDATE`;
    await tx.employeeExtraPermission.createMany({ data: extras.map(permissionCode => ({ employeeId: account.id, permissionCode, grantedById: admin.id })) });
    await tx.employee.update({ where: { id: account.id }, data: { permissionVersion: { increment: 1 }, version: { increment: 1 } } });
  });
  const granted = await permissionData(await myPermissions(data.accessToken));
  expect(granted).toEqual({ ...original, permissionVersion: 1, extraPermissions: extras,
    effectivePermissions: [...original.defaultPermissions, ...extras].sort() });
  for (const unrelated of ['product.cost.read', 'inventory.read', 'employee.permission.manage']) expect(granted.effectivePermissions).not.toContain(unrelated);
  expect((await permissionData(await myPermissions(coworkerLogin.data.accessToken))).extraPermissions).toEqual([]);
  await peer.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM employee WHERE id=${account.id}::uuid FOR UPDATE`;
    await tx.employeeExtraPermission.deleteMany({ where: { employeeId: account.id } });
    await tx.employee.update({ where: { id: account.id }, data: { permissionVersion: { increment: 1 }, version: { increment: 1 } } });
  });
  expect(await permissionData(await myPermissions(data.accessToken))).toEqual({ ...original, permissionVersion: 2 });
  expect((await me(data.accessToken)).status).toBe(200);
  expect(await prisma.authSession.count({ where: { employeeId: account.id, revokedAt: null } })).toBe(1);
  expect((await prisma.employee.findUniqueOrThrow({ where: { id: account.id } })).tokenVersion).toBe(0);
});

it('一次响应沿用同一身份快照，快照后另一连接调岗不会混入新默认权限，下一请求读取新岗位', async () => {
  const account = await employee(); const { data } = await (await login({ username: account.username, password })).json() as { data: LoginData };
  identities.afterRead = async identity => {
    expect(identity).toMatchObject({ subjectId: account.id, role: 'CUSTOMER_SERVICE', permissionVersion: 0 });
    identities.afterRead = undefined;
    await peer.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM employee WHERE id=${account.id}::uuid FOR UPDATE`;
      await tx.employee.update({ where: { id: account.id }, data: { role: 'MERCH_WAREHOUSE', permissionVersion: 1, version: 1 } });
    });
  };
  const first = await permissionData(await myPermissions(data.accessToken));
  expect(first).toEqual({ role: 'CUSTOMER_SERVICE', permissionVersion: 0, defaultPermissions: [...roleTemplates.CUSTOMER_SERVICE].sort(),
    extraPermissions: [], effectivePermissions: [...roleTemplates.CUSTOMER_SERVICE].sort() });
  const next = await permissionData(await myPermissions(data.accessToken));
  expect(next).toEqual({ role: 'MERCH_WAREHOUSE', permissionVersion: 1, defaultPermissions: [...roleTemplates.MERCH_WAREHOUSE].sort(),
    extraPermissions: [], effectivePermissions: [...roleTemplates.MERCH_WAREHOUSE].sort() });
});

it('强制改密员工不能查询权限，403不注销；状态变化下一请求立即生效且客户端不能自报能力', async () => {
  const account = await employee('SUPER_ADMIN', true); const { data } = await (await login({ username: account.username, password })).json() as { data: LoginData };
  await errorBody(await myPermissions(data.accessToken), 403, 'PASSWORD_CHANGE_REQUIRED');
  expect((await me(data.accessToken)).status).toBe(200);
  await peer.employee.update({ where: { id: account.id }, data: { mustChangePassword: false, role: 'CUSTOMER_SERVICE', permissionVersion: 1 } });
  const result = await permissionData(await myPermissions(data.accessToken, '?role=SUPER_ADMIN&permissions=employee.read', {
    'X-Role': 'SUPER_ADMIN', 'X-Permissions': 'employee.read', 'X-Request-Id': 'caller-id',
  }));
  expect(result).toMatchObject({ role: 'CUSTOMER_SERVICE', permissionVersion: 1, extraPermissions: [] });
  expect(result.effectivePermissions).not.toContain('employee.read');
  await peer.employee.update({ where: { id: account.id }, data: { mustChangePassword: true } });
  await errorBody(await myPermissions(data.accessToken), 403, 'PASSWORD_CHANGE_REQUIRED');
  expect(await prisma.authSession.count({ where: { employeeId: account.id, revokedAt: null } })).toBe(1);
});

it('本人权限接口拒绝缺失、顾客域、撤销、停用及过期凭证', async () => {
  const account = await employee(); const { data } = await (await login({ username: account.username, password })).json() as { data: LoginData };
  await errorBody(await myPermissions(), 401, 'TOKEN_INVALID');
  const customer = await tokens.issue({ subjectType: 'CUSTOMER', subjectId: randomUUID(), sessionId: randomUUID(), tokenVersion: 0 });
  await errorBody(await myPermissions(customer.accessToken), 401, 'TOKEN_SUBJECT_MISMATCH');
  await peer.employee.update({ where: { id: account.id }, data: { status: 'DISABLED' } });
  await errorBody(await myPermissions(data.accessToken), 401, 'ACCOUNT_UNAVAILABLE');
  await peer.employee.update({ where: { id: account.id }, data: { status: 'ACTIVE' } });
  const claims = await tokens.verify(data.accessToken, 'EMPLOYEE');
  await prisma.$transaction(tx => sessions.revokeCurrent(tx, { subjectType: 'EMPLOYEE', subjectId: account.id }, claims.sid));
  await errorBody(await myPermissions(data.accessToken), 401, 'SESSION_REVOKED');
  millis += 7_200_000; await errorBody(await myPermissions(data.accessToken), 401, 'TOKEN_EXPIRED');
});

it('已编译的真实API可登录和读取本人，tsc元数据同样拒绝额外JSON字段', async () => {
  const account = await employee();
  const source = String.raw`
    require('reflect-metadata');
    const { NestFactory } = require('@nestjs/core');
    const { AppModule } = require('./dist/app.module.js');
    const { configureApp } = require('./dist/common/configure-app.js');
    (async () => {
      const app = await NestFactory.create(AppModule, { logger: false });
      try {
        configureApp(app); await app.listen(0, '127.0.0.1'); const url = await app.getUrl();
        const input = { username: process.env.SHOP_TEST_USERNAME, password: process.env.SHOP_TEST_PASSWORD };
        const send = body => fetch(url + '/api/v1/admin/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const invalid = await send({ ...input, role: 'SUPER_ADMIN' });
        const response = await send(input); const body = await response.json();
        const profile = await fetch(url + '/api/v1/admin/me', { headers: { Authorization: 'Bearer ' + body.data?.accessToken } });
        const permissions = await fetch(url + '/api/v1/admin/me/permissions', { headers: { Authorization: 'Bearer ' + body.data?.accessToken } });
        const permissionBody = await permissions.json();
        console.log(JSON.stringify({ invalidStatus: invalid.status, loginStatus: response.status, meStatus: profile.status,
          permissionStatus: permissions.status, permissionRole: permissionBody.data?.role, defaultCount: permissionBody.data?.defaultPermissions?.length }));
      } finally { await app.close(); }
    })().catch(() => { console.error('编译后API验证失败'); process.exitCode=1; });`;
  const child = spawnSync(process.execPath, ['-e', source], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true, timeout: 12_000,
    env: { ...process.env, LOG_LEVEL: 'silent', SHOP_TEST_USERNAME: account.username, SHOP_TEST_PASSWORD: password } });
  expect(child.status).toBe(0); expect(JSON.parse(child.stdout.trim())).toEqual({ invalidStatus: 400, loginStatus: 200, meStatus: 200,
    permissionStatus: 200, permissionRole: 'CUSTOMER_SERVICE', defaultCount: 12 });
  for (const value of [password, hash]) expect(child.stdout + child.stderr).not.toContain(value);
});
