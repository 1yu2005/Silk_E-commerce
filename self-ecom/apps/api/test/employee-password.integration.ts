// 作用：验证员工本人改密、解除首次改密、全部会话失效及并发回滚。
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { INestApplication } from '@nestjs/common';
import type { Employee, EmployeeRole, Prisma } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuditService, type AuditPayload } from '../src/audit/audit.service.js';
import { configureApp } from '../src/common/configure-app.js';
import { APP_CONFIG, loadConfiguration } from '../src/config/environment.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { assertSafeTestDatabase } from '../scripts/database-env.js';
import { AuthSessionService } from '../src/auth/auth-session.service.js';
import { ChangePasswordDto } from '../src/auth/change-password.dto.js';
import { CurrentIdentityService } from '../src/auth/current-identity.service.js';
import { EmployeeAuthController } from '../src/auth/employee-auth.controller.js';
import { EmployeeLoginDto } from '../src/auth/employee-login.dto.js';
import { JwtTokenService } from '../src/auth/jwt-token.service.js';
import { LoginRateLimiter } from '../src/auth/login-rate-limiter.js';
import { PasswordService } from '../src/auth/password.service.js';
import { PermissionService } from '../src/permissions/permission.service.js';

assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('集成测试仅可在test环境执行');
// Vitest不生成参数装饰器元数据；另用编译产物子进程验证真实tsc路径。
Reflect.defineMetadata('design:paramtypes', [EmployeeLoginDto, Object], EmployeeAuthController.prototype, 'login');
Reflect.defineMetadata('design:paramtypes', [ChangePasswordDto, Object, Object], EmployeeAuthController.prototype, 'changePassword');
const oldPassword = 'OldEmployee#2026'; const newPassword = 'NewEmployee#2026';
const wrongPassword = 'WrongEmployee#2026'; const otherPassword = 'OtherEmployee#2026';
let millis = Date.parse('2026-11-12T01:00:00.500Z'); const clock = () => new Date(millis);
const tokens = new JwtTokenService({ secret: 'employee-password-test-key-'.repeat(3), ttlSeconds: 7200 }, clock);
const sessions = new AuthSessionService(tokens, clock);
class ControlledPasswords extends PasswordService {
  afterHash: (() => Promise<void>) | undefined;
  checks = 0; hashes = 0;
  override async verify(value: string, hash: string) { this.checks++; return super.verify(value, hash); }
  override async hash(value: string) {
    this.hashes++; const result = await super.hash(value); await this.afterHash?.(); return result;
  }
}
class ControlledAudit extends AuditService {
  fail = false; observedWrites = false;
  override async appendAudit(tx: Prisma.TransactionClient, payload: AuditPayload) {
    await super.appendAudit(tx, payload);
    if (!this.fail) return;
    const employee = await tx.employee.findUniqueOrThrow({ where: { id: payload.targetId } });
    const active = await tx.authSession.count({ where: { employeeId: payload.targetId, revokedAt: null } });
    const audit = await tx.auditLog.count({ where: { requestId: payload.requestId } });
    this.observedWrites = employee.passwordHash !== originalHash && !employee.mustChangePassword
      && employee.tokenVersion === 1 && employee.version === 1 && active === 0 && audit === 1;
    throw new Error('测试专用审计提交故障');
  }
}
const passwords = new ControlledPasswords(); const audit = new ControlledAudit();
let originalHash = ''; let otherHash = ''; let spaceHash = '';
let app: INestApplication; let prisma: PrismaService; let peer: PrismaService; let baseUrl = '';
const ids = new Set<string>();

beforeAll(async () => {
  [originalHash, otherHash, spaceHash] = await Promise.all([
    passwords.hash(oldPassword), passwords.hash(otherPassword), passwords.hash('        '),
  ]);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG).useValue(loadConfiguration({ ...process.env, LOG_LEVEL: 'silent' }))
    .overrideProvider(JwtTokenService).useValue(tokens).overrideProvider(AuthSessionService).useValue(sessions)
    .overrideProvider(CurrentIdentityService).useValue(new CurrentIdentityService(tokens, new PermissionService(), clock))
    .overrideProvider(PasswordService).useValue(passwords).overrideProvider(AuditService).useValue(audit)
    .overrideProvider(LoginRateLimiter).useValue(new LoginRateLimiter(() => millis)).compile();
  app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1');
  prisma = app.get(PrismaService); baseUrl = await app.getUrl();
  peer = new PrismaService(loadConfiguration()); await peer.onModuleInit();
});
beforeEach(() => { millis += 360_000; passwords.afterHash = undefined; passwords.checks = 0; passwords.hashes = 0;
  audit.fail = false; audit.observedWrites = false; });
