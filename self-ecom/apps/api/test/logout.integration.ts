// 作用：验证双登录域注销、同会话幂等、跨设备隔离、并发及审计回滚。
import 'reflect-metadata';
import { randomInt, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { INestApplication } from '@nestjs/common';
import type { Prisma, SubjectType } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuditService, type AuditPayload } from '../src/audit/audit.service.js';
import { AuthSessionService } from '../src/auth/auth-session.service.js';
import { CurrentIdentityService } from '../src/auth/current-identity.service.js';
import { JwtTokenService } from '../src/auth/jwt-token.service.js';
import { PasswordService } from '../src/auth/password.service.js';
import { type SubjectReference } from '../src/auth/session-support.js';
import { configureApp } from '../src/common/configure-app.js';
import { APP_CONFIG, loadConfiguration } from '../src/config/environment.js';
import { PermissionService } from '../src/permissions/permission.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { assertSafeTestDatabase } from '../scripts/database-env.js';

assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('集成测试仅可在test环境执行');
const password = 'LogoutEmployee#2026'; let passwordHash = '';
let millis = Date.parse('2026-11-12T01:00:00.500Z'); const clock = () => new Date(millis);
const tokens = new JwtTokenService({ secret: 'logout-integration-only-key-'.repeat(3), ttlSeconds: 7200 }, clock);
const sessions = new AuthSessionService(tokens, clock);
const identities = new CurrentIdentityService(tokens, new PermissionService(), clock);
class ControlledAudit extends AuditService {
  fail = false; observedWrites = false;
  afterWrite: ((tx: Prisma.TransactionClient, payload: AuditPayload) => Promise<void>) | undefined;
  override async appendAudit(tx: Prisma.TransactionClient, payload: AuditPayload) {
    await super.appendAudit(tx, payload);
    await this.afterWrite?.(tx, payload);
    if (!this.fail) return;
    const session = await tx.authSession.findUniqueOrThrow({ where: { id: payload.targetId } });
    this.observedWrites = session.revokedAt !== null && session.revokeReason === 'LOGOUT'
      && await tx.auditLog.count({ where: { requestId: payload.requestId } }) === 1;
    throw new Error('测试专用注销审计提交故障');
  }
}
const audit = new ControlledAudit();
let app: INestApplication; let prisma: PrismaService; let peer: PrismaService; let baseUrl = '';
const employeeIds = new Set<string>(); const customerIds = new Set<string>();
beforeAll(async () => {
  passwordHash = await new PasswordService().hash(password);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG).useValue(loadConfiguration({ ...process.env, LOG_LEVEL: 'silent' }))
    .overrideProvider(JwtTokenService).useValue(tokens).overrideProvider(AuthSessionService).useValue(sessions)
    .overrideProvider(CurrentIdentityService).useValue(identities).overrideProvider(AuditService).useValue(audit).compile();
  app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1');
  prisma = app.get(PrismaService); baseUrl = await app.getUrl();
  peer = new PrismaService(loadConfiguration()); await peer.onModuleInit();
});
beforeEach(() => { millis += 360_000; audit.fail = false; audit.observedWrites = false; audit.afterWrite = undefined; });
afterEach(async () => {
  audit.fail = false; audit.afterWrite = undefined;
  // 仅清理本文件创建的主体及其审计、会话，不清空既有测试库。
  await prisma.auditLog.deleteMany({ where: { OR: [
    { actorEmployeeId: { in: [...employeeIds] } }, { actorCustomerId: { in: [...customerIds] } },
  ] } });
  await prisma.authSession.deleteMany({ where: { OR: [
    { employeeId: { in: [...employeeIds] } }, { customerId: { in: [...customerIds] } },
  ] } });
  await prisma.employee.deleteMany({ where: { id: { in: [...employeeIds] } } });
  await prisma.customer.deleteMany({ where: { id: { in: [...customerIds] } } }); employeeIds.clear(); customerIds.clear();
});
afterAll(async () => { await peer?.$disconnect(); await app?.close(); });

