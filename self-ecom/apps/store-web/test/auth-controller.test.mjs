/** 文件作用：回归顾客身份、注册、昵称、改密和异步会话竞态。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClientError, AuthSessionStore } from '@shop/api-client';
import { CustomerAuthController } from '../src/auth/controller.ts';
import { phoneIssue, nicknameIssue, registrationInput } from '../src/auth/form-rules.ts';

const profile = { id: 'customer-a', phone: '13900000001', nickname: '顾客甲', avatarUrl: null, status: 'NORMAL', createdAt: '2026-11-12T01:00:00.000Z' };
const result = data => ({ data, requestId: '4b0c8edc-70ab-42c4-a033-af5f4574a86e' });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture({ loggedIn = true, status = 'NORMAL', initialMe } = {}) {
  const values = new Map(); let now = Date.now();
  const session = new AuthSessionStore('CUSTOMER', { now: () => now, storage: () => ({
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key),
  }) });
  const save = (token = 'customer-token-a') => session.save({ accessToken: token, tokenType: 'Bearer', expiresAt: new Date(now + 60_000).toISOString() });
  if (loggedIn) save();
  const calls = { me: 0, login: 0, register: 0, logout: 0, updateProfile: 0, changePassword: 0 };
  const behavior = { me: initialMe ?? (async () => result({ ...profile, status })), register: async () => result({ id: 'created' }),
    login: async () => { save('new-customer-token'); return result({}); }, logout: async () => result({ loggedOut: true }),
    updateProfile: async input => result({ ...profile, ...input, status }), changePassword: async () => result({ changed: true, requireLogin: true }) };
  const client = { session, api: {}, auth: {
    me: async () => { calls.me++; return behavior.me(); },
    login: async input => { calls.login++; return behavior.login(input); },
    register: async input => { calls.register++; return behavior.register(input); },
    updateProfile: async input => { calls.updateProfile++; return behavior.updateProfile(input); },
    changePassword: async input => {
      calls.changePassword++; const revision = session.current().revision;
      try { const response = await behavior.changePassword(input); session.clearIfCurrent(revision); return response; }
      catch (error) {
        if (error.status === 401 && session.current().revision === revision) {
          session.invalidateIfCurrent(revision); controller.onUnauthorized();
        }
        throw error;
      }
    },
    logout: async () => { calls.logout++; const revision = session.current().revision;
      try { return await behavior.logout(); } finally { session.clearIfCurrent(revision); } },
  } };
  const controller = new CustomerAuthController(client); const stop = controller.start();
  return { session, controller, calls, behavior, save, values, stop, advance: delta => { now += delta; } };
}

test('匿名不请求本人，快照稳定且可取消订阅', async () => {
  const f = fixture({ loggedIn: false }); let events = 0;
  const stop = f.controller.subscribe(() => { events++; });
  assert.equal(f.calls.me, 0); assert.equal(f.controller.getSnapshot().status, 'anonymous');
  assert.equal(f.controller.getSnapshot(), f.controller.getSnapshot()); assert.ok(Object.isFrozen(f.controller.getSnapshot()));
  f.save(); await f.controller.restore(); assert.ok(events > 0); stop();
  const before = events; f.session.clear(); assert.equal(events, before); f.stop();
});

test('只持久化顾客域最小凭证，不保存手机号资料或密码', async () => {
  const f = fixture(); await f.controller.restore();
  const stored = JSON.parse([...f.values.values()][0]);
  assert.deepEqual(Object.keys(stored).sort(), ['accessToken', 'domain', 'expiresAt']); assert.equal(stored.domain, 'CUSTOMER');
  assert.ok(!JSON.stringify(stored).includes(profile.phone)); f.stop();
});

test('恢复确认前不展示旧资料，强制重读会立即隐藏旧身份', async () => {
  const f = fixture(); assert.equal(f.controller.getSnapshot().status, 'checking'); assert.equal(f.controller.getSnapshot().customer, null);
  await f.controller.restore(); assert.deepEqual(f.controller.getSnapshot().customer, profile);
  const gate = deferred(); f.behavior.me = () => gate.promise; const pending = f.controller.restore(true);
  assert.equal(f.controller.getSnapshot().customer, null); gate.resolve(result(profile)); await pending;
  assert.equal(f.controller.getSnapshot().status, 'ready'); f.stop();
});

test('StrictMode清理再启动及并发重读只请求一次', async () => {
  const f = fixture(); f.stop(); const stop = f.controller.start();
  await Promise.all([f.controller.restore(), f.controller.restore(true), f.controller.restore(true)]);
  assert.equal(f.calls.me, 1); stop();
});

test('交易受限顾客仍可恢复本人资料', async () => {
  const f = fixture({ status: 'TRADE_RESTRICTED' }); await f.controller.restore();
  assert.equal(f.controller.getSnapshot().status, 'ready'); assert.equal(f.controller.getSnapshot().customer.status, 'TRADE_RESTRICTED'); f.stop();
});

test('本人500保留凭证、清资料并允许手动重试', async () => {
  const f = fixture({ initialMe: async () => { throw new ApiClientError('INTERNAL_ERROR', '服务异常', 500); } });
  await f.controller.restore(); assert.equal(f.controller.getSnapshot().status, 'error'); assert.equal(f.controller.getSnapshot().customer, null);
  assert.ok(f.session.current().credential); f.behavior.me = async () => result(profile); await f.controller.restore(true);
  assert.equal(f.controller.getSnapshot().status, 'ready'); f.stop();
});

test('未知异常使用固定提示，不带原始配置', async () => {
  const f = fixture({ initialMe: async () => { throw new Error('private-configuration'); } }); await f.controller.restore();
  assert.equal(f.controller.getSnapshot().error.message, '账号信息读取失败，请重试');
  assert.ok(!JSON.stringify(f.controller.getSnapshot()).includes('private-configuration')); f.stop();
});

test('当前401清身份且迟到旧本人不能恢复', async () => {
  const gate = deferred(); const f = fixture({ initialMe: () => gate.promise }); const pending = f.controller.restore();
  f.session.invalidateIfCurrent(f.session.getSnapshot().revision); f.controller.onUnauthorized(); gate.resolve(result(profile)); await pending;
  assert.equal(f.controller.getSnapshot().status, 'anonymous'); assert.equal(f.controller.getSnapshot().customer, null);
  assert.match(f.controller.getSnapshot().notice, /失效/); f.stop();
});

test('到期等号清本地资料和凭证', async () => {
  const f = fixture(); await f.controller.restore(); f.advance(60_000); f.session.current();
  assert.equal(f.controller.getSnapshot().status, 'anonymous'); assert.equal(f.values.size, 0); f.stop();
});

test('旧本人成功或异常迟到都不覆盖新登录', async () => {
  for (const fail of [false, true]) {
    const f = fixture(); await f.controller.restore(); const gate = deferred(); f.behavior.me = () => gate.promise;
    const old = f.controller.restore(true); f.behavior.me = async () => result({ ...profile, id: 'customer-b', nickname: '顾客乙' });
    f.save('customer-token-b'); await f.controller.restore();
    if (fail) gate.reject(new Error('old-failure')); else gate.resolve(result(profile));
    await old; assert.equal(f.controller.getSnapshot().customer.id, 'customer-b'); f.stop();
  }
});

test('迟到旧注销不能清除新登录页面身份', async () => {
  const f = fixture(); await f.controller.restore(); const gate = deferred(); f.behavior.logout = () => gate.promise;
  const old = f.controller.logout(); f.behavior.me = async () => result({ ...profile, id: 'customer-b' });
  f.save('customer-token-b'); await f.controller.restore(); gate.resolve(result({})); await old;
  assert.equal(f.controller.getSnapshot().customer.id, 'customer-b'); assert.ok(f.session.current().credential); f.stop();
});

test('注销等待期间焦点重读不能重新显示旧身份', async () => {
  const f = fixture(); await f.controller.restore(); const gate = deferred(); f.behavior.logout = () => gate.promise;
  const pending = f.controller.logout(); await f.controller.restore(true); await f.controller.restore(true);
  assert.equal(f.calls.me, 1); assert.equal(f.controller.getSnapshot().customer, null);
  gate.resolve(result({})); await pending; assert.equal(f.controller.getSnapshot().status, 'anonymous'); f.stop();
});

test('403只提示并保留会话，不请求员工权限或自动重试', async () => {
  const f = fixture(); await f.controller.restore(); f.controller.onForbidden(); f.controller.onForbidden();
  assert.equal(f.calls.me, 1); assert.ok(f.session.current().credential); assert.equal(f.controller.getSnapshot().status, 'ready'); f.stop();
});

test('公开登录401不创建会话或查询本人', async () => {
  const f = fixture({ loggedIn: false }); f.behavior.login = async () => { throw new ApiClientError('INVALID_CREDENTIALS', '手机号或密码错误', 401); };
  await assert.rejects(f.controller.login({ phone: profile.phone, password: 'WrongPass#2026' }), { status: 401 });
  assert.equal(f.calls.me, 0); assert.equal(f.controller.getSnapshot().status, 'anonymous'); f.stop();
});

test('登录成功保存顾客会话并从本人接口恢复', async () => {
  const f = fixture({ loggedIn: false }); await f.controller.login({ phone: profile.phone, password: 'CustomerPass#2026' });
  assert.equal(f.controller.getSnapshot().status, 'ready'); assert.equal(f.calls.me, 1); assert.equal(f.calls.login, 1); f.stop();
});

test('注册成功只提示去登录，不创建会话或请求本人', async () => {
  const f = fixture({ loggedIn: false }); assert.equal(await f.controller.register({ phone: profile.phone, password: 'CustomerPass#2026' }), true);
  assert.equal(f.calls.register, 1); assert.equal(f.calls.login, 0); assert.equal(f.calls.me, 0); assert.equal(f.values.size, 0);
  assert.equal(f.controller.getSnapshot().status, 'anonymous'); assert.match(f.controller.getSnapshot().notice, /注册成功/); f.stop();
});

test('注册409报告调用方，不伪装成功或自动登录', async () => {
  const f = fixture({ loggedIn: false }); f.behavior.register = async () => { throw new ApiClientError('PHONE_EXISTS', '手机号已注册', 409); };
  await assert.rejects(f.controller.register({ phone: profile.phone, password: 'CustomerPass#2026' }), { status: 409 });
  assert.equal(f.controller.getSnapshot().notice, null); assert.equal(f.values.size, 0); f.stop();
});

test('注册成功迟于新登录，不清资料或产生跳登录指示', async () => {
  const f = fixture({ loggedIn: false }); const gate = deferred(); f.behavior.register = () => gate.promise;
  const pending = f.controller.register({ phone: profile.phone, password: 'CustomerPass#2026' });
  f.save(); await f.controller.restore(); gate.resolve(result({})); assert.equal(await pending, false);
  assert.equal(f.controller.getSnapshot().status, 'ready'); assert.equal(f.controller.getSnapshot().notice, null); f.stop();
});

test('主动清会话后，旧注册响应不再触发成功导航', async () => {
  const f = fixture({ loggedIn: false }); const gate = deferred(); f.behavior.register = () => gate.promise;
  const pending = f.controller.register({ phone: profile.phone, password: 'CustomerPass#2026' });
  f.session.clear(); gate.resolve(result({})); assert.equal(await pending, false); assert.equal(f.controller.getSnapshot().notice, null); f.stop();
});

test('注销成功和网络失败均清本地，失败明确服务器未确认', async () => {
  for (const fail of [false, true]) {
    const f = fixture(); await f.controller.restore();
    if (fail) f.behavior.logout = async () => { throw new ApiClientError('NETWORK_ERROR', '网络失败'); };
    await f.controller.logout(); assert.equal(f.values.size, 0); assert.equal(f.controller.getSnapshot().customer, null);
    assert.match(f.controller.getSnapshot().notice, fail ? /未确认/ : /已退出/); f.stop();
  }
});

test('停止订阅不再自动请求，重启仍能恢复最新会话', async () => {
  const f = fixture(); await f.controller.restore(); f.stop(); f.save('customer-token-b'); assert.equal(f.calls.me, 1);
  const stop = f.controller.start(); await f.controller.restore(); assert.equal(f.calls.me, 2); stop();
});

test('手机号边界与服务端一致，允许首尾空格，不接受国际前缀或非文本', () => {
  for (const phone of ['13900000001', ' 13900000001 ', '19999999999']) assert.equal(phoneIssue(phone), null);
  for (const phone of [undefined, null, 13900000001, '', '+8613900000001', '12900000001', '1390000000', '139000000011', '139 00000001']) assert.ok(phoneIssue(phone));
});

test('可选昵称按Unicode字符计数，空白和超长拒绝', () => {
  for (const nickname of [undefined, '', ' 顾客 ', '😀'.repeat(40)]) assert.equal(nicknameIssue(nickname), null);
  for (const nickname of [null, 1, [], '   ', '😀'.repeat(41)]) assert.ok(nicknameIssue(nickname));
});

test('注册正文只含公开字段，保留密码原文并省略未填昵称', () => {
  assert.deepEqual(registrationInput({ phone: ' 13900000001 ', password: '        ', confirmation: '        ', role: 'SUPER_ADMIN' }), { phone: '13900000001', password: '        ' });
  assert.deepEqual(registrationInput({ phone: profile.phone, password: 'CustomerPass#2026', nickname: ' 昵称 ', confirmation: 'unused' }),
    { phone: profile.phone, password: 'CustomerPass#2026', nickname: '昵称' });
  assert.ok(!('nickname' in registrationInput({ phone: profile.phone, password: 'CustomerPass#2026', nickname: '' })));
});

test('编辑昵称必须填写，按Unicode计数且不改变注册可省略规则', () => {
  for (const value of [undefined, '', null, '   ', '😀'.repeat(41)]) assert.ok(nicknameIssue(value, true));
  for (const value of [' 昵称 ', '😀'.repeat(40)]) assert.equal(nicknameIssue(value, true), null);
  assert.equal(nicknameIssue(undefined), null); assert.equal(nicknameIssue(''), null);
});

test('昵称仅发送trim后的白名单字段，成功立即更新本人且不更换会话', async () => {
  const f = fixture({ status: 'TRADE_RESTRICTED' }); await f.controller.restore(); const credential = f.session.current();
  f.behavior.updateProfile = async input => {
    assert.deepEqual(input, { nickname: '新昵称' }); return result({ ...profile, nickname: '新昵称', status: 'TRADE_RESTRICTED' });
  };
  assert.equal(await f.controller.updateProfile({ nickname: ' 新昵称 ', phone: 'ignored', status: 'NORMAL' }), true);
  assert.equal(f.controller.getSnapshot().customer.nickname, '新昵称'); assert.equal(f.controller.getSnapshot().customer.status, 'TRADE_RESTRICTED');
  assert.equal(f.session.current(), credential); assert.equal(f.calls.me, 1); assert.match(f.controller.getSnapshot().notice, /已保存/); f.stop();
});

test('昵称失败不伪造成功、不重试或清合法会话', async () => {
  for (const status of [400, 403, 500, undefined]) {
    const f = fixture(); await f.controller.restore(); const before = f.controller.getSnapshot();
    f.behavior.updateProfile = async () => { throw new ApiClientError('REQUEST_FAILED', '安全失败提示', status); };
    await assert.rejects(f.controller.updateProfile({ nickname: '修改失败' }), { message: '安全失败提示' });
    assert.equal(f.controller.getSnapshot(), before); assert.ok(f.session.current().credential); assert.equal(f.calls.updateProfile, 1); f.stop();
  }
});

test('昵称保存后迟到的旧本人成功或失败均不能覆盖结果', async () => {
  for (const fail of [false, true]) {
    const f = fixture(); await f.controller.restore(); const gate = deferred(); f.behavior.me = () => gate.promise;
    const oldRead = f.controller.restore(true); await f.controller.updateProfile({ nickname: '保存后的昵称' });
    if (fail) gate.reject(new Error('旧查询失败')); else gate.resolve(result(profile));
    await oldRead; assert.equal(f.controller.getSnapshot().status, 'ready'); assert.equal(f.controller.getSnapshot().customer.nickname, '保存后的昵称'); f.stop();
  }
});

test('旧昵称成功迟于新登录，不覆盖新顾客资料或成功提示', async () => {
  const f = fixture(); await f.controller.restore(); const gate = deferred(); f.behavior.updateProfile = () => gate.promise;
  const pending = f.controller.updateProfile({ nickname: '旧顾客昵称' });
  f.behavior.me = async () => result({ ...profile, id: 'customer-b', nickname: '顾客乙' }); f.save('customer-b'); await f.controller.restore();
  gate.resolve(result({ ...profile, nickname: '旧顾客昵称' })); assert.equal(await pending, false);
  assert.equal(f.controller.getSnapshot().customer.id, 'customer-b'); assert.equal(f.controller.getSnapshot().notice, null); f.stop();
});

test('注销等待中或当前401后，旧昵称响应不能恢复身份', async () => {
  for (const invalidated of [false, true]) {
    const f = fixture(); await f.controller.restore(); const gate = deferred(); f.behavior.updateProfile = () => gate.promise;
    const pending = f.controller.updateProfile({ nickname: '迟到昵称' }); const logoutGate = deferred(); let logout;
    if (invalidated) { f.session.invalidateIfCurrent(f.session.current().revision); f.controller.onUnauthorized(); }
    else { f.behavior.logout = () => logoutGate.promise; logout = f.controller.logout(); }
    gate.resolve(result({ ...profile, nickname: '迟到昵称' })); assert.equal(await pending, false); assert.equal(f.controller.getSnapshot().customer, null);
    if (logout) { logoutGate.resolve(result({ loggedOut: true })); await logout; }
    f.stop();
  }
});

test('改密只发旧新密码原文，成功清资料及本地凭证并提示重新登录', async () => {
  const f = fixture(); await f.controller.restore();
  f.behavior.changePassword = async input => {
    assert.deepEqual(input, { oldPassword: ' OldPass#2026 ', newPassword: ' NewPass#2026 ' }); return result({ changed: true, requireLogin: true });
  };
  await f.controller.changePassword({ oldPassword: ' OldPass#2026 ', newPassword: ' NewPass#2026 ', confirmation: 'ignored' });
  assert.equal(f.controller.getSnapshot().status, 'anonymous'); assert.equal(f.controller.getSnapshot().customer, null); assert.equal(f.values.size, 0);
  assert.match(f.controller.getSnapshot().notice, /密码已修改/); assert.equal(f.calls.changePassword, 1);
  assert.ok(!JSON.stringify(f.controller.getSnapshot()).includes('Pass#2026')); f.stop();
});

test('旧密码401清本域后保留安全错误和请求编号，重新登录时清提示', async () => {
  const f = fixture(); await f.controller.restore();
  const error = new ApiClientError('INVALID_CREDENTIALS', '账号或密码错误', 401, '4b0c8edc-70ab-42c4-a033-af5f4574a86e');
  f.behavior.changePassword = async () => { throw error; };
  await assert.rejects(f.controller.changePassword({ oldPassword: 'WrongPass#2026', newPassword: 'NewPass#2026' }), { status: 401 });
  assert.equal(f.controller.getSnapshot().status, 'anonymous'); assert.equal(f.controller.getSnapshot().error, error); assert.equal(f.values.size, 0);
  assert.match(f.controller.getSnapshot().notice, /密码未修改/); await f.controller.restore(); assert.equal(f.controller.getSnapshot().error, error);
  await f.controller.login({ phone: profile.phone, password: 'CustomerPass#2026' }); assert.equal(f.controller.getSnapshot().error, null); f.stop();
});

test('改密400、403、500或网络失败不假报成功或自动重试', async () => {
  for (const status of [400, 403, 500, undefined]) {
    const f = fixture(); await f.controller.restore(); const before = f.controller.getSnapshot();
    f.behavior.changePassword = async () => { throw new ApiClientError('REQUEST_FAILED', '安全失败提示', status); };
    await assert.rejects(f.controller.changePassword({ oldPassword: 'OldPass#2026', newPassword: 'NewPass#2026' }), { message: '安全失败提示' });
    assert.equal(f.controller.getSnapshot(), before); assert.ok(f.session.current().credential); assert.equal(f.calls.changePassword, 1); f.stop();
  }
});

test('改密成功或401迟于新登录，均不清新会话或插入旧提示', async () => {
  for (const fail of [false, true]) {
    const f = fixture(); await f.controller.restore(); const gate = deferred(); f.behavior.changePassword = () => gate.promise;
    const pending = f.controller.changePassword({ oldPassword: 'OldPass#2026', newPassword: 'NewPass#2026' });
    const outcome = fail ? assert.rejects(pending, { status: 401 }) : pending;
    f.behavior.me = async () => result({ ...profile, id: 'customer-b' }); f.save('customer-b'); await f.controller.restore();
    if (fail) gate.reject(new ApiClientError('INVALID_CREDENTIALS', '账号或密码错误', 401)); else gate.resolve(result({ changed: true, requireLogin: true }));
    await outcome; assert.equal(f.controller.getSnapshot().customer.id, 'customer-b'); assert.equal(f.controller.getSnapshot().notice, null); assert.equal(f.controller.getSnapshot().error, null); f.stop();
  }
});

test('主动注销后迟到改密成功，不覆盖注销提示', async () => {
  const f = fixture(); await f.controller.restore(); const gate = deferred(); f.behavior.changePassword = () => gate.promise;
  const pending = f.controller.changePassword({ oldPassword: 'OldPass#2026', newPassword: 'NewPass#2026' });
  await f.controller.logout(); gate.resolve(result({ changed: true, requireLogin: true })); await pending;
  assert.equal(f.controller.getSnapshot().notice, '已退出登录。'); assert.equal(f.values.size, 0); f.stop();
});
