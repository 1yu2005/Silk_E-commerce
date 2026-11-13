/** 文件作用：验证任务筛选、北京时间、重复提交与冲突/不确定结果保护，旧登录不能改写新页面。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClientError, AuthSessionStore } from '@shop/api-client';
import { beijingDeadline, canArrangeTasks, parseTaskSearch, safeBusinessPath, taskSearchParams } from '../src/tasks/model.ts';
import { TaskMutationController } from '../src/tasks/mutation-controller.ts';
import { runEmployeeMutation } from '../src/employees/management.ts';
const id = 'd6b3c7f0-552d-48fe-8e08-bb80f7934a10';
test('默认本人任务，筛选往返保留false、页码、业务编号，不修改输入', () => {
  assert.deepEqual(parseTaskSearch(''), { query: { view: 'mine', page: 1, pageSize: 20 } });
  const query = { view: 'pool', page: 3, pageSize: 10, stage: 'SHIPMENT_PROCESS', status: 'OPEN', businessType: 'ORDER', businessId: id, overdue: false };
  assert.deepEqual(parseTaskSearch(taskSearchParams(query).toString()).query, query); assert.equal(query.overdue, false);
  assert.equal(parseTaskSearch('businessId=' + id.toUpperCase()).query.businessId, id);
});
test('未知、重复、空白、指数、小数、越界、非法枚举和UUID不请求服务器', () => {
  for (const search of ['view=other', 'page=0', 'page=-1', 'page=1e2', 'page=1.2', 'page=2147483648', 'pageSize=101', 'page=1&page=2',
    'view=mine&view=pool', 'anything=1', 'status=ACTIVE', 'stage=REFUND', 'businessType=OTHER', 'businessId=123', 'overdue=1', 'page=', 'overdue=']) assert.ok(parseTaskSearch(search).error, search);
});
test('管理员待安排要求真实管理员岗位与有效转交权限同时满足', () => {
  assert.equal(canArrangeTasks(null), false); assert.equal(canArrangeTasks({ role: 'SUPER_ADMIN', effectivePermissions: [] }), false);
  assert.equal(canArrangeTasks({ role: 'CUSTOMER_SERVICE', effectivePermissions: ['task.transfer'] }), false);
  assert.equal(canArrangeTasks({ role: 'SUPER_ADMIN', effectivePermissions: ['task.transfer'] }), true);
});
test('北京时间明确转UTC，跨年/闰日/秒不依赖宿主时区，拒绝日历进位', () => {
  assert.equal(beijingDeadline('2026-11-13T10:15'), '2026-11-13T02:15:00.000Z');
  assert.equal(beijingDeadline('2027-01-01T00:15:37'), '2026-12-31T16:15:37.000Z');
  assert.equal(beijingDeadline('2028-02-29T23:59:59'), '2028-02-29T15:59:59.000Z');
  for (const value of [null, '', '2026-02-29T10:00', '2026-02-30T10:00', '2026-13-01T10:00', '2026-11-13T24:00', '2026-11-13T10:00Z', '2026-11-13T10:00+08:00', '2026-11-13T10:00:00.123']) assert.equal(beijingDeadline(value), null);
});
test('业务链接只接受后端应用内安全详情路径', () => {
  assert.equal(safeBusinessPath('/orders/' + id), '/orders/' + id);
  for (const path of [null, '', '//host/orders', 'https://host/orders', 'javascript:alert(1)', '/orders?token=x', '/orders/../employees', '/orders/#x']) assert.equal(safeBusinessPath(path), null);
});
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture() {
  const session = new AuthSessionStore('EMPLOYEE', { storage: () => null });
  const login = () => session.save({ accessToken: 'temporary-only', tokenType: 'Bearer', expiresAt: new Date(Date.now() + 60000).toISOString() });
  login(); return { session, login, controller: new TaskMutationController(session, runEmployeeMutation) };
}
test('同一事件循环连续提交只发一次，成功只调用一次刷新', async () => {
  const { controller } = fixture(); const gate = deferred(); let sent = 0; let saved = 0;
  const send = () => { sent++; return gate.promise; }; const committed = () => { saved++; };
  const pending = controller.submit(send, committed); await controller.submit(send, committed);
  assert.equal(sent, 1); assert.equal(controller.getSnapshot().sending, true); gate.resolve({ data: { changed: true } }); await pending;
  assert.equal(saved, 1); assert.equal(controller.getSnapshot().sending, false);
});
for (const status of [404, 409, 500, undefined]) test(`任务错误${status ?? '网络失败'}保留原错误并阻止再次发写请求`, async () => {
  const { controller, session } = fixture(); const failure = new ApiClientError('TASK_FAILED', '安全失败提示', status, id); let sent = 0;
  const send = async () => { sent++; throw failure; }; await controller.submit(send, () => assert.fail('不能成功'));
  assert.equal(controller.getSnapshot().error, failure); assert.equal(controller.getSnapshot().blocked, status === 404 || status === 409 ? 'conflict' : 'uncertain');
  await controller.submit(send, () => {}); assert.equal(sent, 1); assert.ok(session.current().credential);
});
test('400业务输入错误允许修正后手动提交，不自动重试', async () => {
  const { controller } = fixture(); let sent = 0;
  await controller.submit(async () => { sent++; throw new ApiClientError('VALIDATION_FAILED', '原因错误', 400); }, () => {});
  assert.equal(controller.getSnapshot().blocked, null); assert.equal(sent, 1);
  await controller.submit(async () => { sent++; return { data: true }; }, () => {}); assert.equal(sent, 2);
});
for (const failed of [false, true]) test(`切换登录后丢弃在途${failed ? '错误' : '成功'}，不会刷新新用户页面`, async () => {
  const { controller, login } = fixture(); const gate = deferred(); let saved = 0;
  const pending = controller.submit(() => gate.promise, () => { saved++; }); login();
  if (failed) gate.reject(new Error('旧响应')); else gate.resolve({ data: { changed: true } });
  await pending; assert.equal(saved, 0); assert.equal(controller.getSnapshot().error, null);
});
test('未登录或已销毁不提交，销毁后的在途结果无回调', async () => {
  const { controller, session } = fixture(); const gate = deferred(); let saved = 0;
  const pending = controller.submit(() => gate.promise, () => { saved++; }); controller.dispose(); gate.resolve({ data: true }); await pending;
  await controller.submit(() => assert.fail('已销毁不能提交'), () => {}); session.clear();
  const empty = new TaskMutationController(session, runEmployeeMutation); await empty.submit(() => assert.fail('匿名不能提交'), () => {}); assert.equal(saved, 0);
});