async function account(subjectType: SubjectType): Promise<SubjectReference> {
  const id = randomUUID(); const createdAt = new Date('2026-01-01T00:00:00Z');
  if (subjectType === 'EMPLOYEE') {
    employeeIds.add(id);
    await prisma.employee.create({ data: { id, username: `o_${id.replaceAll('-', '').slice(0, 20)}`,
      displayName: '注销测试员工', role: 'CUSTOMER_SERVICE', mustChangePassword: true, passwordHash, createdAt } });
  } else {
    customerIds.add(id);
    await prisma.customer.create({ data: { id, phone: `139${randomInt(100_000_000).toString().padStart(8, '0')}`,
      nickname: '注销测试顾客', passwordHash, createdAt } });
  }
  return { subjectType, subjectId: id };
}
async function issue(subject: SubjectReference) {
  // 顾客登录API尚未实现：夹具经真实会话服务建立，不声称验证过顾客HTTP登录。
  return prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, {
    ...subject, expectedPasswordHash: passwordHash, expectedTokenVersion: 0,
  }));
}
async function logout(token?: string, body: unknown = {}, headers: Record<string, string> = {}, query = '') {
  return fetch(`${baseUrl}/api/v1/auth/logout${query}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
}
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  const body = await response.json() as { code: string; requestId: string };
  expect(body.code).toBe(code); expect(body.requestId).toBe(response.headers.get('x-request-id'));
  expect(JSON.stringify(body)).not.toContain(password); expect(JSON.stringify(body)).not.toContain(passwordHash);
  return body;
}
async function success(response: Response) {
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json() as { data: unknown; requestId: string };
  expect(body).toEqual({ data: { loggedOut: true }, requestId: response.headers.get('x-request-id') }); return body;
}
async function facts(subject: SubjectReference) {
  const own = subject.subjectType === 'EMPLOYEE' ? { employeeId: subject.subjectId } : { customerId: subject.subjectId };
  return { account: subject.subjectType === 'EMPLOYEE'
    ? await prisma.employee.findUniqueOrThrow({ where: { id: subject.subjectId } })
    : await prisma.customer.findUniqueOrThrow({ where: { id: subject.subjectId } }),
  sessions: await prisma.authSession.findMany({ where: own, orderBy: { id: 'asc' } }),
  audits: await prisma.auditLog.findMany({ where: subject.subjectType === 'EMPLOYEE'
    ? { actorEmployeeId: subject.subjectId } : { actorCustomerId: subject.subjectId }, orderBy: { id: 'asc' } }) };
}
async function waitForBlocker(pid: number) {
  const deadline = performance.now() + 300;
  while (performance.now() < deadline) {
    const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock'
        AND ${pid} = ANY(pg_blocking_pids(pid))) AS waiting`;
    if (row?.waiting) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('未观察到注销HTTP事务的主体行锁等待');
}

it.each(['EMPLOYEE', 'CUSTOMER'] as const)('%s注销仅当前sid，重复200、原事实保留且其它设备/主体不受影响', async type => {
  const subject = await account(type); const first = await issue(subject); const second = await issue(subject);
  const other = await account(type === 'EMPLOYEE' ? 'CUSTOMER' : 'EMPLOYEE'); await issue(other);
  const before = await facts(subject); const otherBefore = await facts(other);
  const response = await success(await logout(first.accessToken, {}, { 'X-Request-Id': 'caller-value' }));
  expect(response.requestId).not.toBe('caller-value');
  const after = await facts(subject); expect(after.account).toEqual(before.account);
  expect(after.sessions.find(session => session.id === first.sessionId)).toMatchObject({ revokedAt: clock(), revokeReason: 'LOGOUT' });
  expect(after.sessions.find(session => session.id === second.sessionId)).toEqual(before.sessions.find(session => session.id === second.sessionId));
  expect(after.audits).toHaveLength(1); expect(after.audits[0]).toMatchObject({ actorType: type,
    actorEmployeeId: type === 'EMPLOYEE' ? subject.subjectId : null, actorCustomerId: type === 'CUSTOMER' ? subject.subjectId : null,
    action: 'auth.logout', targetType: 'AuthSession', targetId: first.sessionId, requestId: response.requestId,
    beforeData: null, afterData: { loggedOut: true } });
  for (const secret of [password, passwordHash, first.accessToken]) expect(JSON.stringify(after.audits)).not.toContain(secret);
  await expect(identities.authenticate(prisma, first.accessToken, type)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
  await expect(identities.authenticate(prisma, second.accessToken, type)).resolves.toMatchObject({ subjectId: subject.subjectId });
  millis += 1000; audit.fail = true; await success(await logout(first.accessToken));
  expect(await facts(subject)).toEqual(after); expect(await facts(other)).toEqual(otherBefore);
  if (type === 'EMPLOYEE') {
    const denied = await fetch(`${baseUrl}/api/v1/admin/me`, { headers: { Authorization: `Bearer ${first.accessToken}` } });
    await error(denied, 401, 'SESSION_REVOKED');
  }
});

it('无请求体和空对象均可注销，受交易限制顾客可退出', async () => {
  const subject = await account('CUSTOMER');
  await prisma.customer.update({ where: { id: subject.subjectId }, data: { status: 'TRADE_RESTRICTED' } });
  const issued = await issue(subject);
  const response = await fetch(`${baseUrl}/api/v1/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${issued.accessToken}` } });
  await success(response); await success(await logout(issued.accessToken));
});