afterEach(async () => {
  passwords.afterHash = undefined; audit.fail = false;
  // 只清理本文件创建的UUID及其审计，保留其它夹具和已有数据。
  await prisma.auditLog.deleteMany({ where: { actorEmployeeId: { in: [...ids] } } });
  await prisma.authSession.deleteMany({ where: { employeeId: { in: [...ids] } } });
  await prisma.employee.deleteMany({ where: { id: { in: [...ids] } } }); ids.clear();
});
afterAll(async () => { await peer?.$disconnect(); await app?.close(); });

async function employee(role: EmployeeRole = 'CUSTOMER_SERVICE', mustChangePassword = true, passwordHash = originalHash) {
  const id = randomUUID(); ids.add(id);
  return prisma.employee.create({ data: { id, username: `p_${id.replaceAll('-', '').slice(0, 20)}`,
    displayName: '员工改密测试', role, mustChangePassword, passwordHash, createdAt: new Date('2026-01-01T00:00:00Z') } });
}
async function login(account: Employee, password = oldPassword) {
  return fetch(`${baseUrl}/api/v1/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: account.username, password }) });
}
async function access(account: Employee, password = oldPassword) {
  const response = await login(account, password); expect(response.status).toBe(200);
  return (await response.json() as { data: { accessToken: string } }).data.accessToken;
}
async function change(token?: string, input: unknown = { oldPassword, newPassword }, extraHeaders = {}) {
  return fetch(`${baseUrl}/api/v1/admin/auth/change-password`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders }, body: JSON.stringify(input) });
}
async function me(token: string) {
  return fetch(`${baseUrl}/api/v1/admin/me`, { headers: { Authorization: `Bearer ${token}` } });
}
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  const body = await response.json() as { code: string; requestId: string; details?: unknown };
  expect(body.code).toBe(code); expect(body.requestId).toBe(response.headers.get('x-request-id'));
  for (const value of [oldPassword, newPassword, wrongPassword, originalHash, otherHash]) expect(JSON.stringify(body)).not.toContain(value);
  return body;
}
async function facts(id: string) {
  return { employee: await prisma.employee.findUniqueOrThrow({ where: { id } }),
    sessions: await prisma.authSession.findMany({ where: { employeeId: id }, orderBy: { id: 'asc' } }),
    audits: await prisma.auditLog.findMany({ where: { actorEmployeeId: id }, orderBy: { id: 'asc' } }) };
}

it.each(['SUPER_ADMIN', 'MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'] as const)('%s强制改密，全部旧会话失效，新密码重登及事务审计一致', async role => {
  const account = await employee(role); const token = await access(account); const second = await access(account);
  const alreadyRevoked = await access(account); const claims = await tokens.verify(alreadyRevoked, 'EMPLOYEE');
  await prisma.$transaction(tx => sessions.revokeCurrent(tx, { subjectType: 'EMPLOYEE', subjectId: account.id }, claims.sid));
  const previous = await prisma.authSession.findUniqueOrThrow({ where: { id: claims.sid } });
  const other = await employee(); const otherToken = await access(other); const otherBefore = await facts(other.id);
  const before = await facts(account.id);
  const response = await change(token, undefined, { 'X-Request-Id': 'caller-input' });
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json() as { data: unknown; requestId: string };
  expect(body).toEqual({ data: { changed: true, requireLogin: true }, requestId: response.headers.get('x-request-id') });
  expect(body.requestId).not.toBe('caller-input');
  const after = await facts(account.id);
  expect(after.employee).toMatchObject({ mustChangePassword: false, tokenVersion: 1, version: 1, permissionVersion: 0,
    role, username: account.username, displayName: account.displayName, lastLoginAt: before.employee.lastLoginAt });
  expect(after.employee.passwordHash).not.toBe(originalHash); expect(await new PasswordService().verify(newPassword, after.employee.passwordHash)).toBe(true);
  expect(after.sessions).toHaveLength(3); expect(after.sessions.every(session => session.revokedAt !== null)).toBe(true);
  expect(after.sessions.filter(session => session.id !== claims.sid).every(session => session.revokeReason === 'PASSWORD_CHANGED')).toBe(true);
  expect(after.sessions.find(session => session.id === claims.sid)).toEqual(previous);
  expect(after.audits).toHaveLength(1); expect(after.audits[0]).toMatchObject({ actorType: 'EMPLOYEE', actorEmployeeId: account.id,
    action: 'employee.password.change', targetType: 'Employee', targetId: account.id, requestId: body.requestId,
    beforeData: { mustChangePassword: true }, afterData: { passwordChanged: true, mustChangePassword: false } });
  for (const secret of [oldPassword, newPassword, originalHash, after.employee.passwordHash, token]) expect(JSON.stringify(after.audits)).not.toContain(secret);
  await error(await me(token), 401, 'SESSION_REVOKED'); await error(await me(second), 401, 'SESSION_REVOKED');
  await error(await change(token), 401, 'SESSION_REVOKED'); expect((await facts(account.id)).audits).toHaveLength(1);
  await error(await login(account), 401, 'INVALID_CREDENTIALS'); const fresh = await access(account, newPassword);
  expect((await (await me(fresh)).json() as { data: { mustChangePassword: boolean } }).data.mustChangePassword).toBe(false);
  expect(await facts(other.id)).toEqual(otherBefore); expect((await me(otherToken)).status).toBe(200);
});

it('普通员工主动改密也可用，不要求管理员权限，个人权限版本不变', async () => {
  const account = await employee('CUSTOMER_SERVICE', false); const token = await access(account);
  expect((await change(token)).status).toBe(200);
  const result = await facts(account.id);
  expect(result.employee).toMatchObject({ version: 1, tokenVersion: 1, permissionVersion: 0, mustChangePassword: false });
  expect(result.audits[0]?.beforeData).toEqual({ mustChangePassword: false });
});

it('旧密码错误不哈希新密码、不更新员工/会话且不写成功审计', async () => {
  const account = await employee(); const token = await access(account); const before = await facts(account.id);
  passwords.checks = 0; passwords.hashes = 0;
  await error(await change(token, { oldPassword: wrongPassword, newPassword }), 401, 'INVALID_CREDENTIALS');
  expect(passwords.checks).toBe(1); expect(passwords.hashes).toBe(0); expect(await facts(account.id)).toEqual(before);
  expect((await me(token)).status).toBe(200);
});

it.each([{}, { newPassword }, { oldPassword }, { oldPassword: 42, newPassword }, { oldPassword, newPassword: 42 },
  { oldPassword: 'short', newPassword }, { oldPassword, newPassword: 'short' },
  { oldPassword, newPassword: '密'.repeat(25) }, { oldPassword, newPassword: '\ud800'.repeat(8) },
  { oldPassword, newPassword, employeeId: 'other-user' }, { oldPassword, newPassword, mustChangePassword: false },
  { oldPassword, newPassword: oldPassword },
])('非法改密输入 %# 返回400且无密码、会话或审计变化', async input => {
  const account = await employee(); const token = await access(account); const before = await facts(account.id);
  passwords.checks = 0; passwords.hashes = 0;
  await error(await change(token, input), 400, 'VALIDATION_FAILED');
  expect(passwords.checks).toBe(0); expect(passwords.hashes).toBe(0); expect(await facts(account.id)).toEqual(before);
});

it('旧密码与新密码保留空格，新密码只差首尾空格仍按原文生效', async () => {
  const account = await employee('CUSTOMER_SERVICE', true, spaceHash); const token = await access(account, '        ');
  expect((await change(token, { oldPassword: '        ', newPassword: '         ' })).status).toBe(200);
  await error(await login(account, '        '), 401, 'INVALID_CREDENTIALS'); expect((await login(account, '         ')).status).toBe(200);
});

it('缺凭证、顾客域、过期及停用凭证均在bcrypt前拒绝', async () => {
  const account = await employee(); const token = await access(account); const before = await facts(account.id);
  passwords.checks = 0; passwords.hashes = 0;
  await error(await change(), 401, 'TOKEN_INVALID');
  const customer = await tokens.issue({ subjectType: 'CUSTOMER', subjectId: randomUUID(), sessionId: randomUUID(), tokenVersion: 0 });
  await error(await change(customer.accessToken), 401, 'TOKEN_SUBJECT_MISMATCH');
  millis += 7_200_000; await error(await change(token), 401, 'TOKEN_EXPIRED');
  expect(await facts(account.id)).toEqual(before);
  const fresh = await access(account);
  await prisma.employee.update({ where: { id: account.id }, data: { status: 'DISABLED' } });
  passwords.checks = 0;
  await error(await change(fresh), 401, 'ACCOUNT_UNAVAILABLE'); expect(passwords.checks).toBe(0); expect(passwords.hashes).toBe(0);
});

it('审计写入后抛错使密码、版本、强制改密标志和全部会话一起回滚，随后可重试', async () => {
  const account = await employee(); const token = await access(account); const second = await access(account);
  const before = await facts(account.id); audit.fail = true;
  await error(await change(token), 500, 'INTERNAL_ERROR'); expect(audit.observedWrites).toBe(true);
  expect(await facts(account.id)).toEqual(before);
  expect((await me(token)).status).toBe(200); expect((await me(second)).status).toBe(200);
  audit.fail = false; expect((await change(token)).status).toBe(200); expect((await facts(account.id)).audits).toHaveLength(1);
});

it.each(['重置', '停用', '注销', '到期', '仅换哈希'] as const)('bcrypt完成后并发%s，事务内重验拒绝旧请求', async operation => {
  const account = await employee(); const token = await access(account); const claims = await tokens.verify(token, 'EMPLOYEE');
  let release!: () => void; let ready!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; }); const hashed = new Promise<void>(resolve => { ready = resolve; });
  passwords.afterHash = async () => { ready(); await hold; };
  const pending = change(token);
  try {
    await Promise.race([hashed, pending.then(() => { throw new Error('改密未进入哈希屏障'); })]);
    if (operation === '到期') millis += 7_200_000;
    else await peer.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM employee WHERE id=${account.id}::uuid FOR UPDATE`;
      if (operation === '注销') await sessions.revokeCurrent(tx, { subjectType: 'EMPLOYEE', subjectId: account.id }, claims.sid);
      else {
        await tx.employee.update({ where: { id: account.id }, data: operation === '停用'
          ? { status: 'DISABLED', tokenVersion: { increment: 1 } }
          : { passwordHash: otherHash, ...(operation === '重置' ? { tokenVersion: { increment: 1 } } : {}) } });
        if (operation !== '仅换哈希') await sessions.revokeAll(tx, { subjectType: 'EMPLOYEE', subjectId: account.id }, operation === '停用' ? 'ACCOUNT_DISABLED' : 'PASSWORD_RESET');
      }
    });
    const beforeRelease = await facts(account.id); release();
    await error(await pending, 401, operation === '到期' ? 'TOKEN_EXPIRED' : operation === '仅换哈希' ? 'INVALID_CREDENTIALS' : 'SESSION_REVOKED');
    expect(await facts(account.id)).toEqual(beforeRelease);
  } finally { release(); await pending; passwords.afterHash = undefined; }
});

