// 作用：验证员工查询的权限、分页、文字搜索、公开字段与一致读取快照。
import 'reflect-metadata';
import { randomInt, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { INestApplication } from '@nestjs/common';
import type { EmployeeRole, Prisma } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuthSessionService } from '../src/auth/auth-session.service.js';
import { CurrentIdentityService } from '../src/auth/current-identity.service.js';
import { JwtTokenService } from '../src/auth/jwt-token.service.js';
import { PasswordService } from '../src/auth/password.service.js';
import { configureApp } from '../src/common/configure-app.js';
import { APP_CONFIG, loadConfiguration } from '../src/config/environment.js';
import { EmployeeQueryController } from '../src/employees/employee-query.controller.js';
import { EmployeeIdParamsDto, EmployeeListQueryDto } from '../src/employees/employee-query.dto.js';
import { EmployeeQueryService } from '../src/employees/employee-query.service.js';
import { permissionDefinitions, roleTemplates } from '../src/permissions/permission-catalog.js';
import { seedPermissionCatalog } from '../src/permissions/permission-seed.js';
import { PermissionService } from '../src/permissions/permission.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { assertSafeTestDatabase } from '../scripts/database-env.js';

assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('集成测试仅可在test环境执行');
// Vitest不生成参数元数据；另用编译API子进程验证生产tsc识别DTO。
Reflect.defineMetadata('design:paramtypes', [EmployeeListQueryDto], EmployeeQueryController.prototype, 'list');
Reflect.defineMetadata('design:paramtypes', [EmployeeIdParamsDto], EmployeeQueryController.prototype, 'detail');
const password = 'EmployeeQuery#2026'; let passwordHash = '';
let millis = Date.parse('2026-11-12T01:00:00.500Z'); const clock = () => new Date(millis);
const tokens = new JwtTokenService({ secret: 'employee-query-test-only-key-'.repeat(3), ttlSeconds: 7200 }, clock);
const sessions = new AuthSessionService(tokens, clock);
let app: INestApplication; let prisma: PrismaService; let peer: PrismaService; let baseUrl = ''; let marker = '';
let adminId = ''; let adminToken = '';
let listSpy: MockInstance<EmployeeQueryService['list']>; let detailSpy: MockInstance<EmployeeQueryService['detail']>;
let catalogSpy: MockInstance<PermissionService['catalog']>;
const employeeIds = new Set<string>(); const customerIds = new Set<string>();
const listKeys = ['id', 'username', 'displayName', 'role', 'status', 'mustChangePassword', 'version', 'createdAt', 'lastLoginAt'].sort();
interface EmployeeItem { id: string; username: string; displayName: string; role: EmployeeRole; status: string;
  mustChangePassword: boolean; version: number; createdAt: string; lastLoginAt: string | null }
interface ListData { items: EmployeeItem[]; total: number; page: number; pageSize: number }
interface DetailData extends EmployeeItem { permissionVersion: number; defaultPermissions: string[]; extraPermissions: string[]; effectivePermissions: string[] }

