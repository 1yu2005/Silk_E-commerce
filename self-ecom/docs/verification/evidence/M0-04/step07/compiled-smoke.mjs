// 作用：用真实编译产物和默认空业务注册表验证七个任务接口边界；仅在自建专属库创建测试元数据与账号。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
const api = resolve('apps/api'); const require = createRequire(resolve(api, 'package.json')); const directory = 'docs/verification/evidence/M0-04/step07';
assert.ok(!existsSync(`${directory}/compiled-smoke.json`), '不得覆盖烟测记录');
const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env }; const dev = new URL(env.DATABASE_URL); const test = new URL(env.TEST_DATABASE_URL);
assert.notEqual(dev.pathname, test.pathname); assert.match(test.pathname, /^\/[a-z][a-z0-9_]*_test$/); assert.equal(dev.hostname, test.hostname); assert.equal(dev.port, test.port);
assert.ok(['localhost', '127.0.0.1'].includes(test.hostname));
const name = `task_reassign_${randomUUID().replaceAll('-', '')}_test`; assert.match(name, /^task_reassign_[a-f0-9]{32}_test$/);
const target = new URL(test); target.pathname = '/' + name; const server = new URL(test); server.pathname = '/postgres';
const { Client } = require('pg'); const admin = new Client({ connectionString: server.toString() });
require('reflect-metadata'); const { Test } = require('@nestjs/testing');
const { AppModule } = require(resolve(api, 'dist/app.module.js')); const { configureApp } = require(resolve(api, 'dist/common/configure-app.js'));
const { APP_CONFIG, loadConfiguration } = require(resolve(api, 'dist/config/environment.js'));
const { PrismaService } = require(resolve(api, 'dist/prisma/prisma.service.js')); const { AuthSessionService } = require(resolve(api, 'dist/auth/auth-session.service.js'));
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
  for (const type of ['ORDER','AFTER_SALE','INVENTORY_ADJUSTMENT','OFFLINE_CASE','CUSTODY_ARRANGEMENT']) assert.throws(() => registry.requireHandoff(type), { code: 'BUSINESS_MODULE_NOT_READY' });
  for (const type of ['ORDER', 'AFTER_SALE', 'INVENTORY_ADJUSTMENT', 'OFFLINE_CASE', 'CUSTODY_ARRANGEMENT']) assert.throws(() => registry.require(type), { code: 'BUSINESS_MODULE_NOT_READY' });
  const passwordHash = await new PasswordService().hash('CompiledTaskAccess#2026');
  const employee = await prisma.employee.create({ data: { username: 'compiled_task_access', displayName: '隔离编译烟测员工', role: 'SUPER_ADMIN', mustChangePassword: false, passwordHash } });
  const session = await prisma.$transaction(tx => app.get(AuthSessionService).createAfterPasswordVerified(tx, { subjectId: employee.id, subjectType: 'EMPLOYEE', expectedPasswordHash: passwordHash, expectedTokenVersion: 0 }));
  // 只在专属库放一条无真实业务来源的元数据，证明不能仅凭UUID、管理员权限或任务表行显示/领取它。
  const businessId = randomUUID(); const cursor = await prisma.taskStageCursor.create({ data: { businessType: 'ORDER', businessId, stage: 'SHIPMENT_PROCESS', lastRound: 1 } });
  const orphan = await prisma.task.create({ data: { cursorId: cursor.id, businessType: 'ORDER', businessId, stage: 'SHIPMENT_PROCESS', round: 1,
    entryKey: 'isolated-orphan', requiredPermissions: ['order.fulfillment.read', 'shipment.claim', 'shipment.pack', 'shipment.handover'], startedAt: new Date(), ruleSnapshot: {} } });
  async function request(path, status, body) {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); const result = await response.json(); assert.equal(response.status, status);
    assert.equal(result.requestId, response.headers.get('x-request-id')); report.cases.push({ path, status, requestId: result.requestId, ...(result.code ? { code: result.code } : {}) }); return result.data;
  }
  for (const view of ['mine', 'pool', 'reassign']) assert.deepEqual(await request(`/admin/tasks?view=${view}`, 200), { items: [], total: 0, page: 1, pageSize: 20 });
  const summary = await request('/admin/tasks/summary', 200); assert.deepEqual({ ...summary, asOf: null }, { myPending: 0, eligibleOpen: 0, currentOverdue: 0, everOverdue: 0, reassignNeeded: 0, countsOverlap: true, asOf: null });
  await request(`/admin/tasks/${orphan.id}`, 404); await request(`/admin/tasks/${orphan.id}/history`, 404);
  await request(`/admin/tasks/${orphan.id}/claim`, 404, { expectedVersion: 0 }); await request(`/admin/tasks/${orphan.id}/release`, 404, { expectedVersion: 0, reason: '不能操作孤立任务' });
  await request(`/admin/tasks/${orphan.id}/claim`, 400, { expectedVersion: '0' });
  await request(`/admin/tasks/${orphan.id}/transfer`, 404, { targetEmployeeId: employee.id, expectedVersion: 0, reason: '不能转交孤立任务' });
  await request(`/admin/tasks/${orphan.id}/transfer`, 400, { expectedVersion: 0, reason: '转交目标必填' });
  await request(`/admin/tasks/${orphan.id}/transfer`, 400, { targetEmployeeId: employee.id, expectedVersion: 0, reason: '禁止指定截止', dueAt: new Date().toISOString() });
  assert.equal(await prisma.auditLog.count(), 0); assert.equal(await prisma.taskHistory.count(), 0); assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: orphan.id } })).version, 0);
  const response = await fetch((await app.getUrl()) + '/api/docs-json'); assert.equal(response.status, 200); const spec = await response.json();
  report.operations = Object.values(spec.paths).reduce((count, item) => count + Object.keys(item).filter(key => ['get', 'post', 'put', 'patch', 'delete'].includes(key)).length, 0);
  assert.equal(report.operations, 39); report.productionAdaptersEmpty = true; report.orphanTaskHiddenAndImmutable = true; report.passed = true;
} finally {
  await app?.close(); try { if (created) { await admin.query(`DROP DATABASE "${name}"`); report.databaseRemoved = true; } } finally { await admin.end(); }
  writeFileSync(`${directory}/compiled-smoke.json`, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report));
