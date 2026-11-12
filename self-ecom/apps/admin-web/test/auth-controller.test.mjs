/** 文件作用：回归员工身份恢复、强制改密、权限刷新和异步竞态。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClientError, AuthSessionStore, validatePassword, validatePasswordChange } from '@shop/api-client';
import { EmployeeAuthController } from '../src/auth/controller.ts';

const profile = { id: 'employee-a', username: 'employee_a', displayName: '员工甲', role: 'CUSTOMER_SERVICE', status: 'ACTIVE', mustChangePassword: false };
const permissions = { role: 'CUSTOMER_SERVICE', permissionVersion: 1, defaultPermissions: ['customer.read'], extraPermissions: [], effectivePermissions: ['customer.read'] };
const result = data => ({ data, requestId: '93bb2fbf-cd2e-4ac7-a16f-90f6078bd47c' });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture({ loggedIn = true, forced = false } = {}) {
  const values = new Map();
  let now = Date.now();
  const session = new AuthSessionStore('EMPLOYEE', { now: () => now, storage: () => ({
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key),
  }) });
  const save = (token = 'token-a') => session.save({ accessToken: token, tokenType: 'Bearer', expiresAt: new Date(now + 60_000).toISOString() });
  if (loggedIn) save();
  const calls = { me: 0, permissions: 0, logout: 0, password: 0, login: 0 };
  const behavior = { me: async () => result({ ...profile, mustChangePassword: forced }), permissions: async () => result(permissions),
    login: async () => { save('new-login'); return result({}); }, logout: async () => result({ loggedOut: true }),
    password: async () => result({ changed: true, requireLogin: true }) };
  const client = { session, api: {}, auth: {
    me: async () => { calls.me++; return behavior.me(); }, permissions: async () => { calls.permissions++; return behavior.permissions(); },
    login: async input => { calls.login++; return behavior.login(input); },
    changePassword: async input => { calls.password++; const revision = session.current().revision;
      const value = await behavior.password(input); session.clearIfCurrent(revision); return value; },
    logout: async () => { calls.logout++; const revision = session.current().revision;
      try { return await behavior.logout(); } finally { session.clearIfCurrent(revision); } },
  } };
  const controller = new EmployeeAuthController(client);
  const stop = controller.start();
  return { session, controller, calls, behavior, save, values, stop, advance: value => { now += value; } };
}

test('匿名不查询本人；快照稳定，订阅可取消', async () => {
  const f = fixture({ loggedIn: false }); let notifications = 0;
  const unsubscribe = f.controller.subscribe(() => { notifications++; });
  assert.equal(f.controller.getSnapshot(), f.controller.getSnapshot());
  assert.ok(Object.isFrozen(f.controller.getSnapshot()));
  assert.equal(f.controller.getSnapshot().status, 'anonymous'); assert.equal(f.calls.me, 0);
  f.save(); await f.controller.restore(); assert.ok(notifications > 0);
  unsubscribe(); const count = notifications; f.session.clear(); assert.equal(notifications, count); f.stop();
});

test('恢复必须先本人再权限；在确认完成前不展示身份和菜单', async () => {
  const f = fixture();
  assert.equal(f.controller.getSnapshot().status, 'checking');
  assert.equal(f.controller.getSnapshot().employee, null); assert.equal(f.controller.getSnapshot().permissions, null);
  assert.equal(f.calls.permissions, 0); await f.controller.restore();
  assert.equal(f.controller.getSnapshot().status, 'ready'); assert.deepEqual(f.controller.getSnapshot().permissions, permissions); f.stop();
});

test('StrictMode清理再启动和同时重读共用一组请求', async () => {
  const f = fixture(); f.stop(); const stop = f.controller.start();
  await Promise.all([f.controller.restore(), f.controller.restore(true), f.controller.restore(true)]);
  assert.equal(f.calls.me, 1); assert.equal(f.calls.permissions, 1); stop();
});

test('强制改密只查本人，不查询被禁止的权限接口', async () => {
  const f = fixture({ forced: true }); await f.controller.restore();
  assert.equal(f.controller.getSnapshot().status, 'password-change'); assert.equal(f.calls.permissions, 0);
  assert.equal(f.controller.getSnapshot().permissions, null); f.stop();
});

test('权限响应的最新岗位用于显示，权限不落入持久化存储', async () => {
  const f = fixture(); f.behavior.permissions = async () => result({ ...permissions, role: 'MERCH_WAREHOUSE' });
  await f.controller.restore(); assert.equal(f.controller.getSnapshot().employee.role, 'MERCH_WAREHOUSE');
  assert.deepEqual(Object.keys(JSON.parse([...f.values.values()][0])).sort(), ['accessToken', 'domain', 'expiresAt']); f.stop();
});

test('恢复500保留凭证，清空资料权限，可手动重试', async () => {
  const f = fixture(); f.behavior.permissions = async () => { throw new ApiClientError('INTERNAL_ERROR', '服务异常', 500); };
  await f.controller.restore(); assert.equal(f.controller.getSnapshot().status, 'error');
  assert.ok(f.session.current().credential); assert.equal(f.controller.getSnapshot().employee, null);
  f.behavior.permissions = async () => result(permissions); await f.controller.restore(true);
  assert.equal(f.controller.getSnapshot().status, 'ready'); f.stop();
});

test('未知恢复异常使用固定提示，不暴露原异常', async () => {
  const f = fixture(); f.behavior.permissions = async () => { throw new Error('private-config'); };
  await f.controller.restore(); assert.equal(f.controller.getSnapshot().error.message, '身份信息读取失败，请重试');
  assert.ok(!JSON.stringify(f.controller.getSnapshot()).includes('private-config')); f.stop();
});

test('401清除身份与权限，并丢弃在途本人响应', async () => {
  const f = fixture(); const gate = deferred(); const entered = deferred();
  f.behavior.permissions = () => { entered.resolve(); return gate.promise; };
  const pending = f.controller.restore(); await entered.promise;
  f.session.invalidateIfCurrent(f.session.getSnapshot().revision); f.controller.onUnauthorized();
  gate.resolve(result(permissions)); await pending;
  assert.equal(f.controller.getSnapshot().status, 'anonymous'); assert.equal(f.controller.getSnapshot().permissions, null);
  assert.match(f.controller.getSnapshot().notice, /失效/); f.stop();
});

test('到期后由会话检查立即清除身份和权限', async () => {
  const f = fixture(); await f.controller.restore(); f.advance(60_000); f.session.current();
  assert.equal(f.controller.getSnapshot().status, 'anonymous'); assert.equal(f.controller.getSnapshot().employee, null); assert.equal(f.values.size, 0); f.stop();
});

test('新登录保存后，迟到旧本人响应不能恢复旧身份', async () => {
  const f = fixture(); await f.controller.restore(); const gate = deferred();
  f.behavior.me = () => gate.promise; const old = f.controller.restore(true);
  f.behavior.me = async () => result({ ...profile, id: 'employee-b', displayName: '员工乙' });
  f.save('token-b'); await f.controller.restore(); gate.resolve(result(profile)); await old;
  assert.equal(f.controller.getSnapshot().employee.id, 'employee-b'); f.stop();
});

test('新登录保存后，迟到旧权限及旧异常不能覆盖新身份', async () => {
  for (const rejectOld of [false, true]) {
    const f = fixture(); await f.controller.restore(); const gate = deferred(); const entered = deferred();
    f.behavior.permissions = () => { entered.resolve(); return gate.promise; };
    const old = f.controller.restore(true); await entered.promise;
    f.behavior.me = async () => result({ ...profile, id: 'employee-b' }); f.behavior.permissions = async () => result({ ...permissions, permissionVersion: 2 });
    f.save('token-b'); await f.controller.restore();
    if (rejectOld) gate.reject(new Error('old-failure')); else gate.resolve(result(permissions));
    await old; assert.equal(f.controller.getSnapshot().employee.id, 'employee-b');
    assert.equal(f.controller.getSnapshot().permissions.permissionVersion, 2); f.stop();
  }
});

test('并发403只触发一组本人/权限读取，不重放原动作', async () => {
  const f = fixture(); await f.controller.restore();
  f.controller.onForbidden('FORBIDDEN'); f.controller.onForbidden('FORBIDDEN'); f.controller.onForbidden('FORBIDDEN');
  await f.controller.restore(); assert.equal(f.calls.me, 2); assert.equal(f.calls.permissions, 2);
  assert.equal(f.controller.getSnapshot().status, 'ready'); assert.ok(f.session.current().credential);
  assert.match(f.controller.getSnapshot().notice, /没有权限/); f.stop();
});

test('权限刷新本身403只失败一次，不循环请求或注销', async () => {
  const f = fixture(); await f.controller.restore();
  f.behavior.permissions = async () => { f.controller.onForbidden('FORBIDDEN'); throw new ApiClientError('FORBIDDEN', '没有权限', 403); };
  f.controller.onForbidden('FORBIDDEN'); await f.controller.restore(); await Promise.resolve();
  assert.equal(f.calls.me, 2); assert.equal(f.calls.permissions, 2); assert.ok(f.session.current().credential);
  assert.equal(f.controller.getSnapshot().status, 'error'); f.stop();
});

test('PASSWORD_CHANGE_REQUIRED立即清权限，迟到刷新不恢复业务状态', async () => {
  const f = fixture(); await f.controller.restore(); const gate = deferred(); const entered = deferred();
  f.behavior.permissions = () => { entered.resolve(); return gate.promise; };
  const pending = f.controller.restore(true); await entered.promise;
  f.controller.onForbidden('PASSWORD_CHANGE_REQUIRED'); gate.resolve(result(permissions)); await pending;
  assert.equal(f.controller.getSnapshot().status, 'password-change'); assert.equal(f.controller.getSnapshot().permissions, null);
  assert.ok(f.session.current().credential); f.stop();
});

test('匿名收到403不会发起请求', async () => {
  const f = fixture({ loggedIn: false }); f.controller.onForbidden('FORBIDDEN');
  f.controller.onForbidden('PASSWORD_CHANGE_REQUIRED'); assert.equal(f.calls.me, 0); f.stop();
});

test('登录保存后恢复本人，登录密码不持久化', async () => {
  const f = fixture({ loggedIn: false }); await f.controller.login({ username: 'employee_a', password: 'PrivatePass#2026' });
  assert.equal(f.controller.getSnapshot().status, 'ready'); assert.equal(f.calls.login, 1);
  assert.ok(![...f.values.values()].join('').includes('PrivatePass')); f.stop();
});

test('公开登录失败留在匿名状态，不查询资料', async () => {
  const f = fixture({ loggedIn: false }); f.behavior.login = async () => { throw new ApiClientError('INVALID_CREDENTIALS', '账号或密码错误', 401); };
  await assert.rejects(f.controller.login({ username: 'employee_a', password: 'WrongPass#2026' }), { code: 'INVALID_CREDENTIALS' });
  assert.equal(f.calls.me, 0); assert.equal(f.controller.getSnapshot().status, 'anonymous'); f.stop();
});

test('改密成功清本地并提示重新登录', async () => {
  const f = fixture({ forced: true }); await f.controller.restore();
  await f.controller.changePassword({ oldPassword: 'OldPass#2026', newPassword: 'NewPass#2026' });
  assert.equal(f.controller.getSnapshot().status, 'anonymous'); assert.equal(f.values.size, 0);
  assert.match(f.controller.getSnapshot().notice, /密码已修改/); f.stop();
});

test('改密403保留当前会话，报告调用方', async () => {
  const f = fixture(); await f.controller.restore(); f.behavior.password = async () => { throw new ApiClientError('FORBIDDEN', '拒绝修改', 403); };
  await assert.rejects(f.controller.changePassword({ oldPassword: 'OldPass#2026', newPassword: 'NewPass#2026' }), { status: 403 });
  assert.equal(f.controller.getSnapshot().status, 'ready'); assert.ok(f.session.current().credential); f.stop();
});

test('注销成功或网络失败都清本地，不保留旧身份', async () => {
  for (const fail of [false, true]) {
    const f = fixture(); await f.controller.restore();
    if (fail) f.behavior.logout = async () => { throw new ApiClientError('NETWORK_ERROR', '网络失败'); };
    await f.controller.logout(); assert.equal(f.values.size, 0); assert.equal(f.controller.getSnapshot().status, 'anonymous');
    assert.equal(f.controller.getSnapshot().employee, null); assert.match(f.controller.getSnapshot().notice, fail ? /未确认/ : /已退出/); f.stop();
  }
});

test('注销请求未完成时，焦点恢复不能重新展示正在退出的身份', async () => {
  const f = fixture(); await f.controller.restore(); const gate = deferred();
  f.behavior.logout = () => gate.promise;
  const pending = f.controller.logout();
  await f.controller.restore(true);
  assert.equal(f.controller.getSnapshot().status, 'checking');
  assert.equal(f.controller.getSnapshot().employee, null);
  assert.equal(f.controller.getSnapshot().permissions, null);
  assert.equal(f.calls.me, 1);
  gate.resolve(result({ loggedOut: true })); await pending; f.stop();
});

test('迟到旧注销或改密不清除新登录的页面身份', async () => {
  for (const operation of ['logout', 'password']) {
    const f = fixture(); await f.controller.restore(); const gate = deferred(); f.behavior[operation] = () => gate.promise;
    const pending = operation === 'logout' ? f.controller.logout() : f.controller.changePassword({ oldPassword: 'OldPass#2026', newPassword: 'NewPass#2026' });
    f.behavior.me = async () => result({ ...profile, id: 'employee-b' }); f.save('token-b'); await f.controller.restore();
    gate.resolve(result({})); await pending; assert.equal(f.controller.getSnapshot().status, 'ready');
    assert.equal(f.controller.getSnapshot().employee.id, 'employee-b'); f.stop();
  }
});

test('清理订阅后会话变化不再请求；重新启动可恢复', async () => {
  const f = fixture(); await f.controller.restore(); f.stop(); f.save('token-b');
  assert.equal(f.calls.me, 1); const stop = f.controller.start(); await f.controller.restore(); assert.equal(f.calls.me, 2); stop();
});

test('页面复用服务端密码边界，不截断、不trim密码', () => {
  assert.equal(validatePassword('        '), null); assert.equal(validatePassword('😀'.repeat(18)), null);
  assert.equal(validatePassword('😀'.repeat(19)).code, 'PASSWORD_TOO_MANY_BYTES');
  assert.equal(validatePassword('a'.repeat(65)).code, 'PASSWORD_TOO_LONG');
  assert.equal(validatePasswordChange('samepass', 'samepass').code, 'PASSWORD_UNCHANGED');
});