beforeAll(async () => {
  passwordHash = await new PasswordService().hash(password);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG).useValue(loadConfiguration({ ...process.env, LOG_LEVEL: 'silent' }))
    .overrideProvider(JwtTokenService).useValue(tokens).overrideProvider(AuthSessionService).useValue(sessions)
    .overrideProvider(CurrentIdentityService).useValue(new CurrentIdentityService(tokens, new PermissionService(), clock)).compile();
  app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1');
  prisma = app.get(PrismaService); baseUrl = await app.getUrl(); await seedPermissionCatalog(prisma);
  peer = new PrismaService(loadConfiguration()); await peer.onModuleInit();
  listSpy = vi.spyOn(app.get(EmployeeQueryService), 'list'); detailSpy = vi.spyOn(app.get(EmployeeQueryService), 'detail');
  catalogSpy = vi.spyOn(app.get(PermissionService), 'catalog');
});
beforeEach(async () => {
  millis += 360_000; marker = `eq_${randomUUID().slice(0, 8)}`; listSpy.mockClear(); detailSpy.mockClear(); catalogSpy.mockClear();
  const admin = await employee({ role: 'SUPER_ADMIN', displayName: '查询管理员夹具' }); adminId = admin.id; adminToken = await access(admin.id);
});
afterEach(async () => {
  await prisma.employeeExtraPermission.deleteMany({ where: { employeeId: { in: [...employeeIds] } } });
  await prisma.auditLog.deleteMany({ where: { actorEmployeeId: { in: [...employeeIds] } } });
  await prisma.authSession.deleteMany({ where: { OR: [
    { employeeId: { in: [...employeeIds] } }, { customerId: { in: [...customerIds] } },
  ] } });
  await prisma.employee.deleteMany({ where: { id: { in: [...employeeIds] } } });
  await prisma.customer.deleteMany({ where: { id: { in: [...customerIds] } } }); employeeIds.clear(); customerIds.clear();
});
afterAll(async () => { listSpy?.mockRestore(); detailSpy?.mockRestore(); catalogSpy?.mockRestore(); await peer?.$disconnect(); await app?.close(); });