it('两个请求都完成旧密码验证后同时改密，仅一个成功、一条审计、版本只加一次', async () => {
  const account = await employee(); const first = await access(account); const second = await access(account);
  let release!: () => void; let ready!: () => void; let count = 0;
  const hold = new Promise<void>(resolve => { release = resolve; }); const hashed = new Promise<void>(resolve => { ready = resolve; });
  passwords.afterHash = async () => { if (++count === 2) ready(); await hold; };
  const requests = [change(first), change(second, { oldPassword, newPassword: otherPassword })];
  try {
    await Promise.race([hashed, ...requests.map(request => request.then(() => { throw new Error('并发请求未进入哈希屏障'); }))]);
    release(); const responses = await Promise.all(requests); expect(responses.map(response => response.status).sort()).toEqual([200, 401]);
    const after = await facts(account.id); expect(after.employee).toMatchObject({ tokenVersion: 1, version: 1, mustChangePassword: false });
    expect(after.audits).toHaveLength(1); expect(after.sessions.every(session => session.revokeReason === 'PASSWORD_CHANGED')).toBe(true);
    const winnerPassword = responses[0]!.status === 200 ? newPassword : otherPassword;
    expect(await new PasswordService().verify(winnerPassword, after.employee.passwordHash)).toBe(true);
  } finally { release(); await Promise.all(requests); passwords.afterHash = undefined; }
});