it.each([{ sid: 'another-session' }, { token: 'private-body-token' }, { employeeId: randomUUID() }, [], [1], 'private-text', 42, null])(
  '拒绝非空或非对象JSON输入 %#，不改变会话及审计', async body => {
    const subject = await account('EMPLOYEE'); const issued = await issue(subject); const before = await facts(subject);
    const response = await logout(issued.accessToken, body); const result = await error(response, 400, 'VALIDATION_FAILED');
    expect(JSON.stringify(result)).not.toContain('private-body-token'); expect(JSON.stringify(result)).not.toContain('private-text');
    expect(await facts(subject)).toEqual(before);
  });

it('缺失、损坏、错误密钥、Cookie及查询参数凭证不能注销；额外请求头不能指定目标', async () => {
  const subject = await account('EMPLOYEE'); const issued = await issue(subject); const before = await facts(subject);
  const otherTokens = new JwtTokenService({ secret: 'wrong-logout-key-'.repeat(4), ttlSeconds: 7200 }, clock);
  const invalid = await otherTokens.issue({ ...subject, sessionId: issued.sessionId, tokenVersion: 0 });
  for (const token of [undefined, 'broken.token.value', invalid.accessToken]) await error(await logout(token), 401, 'TOKEN_INVALID');
  await error(await logout(undefined, {}, { Cookie: `token=${issued.accessToken}` }, `?token=${issued.accessToken}`), 401, 'TOKEN_INVALID');
  expect(await facts(subject)).toEqual(before);
  const other = await issue(subject);
  await success(await logout(issued.accessToken, {}, { 'X-Session-Id': other.sessionId }, `?sid=${other.sessionId}`));
  expect((await prisma.authSession.findUniqueOrThrow({ where: { id: other.sessionId } })).revokedAt).toBeNull();
});

it.each(['不存在sid', '他人sid', '错误会话域', '错误会话版本', '错误期限'] as const)('合法签名但%s仍401，不能利用幂等例外', async operation => {
  const subject = await account('EMPLOYEE'); const issued = await issue(subject); const other = await account('EMPLOYEE');
  let sessionId = issued.sessionId;
  if (operation === '不存在sid') sessionId = randomUUID();
  if (operation === '他人sid') sessionId = (await issue(other)).sessionId;
  if (operation === '错误会话域') {
    const customer = await account('CUSTOMER'); sessionId = (await issue(customer)).sessionId;
  }
  if (operation === '错误会话版本') await prisma.authSession.update({ where: { id: sessionId }, data: { tokenVersion: 1 } });
  if (operation === '错误期限') await prisma.authSession.update({ where: { id: sessionId }, data: { expiresAt: new Date(issued.expiresAt.getTime() - 1000) } });
  const forged = await tokens.issue({ ...subject, sessionId, tokenVersion: 0 }); const before = await facts(subject);
  await error(await logout(forged.accessToken), 401, 'TOKEN_INVALID'); expect(await facts(subject)).toEqual(before);
});