async function employee(input: Partial<Prisma.EmployeeUncheckedCreateInput> = {}) {
  const id = input.id ?? randomUUID(); employeeIds.add(id);
  return prisma.employee.create({ data: { id, username: `q_${randomUUID().replaceAll('-', '').slice(0, 20)}`, displayName: `${marker} 员工`,
    role: 'CUSTOMER_SERVICE', mustChangePassword: false, passwordHash, createdAt: new Date('2026-01-01T00:00:00Z'), ...input } });
}
async function access(id: string) {
  const issued = await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, {
    subjectType: 'EMPLOYEE', subjectId: id, expectedPasswordHash: passwordHash, expectedTokenVersion: 0,
  })); return issued.accessToken;
}
async function call(path: string, token: string | null = adminToken) {
  return fetch(`${baseUrl}/api/v1/admin/employees${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}
async function list(query = '', token: string | null = adminToken) { return call(`?${query}`, token); }
async function catalog(token: string | null = adminToken, query = '') {
  return fetch(`${baseUrl}/api/v1/admin/permissions${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}
async function success<T>(response: Response): Promise<T> {
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json() as { data: T; requestId: string };
  expect(Object.keys(body).sort()).toEqual(['data', 'requestId']); expect(body.requestId).toBe(response.headers.get('x-request-id'));
  for (const secret of [password, passwordHash, adminToken]) expect(JSON.stringify(body)).not.toContain(secret);
  return body.data;
}
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  const body = await response.json() as { code: string; requestId: string; details?: { field: string }[] };
  expect(body.code).toBe(code); expect(body.requestId).toBe(response.headers.get('x-request-id'));
  for (const secret of [password, passwordHash, 'private-input']) expect(JSON.stringify(body)).not.toContain(secret);
  return body;
}

it('默认分页20条、第二页和重复请求保持createdAt/id倒序，列表严格九字段', async () => {
  const prefix = randomUUID().slice(0, 24); const rows = [];
  for (let index = 0; index < 23; index++) rows.push(await employee({ id: `${prefix}${index.toString(16).padStart(12, '0')}`,
    createdAt: new Date(index === 22 ? '2026-01-01T00:00:00Z' : '2026-01-02T00:00:00Z') }));
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
  const first = await success<ListData>(await list(`keyword=${marker}`));
  expect(first).toMatchObject({ total: 23, page: 1, pageSize: 20 }); expect(first.items.map(item => item.id)).toEqual(rows.slice(0, 20).map(item => item.id));
  for (const item of first.items) { expect(Object.keys(item).sort()).toEqual(listKeys); expect(item.lastLoginAt).toBeNull(); }
  const second = await success<ListData>(await list(`keyword=${marker}&page=2`));
  expect(second).toMatchObject({ total: 23, page: 2, pageSize: 20 }); expect(second.items.map(item => item.id)).toEqual(rows.slice(20).map(item => item.id));
  expect(await success<ListData>(await list(`keyword=${marker}`))).toEqual(first);
  expect((await success<ListData>(await list(`keyword=${marker}&pageSize=100`))).items).toHaveLength(23);
});

it('关键词账号/显示名忽略大小写，岗位与状态交集筛选，空页仍有准确total', async () => {
  const active = await employee({ username: `${marker}_active` });
  const disabled = await employee({ role: 'MERCH_WAREHOUSE', status: 'DISABLED', displayName: `${marker} 仓储` });
  await employee({ role: 'MERCH_WAREHOUSE', displayName: `${marker} 仓储启用` });
  const byName = await success<ListData>(await list(`keyword=${marker.toUpperCase()}_ACTIVE`)); expect(byName.items.map(item => item.id)).toEqual([active.id]);
  const filtered = await success<ListData>(await list(`keyword=${encodeURIComponent(` ${marker} `)}&role=MERCH_WAREHOUSE&status=DISABLED`));
  expect(filtered.total).toBe(1); expect(filtered.items.map(item => item.id)).toEqual([disabled.id]);
  expect(await success<ListData>(await list(`keyword=${marker}&page=9007199254740991&pageSize=100`)))
    .toEqual({ items: [], total: 3, page: Number.MAX_SAFE_INTEGER, pageSize: 100 });
  expect(await success<ListData>(await list('keyword=never_match_this_fixture'))).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
});

it('百分号、下划线和反斜线按文字检索，不扩展匹配范围', async () => {
  const target = await employee({ displayName: `${marker}%_\\命中` });
  await employee({ displayName: `${marker}xx_\\命中` }); await employee({ displayName: `${marker}%x\\命中` });
  const literal = await success<ListData>(await list(`keyword=${encodeURIComponent(`${marker}%_\\`)}`));
  expect(literal.items.map(item => item.id)).toEqual([target.id]); expect(literal.total).toBe(1);
});

it.each(['page=0', 'page=-1', 'page=1.5', 'page=', 'page=1e2', 'page=9007199254740992', 'page=1&page=2',
  'pageSize=0', 'pageSize=101', 'pageSize=1e2', 'role=UNKNOWN', 'role=SUPER_ADMIN&role=CUSTOMER_SERVICE',
  'status=unknown', `keyword=${'x'.repeat(51)}`, 'keyword=one&keyword=two', 'extra=private-input',
])('严格拒绝非法列表参数%s，带字段错误且未进入查询服务', async query => {
  const result = await error(await list(query), 400, 'VALIDATION_FAILED'); expect(result.details?.length).toBeGreaterThan(0);
  expect(listSpy).not.toHaveBeenCalled();
});

it.each(['SUPER_ADMIN', 'MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'] as const)('%s详情返回资料和权限快照，不暴露哈希/会话且可读取停用目标', async role => {
  const target = await employee({ role, status: 'DISABLED', version: 4, permissionVersion: 7 });
  const before = await prisma.employee.findUniqueOrThrow({ where: { id: target.id } });
  const result = await success<DetailData>(await call(`/${target.id.toUpperCase()}`));
  expect(Object.keys(result).sort()).toEqual([...listKeys, 'permissionVersion', 'defaultPermissions', 'extraPermissions', 'effectivePermissions'].sort());
  expect(result).toMatchObject({ id: target.id, role, status: 'DISABLED', version: 4, permissionVersion: 7,
    createdAt: target.createdAt.toISOString(), lastLoginAt: null, defaultPermissions: [...roleTemplates[role]].sort(),
    extraPermissions: [], effectivePermissions: [...roleTemplates[role]].sort() });
  expect(await prisma.employee.findUniqueOrThrow({ where: { id: target.id } })).toEqual(before);
  expect(await prisma.auditLog.count({ where: { targetId: target.id } })).toBe(0);
});

it('详情读取额外权限及版本变化，授权关系只输出码，列表不逐行读取或合并权限', async () => {
  const target = await employee(); const extras = ['order.fulfillment.read', 'shipment.claim', 'shipment.handover'];
  await peer.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM employee WHERE id=${target.id}::uuid FOR UPDATE`;
    await tx.employeeExtraPermission.createMany({ data: extras.map(permissionCode => ({ employeeId: target.id, permissionCode, grantedById: adminId })) });
    await tx.employee.update({ where: { id: target.id }, data: { permissionVersion: 1, version: 1 } });
  });
  const result = await success<DetailData>(await call(`/${target.id}`));
  expect(result).toMatchObject({ version: 1, permissionVersion: 1, extraPermissions: extras,
    effectivePermissions: [...roleTemplates.CUSTOMER_SERVICE, ...extras].sort() });
  expect(JSON.stringify(result)).not.toMatch(/grantedById|grantedAt|permissionCode/);
  // 故意留下缺依赖夹具，列表仍只读公开资料；详情明确失败而不自动补权。
  await peer.employeeExtraPermission.deleteMany({ where: { employeeId: target.id, permissionCode: { not: 'shipment.handover' } } });
  const listed = await success<ListData>(await list(`keyword=${marker}`)); expect(listed.items).toHaveLength(1);
  expect(Object.keys(listed.items[0]!).sort()).toEqual(listKeys);
  await error(await call(`/${target.id}`), 500, 'INTERNAL_ERROR');
  expect(await prisma.employeeExtraPermission.count({ where: { employeeId: target.id } })).toBe(1);
});

it('有权用户的错误UUID返回400、未知UUID返回404', async () => {
  const invalid = await error(await call('/not-a-uuid'), 400, 'VALIDATION_FAILED');
  expect(invalid.details?.some(item => item.field === 'id')).toBe(true); expect(detailSpy).not.toHaveBeenCalled();
  await error(await call(`/${randomUUID()}`), 404, 'EMPLOYEE_NOT_FOUND'); expect(detailSpy).toHaveBeenCalledTimes(1);
});

it.each(['MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'] as const)('%s员工查询及固定目录均403，权限判断先于参数或目标查询', async role => {
  const actor = await employee({ role }); const token = await access(actor.id); const target = await employee();
  for (const path of ['?page=0&extra=private-input', `/${target.id}`, `/${randomUUID()}`, '/not-a-uuid']) {
    const body = await error(await call(path, token), 403, 'FORBIDDEN'); expect(body.details).toBeUndefined();
  }
  expect(listSpy).not.toHaveBeenCalled(); expect(detailSpy).not.toHaveBeenCalled();
  await error(await catalog(token, '?role=SUPER_ADMIN&permission=employee.read'), 403, 'FORBIDDEN');
  expect(catalogSpy).not.toHaveBeenCalled();
});

it('强制改密管理员403但会话有效；无凭证、顾客域、停用、撤销及到期均401', async () => {
  await prisma.employee.update({ where: { id: adminId }, data: { mustChangePassword: true } });
  await error(await list('', adminToken), 403, 'PASSWORD_CHANGE_REQUIRED');
  await error(await call('/not-a-uuid'), 403, 'PASSWORD_CHANGE_REQUIRED');
  await error(await catalog(), 403, 'PASSWORD_CHANGE_REQUIRED');
  expect(await prisma.authSession.count({ where: { employeeId: adminId, revokedAt: null } })).toBe(1);
  await error(await list('', null), 401, 'TOKEN_INVALID');
  await error(await catalog(null), 401, 'TOKEN_INVALID');
  const customerId = randomUUID(); customerIds.add(customerId);
  await prisma.customer.create({ data: { id: customerId, phone: `139${randomInt(100_000_000).toString().padStart(8, '0')}`,
    nickname: '查询域隔离夹具', passwordHash, createdAt: new Date('2026-01-01T00:00:00Z') } });
  const customer = await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, { subjectType: 'CUSTOMER', subjectId: customerId,
    expectedPasswordHash: passwordHash, expectedTokenVersion: 0 }));
  await error(await list('', customer.accessToken), 401, 'TOKEN_SUBJECT_MISMATCH');
  await error(await catalog(customer.accessToken), 401, 'TOKEN_SUBJECT_MISMATCH');
  await prisma.employee.update({ where: { id: adminId }, data: { mustChangePassword: false, status: 'DISABLED' } });
  await error(await list(), 401, 'ACCOUNT_UNAVAILABLE');
  await error(await catalog(), 401, 'ACCOUNT_UNAVAILABLE');
  await prisma.employee.update({ where: { id: adminId }, data: { status: 'ACTIVE' } });
  const claims = await tokens.verify(adminToken, 'EMPLOYEE');
  await prisma.$transaction(tx => sessions.revokeCurrent(tx, { subjectType: 'EMPLOYEE', subjectId: adminId }, claims.sid));
  await error(await list(), 401, 'SESSION_REVOKED'); await error(await catalog(), 401, 'SESSION_REVOKED');
  millis += 7_200_000; await error(await list(), 401, 'TOKEN_EXPIRED'); await error(await catalog(), 401, 'TOKEN_EXPIRED');
  expect(listSpy).not.toHaveBeenCalled(); expect(detailSpy).not.toHaveBeenCalled();
  expect(catalogSpy).not.toHaveBeenCalled();
});

it('固定目录精确五字段、52项/15项管理员能力、直接依赖和三岗位模板一致且读取无写入', async () => {
  const before = await prisma.employee.findUniqueOrThrow({ where: { id: adminId } });
  const beforeSessions = await prisma.authSession.findMany({ where: { employeeId: adminId } });
  const beforeAudits = await prisma.auditLog.count({ where: { actorEmployeeId: adminId } });
  const result = await success<ReturnType<PermissionService['catalog']>>(await catalog());
  expect(Object.keys(result).sort()).toEqual(['permissions', 'roleTemplates']); expect(result.permissions).toHaveLength(52);
  const codes = result.permissions.map(item => item.code); expect(codes).toEqual([...new Set(codes)].sort());
  expect(result.permissions.filter(item => item.adminOnly)).toHaveLength(15);
  for (const item of result.permissions) {
    expect(Object.keys(item).sort()).toEqual(['adminOnly', 'code', 'dependencies', 'description', 'name']);
    const expected = permissionDefinitions.find(definition => definition.code === item.code)!;
    expect(item).toEqual({ code: expected.code, name: expected.name, description: expected.description,
      adminOnly: expected.adminOnly, dependencies: [...expected.dependencies].sort() });
    expect(item.dependencies.every(code => codes.includes(code as typeof codes[number]))).toBe(true);
  }
  expect(result.permissions.find(item => item.code === 'shipment.handover')?.dependencies).toEqual(['order.fulfillment.read', 'shipment.claim']);
  expect(Object.keys(result.roleTemplates).sort()).toEqual(['CUSTOMER_SERVICE', 'MERCH_WAREHOUSE', 'SUPER_ADMIN']);
  for (const role of ['SUPER_ADMIN', 'MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'] as const) {
    expect(result.roleTemplates[role]).toEqual([...roleTemplates[role]].sort());
    for (const code of result.roleTemplates[role]) {
      const definition = result.permissions.find(item => item.code === code)!;
      expect(definition.dependencies.every(dependency => result.roleTemplates[role].includes(dependency))).toBe(true);
      if (role !== 'SUPER_ADMIN') expect(definition.adminOnly).toBe(false);
    }
  }
  expect(Object.values(result.roleTemplates).map(items => items.length)).toEqual([52, 25, 12]);
  expect(await success(await catalog(adminToken, '?role=CUSTOMER_SERVICE&permission=private-input'))).toEqual(result);
  expect(JSON.stringify(result)).not.toMatch(/defaultRole|passwordHash|tokenVersion|grantedById|sessionId/);
  expect(await prisma.employee.findUniqueOrThrow({ where: { id: adminId } })).toEqual(before);
  expect(await prisma.authSession.findMany({ where: { employeeId: adminId } })).toEqual(beforeSessions);
  expect(await prisma.auditLog.count({ where: { actorEmployeeId: adminId } })).toBe(beforeAudits);
  expect(await prisma.employeeExtraPermission.count({ where: { employeeId: adminId } })).toBe(0);
});

it('目录依赖当前身份，管理员降岗后旧token立即403，恢复岗位后同token可查询', async () => {
  await success(await catalog()); catalogSpy.mockClear();
  // 直接改自有夹具验证Guard即时读取；不代表调岗写API或审计已实现。
  await peer.employee.update({ where: { id: adminId }, data: { role: 'CUSTOMER_SERVICE', permissionVersion: { increment: 1 }, version: { increment: 1 } } });
  await error(await catalog(), 403, 'FORBIDDEN'); expect(catalogSpy).not.toHaveBeenCalled();
  expect(await prisma.authSession.count({ where: { employeeId: adminId, revokedAt: null } })).toBe(1);
  await peer.employee.update({ where: { id: adminId }, data: { role: 'SUPER_ADMIN', permissionVersion: { increment: 1 }, version: { increment: 1 } } });
  expect((await success<ReturnType<PermissionService['catalog']>>(await catalog())).permissions).toHaveLength(52);
});

it('编译API可真实登录查询员工，严格拒绝额外筛选和非法UUID', async () => {
  const admin = await prisma.employee.findUniqueOrThrow({ where: { id: adminId } }); const target = await employee();
  const source = String.raw`
    require('reflect-metadata');
    const { NestFactory } = require('@nestjs/core'); const { AppModule } = require('./dist/app.module.js');
    const { configureApp } = require('./dist/common/configure-app.js');
    (async () => { const app = await NestFactory.create(AppModule, { logger: false });
      try { configureApp(app); await app.listen(0, '127.0.0.1'); const url = await app.getUrl();
        const login = await fetch(url + '/api/v1/admin/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: process.env.SHOP_TEST_USERNAME, password: process.env.SHOP_TEST_PASSWORD }) });
        const token = (await login.json()).data.accessToken;
        const get = path => fetch(url + '/api/v1/admin/employees' + path, { headers: { Authorization: 'Bearer ' + token } });
        const invalid = await get('?extra=private-input'); const malformed = await get('/not-a-uuid');
        const listed = await get('?keyword=' + encodeURIComponent(process.env.SHOP_TEST_MARKER)); const listBody = await listed.json();
        const detail = await get('/' + process.env.SHOP_TEST_TARGET); const detailBody = await detail.json();
        const catalog = await fetch(url + '/api/v1/admin/permissions', { headers: { Authorization: 'Bearer ' + token } });
        const catalogBody = await catalog.json();
        console.log(JSON.stringify({ invalid: invalid.status, malformed: malformed.status, list: listed.status, total: listBody.data?.total,
          detail: detail.status, version: detailBody.data?.version, defaults: detailBody.data?.defaultPermissions?.length,
          catalog: catalog.status, catalogSize: catalogBody.data?.permissions?.length,
          adminOnly: catalogBody.data?.permissions?.filter(item => item.adminOnly).length,
          templates: Object.values(catalogBody.data?.roleTemplates ?? {}).map(items => items.length) }));
      } finally { await app.close(); }
    })().catch(() => { console.error('编译后员工查询验证失败'); process.exitCode=1; });`;
  const child = spawnSync(process.execPath, ['-e', source], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true, timeout: 12_000,
    env: { ...process.env, LOG_LEVEL: 'silent', SHOP_TEST_USERNAME: admin.username, SHOP_TEST_PASSWORD: password,
      SHOP_TEST_MARKER: marker, SHOP_TEST_TARGET: target.id } });
  expect(child.status).toBe(0); expect(JSON.parse(child.stdout.trim())).toEqual({ invalid: 400, malformed: 400,
    list: 200, total: 1, detail: 200, version: 0, defaults: 12, catalog: 200, catalogSize: 52, adminOnly: 15, templates: [52, 25, 12] });
  for (const secret of [password, passwordHash]) expect(child.stdout + child.stderr).not.toContain(secret);
});