it('编译后的真实API能改密且拒绝额外字段，旧token失效、新密码重登', async () => {
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
        const send = (path, body, token) => fetch(url + '/api/v1/' + path, { method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
        const credentials = { username: process.env.SHOP_TEST_USERNAME, password: process.env.SHOP_TEST_OLD_PASSWORD };
        const loggedIn = await send('admin/auth/login', credentials); const token = (await loggedIn.json()).data?.accessToken;
        const input = { oldPassword: credentials.password, newPassword: process.env.SHOP_TEST_NEW_PASSWORD };
        const invalid = await send('admin/auth/change-password', { ...input, role: 'SUPER_ADMIN' }, token);
        const changed = await send('admin/auth/change-password', input, token); const result = await changed.json();
        const oldMe = await fetch(url + '/api/v1/admin/me', { headers: { Authorization: 'Bearer ' + token } });
        const fresh = await send('admin/auth/login', { ...credentials, password: input.newPassword });
        console.log(JSON.stringify({ invalid: invalid.status, changed: changed.status, data: result.data, oldMe: oldMe.status, fresh: fresh.status }));
      } finally { await app.close(); }
    })().catch(() => { console.error('编译后改密验证失败'); process.exitCode=1; });`;
  const child = spawnSync(process.execPath, ['-e', source], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true, timeout: 12_000,
    env: { ...process.env, LOG_LEVEL: 'silent', SHOP_TEST_USERNAME: account.username,
      SHOP_TEST_OLD_PASSWORD: oldPassword, SHOP_TEST_NEW_PASSWORD: newPassword } });
  expect(child.status).toBe(0); expect(JSON.parse(child.stdout.trim())).toEqual({ invalid: 400, changed: 200,
    data: { changed: true, requireLogin: true }, oldMe: 401, fresh: 200 });
  for (const value of [oldPassword, newPassword, originalHash]) expect(child.stdout + child.stderr).not.toContain(value);
});
