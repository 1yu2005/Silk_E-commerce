// 作用：使用真实编译产物核验延期DTO和默认空业务注册表；所有写入只在本轮自建专属库中。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
const api = resolve('apps/api'); const require = createRequire(resolve(api, 'package.json')); const directory = 'docs/verification/evidence/M0-04/step09';
assert.ok(!existsSync(`${directory}/compiled-smoke.json`), '不得覆盖烟测记录');
const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env }; const dev = new URL(env.DATABASE_URL); const test = new URL(env.TEST_DATABASE_URL);
assert.notEqual(dev.pathname, test.pathname); assert.match(test.pathname, /^\/[a-z][a-z0-9_]*_test$/); assert.equal(dev.hostname, test.hostname); assert.equal(dev.port, test.port);
assert.ok(['localhost', '127.0.0.1'].includes(test.hostname));
const name = `task_kernel_${randomUUID().replaceAll('-', '')}_test`; assert.match(name, /^task_kernel_[a-f0-9]{32}_test$/);
const target = new URL(test); target.pathname = '/' + name; const server = new URL(test); server.pathname = '/postgres';
const { Client } = require('pg'); const admin = new Client({ connectionString: server.toString() });
require('reflect-metadata'); const { Test } = require('@nestjs/testing');
const { AppModule } = require(resolve(api, 'dist/app.module.js')); const { configureApp } = require(resolve(api, 'dist/common/configure-app.js'));
const { APP_CONFIG, loadConfiguration } = require(resolve(api, 'dist/config/environment.js'));
const { PrismaService } = require(resolve(api, 'dist/prisma/prisma.service.js')); const { AuthSessionService } = require(resolve(api, 'dist/auth/auth-session.service.js'));
const { TaskOverdueScanService } = require(resolve(api, 'dist/tasks/task-overdue-scan.service.js'));
const { OrderTimerRepositories } = require(resolve(api, 'dist/tasks/order-timer.service.js'));
const { PasswordService } = require(resolve(api, 'dist/auth/password.service.js')); const { TaskBusinessAdapters } = require(resolve(api, 'dist/tasks/task-business-adapters.js'));
let created = false; let app; const report = { checkedAt: new Date().toISOString(), compiledMetadata: true, isolatedDatabase: true, cases: [] };
try {
  await admin.connect(); await admin.query(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`); created = true;
  const migrated = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], { cwd: api, env: { ...env, DATABASE_URL: target.toString() },
    windowsHide: true, encoding: 'utf8', timeout: 60_000 }); report.migrateExitCode = migrated.status; assert.equal(migrated.status, 0);
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(APP_CONFIG).useValue(loadConfiguration({ ...env,
    NODE_ENV: 'test', DATABASE_URL: target.toString(), LOG_LEVEL: 'silent', SWAGGER_ENABLED: 'true' })).compile();
  app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1'); const base = (await app.getUrl()) + '/api/v1';
  const prisma = app.get(PrismaService); const registry = app.get(TaskBusinessAdapters); assert.equal(registry.accessEntries().length, 0);
  for (const type of ['ORDER', 'AFTER_SALE', 'INVENTORY_ADJUSTMENT', 'OFFLINE_CASE', 'CUSTODY_ARRANGEMENT']) {
    assert.equal(registry.getDeadline(type), undefined); assert.equal(registry.getSources(type), undefined);
    assert.throws(() => registry.requireLifecycle(type), { code: 'BUSINESS_MODULE_NOT_READY' });
    assert.throws(() => registry.requireSources(type), { code: 'BUSINESS_MODULE_NOT_READY' });
    assert.throws(() => registry.requireDeadline(type), { code: 'BUSINESS_MODULE_NOT_READY' });
  }
  assert.throws(() => app.get(OrderTimerRepositories).require(), { code: 'BUSINESS_MODULE_NOT_READY' });
  const emptyScan = await app.get(TaskOverdueScanService).scan(); assert.equal(emptyScan.status, 'SUCCEEDED'); assert.equal(emptyScan.scannedCount, 0);
  const passwordHash = await new PasswordService().hash('CompiledTaskDeadline#2026');
  const employee = await prisma.employee.create({ data: { username: 'compiled_task_deadline', displayName: '隔离编译期限烟测员工', role: 'SUPER_ADMIN', mustChangePassword: false, passwordHash } });
  const session = await prisma.$transaction(tx => app.get(AuthSessionService).createAfterPasswordVerified(tx, { subjectId: employee.id, subjectType: 'EMPLOYEE', expectedPasswordHash: passwordHash, expectedTokenVersion: 0 }));
  // 无真实业务来源的元数据只用于证明：管理员和任务表行不能替代真实业务接入。
  const businessId = randomUUID(); const cursor = await prisma.taskStageCursor.create({ data: { businessType: 'ORDER', businessId, stage: 'SHIPMENT_PROCESS', lastRound: 1 } });
  const orphan = await prisma.task.create({ data: { cursorId: cursor.id, businessType: 'ORDER', businessId, stage: 'SHIPMENT_PROCESS', round: 1,
    entryKey: 'isolated-orphan', requiredPermissions: ['order.fulfillment.read', 'shipment.claim', 'shipment.pack', 'shipment.handover'], startedAt: new Date(Date.now() - 7200_000), dueAt: new Date(Date.now() - 3600_000), ruleSnapshot: {} } });
  async function request(path, status, body) {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); const result = await response.json(); assert.equal(response.status, status);
    assert.equal(result.requestId, response.headers.get('x-request-id')); report.cases.push({ path, status, requestId: result.requestId, ...(result.code ? { code: result.code } : {}) }); return result;
  }
  assert.deepEqual((await request('/admin/tasks?view=pool', 200)).data, { items: [], total: 0, page: 1, pageSize: 20 });
  await request(`/admin/tasks/${orphan.id}`, 404);
  const path = `/admin/tasks/${orphan.id}/extend-deadline`;
  const body = { expectedVersion: 0, reason: '不能给孤立任务延期', newDueAt: new Date(Date.now() + 86400_000).toISOString() };
  assert.equal((await request(path, 404, body)).code, 'TASK_NOT_FOUND');
  assert.equal((await request(path, 404, { ...body, newDueAt: body.newDueAt.replace(/\.\d{3}Z$/, 'Z') })).code, 'TASK_NOT_FOUND');
  for (const newDueAt of ['2026-02-30T02:00:00Z', '2026-11-20T02:00:00', '2026-11-20T10:00:00+08:00', '2026-11-20T02:00:00.0001Z', null, 1795130400000]) {
    await request(path, 400, { ...body, newDueAt });
  }
  await request(path, 400, { expectedVersion: 0, reason: '截止必填' });
  await request(path, 400, { ...body, dueAt: body.newDueAt });
  await request(path, 400, { ...body, originalDueAt: body.newDueAt });
  await request(path, 400, { ...body, expectedVersion: '0' });
  await request(path, 400, { ...body, reason: ' ' });
  assert.equal(await prisma.auditLog.count(), 0); assert.equal(await prisma.taskHistory.count(), 0); assert.equal(await prisma.deadlineEvent.count(), 0);
  const missingDomainScan = await app.get(TaskOverdueScanService).scan(); assert.equal(missingDomainScan.status, 'FAILED'); assert.equal(missingDomainScan.failedCount, 1);
  assert.equal((await prisma.schedulerFailure.findFirstOrThrow()).errorCode, 'BUSINESS_MODULE_NOT_READY');
  report.emptyScanSucceeded = true; report.missingBusinessScanRefused = true;
  assert.deepEqual(await prisma.task.findUniqueOrThrow({ where: { id: orphan.id } }), orphan);
  const response = await fetch((await app.getUrl()) + '/api/docs-json'); assert.equal(response.status, 200); const spec = await response.json();
  report.operations = Object.values(spec.paths).reduce((count, item) => count + Object.keys(item).filter(key => ['get', 'post', 'put', 'patch', 'delete'].includes(key)).length, 0);
  assert.equal(report.operations, 40); assert.equal(spec.paths['/api/v1/admin/tasks/{id}/extend-deadline'].post.operationId, 'extendTaskDeadline');
  report.productionDeadlineAdaptersEmpty = true; report.orphanTaskHiddenAndImmutable = true; report.noAuditHistoryOrDeadlineWrites = true; report.passed = true;
} finally {
  await app?.close(); try { if (created) { await admin.query(`DROP DATABASE "${name}"`); report.databaseRemoved = true; } } finally { await admin.end(); }
  writeFileSync(`${directory}/compiled-smoke.json`, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report));