it.each(['EMPLOYEE', 'CUSTOMER'] as const)('%s已撤销会话仍须核对签名对应的会话版本及期限', async type => {
  const subject = await account(type); const issued = await issue(subject);
  await prisma.$transaction(tx => sessions.revokeCurrent(tx, subject, issued.sessionId));
  const wrongVersion = await tokens.issue({ ...subject, sessionId: issued.sessionId, tokenVersion: 1 });
  await error(await logout(wrongVersion.accessToken), 401, 'TOKEN_INVALID');
  millis += 7_200_000; await error(await logout(issued.accessToken), 401, 'TOKEN_EXPIRED');
  expect((await facts(subject)).audits).toHaveLength(0);
});

it.each(['停用', '冻结', '主体版本变化'] as const)('未撤销会话遇%s仍401，不生成注销成功事实', async operation => {
  const subject = await account(operation === '冻结' ? 'CUSTOMER' : 'EMPLOYEE'); const issued = await issue(subject);
  if (operation === '冻结') await prisma.customer.update({ where: { id: subject.subjectId }, data: { status: 'LOGIN_FROZEN' } });
  else await prisma.employee.update({ where: { id: subject.subjectId }, data: operation === '停用' ? { status: 'DISABLED' } : { tokenVersion: 1 } });
  const before = await facts(subject);
  await error(await logout(issued.accessToken), 401, operation === '主体版本变化' ? 'TOKEN_INVALID' : 'ACCOUNT_UNAVAILABLE');
  expect(await facts(subject)).toEqual(before);
});

