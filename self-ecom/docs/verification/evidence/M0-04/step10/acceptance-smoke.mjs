// 作用：核对独立任务应用的隔离保护、3001/Swagger、真实权限/命令/扫描及正常关闭后的专属库清理。
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
const directory = 'docs/verification/evidence/M0-04/step10'; const label = process.argv[2] ?? 'attempt1'; assert.match(label, /^[a-z0-9-]+$/);
const destination = `${directory}/acceptance-smoke-${label}.json`; assert.ok(!existsSync(destination));
const require = createRequire(resolve('apps/api/package.json')); const { startTaskAcceptance } = require(resolve('apps/api/dist/acceptance/test/acceptance/application.js'));
const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env, NODE_ENV: 'test' }; const report = { checkedAt: new Date().toISOString(), checks: [], requests: [] };
let app; let scenario = '隔离启动保护';
const passed = () => { report.checks.push(scenario); console.log(JSON.stringify({ scenario, passed: true })); };
try {
  await assert.rejects(startTaskAcceptance({ root: process.cwd(), env: { ...env, NODE_ENV: 'development' } }), /NODE_ENV=test/);
  await assert.rejects(startTaskAcceptance({ root: process.cwd(), env: { ...env, TEST_DATABASE_URL: env.DATABASE_URL } }), /TEST_DATABASE_URL/); passed();
  scenario = '3001端口真实启动及40操作Swagger'; app = await startTaskAcceptance({ root: process.cwd(), env, fixtures: true });
  assert.match(app.base, /:3001\/api\/v1$/); const spec = await (await fetch(app.base.replace('/v1', '/docs-json'))).json();
  assert.equal(Object.values(spec.paths).reduce((sum, path) => sum + Object.keys(path).filter(method => ['get', 'post', 'put', 'delete', 'patch'].includes(method)).length, 0), 40);
  assert.equal((await fetch(app.base.replace('/v1', '/docs'))).status, 200); passed();
  const request = async (path, token, method = 'GET', body, status = 200) => {
    const response = await fetch(app.base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const value = await response.json(); assert.equal(response.status, status, path); assert.equal(value.requestId, response.headers.get('x-request-id'));
    report.requests.push({ path, method, status, requestId: value.requestId, ...(value.code ? { code: value.code } : {}) }); return value.data;
  };
  const login = async username => (await request('/admin/auth/login', null, 'POST', { username, password: app.password })).accessToken;
  const admin = await login('task_admin'); const warehouse = await login('warehouse_a'); const support = await login('support_a');
  scenario = '四类夹具真实建立及岗位范围'; assert.equal(await app.prisma.task.count(), 4);
  assert.equal((await request('/admin/tasks?view=pool', warehouse)).items.length, 1);
  assert.equal((await request('/admin/tasks?view=mine', support)).items[0].id, app.taskIds.T3);
  await request('/admin/tasks/' + app.taskIds.T1, support, 'GET', undefined, 404);
  await request('/admin/tasks?view=reassign', support, 'GET', undefined, 403); passed();
  scenario = '真实领取释放和阻塞拒绝'; const id = app.taskIds.T1;
  const claimed = await request(`/admin/tasks/${id}/claim`, warehouse, 'POST', { expectedVersion: 0 }); assert.equal(claimed.task.status, 'CLAIMED');
  const released = await request(`/admin/tasks/${id}/release`, warehouse, 'POST', { expectedVersion: 1, reason: '隔离验收释放' }); assert.equal(released.task.status, 'OPEN');
  assert.equal(released.task.round, 1); assert.equal(released.task.originalDueAt, null);
  await request(`/admin/tasks/${app.taskIds.T4}/release`, warehouse, 'POST', { expectedVersion: 1, reason: '不得绕过业务阻塞' }, 409); passed();
  scenario = '真实撤销个人资格同事务回池'; const employee = app.accounts.find(row => row.username === 'support_a');
  const result = await request(`/admin/employees/${employee.id}/extra-permissions`, admin, 'PUT', { expectedVersion: 0, permissions: [], reason: '隔离验收撤权' }); assert.equal(result.changed, true);
  const reassign = await request('/admin/tasks?view=reassign', admin); assert.equal(reassign.items.length, 1); assert.equal(reassign.items[0].id, app.taskIds.T3);
  assert.equal(reassign.items[0].assignee, null); assert.equal(reassign.items[0].round, 1); passed();
  scenario = '真实扫描重入与调度记录'; const first = await app.scan(); const second = await app.scan();
  assert.equal(first.changedCount, 1); assert.equal(second.changedCount, 0); assert.notEqual(first.requestId, second.requestId);
  assert.equal(await app.prisma.deadlineEvent.count({ where: { taskId: app.taskIds.T2, eventType: 'OVERDUE' } }), 1);
  report.runs = [first, second]; passed();
  scenario = '无造任务接口且生产入口未引入测试应用';
  assert.ok(!readFileSync('apps/api/src/app.module.ts', 'utf8').includes('acceptance')); assert.ok(!Object.keys(spec.paths).some(path => /fixture|acceptance/.test(path))); passed();
  report.passed = true;
} catch (error) {
  report.failure = { scenario, message: error instanceof assert.AssertionError ? error.message.slice(0, 600) : '隔离应用执行失败，未保存原始异常' }; process.exitCode = 1; console.error(JSON.stringify(report.failure));
} finally {
  const databaseName = app?.databaseName; await app?.close();
  if (databaseName) {
    const { Client } = require('pg'); const url = new URL(env.TEST_DATABASE_URL); url.pathname = '/postgres'; const client = new Client({ connectionString: url.toString() });
    try { await client.connect(); assert.equal((await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [databaseName])).rowCount, 0); report.databaseRemoved = true; } finally { await client.end(); }
  }
  writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ passed: !!report.passed, checks: report.checks.length, databaseRemoved: report.databaseRemoved }));
