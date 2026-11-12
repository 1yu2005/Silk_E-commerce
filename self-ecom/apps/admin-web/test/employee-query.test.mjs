/** 文件作用：验证员工查询参数、缓存失效、取消和会话切换隔离。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClientError, AuthSessionStore } from '@shop/api-client';
import { EmployeeQueryController } from '../src/employees/query-controller.ts';
import { canReadEmployees, employeeIdIssue, employeeSearchParams, parseEmployeeSearch } from '../src/employees/query.ts';

const response = data => ({ data, requestId: 'bfead5b2-e513-4d52-80e4-4b10a85f4203' });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(loggedIn = true) {
  const storage = new Map();
  const session = new AuthSessionStore('EMPLOYEE', { storage: () => ({ getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }) });
  const save = () => session.save({ accessToken: 'query-test-token', tokenType: 'Bearer', expiresAt: new Date(Date.now() + 60_000).toISOString() });
  if (loggedIn) save();
  const calls = []; const behavior = { fetch: async input => response(input) };
  const controller = new EmployeeQueryController(session, (input, signal) => { calls.push({ input, signal }); return behavior.fetch(input, signal); });
  return { session, save, controller, calls, behavior, storage };
}

test('匿名不发员工查询，快照稳定只读且订阅可取消', async () => {
  const f = fixture(false); const initial = f.controller.getSnapshot(); let events = 0;
  const stop = f.controller.subscribe(() => { events++; }); await f.controller.read('list', { page: 1 });
  assert.equal(f.calls.length, 0); assert.equal(f.controller.getSnapshot(), initial); assert.ok(Object.isFrozen(initial));
  f.save(); const before = events; stop(); await f.controller.read('list', { page: 1 }); assert.equal(events, before); f.controller.dispose();
});

test('StrictMode重挂载和同参数在途读取只发一次，完成后重进会刷新', async () => {
  const f = fixture(); const gate = deferred(); f.behavior.fetch = () => gate.promise;
  const first = f.controller.read('a', 'a'); const second = f.controller.read('a', 'a'); assert.equal(first, second); assert.equal(f.calls.length, 1);
  gate.resolve(response('员工甲')); await first; assert.equal(f.controller.getSnapshot().data, '员工甲');
  await f.controller.read('a', 'a'); assert.equal(f.calls.length, 2); f.controller.dispose();
});

test('筛选切换立即隐藏旧资料、取消旧请求且迟到结果不能覆盖', async () => {
  for (const fail of [false, true]) {
    const f = fixture(); const gate = deferred(); f.behavior.fetch = () => gate.promise;
    const first = f.controller.read('old', '旧员工'); f.behavior.fetch = async () => response('新员工');
    const second = f.controller.read('new', '新员工'); assert.equal(f.controller.getSnapshot().data, null); assert.ok(f.calls[0].signal.aborted);
    await second; if (fail) gate.reject(new Error('旧失败')); else gate.resolve(response('旧员工'));
    await first; assert.equal(f.controller.getSnapshot().key, 'new'); assert.equal(f.controller.getSnapshot().data, '新员工'); f.controller.dispose();
  }
});

test('401清会话时立即清员工资料，旧在途成功不能恢复', async () => {
  const f = fixture(); await f.controller.read('a', '员工甲');
  const gate = deferred(); f.behavior.fetch = () => gate.promise; const pending = f.controller.read('b', '员工乙');
  f.session.invalidateIfCurrent(f.session.current().revision); assert.equal(f.controller.getSnapshot().data, null); assert.equal(f.controller.getSnapshot().key, null);
  assert.ok(f.calls.at(-1).signal.aborted); gate.resolve(response('员工乙')); await pending;
  assert.equal(f.controller.getSnapshot().status, 'idle'); f.controller.dispose();
});

test('新登录切换清查询，旧会话成功或错误均不写入新身份', async () => {
  for (const fail of [false, true]) {
    const f = fixture(); const gate = deferred(); f.behavior.fetch = () => gate.promise; const pending = f.controller.read('same', '旧员工');
    f.save(); f.behavior.fetch = async () => response('新登录资料'); await f.controller.read('same', '新员工');
    if (fail) gate.reject(new ApiClientError('FORBIDDEN', '旧错误', 403)); else gate.resolve(response('旧资料'));
    await pending; assert.equal(f.controller.getSnapshot().data, '新登录资料'); assert.equal(f.controller.getSnapshot().error, null); f.controller.dispose();
  }
});

test('403在权限刷新重挂载后不循环，手动重试才发下一次', async () => {
  const f = fixture(); f.behavior.fetch = async () => { throw new ApiClientError('FORBIDDEN', '无权', 403); };
  await f.controller.read('a', '员工甲'); await f.controller.read('a', '员工甲'); await f.controller.read('a', '员工甲');
  assert.equal(f.calls.length, 1); assert.equal(f.controller.getSnapshot().error.status, 403); assert.ok(f.session.current().credential);
  f.behavior.fetch = async () => response('已恢复'); await f.controller.read('a', '员工甲', true);
  assert.equal(f.calls.length, 2); assert.equal(f.controller.getSnapshot().data, '已恢复'); f.controller.dispose();
});

test('404、500和未知错误不保留旧资料，未知错误不含原始秘密', async () => {
  for (const error of [new ApiClientError('NOT_FOUND', '员工不存在', 404), new ApiClientError('INTERNAL_ERROR', '服务异常', 500), new Error('private-secret')]) {
    const f = fixture(); await f.controller.read('a', '旧员工'); f.behavior.fetch = async () => { throw error; };
    await f.controller.read('a', '员工甲', true); assert.equal(f.controller.getSnapshot().data, null); assert.equal(f.controller.getSnapshot().status, 'error');
    assert.ok(!JSON.stringify(f.controller.getSnapshot()).includes('private-secret')); assert.ok(f.session.current().credential);
    f.behavior.fetch = async () => response('恢复后资料'); await f.controller.read('a', '员工甲', true); assert.equal(f.controller.getSnapshot().data, '恢复后资料'); f.controller.dispose();
  }
});

test('员工资料和查询条件不写入会话存储，销毁取消在途读取', async () => {
  const f = fixture(); await f.controller.read('a', { displayName: '仅内存员工', permissions: ['private.permission'] });
  assert.ok(!JSON.stringify([...f.storage.values()]).includes('仅内存员工')); assert.ok(!JSON.stringify([...f.storage.values()]).includes('permissions'));
  const gate = deferred(); f.behavior.fetch = () => gate.promise; const pending = f.controller.read('b', '在途员工'); f.controller.dispose();
  assert.ok(f.calls.at(-1).signal.aborted); gate.resolve(response('迟到员工')); await pending; assert.equal(f.controller.getSnapshot().data, null);
});

test('地址栏默认值、Unicode关键词和枚举与查询规则一致', () => {
  assert.deepEqual(parseEmployeeSearch('').query, { page: 1, pageSize: 20 });
  assert.deepEqual(parseEmployeeSearch('page=2&pageSize=100&role=CUSTOMER_SERVICE&status=DISABLED&keyword=%20%E5%91%98%E5%B7%A5%25_%20').query,
    { page: 2, pageSize: 100, keyword: '员工%_', role: 'CUSTOMER_SERVICE', status: 'DISABLED' });
  assert.equal(parseEmployeeSearch(new URLSearchParams({ keyword: '😀'.repeat(50) }).toString()).query.keyword.length, 100);
  assert.equal(parseEmployeeSearch('page=9007199254740991').query.page, Number.MAX_SAFE_INTEGER);
});

test('非法分页、重复/未知字段、超长关键词和岗位状态不发给API', () => {
  for (const search of ['page=0', 'page=-1', 'page=1.1', 'page=1e3', 'page=01', 'page=9007199254740992', 'pageSize=101', 'pageSize=0',
    'page=1&page=2', 'token=private', 'role=toString', 'role=UNKNOWN', 'status=FROZEN', new URLSearchParams({ keyword: '😀'.repeat(51) }).toString()]) {
    assert.equal(parseEmployeeSearch(search).query, undefined, search); assert.ok(parseEmployeeSearch(search).error);
  }
});

test('查询序列化保留筛选和页码，UUID仅形状校验且菜单依据有效权限', () => {
  const query = { page: 2, pageSize: 10, keyword: '顾问%_😀', role: 'MERCH_WAREHOUSE', status: 'ACTIVE' };
  assert.deepEqual(parseEmployeeSearch(employeeSearchParams(query).toString()).query, query);
  assert.equal(employeeIdIssue('ABCDEF00-1234-4234-8234-ABCDEF123456'), null);
  for (const id of ['', '../me', 'not-a-uuid']) assert.ok(employeeIdIssue(id));
  assert.equal(canReadEmployees(null), false); assert.equal(canReadEmployees({ effectivePermissions: [] }), false);
  assert.equal(canReadEmployees({ effectivePermissions: ['employee.read'] }), true);
});

test('写入失效后活跃查询重读，旧在途响应不能恢复旧资料', async () => {
  const f = fixture(); const stop = f.controller.subscribe(() => {}); const gate = deferred();
  f.behavior.fetch = () => gate.promise; const previous = f.controller.read('employee-a', '员工甲');
  f.behavior.fetch = async () => response('更新后的员工甲'); await f.controller.invalidate('employee-a');
  assert.equal(f.calls.length, 2); assert.ok(f.calls[0].signal.aborted);
  gate.resolve(response('旧员工甲')); await previous; assert.equal(f.controller.getSnapshot().data, '更新后的员工甲'); stop(); f.controller.dispose();
});
test('失效只作用指定员工；离开页面仅清缓存不暗中发请求', async () => {
  const f = fixture(); await f.controller.read('employee-b', '员工乙'); const before = f.controller.getSnapshot();
  await f.controller.invalidate('employee-a'); assert.equal(f.controller.getSnapshot(), before); assert.equal(f.calls.length, 1);
  await f.controller.invalidate('employee-b'); assert.equal(f.controller.getSnapshot().data, null); assert.equal(f.calls.length, 1);
  await f.controller.read('employee-b', '员工乙新版本'); assert.equal(f.controller.getSnapshot().data, '员工乙新版本'); f.controller.dispose();
});