it.each(['EMPLOYEE', 'CUSTOMER'] as const)('%s已因重置/冻结撤销的合法sid可幂等退出，保留旧原因且不补注销审计', async type => {
  const subject = await account(type); const issued = await issue(subject);
  await prisma.$transaction(async tx => {
    if (type === 'EMPLOYEE') {
      await tx.$queryRaw`SELECT id FROM employee WHERE id=${subject.subjectId}::uuid FOR UPDATE`;
      await tx.employee.update({ where: { id: subject.subjectId }, data: { tokenVersion: 1 } });
    } else {
      await tx.$queryRaw`SELECT id FROM customer WHERE id=${subject.subjectId}::uuid FOR UPDATE`;
      await tx.customer.update({ where: { id: subject.subjectId }, data: { status: 'LOGIN_FROZEN', tokenVersion: 1 } });
    }
    await sessions.revokeAll(tx, subject, type === 'EMPLOYEE' ? 'PASSWORD_RESET' : 'LOGIN_FROZEN');
  });
  const before = await facts(subject); await success(await logout(issued.accessToken)); expect(await facts(subject)).toEqual(before);
  await expect(identities.authenticate(prisma, issued.accessToken, type)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
});

it.each(['EMPLOYEE', 'CUSTOMER'] as const)('%s注销审计故障回滚会话和审计，原token仍有效且可重试', async type => {
  const subject = await account(type); const issued = await issue(subject); const before = await facts(subject); audit.fail = true;
  await error(await logout(issued.accessToken), 500, 'INTERNAL_ERROR'); expect(audit.observedWrites).toBe(true);
  expect(await facts(subject)).toEqual(before);
  await expect(identities.authenticate(prisma, issued.accessToken, type)).resolves.toMatchObject({ subjectId: subject.subjectId });
  audit.fail = false; await success(await logout(issued.accessToken)); expect((await facts(subject)).audits).toHaveLength(1);
});

it.each(['EMPLOYEE', 'CUSTOMER'] as const)('%s同sid并发HTTP注销实际等待主体锁，两次200仅一条审计', async type => {
  const subject = await account(type); const issued = await issue(subject);
  let release!: () => void; let signal!: () => void; let pid = 0;
  const hold = new Promise<void>(resolve => { release = resolve; }); const ready = new Promise<void>(resolve => { signal = resolve; });
  audit.afterWrite = async tx => {
    pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; signal(); await hold;
  };
  const first = logout(issued.accessToken); let second: Promise<Response> | undefined;
  try {
    await Promise.race([ready, first.then(() => { throw new Error('首次注销未进入审计屏障'); })]);
    second = logout(issued.accessToken); await waitForBlocker(pid); millis += 1000; release();
    const firstResult = await success(await first); await success(await second);
    const after = await facts(subject); expect(after.audits).toHaveLength(1); expect(after.audits[0]?.requestId).toBe(firstResult.requestId);
    expect(after.sessions[0]).toMatchObject({ revokedAt: new Date(millis - 1000), revokeReason: 'LOGOUT' });
  } finally { release(); await Promise.allSettled([first, ...(second ? [second] : [])]); audit.afterWrite = undefined; }
});

it.each(['锁等待期间到期', '锁内先停用', '锁内先撤销'] as const)('%s后注销重验，不复用锁前身份', async operation => {
  const subject = await account('EMPLOYEE'); const issued = await issue(subject);
  let release!: () => void; let signal!: () => void; let pid = 0;
  const hold = new Promise<void>(resolve => { release = resolve; }); const ready = new Promise<void>(resolve => { signal = resolve; });
  const blocker = peer.$transaction(async tx => {
    pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    await tx.$queryRaw`SELECT id FROM employee WHERE id=${subject.subjectId}::uuid FOR UPDATE`;
    if (operation === '锁内先停用') await tx.employee.update({ where: { id: subject.subjectId }, data: { status: 'DISABLED' } });
    if (operation === '锁内先撤销') await sessions.revokeCurrent(tx, subject, issued.sessionId);
    signal(); await hold;
  });
  let pending: Promise<Response> | undefined;
  try {
    await Promise.race([ready, blocker.then(() => { throw new Error('阻塞事务未取得主体锁'); })]);
    pending = logout(issued.accessToken); await waitForBlocker(pid);
    if (operation === '锁等待期间到期') millis += 7_200_000;
    release(); await blocker;
    if (operation === '锁内先撤销') await success(await pending);
    else await error(await pending, 401, operation === '锁等待期间到期' ? 'TOKEN_EXPIRED' : 'ACCOUNT_UNAVAILABLE');
    const after = await facts(subject); expect(after.audits).toHaveLength(0);
    expect(after.sessions[0]?.revokedAt !== null).toBe(operation === '锁内先撤销');
  } finally { release(); await Promise.allSettled([blocker, ...(pending ? [pending] : [])]); }
});

it('编译后的API完成真实登录、无请求体注销、重复注销和单设备隔离', async () => {
  const subject = await account('EMPLOYEE'); const employee = await prisma.employee.findUniqueOrThrow({ where: { id: subject.subjectId } });
  const source = String.raw`
    require('reflect-metadata');
    const { NestFactory } = require('@nestjs/core'); const { AppModule } = require('./dist/app.module.js');
    const { configureApp } = require('./dist/common/configure-app.js');
    (async () => {
      const app = await NestFactory.create(AppModule, { logger: false });
      try {
        configureApp(app); await app.listen(0, '127.0.0.1'); const url = await app.getUrl();
        const login = async () => (await (await fetch(url + '/api/v1/admin/auth/login', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.SHOP_TEST_USERNAME,
          password: process.env.SHOP_TEST_PASSWORD }) })).json()).data.accessToken;
        const first = await login(); const second = await login();
        const logout = (token, body) => fetch(url + '/api/v1/auth/logout', { method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
        const invalid = await logout(first, { sid: 'another-session' }); const response = await logout(first); const body = await response.json();
        const repeat = await logout(first, {});
        const me = token => fetch(url + '/api/v1/admin/me', { headers: { Authorization: 'Bearer ' + token } });
        console.log(JSON.stringify({ invalid: invalid.status, logout: response.status, data: body.data,
          repeat: repeat.status, firstMe: (await me(first)).status, secondMe: (await me(second)).status }));
      } finally { await app.close(); }
    })().catch(() => { console.error('编译后注销验证失败'); process.exitCode=1; });`;
  const child = spawnSync(process.execPath, ['-e', source], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true, timeout: 12_000,
    env: { ...process.env, LOG_LEVEL: 'silent', SHOP_TEST_USERNAME: employee.username, SHOP_TEST_PASSWORD: password } });
  expect(child.status).toBe(0); expect(JSON.parse(child.stdout.trim())).toEqual({ invalid: 400, logout: 200,
    data: { loggedOut: true }, repeat: 200, firstMe: 401, secondMe: 200 });
  for (const secret of [password, passwordHash]) expect(child.stdout + child.stderr).not.toContain(secret);
});
