// 作用：验证顾客注册唯一约束、默认昵称、输入边界、限流及审计回滚。
import 'reflect-metadata';
import { randomInt } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuditService, type AuditPayload } from '../src/audit/audit.service.js';
import { AuthSessionService } from '../src/auth/auth-session.service.js';
import { CustomerRegisterController } from '../src/auth/customer-register.controller.js';
import { CustomerRegisterDto } from '../src/auth/customer-register.dto.js';
import { CustomerRegisterService } from '../src/auth/customer-register.service.js';
import { EmployeeAuthController } from '../src/auth/employee-auth.controller.js';
import { EmployeeLoginDto } from '../src/auth/employee-login.dto.js';
import { LoginRateLimiter } from '../src/auth/login-rate-limiter.js';
import { PasswordService } from '../src/auth/password.service.js';
import { REGISTRATION_RATE_LIMITER, REGISTRATION_RATE_POLICY } from '../src/auth/registration-rate.guard.js';
import { configureApp } from '../src/common/configure-app.js';
import { APP_CONFIG, loadConfiguration } from '../src/config/environment.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { assertSafeTestDatabase } from '../scripts/database-env.js';

const safe = assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('集成测试仅可在test环境执行');
// Vitest不生成参数元数据；另用编译API子进程验证生产tsc路径。
Reflect.defineMetadata('design:paramtypes', [CustomerRegisterDto, Object], CustomerRegisterController.prototype, 'register');
Reflect.defineMetadata('design:paramtypes', [EmployeeLoginDto, Object], EmployeeAuthController.prototype, 'login');
const password = ' RegisterCustomer#2026 '; let millis = 0;
class ControlledPasswords extends PasswordService {
  hashes = 0; fail = false; afterHash: (() => Promise<void>) | undefined;
  override async hash(value: string) {
    this.hashes++; const result = await super.hash(value); await this.afterHash?.();
    if (this.fail) throw new Error('private-hash-failure'); return result;
  }
}
class ControlledAudit extends AuditService {
  fault: Error | undefined; calls = 0; observedWrites = false;
  afterWrite: ((tx: Prisma.TransactionClient, payload: AuditPayload) => Promise<void>) | undefined;
  override async appendAudit(tx: Prisma.TransactionClient, payload: AuditPayload) {
    if (payload.action !== 'customer.register') return super.appendAudit(tx, payload);
    ids.add(payload.targetId); this.calls++; await super.appendAudit(tx, payload);
    this.observedWrites = await tx.customer.count({ where: { id: payload.targetId } }) === 1
      && await tx.auditLog.count({ where: { requestId: payload.requestId, actorCustomerId: payload.targetId } }) === 1;
    await this.afterWrite?.(tx, payload); if (this.fault) throw this.fault;
  }
}
const passwords = new ControlledPasswords(); const audit = new ControlledAudit();
const registrationLimiter = new LoginRateLimiter(() => millis, REGISTRATION_RATE_POLICY);
const loginLimiter = new LoginRateLimiter(() => millis);
let app: INestApplication; let prisma: PrismaService; let peer: PrismaService; let baseUrl = '';
let registerSpy: MockInstance<CustomerRegisterService['register']>;
const ids = new Set<string>(); const phones = new Set<string>();
beforeAll(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG).useValue(loadConfiguration({ ...process.env, LOG_LEVEL: 'silent' }))
    .overrideProvider(PasswordService).useValue(passwords).overrideProvider(AuditService).useValue(audit)
    .overrideProvider(REGISTRATION_RATE_LIMITER).useValue(registrationLimiter).overrideProvider(LoginRateLimiter).useValue(loginLimiter).compile();
  app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1');
  prisma = app.get(PrismaService); peer = new PrismaService(loadConfiguration()); await peer.onModuleInit(); baseUrl = await app.getUrl();
  registerSpy = vi.spyOn(app.get(CustomerRegisterService), 'register');
});
beforeEach(() => {
  millis += 360_000; passwords.hashes = 0; passwords.fail = false; passwords.afterHash = undefined;
  audit.fault = undefined; audit.calls = 0; audit.observedWrites = false; audit.afterWrite = undefined; registerSpy.mockClear();
});
afterEach(async () => {
  passwords.fail = false; passwords.afterHash = undefined; audit.fault = undefined; audit.afterWrite = undefined;
  if (!prisma) return;
  // 只按本文件预先确认不存在的随机手机号及新建UUID清理，不重置测试库。
  for (const row of await prisma.customer.findMany({ where: { phone: { in: [...phones] } }, select: { id: true } })) ids.add(row.id);
  await prisma.auditLog.deleteMany({ where: { actorCustomerId: { in: [...ids] } } });
  await prisma.authSession.deleteMany({ where: { customerId: { in: [...ids] } } });
  await prisma.customer.deleteMany({ where: { id: { in: [...ids] } } }); ids.clear(); phones.clear();
});
afterAll(async () => { registerSpy?.mockRestore(); await peer?.$disconnect(); await app?.close(); });
async function input(patch: Partial<CustomerRegisterDto> = {}): Promise<CustomerRegisterDto> {
  let phone: string;
  do { phone = `188${randomInt(100_000_000).toString().padStart(8, '0')}`; }
  while (phones.has(phone) || await prisma.customer.findUnique({ where: { phone }, select: { id: true } }));
  phones.add(phone); return { phone, password, nickname: '顾客注册夹具', ...patch };
}
async function register(body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/api/v1/store/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'private-input', ...headers }, body: JSON.stringify(body) });
}
interface Result { id: string; phone: string; nickname: string; status: 'NORMAL'; createdAt: string }
async function created(response: Response) {
  expect(response.status).toBe(201); expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.get('set-cookie')).toBeNull();
  const body = await response.json() as { data: Result; requestId: string };
  expect(Object.keys(body).sort()).toEqual(['data', 'requestId']); expect(body.requestId).toBe(response.headers.get('x-request-id')); expect(body.requestId).not.toBe('private-input');
  expect(Object.keys(body.data).sort()).toEqual(['createdAt', 'id', 'nickname', 'phone', 'status']); expect(body.data.status).toBe('NORMAL');
  expect(body.data.id).toMatch(/^[0-9a-f-]{36}$/); expect(Number.isFinite(Date.parse(body.data.createdAt))).toBe(true); ids.add(body.data.id);
  expect(JSON.stringify(body)).not.toMatch(/password|Hash|accessToken|tokenVersion|sessionId|phoneVerified/); return body;
}
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); const body = await response.json() as { code: string; requestId: string; details?: unknown };
  expect(body.code).toBe(code); expect(body.requestId).toBe(response.headers.get('x-request-id'));
  for (const secret of [password, 'private-input', 'private-hash-failure', 'private-sql', ...phones]) expect(JSON.stringify(body)).not.toContain(secret);
  return body;
}
async function facts(id: string) {
  return { customer: await prisma.customer.findUniqueOrThrow({ where: { id } }),
    sessions: await prisma.authSession.findMany({ where: { customerId: id }, orderBy: { id: 'asc' } }),
    audits: await prisma.auditLog.findMany({ where: { targetId: id }, orderBy: { id: 'asc' } }) };
}
function barrier() {
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  let signal!: () => void; const ready = new Promise<void>(resolve => { signal = resolve; }); return { hold, release, ready, signal };
}
async function waitForBlocker(pid: number) {
  const deadline = performance.now() + 550;
  while (performance.now() < deadline) {
    const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid))) AS waiting`;
    if (row?.waiting) return; await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('未观察到并发手机号唯一约束实际等待');
}

it('公开注册201，规范化手机号/昵称但保留密码空格，真实bcrypt与最小审计同事务，无会话', async () => {
  const body = await input(); const txSpy = vi.spyOn(prisma, '$transaction');
  passwords.afterHash = async () => { expect(txSpy).not.toHaveBeenCalled(); };
  let result: Awaited<ReturnType<typeof created>>;
  try { result = await created(await register({ ...body, phone: ` ${body.phone} `, nickname: ' 顾客甲 ' }, { Authorization: 'Bearer invalid-public-input' })); }
  finally { txSpy.mockRestore(); }
  expect(result.data).toMatchObject({ phone: body.phone, nickname: '顾客甲' }); const after = await facts(result.data.id);
  expect(after.customer).toMatchObject({ phone: body.phone, nickname: '顾客甲', status: 'NORMAL', tokenVersion: 0, lastLoginAt: null });
  expect(after.customer.createdAt.toISOString()).toBe(result.data.createdAt); expect(after.customer.passwordHash).toMatch(/^\$2b\$12\$/);
  expect(await passwords.verify(password, after.customer.passwordHash)).toBe(true); expect(await passwords.verify(password.trim(), after.customer.passwordHash)).toBe(false);
  expect(after.sessions).toEqual([]); expect(after.audits).toHaveLength(1); expect(audit.observedWrites).toBe(true);
  expect(after.audits[0]).toMatchObject({ actorType: 'CUSTOMER', actorCustomerId: result.data.id, actorEmployeeId: null,
    action: 'customer.register', targetType: 'Customer', targetId: result.data.id, requestId: result.requestId, reason: null, beforeData: null, afterData: { status: 'NORMAL' } });
  for (const secret of [password, after.customer.passwordHash, body.phone, '顾客甲']) expect(JSON.stringify(after.audits)).not.toContain(secret);
});
it('昵称可省略，默认新顾客不含手机号或手机号片段', async () => {
  const body = await input(); delete body.nickname; const result = await created(await register(body));
  expect(result.data.nickname).toBe('新顾客'); expect(result.data.nickname).not.toMatch(/[0-9]/); expect((await facts(result.data.id)).sessions).toEqual([]);
});
it.each(['12345678', 'x'.repeat(64), '密'.repeat(24), '😀'.repeat(18), '        '])('有效密码边界 %# 不截断，昵称40个Unicode码点可保存', async candidate => {
  const body = await input({ password: candidate, nickname: '😀'.repeat(40) }); const result = await created(await register(body)); const after = await facts(result.data.id);
  expect(result.data.nickname).toBe(body.nickname); expect(await passwords.verify(candidate, after.customer.passwordHash)).toBe(true); expect(after.sessions).toEqual([]);
});
const invalidCases: [string, Record<string, unknown>][] = [
  ['手机号null', { phone: null }], ['手机号数字', { phone: 18800000000 }], ['手机号数组', { phone: ['18800000000'] }], ['手机号对象', { phone: {} }],
  ['手机号短', { phone: '1880000000' }], ['手机号长', { phone: '188000000000' }], ['手机号前缀', { phone: '12800000000' }],
  ['手机号国际前缀', { phone: '+8618800000000' }], ['手机号内部空格', { phone: '188 00000000' }], ['手机号全角数字', { phone: '１８８００００００００' }],
  ['密码null', { password: null }], ['密码数字', { password: 12345678 }], ['密码数组', { password: ['12345678'] }],
  ['密码空', { password: '' }], ['密码不足8码点', { password: '😀'.repeat(7) }], ['密码超64码点', { password: 'a'.repeat(65) }],
  ['密码中文超72字节', { password: '密'.repeat(25) }], ['密码emoji超72字节', { password: '😀'.repeat(19) }], ['密码无效Unicode', { password: 'abcdefg\ud800' }],
  ['昵称null', { nickname: null }], ['昵称数字', { nickname: 123 }], ['昵称数组', { nickname: [] }], ['昵称对象', { nickname: {} }],
  ['昵称空', { nickname: '' }], ['昵称空白', { nickname: ' \t ' }], ['昵称超40字符', { nickname: '客'.repeat(41) }], ['昵称超40码点', { nickname: '😀'.repeat(41) }],
  ['注入状态', { status: 'NORMAL' }], ['注入岗位', { role: 'SUPER_ADMIN' }], ['注入ID', { id: 'private-input' }], ['注入令牌版本', { tokenVersion: 0 }],
  ['注入哈希', { passwordHash: 'private-input' }], ['注入登录时间', { lastLoginAt: null }], ['注入头像', { avatarUrl: null }], ['注入已验证', { phoneVerified: true }],
];
it.each(invalidCases)('%s400，在服务/bcrypt/数据库写入前拒绝', async (_name, patch) => {
  const body = await input(); await error(await register({ ...body, ...patch }), 400, 'VALIDATION_FAILED');
  expect(registerSpy).not.toHaveBeenCalled(); expect(passwords.hashes).toBe(0); expect(audit.calls).toBe(0);
  expect(await prisma.customer.count({ where: { phone: body.phone } })).toBe(0);
});
it.each(['phone', 'password'] as const)('缺少%s400，不进入服务', async field => {
  const body: Partial<CustomerRegisterDto> = await input(); delete body[field]; await error(await register(body), 400, 'VALIDATION_FAILED'); expect(registerSpy).not.toHaveBeenCalled();
});
it.each([{ body: null }, { body: [] }, { body: 42 }])('非对象正文%j400，不进入服务', async ({ body }) => {
  await error(await register(body), 400, 'VALIDATION_FAILED'); expect(registerSpy).not.toHaveBeenCalled(); expect(passwords.hashes).toBe(0);
});
it.each(['NORMAL', 'TRADE_RESTRICTED', 'LOGIN_FROZEN'] as const)('已有%s顾客重复注册409，不能覆盖密码/昵称/状态/会话或审计', async status => {
  const body = await input(); const result = await created(await register(body)); const account = await prisma.customer.findUniqueOrThrow({ where: { id: result.data.id } });
  await prisma.$transaction(tx => app.get(AuthSessionService).createAfterPasswordVerified(tx, { subjectType: 'CUSTOMER', subjectId: account.id, expectedPasswordHash: account.passwordHash, expectedTokenVersion: 0 }));
  await prisma.customer.update({ where: { id: account.id }, data: { status } }); const before = await facts(account.id);
  await error(await register({ ...body, phone: ` ${body.phone} `, nickname: '不能覆盖', password: 'Replacement#2026' }), 409, 'PHONE_EXISTS');
  expect(await facts(account.id)).toEqual(before); expect(audit.calls).toBe(1);
});
it.each(['普通故障', '审计唯一约束'] as const)('注册审计写后%s安全500，账号/审计全部回滚，同手机号可重试', async failure => {
  const body = await input(); audit.fault = failure === '普通故障' ? new Error('private-sql')
    : new Prisma.PrismaClientKnownRequestError('private-sql', { code: 'P2002', clientVersion: '7.10.1' });
  audit.afterWrite = async (_tx, payload) => { expect(await peer.customer.count({ where: { id: payload.targetId } })).toBe(0); };
  await error(await register(body), 500, 'INTERNAL_ERROR'); expect(audit.observedWrites).toBe(true);
  expect(await prisma.customer.count({ where: { phone: body.phone } })).toBe(0); expect(await prisma.auditLog.count({ where: { actorCustomerId: { in: [...ids] } } })).toBe(0);
  audit.fault = undefined; audit.afterWrite = undefined; const result = await created(await register(body)); expect((await facts(result.data.id)).audits).toHaveLength(1);
});
it('哈希失败安全500，不创建顾客、会话或审计', async () => {
  const body = await input(); passwords.fail = true; await error(await register(body), 500, 'INTERNAL_ERROR');
  expect(await prisma.customer.count({ where: { phone: body.phone } })).toBe(0); expect(audit.calls).toBe(0);
});
it('同手机号并发注册实际等待唯一约束，仅首次201、后请求409，一顾客一审计', async () => {
  const body = await input(); const gate = barrier(); let pid = 0;
  audit.afterWrite = async tx => { pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold; };
  const first = register(body); let pending: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, first.then(() => { throw new Error('注册未进入审计屏障'); })]);
    pending = register({ ...body, nickname: '并发后请求', password: 'AnotherCustomer#2026' }); await waitForBlocker(pid);
    expect(await peer.customer.count({ where: { phone: body.phone } })).toBe(0); gate.release(); const result = await created(await first); await error(await pending, 409, 'PHONE_EXISTS');
    const after = await facts(result.data.id); expect(after.customer.nickname).toBe(body.nickname); expect(await passwords.verify(password, after.customer.passwordHash)).toBe(true);
    expect(await prisma.customer.count({ where: { phone: body.phone } })).toBe(1); expect(after.audits).toHaveLength(1); expect(after.sessions).toEqual([]);
  } finally { gate.release(); await Promise.allSettled([first, ...(pending ? [pending] : [])]); }
});

it('5次成功后第6次429，Retry-After精确倒计时，到窗口末端恢复', async () => {
  for (let index = 0; index < 5; index++) await created(await register(await input()));
  const body = await input(); millis += 9_001; const denied = await register(body); expect(denied.headers.get('retry-after')).toBe('51');
  await error(denied, 429, 'AUTH_RATE_LIMITED'); expect(passwords.hashes).toBe(5); expect(registerSpy).toHaveBeenCalledTimes(5);
  expect(await prisma.customer.count({ where: { phone: body.phone } })).toBe(0);
  millis += 50_999; await created(await register(body)); expect(audit.calls).toBe(6);
});
it('格式错误也计数；伪造不同X-Forwarded-For不能绕过，429先于DTO和bcrypt', async () => {
  for (let index = 0; index < 5; index++) await error(await register({}, { 'X-Forwarded-For': `192.0.2.${index + 1}`, 'X-Real-IP': `192.0.2.${index + 1}` }), 400, 'VALIDATION_FAILED');
  const response = await register(await input(), { 'X-Forwarded-For': '203.0.113.1' }); await error(response, 429, 'AUTH_RATE_LIMITED');
  expect(response.headers.get('retry-after')).toBe('60'); expect(registerSpy).not.toHaveBeenCalled(); expect(passwords.hashes).toBe(0);
});
it('6个并发无效注册精确5个400和1个429，不因异步请求漏计数', async () => {
  const responses = await Promise.all(Array.from({ length: 6 }, () => register({})));
  expect(responses.map(response => response.status).sort()).toEqual([400, 400, 400, 400, 400, 429]);
  for (const response of responses) await error(response, response.status, response.status === 429 ? 'AUTH_RATE_LIMITED' : 'VALIDATION_FAILED');
  expect(passwords.hashes).toBe(0); expect(registerSpy).not.toHaveBeenCalled();
});
it('注册额度和员工登录额度相互隔离，沿用各自5/30次策略', async () => {
  const login = () => fetch(`${baseUrl}/api/v1/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  for (let index = 0; index < 5; index++) await error(await register({}), 400, 'VALIDATION_FAILED');
  await error(await login(), 400, 'VALIDATION_FAILED'); await error(await register({}), 429, 'AUTH_RATE_LIMITED');
  millis += 60_000;
  for (let index = 0; index < 30; index++) await error(await login(), 400, 'VALIDATION_FAILED');
  await error(await login(), 429, 'AUTH_RATE_LIMITED'); await created(await register(await input()));
});
it('重复冲突及系统故障也消耗注册IP预算，不退回额度', async () => {
  const body = await input(); await created(await register(body)); await error(await register(body), 409, 'PHONE_EXISTS');
  audit.fault = new Error('private-sql'); await error(await register(await input()), 500, 'INTERNAL_ERROR'); audit.fault = undefined;
  for (let index = 0; index < 2; index++) await error(await register({}), 400, 'VALIDATION_FAILED');
  await error(await register(await input()), 429, 'AUTH_RATE_LIMITED'); expect(passwords.hashes).toBe(3);
});
it('编译API公开注册，严格DTO/重复409/默认昵称/真实5次限流，不返回token或创建会话', async () => {
  const body = await input(); delete body.nickname; const next = await input();
  const source = String.raw`
    require('reflect-metadata');const {NestFactory}=require('@nestjs/core');const {AppModule}=require('./dist/app.module.js');const {configureApp}=require('./dist/common/configure-app.js');
    (async()=>{const app=await NestFactory.create(AppModule,{logger:false});try{configureApp(app);await app.listen(0,'127.0.0.1');const url=await app.getUrl();
      const input=JSON.parse(process.env.SHOP_TEST_REGISTER);const post=body=>fetch(url+'/api/v1/store/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const created=await post(input);const body=await created.json();const duplicate=await post(input);const conflict=await duplicate.json();
      const invalid=await post({...input,status:'NORMAL'});const phone=await post({...input,phone:'123'});const password=await post({...input,password:'short'});
      const limited=await post({...input,phone:process.env.SHOP_TEST_NEXT_PHONE});const limit=await limited.json();
      console.log(JSON.stringify({id:body.data?.id,created:created.status,fields:Object.keys(body.data??{}).sort(),nickname:body.data?.nickname,status:body.data?.status,
        duplicate:duplicate.status,code:conflict.code,invalid:invalid.status,phone:phone.status,password:password.status,limited:limited.status,limitCode:limit.code,
        retryAfterPositive:Number(limited.headers.get('retry-after'))>0,hasToken:'accessToken'in(body.data??{}),hasCookie:created.headers.has('set-cookie')}));
    }finally{await app.close();}})().catch(()=>{console.error('编译后顾客注册验证失败');process.exitCode=1;});`;
  const child = spawnSync(process.execPath, ['-e', source], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true, timeout: 15_000,
    env: { ...process.env, DATABASE_URL: safe.testUrl, LOG_LEVEL: 'silent', SHOP_TEST_REGISTER: JSON.stringify(body), SHOP_TEST_NEXT_PHONE: next.phone } });
  expect(child.status).toBe(0); const result = JSON.parse(child.stdout.trim()) as { id: string }; ids.add(result.id);
  expect(result).toEqual({ id: result.id, created: 201, fields: ['createdAt', 'id', 'nickname', 'phone', 'status'], nickname: '新顾客', status: 'NORMAL',
    duplicate: 409, code: 'PHONE_EXISTS', invalid: 400, phone: 400, password: 400, limited: 429, limitCode: 'AUTH_RATE_LIMITED', retryAfterPositive: true, hasToken: false, hasCookie: false });
  const after = await facts(result.id); expect(after.sessions).toEqual([]); expect(after.audits).toHaveLength(1); expect(after.customer.lastLoginAt).toBeNull();
  expect(await passwords.verify(password, after.customer.passwordHash)).toBe(true); expect(await prisma.customer.count({ where: { phone: next.phone } })).toBe(0);
  for (const secret of [password, after.customer.passwordHash, body.phone]) expect(child.stdout + child.stderr).not.toContain(secret);
});
