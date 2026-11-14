// 作用：以真实HTTP、会话、PostgreSQL与隔离磁盘验证上传授权、原子引用、限额和清理竞争。
import 'reflect-metadata';
import { randomUUID, randomInt } from 'node:crypto';
import { mkdtemp, readdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, type FilePurpose } from '@prisma/client';
import sharp from 'sharp';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { OrderAdapters } from '../src/orders/order.adapters.js';
import { AppModule } from '../src/app.module.js';
import { AuditService } from '../src/audit/audit.service.js';
import { CurrentIdentityService } from '../src/auth/current-identity.service.js';
import { JwtTokenService } from '../src/auth/jwt-token.service.js';
import { configureApp } from '../src/common/configure-app.js';
import { APP_CONFIG, loadConfiguration } from '../src/config/environment.js';
import { FileBindingService } from '../src/files/file-binding.service.js';
import { FileCleanupService } from '../src/files/file-cleanup.service.js';
import { FILE_CONFIG } from '../src/files/file-configuration.js';
import { FileStorageService } from '../src/files/file-storage.service.js';
import { FileAccessService, type FileAccess } from '../src/files/file-access.service.js';
import { FileBusinessAdapters } from '../src/files/file-business-adapters.js';
import { FilesService } from '../src/files/files.service.js';
import { PermissionService } from '../src/permissions/permission.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { BusinessRecordAdapters } from '../src/records/business-record-adapters.js';
import { CommunicationService } from '../src/records/communication.service.js';
import { assertSafeTestDatabase } from '../scripts/database-env.js';
import { FileError } from '../src/files/file.errors.js';

assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('仅允许隔离测试库');
let app: INestApplication; let prisma: PrismaService; let base = ''; let directory = ''; let png: Buffer;
let storage: FileStorageService; let bindings: FileBindingService; let cleanup: FileCleanupService;
const customers: string[] = []; const employees: string[] = []; const files: string[] = []; const communications: string[] = [];
const order = randomUUID(); let customer: FileAccess; let other: FileAccess; let staff: FileAccess;
const config = { stagedQuota: 100, uploadsPerMinute: 100, cleanupIntervalSeconds: 300 };
const fixtureTable = `files_scope_${randomUUID().replaceAll('-', '')}_test`; let fixtureCreated = false;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'self-ecom-files-db-'));
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG).useValue({ ...loadConfiguration({ ...process.env, LOG_LEVEL: 'silent' }), uploadDir: directory })
    .overrideProvider(OrderAdapters).useValue({onModuleInit(){ /* 文件内核测试以独占归属表覆盖ORDER端口，真实订单文件另有端到端验收。 */ }}).overrideProvider(FILE_CONFIG).useValue(config).compile();
  app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1'); base = await app.getUrl();
  prisma = app.get(PrismaService); storage = app.get(FileStorageService); bindings = app.get(FileBindingService); cleanup = app.get(FileCleanupService);
  customer = await actor('CUSTOMER'); other = await actor('CUSTOMER'); staff = await actor('EMPLOYEE');
  png = await sharp({ create: { width: 20, height: 16, channels: 3, background: '#123456' } }).png().toBuffer();
  // 随机专用测试表提供跨HTTP事务可验证的真实归属；只在shop_test创建并精确删除，生产无此表。
  await prisma.$executeRaw(Prisma.sql`CREATE TABLE ${Prisma.raw(fixtureTable)} (id uuid PRIMARY KEY, customer_id uuid NOT NULL, employee_id uuid NOT NULL)`);
  fixtureCreated = true;
  await prisma.$executeRaw(Prisma.sql`INSERT INTO ${Prisma.raw(fixtureTable)} VALUES (${order}::uuid,${customer.identity.subjectId}::uuid,${staff.identity.subjectId}::uuid)`);
  app.get(BusinessRecordAdapters).registerCommunication({ scopeType: 'ORDER', async lockAndAuthorize(tx, identity, scopeId) {
    const [row] = await tx.$queryRaw<{ customer_id: string; employee_id: string }[]>(Prisma.sql`
      SELECT customer_id,employee_id FROM ${Prisma.raw(fixtureTable)} WHERE id=${scopeId}::uuid FOR UPDATE`);
    if (!row || (identity.subjectType === 'CUSTOMER' ? identity.subjectId !== row.customer_id : identity.subjectId !== row.employee_id)) throw new FileError('FILE_NOT_FOUND');
  } });
});
afterAll(async () => {
  vi.restoreAllMocks();
  if (prisma) {
    if (fixtureCreated && /^files_scope_[a-f0-9]{32}_test$/.test(fixtureTable)) await prisma.$executeRaw(Prisma.sql`DROP TABLE ${Prisma.raw(fixtureTable)}`);
    const where = { OR: [{ uploaderCustomerId: { in: customers } }, { uploaderEmployeeId: { in: employees } }] };
    const owned = await prisma.fileAsset.findMany({ where, select: { id: true } });
    await prisma.fileReference.deleteMany({ where: { fileAssetId: { in: owned.map(row => row.id) } } });
    await prisma.communication.deleteMany({ where: { id: { in: communications } } });
    await prisma.fileAsset.deleteMany({ where });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorCustomerId: { in: customers } }, { actorEmployeeId: { in: employees } }] } });
    await prisma.authSession.deleteMany({ where: { OR: [{ customerId: { in: customers } }, { employeeId: { in: employees } }] } });
    await prisma.customer.deleteMany({ where: { id: { in: customers } } }); await prisma.employee.deleteMany({ where: { id: { in: employees } } });
  }
  await app?.close();
  if (directory && resolve(directory).startsWith(resolve(tmpdir()) + sep) && directory.includes('self-ecom-files-db-')) console.log('保留测试临时目录：' + directory);
});
async function actor(type: 'CUSTOMER' | 'EMPLOYEE'): Promise<FileAccess> {
  const id = randomUUID(); const sid = randomUUID();
  if (type === 'CUSTOMER') {
    customers.push(id); await prisma.customer.create({ data: { id, phone: `136${String(randomInt(100000000)).padStart(8, '0')}`,
      nickname: '文件隔离测试顾客', passwordHash: '只验证真实会话；不提供测试密码登录' } });
  } else {
    employees.push(id); await prisma.employee.create({ data: { id, username: `fi_${id.replaceAll('-', '').slice(0, 20)}`,
      displayName: '文件隔离测试员工', role: 'SUPER_ADMIN', mustChangePassword: false, passwordHash: '只验证真实会话' } });
  }
  const issued = await app.get(JwtTokenService).issue({ subjectType: type, subjectId: id, sessionId: sid, tokenVersion: 0 });
  await prisma.authSession.create({ data: { id: sid, subjectType: type, employeeId: type === 'EMPLOYEE' ? id : null,
    customerId: type === 'CUSTOMER' ? id : null, tokenVersion: 0, createdAt: issued.issuedAt, expiresAt: issued.expiresAt } });
  return { identity: await app.get(CurrentIdentityService).authenticate(prisma, issued.accessToken, type), token: issued.accessToken };
}
function form(purpose = 'CUSTOMER_AVATAR', data = png) {
  const body = new FormData(); body.append('purpose', purpose); body.append('file', new Blob([new Uint8Array(data)]), '../../私密原始名.png'); return body;
}
async function upload(access = customer, body: FormData = form()) {
  const response = await fetch(base + '/api/v1/files', { method: 'POST', headers: { Authorization: `Bearer ${access.token}` }, body });
  const json = await response.json(); if (json.data?.id) files.push(json.data.id);
  return { response, json };
}
async function created(access = customer, purpose: FilePurpose = 'CUSTOMER_AVATAR') {
  const result = await upload(access, form(purpose)); expect(result.response.status, JSON.stringify(result.json)).toBe(201); return result.json.data.id as string;
}
function get(id: string, access?: FileAccess, suffix = '/content') {
  return fetch(`${base}/api/v1/files/${id}${suffix}`, { headers: access ? { Authorization: `Bearer ${access.token}` } : {} });
}
function bind(id: string, access = customer, ownerId = access.identity.subjectId) {
  return prisma.$transaction(tx => bindings.bindFiles(tx, access, { ownerType: 'CUSTOMER_AVATAR', ownerId,
    slot: 'avatar', audience: 'PUBLIC', fileIds: [id], commandKey: randomUUID() }));
}
async function expire(id: string) {
  await prisma.fileAsset.update({ where: { id }, data: { createdAt: new Date(Date.now() - 172800000), expiresAt: new Date(Date.now() - 86400000) } });
}
async function expiringAccess(account: FileAccess) {
  let now = new Date();
  const clock = () => new Date(now);
  const tokens = new JwtTokenService({ secret: 'file-expiry-regression-only-'.repeat(2), ttlSeconds: 60 }, clock);
  const identities = new CurrentIdentityService(tokens, new PermissionService(), clock);
  const sessionId = randomUUID(); const subjectType = account.identity.subjectType; const subjectId = account.identity.subjectId;
  const issued = await tokens.issue({ subjectType, subjectId, sessionId, tokenVersion: account.identity.tokenVersion });
  await prisma.authSession.create({ data: { id: sessionId, subjectType, tokenVersion: account.identity.tokenVersion,
    employeeId: subjectType === 'EMPLOYEE' ? subjectId : null, customerId: subjectType === 'CUSTOMER' ? subjectId : null,
    createdAt: issued.issuedAt, expiresAt: issued.expiresAt } });
  const identity = await identities.authenticate(prisma, issued.accessToken, subjectType);
  return { identities, access: { identity, token: issued.accessToken }, expireToken() { now = new Date(issued.expiresAt); } };
}

