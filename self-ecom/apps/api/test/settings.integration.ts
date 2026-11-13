// 作用：用本轮专属PostgreSQL库验证设置HTTP、严格嵌套输入、并发版本和事务失败回滚。
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { Prisma, SubjectType } from '@prisma/client';
import { assertSafeTestDatabase } from '../scripts/database-env.js';
import { runPrisma } from '../scripts/database.js';
import { AppModule } from '../src/app.module.js';
import { AuditService, type AuditPayload } from '../src/audit/audit.service.js';
import { AuthSessionService } from '../src/auth/auth-session.service.js';
import { CurrentIdentityService } from '../src/auth/current-identity.service.js';
import { JwtTokenService } from '../src/auth/jwt-token.service.js';
import { PasswordService } from '../src/auth/password.service.js';
import { configureApp } from '../src/common/configure-app.js';
import { APP_CONFIG, loadConfiguration } from '../src/config/environment.js';
import { PermissionService } from '../src/permissions/permission.service.js';
import { seedPermissionCatalog } from '../src/permissions/permission-seed.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { StoreSettingsController } from '../src/settings/store-settings.controller.js';
import { SettingVersionParamsDto, SettingVersionsQueryDto, UpdateStoreSettingsDto } from '../src/settings/store-settings.dto.js';
import { StoreSettingsService } from '../src/settings/store-settings.service.js';
import { StoreSettingsError } from '../src/settings/store-settings.errors.js';

const base = assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('仅限独立测试环境');
const targetUrl = new URL(base.testUrl); targetUrl.pathname = `/settings_${randomUUID().replaceAll('-', '')}_test`;
const target = assertSafeTestDatabase(base.developmentUrl, targetUrl.toString());
if (!/^settings_[a-f0-9]{32}_test$/.test(target.testName)) throw new Error('临时测试库名称不合法');
const adminUrl = new URL(base.testUrl); adminUrl.pathname = '/postgres';
const admin = new Client({ connectionString: adminUrl.toString() }); let created = false;
// Vitest不生成参数元数据；编译后入口另做真实DTO烟测，不让测试改变生产装配。
Reflect.defineMetadata('design:paramtypes', [UpdateStoreSettingsDto, Object, Object], StoreSettingsController.prototype, 'update');
Reflect.defineMetadata('design:paramtypes', [SettingVersionsQueryDto], StoreSettingsController.prototype, 'versions');
Reflect.defineMetadata('design:paramtypes', [SettingVersionParamsDto], StoreSettingsController.prototype, 'version');
let now = Date.now(); const clock = () => new Date(now);
const tokens = new JwtTokenService({ secret: 'settings-integration-only-key-2026-'.repeat(2), ttlSeconds: 7200 }, clock);
const sessions = new AuthSessionService(tokens, clock);
class ControlledIdentities extends CurrentIdentityService {
  afterGuard: (() => Promise<void>) | undefined;
  override async authenticate(db: Pick<Prisma.TransactionClient, '$queryRaw'>, token: string, domain: SubjectType) {
    const current = await super.authenticate(db, token, domain);
    if (typeof (db as { $connect?: unknown }).$connect === 'function') await this.afterGuard?.();
    return current;
  }
}
class ControlledAudit extends AuditService {
  fail = false; observedWrites = false;
  override async appendAudit(tx: Prisma.TransactionClient, payload: AuditPayload) {
    await super.appendAudit(tx, payload);
    if (!this.fail || payload.action !== 'store.setting.update') return;
    const head = await tx.storeSettingHead.findUniqueOrThrow({ where: { id: 1 } });
    this.observedWrites = head.currentVersionId === payload.targetId
      && await tx.storeSettingVersion.count() === 1 && await tx.auditLog.count({ where: { requestId: payload.requestId } }) === 1;
    throw new Error('测试专用设置审计故障');
  }
}
const identities = new ControlledIdentities(tokens, new PermissionService(), clock); const audit = new ControlledAudit();
let app: INestApplication; let prisma: PrismaService; let peer: PrismaService; let baseUrl = '';
let passwordHash = ''; let actorId = ''; let credential = ''; let sessionId = '';
async function employee(role: 'SUPER_ADMIN' | 'CUSTOMER_SERVICE' | 'MERCH_WAREHOUSE' = 'SUPER_ADMIN') {
  return prisma.employee.create({ data: { username: `s_${randomUUID().replaceAll('-', '').slice(0, 24)}`,
    displayName: '设置隔离测试员工', role, passwordHash, mustChangePassword: false, createdAt: new Date('2026-01-01T00:00:00Z') } });
}
async function access(id: string, subjectType: SubjectType = 'EMPLOYEE') {
  return prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx,
    { subjectType, subjectId: id, expectedPasswordHash: passwordHash, expectedTokenVersion: 0 }));
}
beforeAll(async () => {
  await admin.connect(); await admin.query(`CREATE DATABASE "${target.testName}" ENCODING 'UTF8' TEMPLATE template0`); created = true;
  runPrisma(['migrate', 'deploy'], { ...process.env, DATABASE_URL: target.testUrl });
  passwordHash = await new PasswordService().hash('SettingsFixture#2026');
  const config = loadConfiguration({ ...process.env, DATABASE_URL: target.testUrl, LOG_LEVEL: 'silent' });
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(APP_CONFIG).useValue(config)
    .overrideProvider(JwtTokenService).useValue(tokens).overrideProvider(AuthSessionService).useValue(sessions)
    .overrideProvider(CurrentIdentityService).useValue(identities).overrideProvider(AuditService).useValue(audit).compile();
  app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1');
  prisma = app.get(PrismaService); peer = new PrismaService(config); await peer.onModuleInit(); baseUrl = await app.getUrl();
  await seedPermissionCatalog(prisma);
}, 45_000);
beforeEach(async () => {
  now = Date.now(); identities.afterGuard = undefined; audit.fail = false; audit.observedWrites = false;
  // 这些清理仅发生在CREATE成功的本轮独占库，不清空shop_test或开发库。
  await prisma.task.deleteMany(); await prisma.taskStageCursor.deleteMany();
  await prisma.storeSettingHead.update({ where: { id: 1 }, data: { currentVersionId: null, version: 0 } });
  await prisma.storeSettingVersion.deleteMany(); await prisma.auditLog.deleteMany();
  await prisma.authSession.deleteMany(); await prisma.employeeExtraPermission.deleteMany();
  await prisma.employee.deleteMany(); await prisma.customer.deleteMany();
  const actor = await employee(); actorId = actor.id; const login = await access(actorId);
  credential = login.accessToken; sessionId = (await tokens.verify(credential, 'EMPLOYEE')).sid;
});
afterAll(async () => {
  await peer?.$disconnect(); await app?.close();
  try {
    if (created) {
      const checked = assertSafeTestDatabase(base.developmentUrl, target.testUrl);
      if (!/^settings_[a-f0-9]{32}_test$/.test(checked.testName)) throw new Error('清理目标不合法');
      // 不FORCE、不终止未知连接；只删除本轮CREATE成功的库。
      await admin.query(`DROP DATABASE "${checked.testName}"`); created = false;
    }
  } finally { await admin.end(); }
}, 20_000);

