// 作用：验证生成任务调用器复用员工认证、严格路由与查询字段、冲突不重试；不作为后端业务成功证据。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AxiosError } from 'axios';
import { createEmployeeClient, createCustomerClient, createGeneratedClient } from '../dist/index.js';
const id = '22c83526-f172-431a-a5f1-d6348f292e81'; const requestId = 'e0b033ca-326a-4c2d-a12b-f7b9fd45048b';
const credential = { accessToken: 'task-client-isolated-token', expiresAt: new Date(Date.now() + 60000).toISOString(), tokenType: 'Bearer' };
test('八个任务生成调用器使用已有Bearer与声明参数，不接受越过路由的ID', async () => {
  const client = createEmployeeClient({ storage: () => null }); client.session.save(credential); const seen = [];
  client.api.defaults.adapter = async config => { assert.equal(config.headers.get('Authorization'), `Bearer ${credential.accessToken}`);
    seen.push({ url: config.url, method: config.method, params: config.params, data: config.data }); return { status: 200, config, headers: {}, data: { data: {}, requestId } }; };
  const api = createGeneratedClient(client.api);
  await api.listTasks({ query: { view: 'pool', stage: 'SHIPMENT_PROCESS', overdue: false, page: 2, pageSize: 10, secret: '不能发送' } });
  await api.getTaskSummary(); await api.getTaskDetail({ path: { id: id.toUpperCase() } }); await api.getTaskHistory({ path: { id }, query: { page: 1, pageSize: 2 } });
  await api.claimTask({ path: { id }, body: { expectedVersion: 0 } }); await api.releaseTask({ path: { id }, body: { expectedVersion: 1, reason: '确认交班' } });
  await api.transferTask({ path: { id }, body: { targetEmployeeId: requestId, expectedVersion: 2, reason: '管理员交接' } });
  await api.extendTaskDeadline({ path: { id }, body: { expectedVersion: 3, newDueAt: '2026-11-20T02:00:00.000Z', reason: '延长人工核实' } });
  assert.deepEqual(seen.map(row => [row.url, row.method]), [['/admin/tasks', 'get'], ['/admin/tasks/summary', 'get'], [`/admin/tasks/${id}`, 'get'],
    [`/admin/tasks/${id}/history`, 'get'], [`/admin/tasks/${id}/claim`, 'post'], [`/admin/tasks/${id}/release`, 'post'], [`/admin/tasks/${id}/transfer`, 'post'], [`/admin/tasks/${id}/extend-deadline`, 'post']]);
  assert.deepEqual(seen[0].params, { view: 'pool', stage: 'SHIPMENT_PROCESS', overdue: false, page: 2, pageSize: 10 });
  assert.deepEqual(JSON.parse(seen[4].data), { expectedVersion: 0 }); assert.deepEqual(JSON.parse(seen[5].data), { expectedVersion: 1, reason: '确认交班' });
  assert.deepEqual(JSON.parse(seen[6].data), { targetEmployeeId: requestId, expectedVersion: 2, reason: '管理员交接' });
  assert.deepEqual(JSON.parse(seen[7].data), { expectedVersion: 3, newDueAt: '2026-11-20T02:00:00.000Z', reason: '延长人工核实' });
  await assert.rejects(api.getTaskDetail({ path: { id: '../settings' } }), { code: 'CLIENT_REQUEST_TARGET_INVALID' }); assert.equal(seen.length, 8);
});
test('顾客客户端不能请求员工任务，409保留员工会话且不自动重发', async () => {
  const customer = createCustomerClient({ storage: () => null }); customer.session.save(credential);
  await assert.rejects(createGeneratedClient(customer.api).listTasks(), { code: 'CLIENT_REQUEST_TARGET_INVALID' });
  let calls = 0; const employee = createEmployeeClient({ storage: () => null }); employee.session.save(credential);
  employee.api.defaults.adapter = async config => { calls++; throw new AxiosError('隐藏传输错误', 'ERR_BAD_RESPONSE', config, {},
    { status: 409, config, headers: {}, data: { code: 'TASK_ALREADY_CLAIMED', message: '已被领取', requestId } }); };
  await assert.rejects(createGeneratedClient(employee.api).claimTask({ path: { id }, body: { expectedVersion: 0 } }), { status: 409, code: 'TASK_ALREADY_CLAIMED', requestId });
  assert.equal(calls, 1); assert.ok(employee.session.current().credential);
});
test('延期409保留requestId和会话，不自动重发；顾客不能借调用器请求延期', async () => {
  const customer = createCustomerClient({ storage: () => null }); customer.session.save(credential);
  const body = { expectedVersion: 0, newDueAt: '2026-11-20T02:00:00.000Z', reason: '人工核实' };
  await assert.rejects(createGeneratedClient(customer.api).extendTaskDeadline({ path: { id }, body }), { code: 'CLIENT_REQUEST_TARGET_INVALID' });
  const employee = createEmployeeClient({ storage: () => null }); employee.session.save(credential); let calls = 0;
  employee.api.defaults.adapter = async config => { calls++; throw new AxiosError('隐藏传输错误', 'ERR_BAD_RESPONSE', config, {},
    { status: 409, config, headers: {}, data: { code: 'TASK_DEADLINE_NOT_LATER', message: '请重新选择截止', requestId } }); };
  await assert.rejects(createGeneratedClient(employee.api).extendTaskDeadline({ path: { id }, body }), { status: 409, code: 'TASK_DEADLINE_NOT_LATER', requestId });
  assert.equal(calls, 1); assert.ok(employee.session.current().credential);
});
