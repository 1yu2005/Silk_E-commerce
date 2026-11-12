/** 文件作用：验证认证请求隔离、令牌覆盖和错误处理边界。 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { AxiosError } from 'axios';
import { ApiClientError, createApiClient, createEmployeeClient, createCustomerClient, SESSION_KEYS } from '../dist/index.js';

const now = Date.parse('2026-11-12T01:00:00Z'); const requestId = '84266f49-376a-4abc-9342-174b06e60978';
const credentials = { accessToken: 'employee-test-token', tokenType: 'Bearer', expiresAt: new Date(now + 60_000).toISOString() };
function storage() { const values = new Map(); return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; }
function clientOptions(extra = {}) { const local = storage(); return { storage: () => local, now: () => now, ...extra }; }
function response(config, data = { ok: true }, status = 200, headers = {}) { return { config, data: { data, requestId }, status, statusText: '', headers }; }
function failure(config, status, code = 'TOKEN_INVALID', extra = {}) {
  return new AxiosError('不能泄漏的传输异常', 'ERR_BAD_RESPONSE', config, { private: '不能保留请求' }, {
    config, status, statusText: '失败', headers: {}, data: { code, message: '固定服务提示', requestId, ...extra },
  });
}
function deferred() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('创建员工只发送五个字段，保留密码原文，返回公开包裹且不切换管理员会话', async () => {
  const client = createEmployeeClient(clientOptions()); client.session.save(credentials); const before = client.session.current();
  const input = { username: 'service_a', displayName: '客服甲', role: 'CUSTOMER_SERVICE', initialPassword: ' Temp#2026 ', reason: '新增客服' };
  client.api.defaults.adapter = async config => {
    assert.equal(config.method, 'post'); assert.equal(config.url, '/admin/employees'); assert.equal(config.headers.get('Authorization'), 'Bearer employee-test-token');
    assert.deepEqual(JSON.parse(config.data), input); return response(config, { id: 'created-employee', mustChangePassword: true }, 201);
  };
  const result = await client.employees.create({ ...input, confirmation: input.initialPassword, status: 'DISABLED', mustChangePassword: false, token: '不能转发' });
  assert.deepEqual(result, { data: { id: 'created-employee', mustChangePassword: true }, requestId }); assert.equal(client.session.current(), before);
});

test('创建账号冲突409保留管理员登录，传递固定错误码与请求编号', async () => {
  const client = createEmployeeClient(clientOptions()); client.session.save(credentials);
  client.api.defaults.adapter = async config => { throw failure(config, 409, 'USERNAME_EXISTS'); };
  await assert.rejects(client.employees.create({ username: 'duplicate', displayName: '客服', role: 'CUSTOMER_SERVICE', initialPassword: 'Temp#2026', reason: '新增' }),
    { status: 409, code: 'USERNAME_EXISTS', requestId }); assert.ok(client.session.current().credential);
});

test('创建员工真实HTTP使用POST、JSON白名单和本域Bearer', async () => {
  const seen = []; const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body: JSON.parse(body) });
    res.writeHead(201, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: { id: 'created-http' }, requestId }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const client = createEmployeeClient(clientOptions({ baseURL: `http://127.0.0.1:${server.address().port}/api/v1` })); client.session.save(credentials);
    const input = { username: 'warehouse_a', displayName: '仓库甲', role: 'MERCH_WAREHOUSE', initialPassword: ' Raw#2026 ', reason: '人员安排' };
    assert.equal((await client.employees.create({ ...input, confirmation: '不能发送' })).data.id, 'created-http');
    assert.deepEqual(seen, [{ method: 'POST', url: '/api/v1/admin/employees', authorization: 'Bearer employee-test-token', body: input }]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('员工列表仅发送查询白名单，返回包裹并携带本域凭证及取消信号', async () => {
  const client = createEmployeeClient(clientOptions()); client.session.save(credentials); const abort = new AbortController();
  client.api.defaults.adapter = async config => {
    assert.equal(config.method, 'get'); assert.equal(config.url, '/admin/employees'); assert.equal(config.headers.get('Authorization'), 'Bearer employee-test-token');
    assert.deepEqual(config.params, { page: 2, pageSize: 10, keyword: '员工%_', role: 'CUSTOMER_SERVICE', status: 'ACTIVE' }); assert.equal(config.signal, abort.signal);
    return response(config, { items: [], page: 2, pageSize: 10, total: 0 });
  };
  const result = await client.employees.list({ page: 2, pageSize: 10, keyword: '员工%_', role: 'CUSTOMER_SERVICE', status: 'ACTIVE', password: '不能转发' }, abort.signal);
  assert.equal(result.requestId, requestId); assert.deepEqual(result.data, { items: [], page: 2, pageSize: 10, total: 0 });
});

test('员工详情UUID路径规范化，拒绝路径注入且不越登录域', async () => {
  const client = createEmployeeClient(clientOptions()); client.session.save(credentials); let calls = 0;
  client.api.defaults.adapter = async config => { calls++; assert.equal(config.url, '/admin/employees/abcdef00-1234-4234-8234-abcdef123456'); return response(config, { id: 'employee-a' }); };
  assert.equal((await client.employees.detail('ABCDEF00-1234-4234-8234-ABCDEF123456')).data.id, 'employee-a');
  await assert.rejects(client.employees.detail('../me'), { code: 'CLIENT_REQUEST_TARGET_INVALID' }); assert.equal(calls, 1);
  assert.equal('employees' in createCustomerClient(clientOptions()), false);
});

test('员工详情404保持合法会话并暴露安全错误与请求编号', async () => {
  const client = createEmployeeClient(clientOptions()); client.session.save(credentials);
  client.api.defaults.adapter = async config => { throw failure(config, 404, 'NOT_FOUND'); };
  await assert.rejects(client.employees.detail('abcdef00-1234-4234-8234-abcdef123456'), { code: 'NOT_FOUND', status: 404, requestId });
  assert.ok(client.session.current().credential);
});

test('员工查询真实HTTP正确发送分页、文字关键词、详情路径与Bearer', async () => {
  const seen = []; const id = 'abcdef00-1234-4234-8234-abcdef123456';
  const server = createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: { ok: true }, requestId }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const client = createEmployeeClient(clientOptions({ baseURL: `http://127.0.0.1:${server.address().port}/api/v1` })); client.session.save(credentials);
    await client.employees.list({ page: 2, pageSize: 10, keyword: '文本%_', role: 'CUSTOMER_SERVICE', status: 'DISABLED' }); await client.employees.detail(id);
    const url = new URL(seen[0].url, 'http://api.invalid'); assert.equal(url.pathname, '/api/v1/admin/employees');
    assert.deepEqual(Object.fromEntries(url.searchParams), { page: '2', pageSize: '10', keyword: '文本%_', role: 'CUSTOMER_SERVICE', status: 'DISABLED' });
    assert.equal(seen[1].url, `/api/v1/admin/employees/${id}`); assert.ok(seen.every(item => item.method === 'GET' && item.authorization === 'Bearer employee-test-token'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('两客户端读取各自凭证，不使用全局Axios或调用方的Authorization', async () => {
  const shared = storage(); const employee = createEmployeeClient({ storage: () => shared, now: () => now }); const customer = createCustomerClient({ storage: () => shared, now: () => now });
  employee.session.save(credentials); customer.session.save({ ...credentials, accessToken: 'customer-test-token' });
  employee.api.defaults.headers.common.Authorization = '不能沿用的旧token';
  const seen = []; for (const client of [employee, customer]) client.api.defaults.adapter = async config => { seen.push(config.headers.get('Authorization')); assert.equal(config.auth, undefined); return response(config); };
  await employee.api.get('/admin/me', { headers: { authorization: '手填其他token' }, auth: { username: '不会发送', password: '不会发送' } });
  await customer.api.get('/store/me'); employee.session.save({ ...credentials, accessToken: 'employee-new-token' }); await employee.auth.me();
  assert.deepEqual(seen, ['Bearer employee-test-token', 'Bearer customer-test-token', 'Bearer employee-new-token']);
});

test('公开登录、注册及健康检查不携带已登录token，注册不自动登录', async () => {
  const client = createCustomerClient(clientOptions()); client.session.save(credentials); const before = client.session.current(); let calls = 0;
  client.api.defaults.adapter = async config => { calls++; assert.equal(config.headers.has('Authorization'), false); return response(config); };
  await client.auth.register({ phone: '13800138001', password: 'PublicDemo#2026' }); await client.api.get('/health/live');
  await client.api.post('/store/auth/login', { phone: '13800138001', password: 'PublicDemo#2026' });
  assert.equal(client.session.current(), before); assert.equal(calls, 3);
});

for (const [domain, factory, url] of [['员工', createEmployeeClient, '/store/me'], ['顾客', createCustomerClient, '/admin/me']]) {
  test(`${domain}客户端拒绝其他登录域，未发送HTTP`, async () => {
    const client = factory(clientOptions()); client.session.save(credentials); let calls = 0; client.api.defaults.adapter = async config => { calls++; return response(config); };
    await assert.rejects(client.api.get(url), error => error instanceof ApiClientError && error.code === 'CLIENT_REQUEST_TARGET_INVALID'); assert.equal(calls, 0); assert.ok(client.session.current().credential);
  });
}
for (const url of ['https://other.invalid/store/me', '//other.invalid/store/me', '/store/../admin/me', '/store/%2e%2e/admin/me', '/store/%2f/admin/me', '\\other.invalid/store/me']) {
  test(`拒绝非本域或含歧义的请求路径 ${url}`, async () => {
    const client = createCustomerClient(clientOptions()); client.session.save(credentials); let sent = false; client.api.defaults.adapter = async config => { sent = true; return response(config); };
    await assert.rejects(client.api.get(url), { code: 'CLIENT_REQUEST_TARGET_INVALID' }); assert.equal(sent, false); assert.ok(client.session.current().credential);
  });
}
test('不能通过单次请求baseURL覆盖把凭证发往其它服务器', async () => {
  const client = createEmployeeClient(clientOptions()); client.session.save(credentials); let sent = false; client.api.defaults.adapter = async config => { sent = true; return response(config); };
  await assert.rejects(client.api.get('/admin/me', { baseURL: 'https://other.invalid/api/v1' }), { code: 'CLIENT_REQUEST_TARGET_INVALID' }); assert.equal(sent, false);
});

test('当前401清理本域会话并通知一次，另一登录域保持', async () => {
  const shared = storage(); let notified = 0; const employee = createEmployeeClient({ storage: () => shared, now: () => now, onUnauthorized: () => notified++ }); const customer = createCustomerClient({ storage: () => shared, now: () => now });
  employee.session.save(credentials); customer.session.save(credentials);
  employee.api.defaults.adapter = async config => { assert.equal(config.validateStatus(401), false); throw failure(config, 401); };
  await assert.rejects(employee.api.get('/admin/me', { validateStatus: () => true }), { code: 'TOKEN_INVALID', status: 401 });
  assert.equal(employee.session.current().credential, null); assert.equal(shared.getItem(SESSION_KEYS.EMPLOYEE), null); assert.ok(customer.session.current().credential); assert.equal(notified, 1);
});

test('公开登录401保留现有会话，不触发退出通知', async () => {
  let notified = 0; const client = createEmployeeClient(clientOptions({ onUnauthorized: () => notified++ })); client.session.save(credentials); const before = client.session.current();
  client.api.defaults.adapter = async config => { assert.equal(config.headers.has('Authorization'), false); throw failure(config, 401, 'INVALID_CREDENTIALS'); };
  await assert.rejects(client.auth.login({ username: 'demo', password: 'WrongDemo#2026' }), { code: 'INVALID_CREDENTIALS' }); assert.equal(client.session.current(), before); assert.equal(notified, 0);
});

for (const code of ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED']) {
  test(`403 ${code}保留会话并通知，不自动刷新或重试请求`, async () => {
    const notifications = []; const client = createEmployeeClient(clientOptions({ onForbidden: code => notifications.push(code) })); client.session.save(credentials); const before = client.session.current(); let calls = 0;
    client.api.defaults.adapter = async config => { calls++; throw failure(config, 403, code); };
    await assert.rejects(client.auth.permissions(), { code, status: 403 }); assert.equal(client.session.current(), before); assert.deepEqual(notifications, [code]); assert.equal(calls, 1);
  });
}

for (const status of [401, 403]) {
  test(`迟到的旧${status}不影响新登录，即使token字符串相同`, async () => {
    let notified = 0; const client = createEmployeeClient(clientOptions({ onUnauthorized: () => notified++, onForbidden: () => notified++ })); client.session.save(credentials);
    const gate = deferred(); let config; client.api.defaults.adapter = value => { config = value; return gate.promise; }; const pending = client.auth.me();
    client.session.save(credentials); const fresh = client.session.current(); gate.reject(failure(config, status)); await assert.rejects(pending, { status }); assert.equal(client.session.current(), fresh); assert.equal(notified, 0);
  });
}
test('多个在途401只清理并通知一次', async () => {
  let notified = 0; const client = createCustomerClient(clientOptions({ onUnauthorized: () => notified++ })); client.session.save(credentials); const queue = [];
  client.api.defaults.adapter = config => { const gate = deferred(); queue.push({ ...gate, config }); return gate.promise; };
  const first = client.auth.me(); const second = client.auth.me();
  for (const pending of queue) pending.reject(failure(pending.config, 401));
  const results = await Promise.allSettled([first, second]); assert.ok(results.every(result => result.status === 'rejected')); assert.equal(notified, 1); assert.equal(client.session.current().credential, null);
});

for (const [status, code] of [[400, 'VALIDATION_FAILED'], [409, 'VERSION_CONFLICT'], [429, 'AUTH_RATE_LIMITED'], [500, 'INTERNAL_ERROR']]) {
  test(`${status}保留会话，不自动重试，保留服务端requestId`, async () => {
    const client = createEmployeeClient(clientOptions()); client.session.save(credentials); const before = client.session.current(); let calls = 0;
    client.api.defaults.adapter = async config => { calls++; const error = failure(config, status, code, { details: [{ field: 'nickname', message: '不合法', private: '必须剔除' }] }); error.response.headers['retry-after'] = '17'; throw error; };
    await assert.rejects(client.auth.me(), error => {
      assert.ok(error instanceof ApiClientError); assert.equal(error.requestId, requestId); assert.equal(error.status, status); assert.equal(error.code, code); assert.equal(error.retryAfterSeconds, 17);
      assert.deepEqual(error.details, [{ field: 'nickname', message: '不合法' }]); assert.equal(error.config, undefined); assert.equal(error.cause, undefined); return true;
    });
    assert.equal(client.session.current(), before); assert.equal(calls, 1);
  });
}

for (const [code, normalized] of [['ECONNABORTED', 'REQUEST_TIMEOUT'], ['ETIMEDOUT', 'REQUEST_TIMEOUT'], ['ERR_NETWORK', 'NETWORK_ERROR'], ['ERR_CANCELED', 'REQUEST_CANCELED']]) {
  test(`${code}使用固定网络错误且保留会话`, async () => {
    const client = createCustomerClient(clientOptions()); client.session.save(credentials); const before = client.session.current();
    client.api.defaults.adapter = async config => { const error = new AxiosError('secret-password-in-raw-error', code, config); if (code === 'ERR_CANCELED') error.__CANCEL__ = true; throw error; };
    await assert.rejects(client.auth.me(), error => error instanceof ApiClientError && error.code === normalized && !String(error).includes('secret-password') && !JSON.stringify(error).includes(credentials.accessToken)); assert.equal(client.session.current(), before);
  });
}

test('非API响应和非Axios异常不向页面暴露原始内容', async () => {
  const client = createEmployeeClient(clientOptions());
  client.api.defaults.adapter = async config => { const error = failure(config, 502); error.response.data = '<html>private-server-data</html>'; throw error; };
  await assert.rejects(client.auth.me(), error => error.code === 'HTTP_ERROR' && error.status === 502 && !JSON.stringify(error).includes('private-server-data'));
  client.api.defaults.adapter = async () => { throw new Error('private-password'); };
  await assert.rejects(client.auth.me(), error => error.code === 'REQUEST_FAILED' && !String(error).includes('private-password'));
});

test('登录保存所属域凭证，me/权限/顾客资料更新返回HTTP包裹并使用正确方法', async () => {
  const employee = createEmployeeClient(clientOptions()); const customer = createCustomerClient(clientOptions()); const seen = [];
  for (const client of [employee, customer]) client.api.defaults.adapter = async config => { seen.push([config.method, config.url, config.headers.get('Authorization')]); return response(config, config.url.endsWith('/login') ? credentials : { safe: true }); };
  const employeeLogin = await employee.auth.login({ username: 'demo', password: 'Demo#2026' }); assert.equal(employeeLogin.requestId, requestId); assert.equal(employee.session.current().credential.domain, 'EMPLOYEE');
  await employee.auth.me(); await employee.auth.permissions(); await customer.auth.login({ phone: '13800138001', password: 'Demo#2026' }); await customer.auth.me(); const updated = await customer.auth.updateProfile({ nickname: '顾客甲' });
  assert.deepEqual(updated, { data: { safe: true }, requestId });
  assert.deepEqual(seen.map(row => row.slice(0, 2)), [['post', '/admin/auth/login'], ['get', '/admin/me'], ['get', '/admin/me/permissions'], ['post', '/store/auth/login'], ['get', '/store/me'], ['patch', '/store/me']]);
  assert.equal(seen[0][2], undefined); assert.equal(seen[3][2], undefined); assert.ok(seen.filter((_, index) => ![0, 3].includes(index)).every(row => row[2] === `Bearer ${credentials.accessToken}`));
});

for (const factory of [createEmployeeClient, createCustomerClient]) {
  test(`${factory.name}改密成功清会话并要求重新登录`, async () => {
    const client = factory(clientOptions()); client.session.save(credentials);
    client.api.defaults.adapter = async config => { assert.equal(config.method, 'post'); assert.ok(config.url.endsWith('/auth/change-password')); return response(config, { changed: true, requireLogin: true }); };
    const result = await client.auth.changePassword({ oldPassword: 'OldDemo#2026', newPassword: 'NewDemo#2026' }); assert.deepEqual(result.data, { changed: true, requireLogin: true }); assert.equal(client.session.current().credential, null);
  });
}
test('改密403保留会话，当前旧密码401按统一策略清会话', async () => {
  const client = createCustomerClient(clientOptions()); client.session.save(credentials);
  client.api.defaults.adapter = async config => { throw failure(config, 403, 'FORBIDDEN'); }; await assert.rejects(client.auth.changePassword({ oldPassword: 'OldDemo#2026', newPassword: 'NewDemo#2026' }), { status: 403 }); assert.ok(client.session.current().credential);
  client.api.defaults.adapter = async config => { throw failure(config, 401, 'INVALID_CREDENTIALS'); }; await assert.rejects(client.auth.changePassword({ oldPassword: 'WrongDemo#2026', newPassword: 'NewDemo#2026' }), { status: 401 }); assert.equal(client.session.current().credential, null);
});

for (const kind of ['成功', '网络失败', '401']) {
  test(`注销${kind}均清本地会话，失败仍传给调用方`, async () => {
    const client = createEmployeeClient(clientOptions()); client.session.save(credentials);
    client.api.defaults.adapter = async config => { assert.equal(config.url, '/auth/logout'); assert.equal(config.headers.get('Authorization'), `Bearer ${credentials.accessToken}`); assert.equal(config.data, '{}');
      if (kind === '网络失败') throw new AxiosError('private-network-error', 'ERR_NETWORK', config);
      if (kind === '401') throw failure(config, 401); return response(config, { loggedOut: true }); };
    if (kind === '成功') assert.equal((await client.auth.logout()).data.loggedOut, true); else await assert.rejects(client.auth.logout(), ApiClientError);
    assert.equal(client.session.current().credential, null);
  });
}
test('迟到的注销/改密成功不清理新登录会话', async () => {
  for (const kind of ['logout', 'changePassword']) {
    const client = createCustomerClient(clientOptions()); client.session.save(credentials); const gate = deferred(); let config;
    client.api.defaults.adapter = value => { config = value; return gate.promise; }; const pending = kind === 'logout' ? client.auth.logout() : client.auth.changePassword({ oldPassword: 'OldDemo#2026', newPassword: 'NewDemo#2026' });
    client.session.save({ ...credentials, accessToken: 'new-login-token' }); gate.resolve(response(config, kind === 'logout' ? { loggedOut: true } : { changed: true, requireLogin: true })); await pending; assert.equal(client.session.current().credential.accessToken, 'new-login-token');
  }
});
test('并发登录仅保存最新尝试，注销后迟到的登录不恢复会话', async () => {
  const client = createEmployeeClient(clientOptions()); const queue = [];
  client.api.defaults.adapter = config => { if (config.url === '/auth/logout') return Promise.resolve(response(config, { loggedOut: true })); const gate = deferred(); queue.push({ ...gate, config }); return gate.promise; };
  const first = client.auth.login({ username: 'first', password: 'Demo#2026' }); const second = client.auth.login({ username: 'second', password: 'Demo#2026' });
  queue[1].resolve(response(queue[1].config, { ...credentials, accessToken: 'second-token' })); await second; queue[0].resolve(response(queue[0].config, { ...credentials, accessToken: 'first-token' })); await first; assert.equal(client.session.current().credential.accessToken, 'second-token');
  const third = client.auth.login({ username: 'third', password: 'Demo#2026' }); await client.auth.logout(); queue[2].resolve(response(queue[2].config, credentials)); await third; assert.equal(client.session.current().credential, null);
});
test('旧会话401先到时，正在进行的最新登录仍能保存新凭证', async () => {
  const client = createEmployeeClient(clientOptions()); client.session.save(credentials); const queue = [];
  client.api.defaults.adapter = config => { const gate = deferred(); queue.push({ ...gate, config }); return gate.promise; };
  const previous = assert.rejects(client.auth.me(), { status: 401 }); const signingIn = client.auth.login({ username: 'new_account', password: 'Demo#2026' });
  queue[0].reject(failure(queue[0].config, 401)); await previous;
  queue[1].resolve(response(queue[1].config, { ...credentials, accessToken: 'new-account-token' })); await signingIn;
  assert.equal(client.session.current().credential?.accessToken, 'new-account-token');
});
test('显式清理会话后，之前尚未完成的登录不能恢复凭证', async () => {
  const client = createEmployeeClient(clientOptions()); const gate = deferred(); let config;
  client.api.defaults.adapter = value => { config = value; return gate.promise; };
  const signingIn = client.auth.login({ username: 'demo', password: 'Demo#2026' }); client.session.clear();
  gate.resolve(response(config, credentials)); await signingIn; assert.equal(client.session.current().credential, null);
});
test('凭证过期后下一请求不发送token，当前失败触发未登录处理', async () => {
  let millis = now; let notified = 0; const client = createCustomerClient(clientOptions({ now: () => millis, onUnauthorized: () => notified++ })); client.session.save(credentials); millis += 60_000;
  client.api.defaults.adapter = async config => { assert.equal(config.headers.has('Authorization'), false); throw failure(config, 401); };
  await assert.rejects(client.auth.me(), { status: 401 }); assert.equal(client.session.current().credential, null); assert.equal(notified, 1);
});

test('真实Axios HTTP发送验证：两域独立Bearer、公开请求无凭证、401/403及注销', async () => {
  const seen = []; const server = createServer((request, response) => {
    const path = request.url; seen.push([request.method, path, request.headers.authorization]); let data = { ok: true }; let status = 200;
    if (path.endsWith('/auth/login')) data = { ...credentials, accessToken: path.startsWith('/api/v1/admin/') ? 'employee-http-token' : 'customer-http-token' };
    if (path === '/api/v1/admin/me/permissions') { status = 403; data = { code: 'FORBIDDEN', message: '无权访问', requestId }; }
    if (path === '/api/v1/store/me?revoked=1') { status = 401; data = { code: 'SESSION_REVOKED', message: '会话已撤销', requestId }; }
    if (path === '/api/v1/auth/logout') data = { loggedOut: true };
    response.writeHead(status, { 'Content-Type': 'application/json', 'X-Request-Id': requestId }); response.end(JSON.stringify(status >= 400 ? data : { data, requestId }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const baseURL = `http://127.0.0.1:${server.address().port}/api/v1`; const shared = storage();
    const employee = createEmployeeClient({ baseURL, storage: () => shared, now: () => now }); const customer = createCustomerClient({ baseURL, storage: () => shared, now: () => now });
    employee.api.defaults.proxy = false; customer.api.defaults.proxy = false;
    await employee.auth.login({ username: 'demo', password: 'Demo#2026' }); await customer.auth.login({ phone: '13800138001', password: 'Demo#2026' });
    await employee.auth.me(); await customer.auth.me(); await assert.rejects(employee.auth.permissions(), { code: 'FORBIDDEN', status: 403 }); assert.ok(employee.session.current().credential);
    await assert.rejects(customer.api.get('/store/me?revoked=1'), { code: 'SESSION_REVOKED', status: 401 }); assert.equal(customer.session.current().credential, null); assert.ok(employee.session.current().credential);
    await employee.auth.logout(); assert.equal(employee.session.current().credential, null);
    assert.deepEqual(seen, [['POST', '/api/v1/admin/auth/login', undefined], ['POST', '/api/v1/store/auth/login', undefined], ['GET', '/api/v1/admin/me', 'Bearer employee-http-token'],
      ['GET', '/api/v1/store/me', 'Bearer customer-http-token'], ['GET', '/api/v1/admin/me/permissions', 'Bearer employee-http-token'], ['GET', '/api/v1/store/me?revoked=1', 'Bearer customer-http-token'], ['POST', '/api/v1/auth/logout', 'Bearer employee-http-token']]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('保留原无认证Axios工厂供普通传输使用', async () => {
  const api = createApiClient('/api/v1'); api.defaults.adapter = async config => response(config); assert.equal(api.defaults.timeout, 10_000); assert.equal((await api.get('/health/live')).status, 200);
});
