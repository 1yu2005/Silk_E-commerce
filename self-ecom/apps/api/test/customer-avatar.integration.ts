// 作用：以真实上传、当前会话和数据库验证头像闭环、越权拒绝、失败回滚与并发历史保留。
import 'reflect-metadata';
import { randomInt, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import { beforeAll, afterAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { CustomerAvatarController } from '../src/auth/customer-avatar.controller.js';
import { CustomerAvatarDto } from '../src/auth/customer-avatar.dto.js';
import { JwtTokenService } from '../src/auth/jwt-token.service.js';
import { PasswordService } from '../src/auth/password.service.js';
import { AuditService } from '../src/audit/audit.service.js';
import { FileBindingService } from '../src/files/file-binding.service.js';
import { APP_CONFIG, loadConfiguration } from '../src/config/environment.js';
import { configureApp } from '../src/common/configure-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { assertSafeTestDatabase } from '../scripts/database-env.js';

assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('仅允许隔离测试库');
Reflect.defineMetadata('design:paramtypes', [CustomerAvatarDto, Object, Object], CustomerAvatarController.prototype, 'set');
let app: INestApplication; let prisma: PrismaService; let base = ''; let directory = ''; let png: Buffer; let passwordHash = '';
const ids: string[] = []; let account: { id: string; token: string; phone: string }; let other: typeof account;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'self-ecom-avatar-'));
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(APP_CONFIG)
    .useValue({ ...loadConfiguration({ ...process.env, LOG_LEVEL: 'silent' }), uploadDir: directory }).compile();
  app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1'); prisma = app.get(PrismaService); base = await app.getUrl();
  passwordHash = await app.get(PasswordService).hash('AvatarTesting#2026');
  png = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#54878a' } }).png().toBuffer();
});
beforeEach(async () => { account = await customer(); other = await customer(); });
afterEach(async () => {
  vi.restoreAllMocks(); await prisma.customer.updateMany({ where: { id: { in: ids } }, data: { avatarAssetId: null } });
  const files = await prisma.fileAsset.findMany({ where: { uploaderCustomerId: { in: ids } }, select: { id: true } });
  await prisma.fileReference.deleteMany({ where: { fileAssetId: { in: files.map(row => row.id) } } });
  await prisma.fileAsset.deleteMany({ where: { id: { in: files.map(row => row.id) } } });
  await prisma.auditLog.deleteMany({ where: { actorCustomerId: { in: ids } } }); await prisma.authSession.deleteMany({ where: { customerId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { id: { in: ids } } }); ids.length = 0;
});
afterAll(async () => {
  await app?.close(); if (directory && resolve(directory).startsWith(resolve(tmpdir()) + sep) && directory.includes('self-ecom-avatar-')) await rm(directory, { recursive: true, force: true });
});
async function customer() {
  const id = randomUUID(); ids.push(id); const phone = `135${String(randomInt(100000000)).padStart(8, '0')}`;
  await prisma.customer.create({ data: { id, phone, nickname: '头像隔离顾客', passwordHash } }); const sessionId = randomUUID();
  const issued = await app.get(JwtTokenService).issue({ subjectType: 'CUSTOMER', subjectId: id, sessionId, tokenVersion: 0 });
  await prisma.authSession.create({ data: { id: sessionId, subjectType: 'CUSTOMER', customerId: id, tokenVersion: 0, createdAt: issued.issuedAt, expiresAt: issued.expiresAt } });
  return { id, phone, token: issued.accessToken };
}
async function upload(target = account, purpose = 'CUSTOMER_AVATAR') {
  const body = new FormData(); body.append('purpose', purpose); body.append('file', new Blob([new Uint8Array(png)]), 'avatar.png');
  const response = await fetch(base + '/api/v1/files', { method: 'POST', headers: { Authorization: `Bearer ${target.token}` }, body });
  expect(response.status).toBe(201); return (await response.json()).data.id as string;
}
const request = (method: string, path: string, target = account, body?: unknown) => fetch(base + '/api/v1' + path, {
  method, headers: { Authorization: `Bearer ${target.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const set = (id: string, target = account) => request('PUT', '/store/me/avatar', target, { fileId: id });
it('上传后设置头像、本人资料与真实密码登录均返回真实URL，重复设置无额外审计或引用', async () => {
  const id = await upload(); const response = await set(id); expect(response.status).toBe(200); const result = await response.json();
  expect(result.data).toEqual({ avatarAssetId: id, avatarUrl: `/api/v1/files/${id}/content`, changed: true });
  expect((await (await request('GET', '/store/me')).json()).data.avatarUrl).toBe(result.data.avatarUrl);
  const login = await fetch(base + '/api/v1/store/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: account.phone, password: 'AvatarTesting#2026' }) });
  expect(login.status).toBe(200); expect((await login.json()).data.customer.avatarUrl).toBe(result.data.avatarUrl);
  expect((await (await set(id.toUpperCase())).json()).data.changed).toBe(false);
  expect(await prisma.fileReference.count({ where: { fileAssetId: id } })).toBe(1);
  expect(await prisma.auditLog.count({ where: { actorCustomerId: account.id, action: 'customer.avatar.change' } })).toBe(1);
  expect((await fetch(base + result.data.avatarUrl)).status).toBe(200);
});
it('昵称修改与同名响应均保留当前头像且不暴露内部关系', async () => {
  const id = await upload(); await set(id);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await (await request('PATCH', '/store/me', account, { nickname: '新的服装顾客' })).json();
    expect(result.data.avatarUrl).toBe(`/api/v1/files/${id}/content`); expect(result.data).not.toHaveProperty('avatarAsset'); expect(result.data).not.toHaveProperty('avatarAssetId');
  }
});
it('更换和移除保留历史图片，重复移除不重复审计', async () => {
  const first = await upload(); const second = await upload(); await set(first); await set(second);
  expect((await request('DELETE', '/store/me/avatar')).status).toBe(200);
  expect((await (await request('DELETE', '/store/me/avatar')).json()).data).toEqual({ avatarAssetId: null, avatarUrl: null, changed: false });
  expect((await (await request('GET', '/store/me')).json()).data.avatarUrl).toBeNull();
  for (const id of [first, second]) {
    expect((await fetch(`${base}/api/v1/files/${id}/content`)).status).toBe(200);
    expect(await prisma.fileReference.count({ where: { fileAssetId: id } })).toBe(1);
  }
  expect(await prisma.auditLog.count({ where: { actorCustomerId: account.id, action: 'customer.avatar.change' } })).toBe(3);
});
it('他人文件404、错误用途409、过期409及非法字段400均不改变当前头像', async () => {
  const previous = await upload(); await set(previous); const foreign = await upload(other); const evidence = await upload(account, 'AFTER_SALE_EVIDENCE'); const expired = await upload();
  await prisma.fileAsset.update({ where: { id: expired }, data: { createdAt: new Date(Date.now() - 172800000), expiresAt: new Date(Date.now() - 86400000) } });
  expect((await set(foreign)).status).toBe(404); expect((await set(evidence)).status).toBe(409); expect((await set(expired)).status).toBe(409);
  for (const body of [{ fileId: previous, customerId: other.id }, { avatarUrl: 'https://invalid/image' }, { fileId: 'invalid' }]) expect((await request('PUT', '/store/me/avatar', account, body)).status).toBe(400);
  expect((await request('DELETE', '/store/me/avatar', account, { fileId: previous })).status).toBe(400);
  expect((await prisma.customer.findUniqueOrThrow({ where: { id: account.id } })).avatarAssetId).toBe(previous);
});
it.each(['binding', 'audit'])('%s失败整体回滚当前头像、引用、文件状态及审计', async phase => {
  const id = await upload();
  if (phase === 'binding') {
    const original = app.get(FileBindingService).bindFiles.bind(app.get(FileBindingService));
    vi.spyOn(app.get(FileBindingService), 'bindFiles').mockImplementationOnce(async (...args) => { await original(...args); throw new Error('插引用后故障'); });
  } else {
    const original = app.get(AuditService).appendAudit.bind(app.get(AuditService));
    vi.spyOn(app.get(AuditService), 'appendAudit').mockImplementationOnce(async (...args) => { await original(...args); throw new Error('审计后故障'); });
  }
  expect((await set(id)).status).toBe(500);
  expect((await prisma.customer.findUniqueOrThrow({ where: { id: account.id } })).avatarAssetId).toBeNull();
  expect(await prisma.fileReference.count({ where: { fileAssetId: id } })).toBe(0);
  expect((await prisma.fileAsset.findUniqueOrThrow({ where: { id } })).state).toBe('STAGED');
  expect(await prisma.auditLog.count({ where: { actorCustomerId: account.id, action: 'customer.avatar.change' } })).toBe(0);
});
it('交易受限允许本人设置，冻结或撤销会话旧token被拒绝；匿名与员工登录域不能调用', async () => {
  const id = await upload(); await prisma.customer.update({ where: { id: account.id }, data: { status: 'TRADE_RESTRICTED' } }); expect((await set(id)).status).toBe(200);
  await prisma.customer.update({ where: { id: account.id }, data: { status: 'LOGIN_FROZEN' } }); expect((await request('DELETE', '/store/me/avatar')).status).toBe(401);
  await prisma.authSession.updateMany({ where: { customerId: other.id }, data: { revokedAt: new Date(), revokeReason: 'LOGOUT' } }); expect((await set(id, other)).status).toBe(401);
  expect((await fetch(base + '/api/v1/store/me/avatar', { method: 'DELETE' })).status).toBe(401);
  const employee = await app.get(JwtTokenService).issue({ subjectType: 'EMPLOYEE', subjectId: randomUUID(), sessionId: randomUUID(), tokenVersion: 0 });
  expect((await request('DELETE', '/store/me/avatar', { ...account, token: employee.accessToken })).status).toBe(401);
});
it('两个并发头像命令按顾客锁串行，各自历史保留且当前指针只指向一个合法图片', async () => {
  const first = await upload(); const second = await upload(); const responses = await Promise.all([set(first), set(second)]);
  expect(responses.map(item => item.status)).toEqual([200, 200]); const current = await prisma.customer.findUniqueOrThrow({ where: { id: account.id } });
  expect([first, second]).toContain(current.avatarAssetId);
  expect(await prisma.fileReference.count({ where: { ownerType: 'CUSTOMER_AVATAR', ownerId: account.id } })).toBe(2);
  expect(await prisma.auditLog.count({ where: { actorCustomerId: account.id, action: 'customer.avatar.change' } })).toBe(2);
});