function input(patch: Record<string, unknown> = {}) {
  return { expectedVersion: 0, reason: '隔离测试初始化设置', shippingFeeCents: 1000, freeShippingEnabled: true,
    freeShippingThresholdCents: 9900, returnAddress: { receiver: '隔离测试收件人', phone: '010-00000000', province: '虚构省',
      city: '虚构市', district: '虚构区', detail: '仅隔离库使用的虚构地址' },
    serviceContact: { phone: '+86 010-00000000', serviceHours: '周一至周五09:00—18:00' },
    deadlines: { paymentMinutes: 30, autoReceiptDays: 10, afterSaleWindowDays: 7, reviewWorkdays: 2,
      supplementDays: 7, returnShipDays: 7, inspectionWorkdays: 2, refundWorkdays: 1 }, ...patch };
}
async function call(path = '/admin/settings', method = 'GET', body?: unknown, token: string | null = credential) {
  return fetch(`${baseUrl}/api/v1${path}`, { method, headers: { 'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function success(response: Response) {
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json(); expect(Object.keys(body).sort()).toEqual(['data', 'requestId']);
  expect(body.requestId).toBe(response.headers.get('x-request-id'));
  expect(JSON.stringify(body)).not.toContain(passwordHash); expect(JSON.stringify(body)).not.toContain(credential);
  return body;
}
async function failure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); const body = await response.json(); expect(body.code).toBe(code);
  expect(body.requestId).toBe(response.headers.get('x-request-id'));
  expect(JSON.stringify(body)).not.toMatch(/SettingsFixture|测试专用设置审计故障|postgresql:/); return body;
}
async function unchanged() {
  expect(await prisma.storeSettingVersion.count()).toBe(0); expect(await prisma.auditLog.count()).toBe(0);
  expect(await prisma.storeSettingHead.findUniqueOrThrow({ where: { id: 1 } })).toEqual({ id: 1, currentVersionId: null, version: 0 });
}
function barrier() {
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  let signal!: () => void; const ready = new Promise<void>(resolve => { signal = resolve; }); return { release, hold, signal, ready };
}
async function waitForBlocker(pid: number, expected = 1) {
  const until = performance.now() + 400;
  while (performance.now() < until) {
    // 第二个请求可能排在第一个请求的tuple锁后面；递归核对整条等待链，不能只数直接阻塞者。
    const [row] = await peer.$queryRaw<{ count: number }[]>`WITH RECURSIVE blocked(pid) AS (
      SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND ${pid}=ANY(pg_blocking_pids(pid))
      UNION
      SELECT activity.pid FROM pg_stat_activity activity JOIN blocked parent ON parent.pid=ANY(pg_blocking_pids(activity.pid))
      WHERE activity.datname=current_database()
    ) SELECT count(*)::int AS count FROM blocked`;
    if ((row?.count ?? 0) >= expected) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  const waits = await peer.$queryRaw`SELECT pid, pg_blocking_pids(pid) AS blockers, wait_event AS event,
    query LIKE '%store_setting_head%' AS head_query FROM pg_stat_activity
    WHERE datname=current_database() AND wait_event_type='Lock'`;
  console.info('Head锁等待诊断', waits);
  throw new Error('未观察到设置Head的真实锁等待');
}

it('空配置可查询，业务要求配置时明确409，公开接口忽略无效Bearer', async () => {
  expect((await success(await call())).data).toEqual({ configured: false, version: 0, currentSetting: null });
  expect((await success(await call('/store/contact', 'GET', undefined, 'invalid-token'))).data)
    .toEqual({ configured: false, servicePhone: null, serviceHours: null, settingsVersion: 0 });
  await expect(prisma.$transaction(tx => app.get(StoreSettingsService).requireCurrent(tx)))
    .rejects.toMatchObject({ code: 'STORE_NOT_CONFIGURED', status: 409 });
  expect(new StoreSettingsError('STORE_NOT_CONFIGURED').message).not.toContain('地址');
  expect((await success(await call('/admin/settings/versions'))).data).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
});
it('初版完整保存、规范化电话、公开字段裁剪且同事务最小审计', async () => {
  const body = input(); const result = await success(await call('/admin/settings', 'PUT', body));
  expect(result.data).toMatchObject({ version: 1, changed: true, currentSetting: { versionNumber: 1, reason: body.reason,
    createdByEmployeeId: actorId, returnAddress: { phone: '01000000000' }, serviceContact: { phone: '+8601000000000' } } });
  expect(result.data.settingVersionId).toBe(result.data.currentSetting.id);
  expect((await success(await call())).data).toEqual({ configured: true, version: 1, currentSetting: result.data.currentSetting });
  expect((await success(await call('/store/contact', 'GET', undefined, null))).data)
    .toEqual({ configured: true, servicePhone: '+8601000000000', serviceHours: body.serviceContact.serviceHours, settingsVersion: 1 });
  const logs = await prisma.auditLog.findMany(); expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({ action: 'store.setting.update', targetType: 'StoreSettingVersion', targetId: result.data.settingVersionId,
    actorEmployeeId: actorId, actorCustomerId: null, beforeData: null, requestId: result.requestId,
    afterData: { versionNumber: 1, settingVersionId: result.data.settingVersionId,
      changedFields: ['shippingFeeCents', 'freeShippingEnabled', 'freeShippingThresholdCents', 'returnAddress', 'serviceContact', 'deadlines'] } });
  expect(JSON.stringify(logs)).not.toContain(body.returnAddress.detail); expect(JSON.stringify(logs)).not.toContain(body.serviceContact.phone);
});
it('同内容不新增记录；过期版本即使内容相同也409', async () => {
  const first = (await success(await call('/admin/settings', 'PUT', input()))).data;
  const records = await prisma.storeSettingVersion.findMany(); const logs = await prisma.auditLog.findMany();
  const same = (await success(await call('/admin/settings', 'PUT', input({ expectedVersion: 1, reason: '仅原因改变不造版本' })))).data;
  expect(same).toEqual({ ...first, changed: false });
  await failure(await call('/admin/settings', 'PUT', input()), 409, 'VERSION_CONFLICT');
  expect(await prisma.storeSettingVersion.findMany()).toEqual(records); expect(await prisma.auditLog.findMany()).toEqual(logs);
});
it('更新只追加完整新版本，旧版本、旧任务期限及快照保留，历史可分页读取', async () => {
  const first = (await success(await call('/admin/settings', 'PUT', input()))).data;
  const before = await prisma.storeSettingVersion.findUniqueOrThrow({ where: { id: first.settingVersionId } });
  const cursor = await prisma.taskStageCursor.create({ data: { businessType: 'AFTER_SALE', businessId: randomUUID(), stage: 'AFTER_SALE_REVIEW', lastRound: 1 } });
  const task = await prisma.task.create({ data: { cursorId: cursor.id, businessType: cursor.businessType, businessId: cursor.businessId,
    stage: cursor.stage, round: 1, entryKey: randomUUID(), requiredPermissions: ['after-sale.review'], startedAt: new Date('2026-11-01T00:00:00Z'),
    originalDueAt: new Date('2026-11-03T00:00:00Z'), dueAt: new Date('2026-11-03T00:00:00Z'), settingsVersionId: before.id,
    ruleSnapshot: { unit: 'WORKDAY', amount: before.reviewWorkdays, timeZone: 'Asia/Shanghai', algorithmVersion: 'shanghai-calendar-v1' } } });
  const second = (await success(await call('/admin/settings', 'PUT', input({ expectedVersion: 1, shippingFeeCents: 0,
    freeShippingEnabled: false, freeShippingThresholdCents: 0, deadlines: { ...input().deadlines, reviewWorkdays: 3 } })))).data;
  expect(second.version).toBe(2); expect(await prisma.storeSettingVersion.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
  expect(await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).toEqual(task);
  const detail = (await success(await call(`/admin/settings/versions/${first.settingVersionId.toUpperCase()}`))).data;
  expect(detail).toEqual(first.currentSetting);
  const page = (await success(await call('/admin/settings/versions?page=1&pageSize=1'))).data;
  expect(page.total).toBe(2); expect(page.items.map((row: { id: string }) => row.id)).toEqual([second.settingVersionId]);
  expect(Object.keys(page.items[0]).sort()).toEqual(['createdAt', 'createdByEmployeeId', 'id', 'reason', 'versionNumber']);
  expect((await success(await call('/admin/settings/versions?page=9007199254740991'))).data.items).toEqual([]);
  await failure(await call(`/admin/settings/versions/${randomUUID()}`), 404, 'SETTING_VERSION_NOT_FOUND');
  await failure(await call('/admin/settings/versions/not-uuid'), 400, 'VALIDATION_FAILED');
  const latestAudit = await prisma.auditLog.findFirstOrThrow({ where: { targetId: second.settingVersionId } });
  expect(latestAudit.beforeData).toEqual({ versionNumber: 1, settingVersionId: first.settingVersionId });
  expect(latestAudit.afterData).toEqual({ versionNumber: 2, settingVersionId: second.settingVersionId,
    changedFields: ['shippingFeeCents', 'freeShippingEnabled', 'freeShippingThresholdCents', 'deadlines'] });
});

const invalid: [string, Record<string, unknown>][] = [
  ['负金额', { shippingFeeCents: -1 }], ['超限金额', { shippingFeeCents: 1000001 }], ['浮点金额', { shippingFeeCents: 0.1 }],
  ['金额字符串', { shippingFeeCents: '1000' }], ['超限门槛', { freeShippingThresholdCents: 100000001 }],
  ['负门槛', { freeShippingThresholdCents: -1 }], ['字符串boolean', { freeShippingEnabled: 'false' }],
  ['空boolean', { freeShippingEnabled: null }], ['字符串版本', { expectedVersion: '0' }], ['小数版本', { expectedVersion: 0.5 }],
  ['负版本', { expectedVersion: -1 }], ['超安全整数版本', { expectedVersion: Number.MAX_SAFE_INTEGER + 1 }],
  ['空原因', { reason: ' ' }], ['过长原因', { reason: '字'.repeat(501) }], ['伪造修改人', { createdBy: randomUUID() }],
  ['伪造版本ID', { versionId: randomUUID() }], ['空地址对象', { returnAddress: {} }], ['null地址', { returnAddress: null }],
  ['地址数组', { returnAddress: [input().returnAddress] }], ['空地址详情', { returnAddress: { ...input().returnAddress, detail: ' ' } }],
  ['地址超长', { returnAddress: { ...input().returnAddress, detail: '字'.repeat(201) } }],
  ['嵌套未知字段', { returnAddress: { ...input().returnAddress, secret: '不应保存' } }],
  ['缺服务电话', { serviceContact: {} }], ['非法服务电话', { serviceContact: { phone: 'abc' } }],
  ['服务电话超长', { serviceContact: { phone: '1 '.repeat(29) + '1' } }],
  ['服务时间超长', { serviceContact: { ...input().serviceContact, serviceHours: '字'.repeat(101) } }],
  ['服务时间错误类型', { serviceContact: { ...input().serviceContact, serviceHours: 1 } }],
  ['嵌套联系方式字段', { serviceContact: { ...input().serviceContact, privateContact: '不应保存' } }],
  ['期限数组', { deadlines: [input().deadlines] }], ['未知期限', { deadlines: { ...input().deadlines, arbitraryDays: 2 } }],
];
it.each(invalid)('%s返回400且没有版本或审计写入', async (_name, patch) => {
  const result = await failure(await call('/admin/settings', 'PUT', input(patch)), 400, 'VALIDATION_FAILED');
  expect(result.details.length).toBeGreaterThan(0); await unchanged();
});
it.each(['expectedVersion', 'reason', 'shippingFeeCents', 'freeShippingEnabled', 'freeShippingThresholdCents', 'returnAddress', 'serviceContact', 'deadlines'])(
'完整替换缺少%s返回400', async field => {
  const body: Record<string, unknown> = input(); delete body[field];
  await failure(await call('/admin/settings', 'PUT', body), 400, 'VALIDATION_FAILED'); await unchanged();
});
it.each([['paymentMinutes', 1440], ['autoReceiptDays', 365], ['afterSaleWindowDays', 365], ['reviewWorkdays', 30],
  ['supplementDays', 90], ['returnShipDays', 90], ['inspectionWorkdays', 30], ['refundWorkdays', 30]] as const)(
'%s严格检查期限范围、整数及类型', async (field, maximum) => {
  for (const value of [0, maximum + 1, 1.5, '2', true, null]) {
    const body = input({ deadlines: { ...input().deadlines, [field]: value } });
    const result = await failure(await call('/admin/settings', 'PUT', body), 400, 'VALIDATION_FAILED');
    expect(result.details.some((row: { field: string }) => row.field === `deadlines.${field}`)).toBe(true);
  }
  await unchanged();
});
it('合法上下界、Unicode文本以及可选服务时间清除均可保存', async () => {
  const body = input({ shippingFeeCents: 1000000, freeShippingThresholdCents: 100000000, reason: '原'.repeat(500),
    returnAddress: { ...input().returnAddress, receiver: '😀'.repeat(40), detail: '址'.repeat(200) },
    deadlines: { paymentMinutes: 1440, autoReceiptDays: 365, afterSaleWindowDays: 365, reviewWorkdays: 30,
      supplementDays: 90, returnShipDays: 90, inspectionWorkdays: 30, refundWorkdays: 30 } });
  await success(await call('/admin/settings', 'PUT', body));
  const second = (await success(await call('/admin/settings', 'PUT', input({ expectedVersion: 1,
    serviceContact: { phone: '010-00000000' }, deadlines: Object.fromEntries(Object.keys(input().deadlines).map(key => [key, 1])) })))).data;
  expect(second.currentSetting.serviceContact.serviceHours).toBeNull();
  const third = (await success(await call('/admin/settings', 'PUT', input({ expectedVersion: 2,
    serviceContact: { phone: '01000000000', serviceHours: null }, deadlines: Object.fromEntries(Object.keys(input().deadlines).map(key => [key, 1])) })))).data;
  expect(third.changed).toBe(false); expect(third.version).toBe(2);
});
it.each(['page=0', 'pageSize=101', 'page=1.5', 'page[]=1', 'unknown=1'])('历史查询%s返回400', async query => {
  await failure(await call(`/admin/settings/versions?${query}`), 400, 'VALIDATION_FAILED');
});
it.each(['CUSTOMER_SERVICE', 'MERCH_WAREHOUSE'] as const)('%s不能访问设置读写和历史，授权先于参数校验', async role => {
  const actor = await employee(role); const token = (await access(actor.id)).accessToken;
  for (const path of ['/admin/settings', '/admin/settings/versions', '/admin/settings/versions/not-uuid'])
    await failure(await call(path, 'GET', undefined, token), 403, 'FORBIDDEN');
  await failure(await call('/admin/settings', 'PUT', { invalid: true }, token), 403, 'FORBIDDEN'); await unchanged();
});
it('缺凭证、顾客域、强制改密均拒绝；公开联系方式不要求顾客登录', async () => {
  await failure(await call('/admin/settings', 'GET', undefined, null), 401, 'TOKEN_INVALID');
  const customer = await prisma.customer.create({ data: { phone: '13900000001', nickname: '隔离顾客', passwordHash, createdAt: new Date('2026-01-01T00:00:00Z') } });
  const token = (await access(customer.id, 'CUSTOMER')).accessToken;
  await failure(await call('/admin/settings', 'GET', undefined, token), 401, 'TOKEN_SUBJECT_MISMATCH');
  await prisma.employee.update({ where: { id: actorId }, data: { mustChangePassword: true } });
  await failure(await call(), 403, 'PASSWORD_CHANGE_REQUIRED'); await unchanged();
});
it.each(['role', 'status', 'mustChangePassword'] as const)('Guard通过后%s变化会在锁内重新拒绝', async field => {
  identities.afterGuard = async () => {
    identities.afterGuard = undefined;
    await peer.employee.update({ where: { id: actorId }, data: field === 'role' ? { role: 'CUSTOMER_SERVICE' }
      : field === 'status' ? { status: 'DISABLED' } : { mustChangePassword: true } });
  };
  await failure(await call('/admin/settings', 'PUT', input()), field === 'status' ? 401 : 403,
    field === 'status' ? 'ACCOUNT_UNAVAILABLE' : field === 'role' ? 'FORBIDDEN' : 'PASSWORD_CHANGE_REQUIRED'); await unchanged();
});
it('审计已写入后故障，版本、Head和审计整组回滚', async () => {
  audit.fail = true; await failure(await call('/admin/settings', 'PUT', input()), 500, 'INTERNAL_ERROR');
  expect(audit.observedWrites).toBe(true); await unchanged();
  audit.fail = false; expect((await success(await call('/admin/settings', 'PUT', input()))).data.version).toBe(1);
});
it('两个真实管理员在Head竞争，同expectedVersion仅一个版本和审计提交', async () => {
  const second = await employee(); const secondToken = (await access(second.id)).accessToken;
  const gate = barrier(); let pid = 0;
  const blocker = peer.$transaction(async tx => {
    const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`; pid = row!.pid;
    await tx.$queryRaw`SELECT id FROM store_setting_head WHERE id=1 FOR UPDATE`; gate.signal(); await gate.hold;
  });
  let requests: Promise<Response>[] = [];
  try {
    await gate.ready; requests = [call('/admin/settings', 'PUT', input()),
      call('/admin/settings', 'PUT', input({ shippingFeeCents: 2000 }), secondToken)];
    await waitForBlocker(pid, 2); gate.release(); await blocker;
    const results = await Promise.all(requests); expect(results.map(row => row.status).sort()).toEqual([200, 409]);
    for (const response of results) if (response.status === 409) await failure(response, 409, 'VERSION_CONFLICT');
    expect(await prisma.storeSettingVersion.count()).toBe(1); expect(await prisma.auditLog.count()).toBe(1);
  } finally { gate.release(); await blocker; await Promise.allSettled(requests); }
});
it.each(['revoked', 'expired'] as const)('等待Head期间会话%s，锁后重新认证拒绝保存', async mode => {
  const gate = barrier(); let pid = 0;
  const blocker = peer.$transaction(async tx => {
    const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`; pid = row!.pid;
    await tx.$queryRaw`SELECT id FROM store_setting_head WHERE id=1 FOR UPDATE`; gate.signal(); await gate.hold;
  });
  let request: Promise<Response> | undefined;
  try {
    await gate.ready; request = call('/admin/settings', 'PUT', input()); await waitForBlocker(pid);
    if (mode === 'revoked') await peer.authSession.update({ where: { id: sessionId }, data: { revokedAt: clock(), revokeReason: '测试撤销' } });
    else now += 7_200_000;
    gate.release(); await blocker;
    await failure(await request, 401, mode === 'revoked' ? 'SESSION_REVOKED' : 'TOKEN_EXPIRED'); await unchanged();
  } finally { gate.release(); await blocker; await request; }
});