it('文件绑定业务锁等待跨过JWT到期后拒绝引用，文件仍为STAGED', async () => {
  const id = await created(); const f = await expiringAccess(customer); const adapters = new FileBusinessAdapters();
  const adapter = adapters.get('CUSTOMER_AVATAR'); const authorize = adapter.authorize.bind(adapter);
  adapter.authorize = async (...args) => { await authorize(...args); f.expireToken(); };
  const service = new FileBindingService(new FileAccessService(f.identities), adapters);
  await expect(prisma.$transaction(tx => service.bindFiles(tx, f.access, { ownerType: 'CUSTOMER_AVATAR',
    ownerId: customer.identity.subjectId, slot: 'avatar', audience: 'PUBLIC', fileIds: [id], commandKey: randomUUID() })))
    .rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
  expect(await prisma.fileReference.count({ where: { fileAssetId: id } })).toBe(0);
  expect((await prisma.fileAsset.findUniqueOrThrow({ where: { id } })).state).toBe('STAGED');
});

it('私有文件业务锁等待跨过JWT到期后拒绝读取元数据', async () => {
  const id = await created(staff, 'COMMUNICATION_EVIDENCE');
  const record = await prisma.$transaction(tx => app.get(CommunicationService).appendCommunication(tx, staff, {
    scopeType: 'ORDER', scopeId: order, channel: 'PHONE', occurredAt: new Date(), result: '内部核对',
    attachments: [{ fileId: id, audience: 'INTERNAL' }], requestId: randomUUID(),
  })); communications.push(record.id);
  const f = await expiringAccess(staff); const adapters = app.get(FileBusinessAdapters);
  const adapter = adapters.get('COMMUNICATION'); const authorize = adapter.authorize.bind(adapter);
  const spy = vi.spyOn(adapter, 'authorize').mockImplementation(async (...args) => { await authorize(...args); f.expireToken(); });
  const service = new FilesService(prisma, new FileAccessService(f.identities), f.identities, adapters, storage, app.get(AuditService), config);
  try { await expect(service.metadata(id, f.access.token)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' }); }
  finally { spy.mockRestore(); }
});

it('上传返回安全元数据、最小审计，STAGED私有且二进制不被JSON包装', async () => {
  const { response, json } = await upload(); expect(response.status).toBe(201); const data = json.data;
  expect(data).toMatchObject({ state: 'STAGED', visibility: 'PRIVATE', width: 20, height: 16, mimeType: 'image/png' });
  for (const field of ['storageKey', 'sha256', 'uploaderCustomerId', 'originalName']) expect(data).not.toHaveProperty(field);
  expect(response.headers.get('x-request-id')).toBe(json.requestId);
  const row = await prisma.fileAsset.findUniqueOrThrow({ where: { id: data.id } });
  expect(row.originalName).toBe('image.png'); expect(row.expiresAt!.getTime() - row.createdAt.getTime()).toBe(86400000);
  expect(await prisma.auditLog.count({ where: { targetId: data.id, action: 'file.upload' } })).toBe(1);
  const content = await get(data.id, customer); expect(content.status).toBe(200);
  expect(content.headers.get('content-type')).toContain('image/png'); expect(content.headers.get('cache-control')).toBe('private, no-store');
  expect(content.headers.get('x-content-type-options')).toBe('nosniff'); expect(content.headers.get('vary')).toContain('Authorization');
  expect(Buffer.from(await content.arrayBuffer())).toEqual(await storage.read(row.storageKey));
  expect((await get(data.id, customer, '')).status).toBe(200);
});
it('匿名、其他顾客及随机ID元数据/内容统一404', async () => {
  const id = await created();
  for (const suffix of ['', '/content']) for (const [file, access] of [[id, undefined], [id, other], [randomUUID(), other]] as const) {
    const response = await get(file, access, suffix); expect(response.status).toBe(404); expect((await response.json()).code).toBe('FILE_NOT_FOUND');
  }
});
it.each(['PRODUCT_IMAGE', 'INVENTORY_EVIDENCE', 'FULFILLMENT_EVIDENCE', 'INSPECTION_EVIDENCE', 'COMMUNICATION_EVIDENCE'])('顾客无权上传%s，不产生记录', async purpose => {
  const before = await prisma.fileAsset.count(); const result = await upload(customer, form(purpose));
  expect(result.response.status).toBe(403); expect(await prisma.fileAsset.count()).toBe(before);
});
it('无token在接收前401；强改密、停用及撤权旧token仍受当前权限约束', async () => {
  expect((await fetch(base + '/api/v1/files', { method: 'POST', body: form() })).status).toBe(401);
  const employee = await actor('EMPLOYEE'); await prisma.employee.update({ where: { id: employee.identity.subjectId }, data: { mustChangePassword: true } });
  expect((await upload(employee, form('PRODUCT_IMAGE'))).json.code).toBe('PASSWORD_CHANGE_REQUIRED');
  await prisma.employee.update({ where: { id: employee.identity.subjectId }, data: { mustChangePassword: false, status: 'DISABLED' } });
  expect((await upload(employee, form('PRODUCT_IMAGE'))).response.status).toBe(401);
  await prisma.employee.update({ where: { id: employee.identity.subjectId }, data: { status: 'ACTIVE', role: 'CUSTOMER_SERVICE' } });
  expect((await upload(employee, form('PRODUCT_IMAGE'))).response.status).toBe(403);
});
it('接收完成后撤销会话，提交前锁内复核拒绝且补偿磁盘文件', async () => {
  const account = await actor('CUSTOMER'); const original = storage.publish.bind(storage);
  const spy = vi.spyOn(storage, 'publish').mockImplementationOnce(async (...args) => {
    const key = await original(...args);
    await prisma.authSession.update({ where: { id: account.identity.sessionId }, data: { revokedAt: new Date(), revokeReason: 'LOGOUT' } }); return key;
  });
  try { const result = await upload(account); expect(result.response.status).toBe(401); expect(result.json.code).toBe('SESSION_REVOKED'); }
  finally { spy.mockRestore(); }
  expect(await prisma.fileAsset.count({ where: { uploaderCustomerId: account.identity.subjectId } })).toBe(0);
});
it('写入完成后撤销商品权限，提交前复核拒绝；交易受限顾客仍可上传售后图', async () => {
  const account = await actor('EMPLOYEE'); const original = storage.publish.bind(storage);
  const spy = vi.spyOn(storage, 'publish').mockImplementationOnce(async (...args) => {
    const key = await original(...args); await prisma.employee.update({ where: { id: account.identity.subjectId }, data: { role: 'CUSTOMER_SERVICE' } }); return key;
  });
  try { expect((await upload(account, form('PRODUCT_IMAGE'))).response.status).toBe(403); } finally { spy.mockRestore(); }
  const restricted = await actor('CUSTOMER'); await prisma.customer.update({ where: { id: restricted.identity.subjectId }, data: { status: 'TRADE_RESTRICTED' } });
  expect((await upload(restricted, form('AFTER_SALE_EVIDENCE'))).response.status).toBe(201);
  await prisma.customer.update({ where: { id: restricted.identity.subjectId }, data: { status: 'LOGIN_FROZEN' } });
  expect((await upload(restricted)).response.status).toBe(401);
});
it('发布磁盘文件失败不创建元数据，临时内容得到补偿', async () => {
  const before = await prisma.fileAsset.count(); const spy = vi.spyOn(storage, 'publish').mockRejectedValueOnce(new Error('模拟rename失败'));
  try { expect((await upload()).response.status).toBe(500); } finally { spy.mockRestore(); }
  expect(await prisma.fileAsset.count()).toBe(before); expect(await readdir(join(directory, 'tmp'))).toEqual([]);
});
it('默认未注册业务拒绝，重复解析器、重复图片及根客户端误传均拒绝', async () => {
  const adapters = new FileBusinessAdapters(); expect(() => adapters.get('PRODUCT')).toThrow('对应业务尚未接入');
  expect(() => adapters.register({ ownerType: 'CUSTOMER_AVATAR', aggregate: async () => '', authorize: async () => {} })).toThrow('不得重复注册');
  const id = await created(); const target = { ownerType: 'CUSTOMER_AVATAR' as const, ownerId: customer.identity.subjectId,
    slot: 'avatar', audience: 'PUBLIC' as const, fileIds: [id, id], commandKey: randomUUID() };
  await expect(prisma.$transaction(tx => bindings.bindFiles(tx, customer, target))).rejects.toMatchObject({ code: 'FILE_INVALID_BINDING' });
  await expect(bindings.bindFiles(prisma, customer, target)).rejects.toThrow('事务客户端');
  expect(app.get(FileAccessService)).toBeInstanceOf(FileAccessService);
});
it.each(['extra', 'double-file', 'file-first', 'empty', 'missing-purpose', 'unknown-purpose', 'duplicate-purpose'])('严格拒绝multipart%s', async mode => {
  let body = form();
  if (mode === 'extra') body.append('visibility', 'PUBLIC');
  if (mode === 'double-file') body.append('file', new Blob([new Uint8Array(png)]), 'second.png');
  if (mode === 'file-first') { body = new FormData(); body.append('file', new Blob([new Uint8Array(png)]), 'x.png'); body.append('purpose', 'CUSTOMER_AVATAR'); }
  if (mode === 'empty') body = form('CUSTOMER_AVATAR', Buffer.alloc(0));
  if (mode === 'missing-purpose') body.delete('purpose');
  if (mode === 'unknown-purpose') body.set('purpose', 'UNKNOWN');
  if (mode === 'duplicate-purpose') body.append('purpose', 'CUSTOMER_AVATAR');
  const result = await upload(customer, body); expect(result.response.status, JSON.stringify(result.json)).toBe(400);
});
it.each([['svg', Buffer.from('<svg/>'), 400], ['corrupt', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 400],
  ['large', Buffer.alloc(5242881), 413]] as const)('HTTP拒绝%s并清理临时文件', async (_mode, data, status) => {
  const before = await prisma.fileAsset.count(); const result = await upload(customer, form('CUSTOMER_AVATAR', data));
  expect(result.response.status).toBe(status); expect(await prisma.fileAsset.count()).toBe(before);
  expect(await readdir(join(directory, 'tmp'))).toEqual([]);
});
it('绑定本人后才匿名公开，重复绑定不重复引用；无通用绑定HTTP路由', async () => {
  const id = await created(); const first = await bind(id); const again = await bind(id);
  expect(again).toEqual(first); const response = await get(id); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('public');
  expect((await get(id, undefined, '')).status).toBe(404); expect((await get(id, other, '')).status).toBe(404);
  expect(await prisma.fileReference.count({ where: { fileAssetId: id } })).toBe(1);
  expect((await fetch(`${base}/api/v1/files/bind`, { method: 'POST' })).status).toBe(404);
});
it('绑定拒绝他人图片、错误用途、过期及未知业务', async () => {
  const id = await created(); await expect(bind(id, other)).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
  const evidence = await created(customer, 'AFTER_SALE_EVIDENCE'); await expect(bind(evidence)).rejects.toMatchObject({ code: 'FILE_PURPOSE_MISMATCH' });
  await expire(id); await expect(bind(id)).rejects.toMatchObject({ code: 'FILE_NOT_BINDABLE' });
  await expect(prisma.$transaction(tx => bindings.bindFiles(tx, staff, { ownerType: 'PRODUCT', ownerId: randomUUID(), slot: 'gallery',
    audience: 'PUBLIC', fileIds: [id], commandKey: randomUUID() }))).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
});
it('审计真实外键故障回滚上传元数据及审计，并补偿最终磁盘文件', async () => {
  const before = await prisma.fileAsset.count(); const objects = await readdir(join(directory, 'objects'));
  const original = app.get(AuditService).appendAudit.bind(app.get(AuditService));
  const spy = vi.spyOn(app.get(AuditService), 'appendAudit').mockImplementationOnce((tx, payload) =>
    original(tx, { ...payload, actor: { type: 'CUSTOMER', id: randomUUID() } }));
  try { expect((await upload()).response.status).toBe(500); } finally { spy.mockRestore(); }
  expect(await prisma.fileAsset.count()).toBe(before); expect(await readdir(join(directory, 'objects'))).toEqual(objects);
});
it('有权但磁盘丢失503，无权仍404', async () => {
  const id = await created(); const row = await prisma.fileAsset.findUniqueOrThrow({ where: { id } }); await storage.remove(row.storageKey);
  expect((await get(id, other)).status).toBe(404); const response = await get(id, customer);
  expect(response.status).toBe(503); expect((await response.json()).code).toBe('FILE_STORAGE_UNAVAILABLE');
});
it('清理只处理过期无引用文件，磁盘失败保留PURGE_PENDING且可重试', async () => {
  const retained = await created(); await bind(retained); const expired = await created(); await expire(expired);
  const spy = vi.spyOn(storage, 'remove').mockRejectedValue(new Error('模拟磁盘删除失败'));
  try { await cleanup.runBatch(100); } finally { spy.mockRestore(); }
  expect((await prisma.fileAsset.findUniqueOrThrow({ where: { id: expired } })).state).toBe('PURGE_PENDING');
  await expect(bind(expired)).rejects.toMatchObject({ code: 'FILE_NOT_BINDABLE' });
  await cleanup.runBatch(100); expect((await prisma.fileAsset.findUniqueOrThrow({ where: { id: expired } })).state).toBe('PURGED');
  expect((await get(retained)).status).toBe(200); expect((await get(expired, customer)).status).toBe(404);
});
it('两个并发上传竞争最后一个配额，数据库主体锁保证只有一个201', async () => {
  const account = await actor('CUSTOMER'); config.stagedQuota = 1;
  try { const results = await Promise.all([upload(account), upload(account)]); expect(results.map(r => r.response.status).sort()).toEqual([201, 429]); }
  finally { config.stagedQuota = 100; }
  expect(await prisma.fileAsset.count({ where: { uploaderCustomerId: account.identity.subjectId, state: 'STAGED' } })).toBe(1);
});
function barrier() {
  let signal!: () => void; let release!: () => void;
  return { ready: new Promise<void>(resolve => { signal = resolve; }), hold: new Promise<void>(resolve => { release = resolve; }),
    signal: () => signal(), release: () => release() };
}
it('绑定先取得文件锁且跨过到期时刻，清理跳过在用文件，提交后保持RETAINED', async () => {
  const id = await created(); const expiresAt = new Date(Date.now() + 1500);
  await prisma.fileAsset.update({ where: { id }, data: { expiresAt } }); const gate = barrier();
  const pending = prisma.$transaction(async tx => {
    await bindings.bindFiles(tx, customer, { ownerType: 'CUSTOMER_AVATAR', ownerId: customer.identity.subjectId,
      slot: 'avatar', audience: 'PUBLIC', fileIds: [id], commandKey: randomUUID() }); gate.signal(); await gate.hold;
  }, { timeout: 10000 });
  try {
    await Promise.race([gate.ready, pending.then(() => { throw new Error('绑定未进入锁屏障'); })]);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 30)));
    await cleanup.runBatch(100); gate.release(); await pending;
    expect((await prisma.fileAsset.findUniqueOrThrow({ where: { id } })).state).toBe('RETAINED'); expect((await get(id)).status).toBe(200);
  } finally { gate.release(); await pending; }
});
it('清理先提交PURGE_PENDING，绑定等待清理锁后拒绝，不会出现成功引用但磁盘被删', async () => {
  const id = await created(); await expire(id); const key = (await prisma.fileAsset.findUniqueOrThrow({ where: { id } })).storageKey;
  const gate = barrier(); const original = storage.remove.bind(storage);
  const spy = vi.spyOn(storage, 'remove').mockImplementation(async candidate => {
    if (candidate === key) { gate.signal(); await gate.hold; } await original(candidate);
  });
  const cleaning = cleanup.runBatch(100); let binding: Promise<unknown> | undefined;
  try {
    await Promise.race([gate.ready, cleaning.then(() => { throw new Error('清理未进入磁盘屏障'); })]);
    expect((await prisma.fileAsset.findUniqueOrThrow({ where: { id } })).state).toBe('PURGE_PENDING');
    binding = bind(id); const assertion = expect(binding).rejects.toMatchObject({ code: 'FILE_NOT_BINDABLE' });
    gate.release(); await cleaning; await assertion;
    expect(await prisma.fileReference.count({ where: { fileAssetId: id } })).toBe(0);
  } finally { gate.release(); await Promise.allSettled([cleaning, ...(binding ? [binding] : [])]); spy.mockRestore(); }
});
it('两个并发清理批次不会误改历史引用或重复破坏状态', async () => {
  const id = await created(); await expire(id); await Promise.all([cleanup.runBatch(100), cleanup.runBatch(100)]);
  expect((await prisma.fileAsset.findUniqueOrThrow({ where: { id } })).state).toBe('PURGED');
});
it('每主体限流返回Retry-After，另一主体仍可上传', async () => {
  const account = await actor('CUSTOMER'); config.uploadsPerMinute = 1;
  try { expect((await upload(account)).response.status).toBe(201); const denied = await upload(account);
    expect(denied.response.status).toBe(429); expect(Number(denied.response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await upload(await actor('CUSTOMER'))).response.status).toBe(201);
  } finally { config.uploadsPerMinute = 100; }
});
it('沟通附件与记录/审计同事务，公开投影只含顾客可见附件，绑定后不凭上传人放行', async () => {
  const visible = await created(staff, 'COMMUNICATION_EVIDENCE'); const internal = await created(staff, 'COMMUNICATION_EVIDENCE');
  const record = await prisma.$transaction(tx => app.get(CommunicationService).appendCommunication(tx, staff, {
    scopeType: 'ORDER', scopeId: order, channel: 'PHONE', occurredAt: new Date(), result: '内部服装核对', publicText: '已确认尺码',
    attachments: [{ fileId: visible, audience: 'CUSTOMER_VISIBLE' }, { fileId: internal, audience: 'INTERNAL' }], requestId: randomUUID(),
  })); communications.push(record.id);
  const projection = await prisma.$transaction(tx => app.get(CommunicationService).readPublicCommunication(tx, customer, { scopeType: 'ORDER', scopeId: order }));
  expect(projection.items[0]?.attachments.map(item => item.fileId)).toEqual([visible]);
  expect((await get(visible, customer)).status).toBe(200); expect((await get(internal, customer)).status).toBe(404);
  await prisma.employee.update({ where: { id: staff.identity.subjectId }, data: { role: 'MERCH_WAREHOUSE' } });
  expect((await get(internal, staff)).status).toBe(404); await prisma.employee.update({ where: { id: staff.identity.subjectId }, data: { role: 'SUPER_ADMIN' } });
});
it('沟通附件审计失败后记录、引用与文件状态全部回滚', async () => {
  const id = await created(staff, 'COMMUNICATION_EVIDENCE'); const requestId = randomUUID();
  const spy = vi.spyOn(app.get(AuditService), 'appendAudit').mockRejectedValue(new Error('模拟附件后审计失败'));
  try {
    await expect(prisma.$transaction(tx => app.get(CommunicationService).appendCommunication(tx, staff, {
      scopeType: 'ORDER', scopeId: order, channel: 'PHONE', occurredAt: new Date(), result: '内部结果',
      attachments: [{ fileId: id, audience: 'INTERNAL' }], requestId,
    }))).rejects.toThrow('模拟附件后审计失败');
  } finally { spy.mockRestore(); }
  expect(await prisma.communication.count({ where: { requestId } })).toBe(0);
  expect(await prisma.fileReference.count({ where: { fileAssetId: id } })).toBe(0);
  expect((await prisma.fileAsset.findUniqueOrThrow({ where: { id } })).state).toBe('STAGED');
});
it('同聚合可复用历史图，跨真实业务聚合拒绝；换audience不能改写已有可见范围', async () => {
  const id = await created(staff, 'COMMUNICATION_EVIDENCE'); const service = app.get(CommunicationService);
  const append = (scopeId: string) => prisma.$transaction(tx => service.appendCommunication(tx, staff, {
    scopeType: 'ORDER', scopeId, channel: 'PHONE', occurredAt: new Date(), result: '核实服装尺码', publicText: '已核实',
    attachments: [{ fileId: id, audience: 'CUSTOMER_VISIBLE' }], requestId: randomUUID(),
  }));
  const first = await append(order); communications.push(first.id); const second = await append(order); communications.push(second.id);
  expect(await prisma.fileReference.count({ where: { fileAssetId: id } })).toBe(2);
  const secondOrder = randomUUID();
  await prisma.$executeRaw(Prisma.sql`INSERT INTO ${Prisma.raw(fixtureTable)} VALUES (${secondOrder}::uuid,${customer.identity.subjectId}::uuid,${staff.identity.subjectId}::uuid)`);
  await expect(append(secondOrder)).rejects.toMatchObject({ code: 'FILE_NOT_BINDABLE' });
  await expect(prisma.$transaction(tx => bindings.bindFiles(tx, staff, { ownerType: 'COMMUNICATION', ownerId: first.id,
    slot: 'evidence', audience: 'INTERNAL', fileIds: [id], commandKey: randomUUID() }))).rejects.toMatchObject({ code: 'FILE_NOT_BINDABLE' });
  expect((await get(id, other)).status).toBe(404);
});
it('公开说明为空、重复或超过5张的沟通附件在写入前拒绝', async () => {
  const id = await created(staff, 'COMMUNICATION_EVIDENCE');
  const invalid = [ { publicText: null, attachments: [{ fileId: id, audience: 'CUSTOMER_VISIBLE' as const }] },
    { publicText: '公开说明', attachments: [{ fileId: id, audience: 'INTERNAL' as const }, { fileId: id, audience: 'CUSTOMER_VISIBLE' as const }] },
    { publicText: null, attachments: Array.from({ length: 6 }, () => ({ fileId: randomUUID(), audience: 'INTERNAL' as const })) } ];
  for (const changes of invalid) await expect(prisma.$transaction(tx => app.get(CommunicationService).appendCommunication(tx, staff, {
    scopeType: 'ORDER', scopeId: order, channel: 'PHONE', occurredAt: new Date(), result: '结果', requestId: randomUUID(), ...changes,
  }))).rejects.toMatchObject({ code: 'RECORD_INPUT_INVALID' });
  expect(await prisma.fileReference.count({ where: { fileAssetId: id } })).toBe(0);
});
it('48小时孤儿扫描只删无元数据旧普通文件，保留已登记文件和新临时文件', async () => {
  const id = await created(); const row = await prisma.fileAsset.findUniqueOrThrow({ where: { id } });
  const orphan = await storage.temporary(); await orphan.handle.writeFile('old'); await orphan.handle.close();
  const fresh = await storage.temporary(); await fresh.handle.writeFile('fresh'); await fresh.handle.close();
  const old = new Date(Date.now() - 259200000); await utimes(orphan.path, old, old); await utimes(join(directory, row.storageKey), old, old);
  await cleanup.runBatch(100); await expect(storage.read(orphan.key)).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await storage.read(fresh.key)).toString()).toBe('fresh'); expect((await get(id, customer)).status).toBe(200); await storage.remove(fresh.key);
});
