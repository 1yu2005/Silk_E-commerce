// 作用：使用tsc产物与本轮独占数据库验证真实装饰器元数据，不补写测试元数据或连接开发库。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
const root = process.cwd(); const api = resolve(root, 'apps/api'); const require = createRequire(resolve(api, 'package.json'));
const directory = resolve(root, 'docs/verification/evidence/M0-04/step03');
assert.ok(!existsSync(resolve(directory, 'compiled-smoke.json')), '不能覆盖烟测记录');
const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env };
const dev = new URL(env.DATABASE_URL); const test = new URL(env.TEST_DATABASE_URL);
assert.notEqual(dev.pathname, test.pathname); assert.match(test.pathname, /^\/[a-z][a-z0-9_]*_test$/);
assert.equal(dev.hostname, test.hostname); assert.equal(dev.port, test.port);
const name = `settings_smoke_${randomUUID().replaceAll('-', '')}_test`; assert.match(name, /^settings_smoke_[a-f0-9]{32}_test$/);
const url = new URL(test); url.pathname = '/' + name;
const adminUrl = new URL(test); adminUrl.pathname = '/postgres';
const { Client } = require('pg'); const admin = new Client({ connectionString: adminUrl.toString() });
require('reflect-metadata'); const { Test } = require('@nestjs/testing');
const { AppModule } = require(resolve(api, 'dist/app.module.js'));
const { configureApp } = require(resolve(api, 'dist/common/configure-app.js'));
const { APP_CONFIG, loadConfiguration } = require(resolve(api, 'dist/config/environment.js'));
const { PrismaService } = require(resolve(api, 'dist/prisma/prisma.service.js'));
const { AuthSessionService } = require(resolve(api, 'dist/auth/auth-session.service.js'));
const { PasswordService } = require(resolve(api, 'dist/auth/password.service.js'));
let created = false; let app;
const report = { checkedAt: new Date().toISOString(), compiledMetadata: true, isolatedDatabase: true, cases: [] };
try {
  await admin.connect(); await admin.query(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`); created = true;
  const migrated = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
    { cwd: api, env: { ...env, DATABASE_URL: url.toString() }, windowsHide: true, encoding: 'utf8', timeout: 60_000 });
  report.migrateExitCode = migrated.status; assert.equal(migrated.status, 0);
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(APP_CONFIG).useValue(loadConfiguration({
    ...env, NODE_ENV: 'test', DATABASE_URL: url.toString(), LOG_LEVEL: 'silent', JWT_SECRET: 'compiled-settings-smoke-only-key-2026-0000',
  })).compile();
  app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1'); const baseUrl = await app.getUrl();
  const prisma = app.get(PrismaService); const hash = await new PasswordService().hash('CompiledSettings#2026');
  const actor = await prisma.employee.create({ data: { username: 'compiled_settings', displayName: '编译烟测管理员',
    role: 'SUPER_ADMIN', mustChangePassword: false, passwordHash: hash } });
  const session = await prisma.$transaction(tx => app.get(AuthSessionService).createAfterPasswordVerified(tx, {
    subjectType: 'EMPLOYEE', subjectId: actor.id, expectedPasswordHash: hash, expectedTokenVersion: 0,
  }));
  const body = { expectedVersion: 0, reason: '隔离编译烟测', shippingFeeCents: 0, freeShippingEnabled: false, freeShippingThresholdCents: 0,
    returnAddress: { receiver: '虚构收件人', phone: '010-00000000', province: '虚构省', city: '虚构市', district: '虚构区', detail: '仅隔离烟测使用' },
    serviceContact: { phone: '010-00000000' }, deadlines: { paymentMinutes: 30, autoReceiptDays: 10, afterSaleWindowDays: 7,
      reviewWorkdays: 2, supplementDays: 7, returnShipDays: 7, inspectionWorkdays: 2, refundWorkdays: 1 } };
  async function request(path, input, expected, token = session.accessToken) {
    const response = await fetch(baseUrl + '/api/v1' + path, { method: input === undefined ? 'GET' : 'PUT',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    const data = await response.json(); assert.equal(response.status, expected);
    assert.equal(data.requestId, response.headers.get('x-request-id'));
    report.cases.push({ path, method: input === undefined ? 'GET' : 'PUT', status: response.status,
      requestId: data.requestId, ...(data.code ? { code: data.code } : {}) }); return data;
  }
  await request('/admin/settings', { ...body, freeShippingEnabled: 'false' }, 400);
  await request('/admin/settings', { ...body, returnAddress: { ...body.returnAddress, arbitrary: true } }, 400);
  await request('/admin/settings', { ...body, deadlines: { ...body.deadlines, reviewWorkdays: 0 } }, 400);
  const first = await request('/admin/settings', body, 200); assert.equal(first.data.version, 1);
  const same = await request('/admin/settings', { ...body, expectedVersion: 1 }, 200); assert.equal(same.data.changed, false);
  await request('/admin/settings', body, 409);
  const contact = await request('/store/contact', undefined, 200, null);
  assert.deepEqual(contact.data, { configured: true, servicePhone: '01000000000', serviceHours: null, settingsVersion: 1 });
  await request('/admin/settings/versions/' + first.data.settingVersionId, undefined, 200);
  const page = await request('/admin/settings/versions?page=1&pageSize=1', undefined, 200); assert.equal(page.data.total, 1);
  const openapi = await fetch(baseUrl + '/api/docs-json'); const spec = await openapi.json();
  report.operations = Object.values(spec.paths).reduce((count, item) => count + Object.keys(item).filter(key => ['get', 'post', 'put', 'patch', 'delete'].includes(key)).length, 0);
  assert.equal(report.operations, 32); report.passed = true;
} finally {
  await app?.close();
  try { if (created) { await admin.query(`DROP DATABASE "${name}"`); report.databaseRemoved = true; } }
  finally { await admin.end(); }
  writeFileSync(resolve(directory, 'compiled-smoke.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report));
