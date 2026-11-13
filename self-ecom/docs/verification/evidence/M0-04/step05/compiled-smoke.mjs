// 作用：用真实tsc产物验证TasksModule依赖注入、生产缺失业务时拒绝及HTTP边界；仅操作本轮独占库。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
const api = resolve('apps/api'); const require = createRequire(resolve(api, 'package.json'));
const directory = 'docs/verification/evidence/M0-04/step05';
assert.ok(!existsSync(`${directory}/compiled-smoke.json`), '不能覆盖烟测记录');
const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env };
const dev = new URL(env.DATABASE_URL); const test = new URL(env.TEST_DATABASE_URL);
assert.notEqual(dev.pathname, test.pathname); assert.match(test.pathname, /^\/[a-z][a-z0-9_]*_test$/);
assert.equal(dev.hostname, test.hostname); assert.equal(dev.port, test.port);
assert.ok(['localhost', '127.0.0.1'].includes(test.hostname));
const name = `task_entry_${randomUUID().replaceAll('-', '')}_test`; assert.match(name, /^task_entry_[a-f0-9]{32}_test$/);
const target = new URL(test); target.pathname = '/' + name; const server = new URL(test); server.pathname = '/postgres';
const { Client } = require('pg'); const admin = new Client({ connectionString: server.toString() });
require('reflect-metadata'); const { Test } = require('@nestjs/testing');
const { AppModule } = require(resolve(api, 'dist/app.module.js'));
const { configureApp } = require(resolve(api, 'dist/common/configure-app.js'));
const { APP_CONFIG, loadConfiguration } = require(resolve(api, 'dist/config/environment.js'));
const { PrismaService } = require(resolve(api, 'dist/prisma/prisma.service.js'));
const { TaskEntryService } = require(resolve(api, 'dist/tasks/task-entry.service.js'));
const { TaskBusinessAdapters } = require(resolve(api, 'dist/tasks/task-business-adapters.js'));
let created = false; let app;
const report = { checkedAt: new Date().toISOString(), compiledMetadata: true, isolatedDatabase: true, cases: [] };
try {
  await admin.connect(); await admin.query(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`); created = true;
  const migrated = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
    { cwd: api, env: { ...env, DATABASE_URL: target.toString() }, windowsHide: true, encoding: 'utf8', timeout: 60_000 });
  report.migrateExitCode = migrated.status; assert.equal(migrated.status, 0);
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(APP_CONFIG).useValue(loadConfiguration({
    ...env, NODE_ENV: 'test', DATABASE_URL: target.toString(), LOG_LEVEL: 'silent', SWAGGER_ENABLED: 'true',
    JWT_SECRET: 'compiled-task-entry-isolated-only-key-2026-0000',
  })).compile();
  app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
  const service = app.get(TaskEntryService); const registry = app.get(TaskBusinessAdapters); const prisma = app.get(PrismaService);
  assert.ok(service instanceof TaskEntryService); assert.ok(registry instanceof TaskBusinessAdapters);
  for (const businessType of ['ORDER', 'AFTER_SALE', 'INVENTORY_ADJUSTMENT', 'OFFLINE_CASE', 'CUSTODY_ARRANGEMENT']) {
    assert.throws(() => registry.require(businessType), { code: 'BUSINESS_MODULE_NOT_READY', status: 409 });
    await assert.rejects(prisma.$transaction(tx => service.withContext(tx, { type: 'SYSTEM' }, [{ businessType, businessId: randomUUID() }],
      randomUUID(), async context => service.enterStage(context, {}))), { code: 'BUSINESS_MODULE_NOT_READY' });
    report.cases.push({ businessType, code: 'BUSINESS_MODULE_NOT_READY' });
  }
  for (const model of ['task', 'taskStageCursor', 'taskHistory', 'deadlineEvent', 'auditLog']) assert.equal(await prisma[model].count(), 0);
  report.diAndDefaultRefusal = true;
  for (const [path, status] of [['/api/v1/health/ready', 200], ['/api/v1/store/contact', 200], ['/api/v1/admin/tasks', 404]]) {
    const response = await fetch(base + path, { signal: AbortSignal.timeout(5000) }); const body = await response.json();
    assert.equal(response.status, status); assert.equal(body.requestId, response.headers.get('x-request-id'));
    if (path.endsWith('contact')) assert.deepEqual(body.data, { configured: false, servicePhone: null, serviceHours: null, settingsVersion: 0 });
    report.cases.push({ path, status, requestId: body.requestId });
  }
  const response = await fetch(base + '/api/docs-json'); assert.equal(response.status, 200); const spec = await response.json();
  report.operations = Object.values(spec.paths).reduce((count, item) => count + Object.keys(item).filter(key => ['get', 'post', 'put', 'patch', 'delete'].includes(key)).length, 0);
  assert.equal(report.operations, 32); assert.ok(Object.keys(spec.paths).every(path => !path.includes('/tasks')));
  report.noTaskHttp = true; report.passed = true;
} finally {
  await app?.close();
  try { if (created) { await admin.query(`DROP DATABASE "${name}"`); report.databaseRemoved = true; } }
  finally { await admin.end(); }
  writeFileSync(`${directory}/compiled-smoke.json`, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report));
