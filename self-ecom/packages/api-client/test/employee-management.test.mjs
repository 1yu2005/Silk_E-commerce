/** 文件作用：验证员工管理客户端的路径、方法、白名单和会话保护。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AxiosError } from 'axios';
import { createEmployeeClient, createCustomerClient } from '../dist/index.js';

const id = 'ABCDEF00-1234-4234-8234-ABCDEF123456'; const requestId = 'ee17de27-9607-4e66-a39c-d5abcf784204';
const command = { expectedVersion: 7, reason: '调整安排' };
const cases = [
  ['updateProfile', 'patch', 'profile', { ...command, displayName: '客服甲' }],
  ['enable', 'post', 'enable', command], ['disable', 'post', 'disable', command],
  ['resetPassword', 'post', 'reset-password', { ...command, temporaryPassword: ' Temp#2026 ' }],
  ['changeRole', 'post', 'change-role', { ...command, role: 'CUSTOMER_SERVICE' }],
  ['setExtraPermissions', 'put', 'extra-permissions', { ...command, permissions: ['shipment.pack'] }],
];
for (const [method, verb, suffix, input] of cases) {
  test(`${method}发送正确路径方法、白名单、版本和原始密码；不切换会话`, async () => {
    const client = createEmployeeClient({ storage: () => null }); client.session.save({ accessToken: 'management-token', tokenType: 'Bearer', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const before = client.session.current(); const payload = { id: id.toLowerCase(), version: 8, changed: true }; let calls = 0;
    client.api.defaults.adapter = async config => {
      calls++; assert.equal(config.url, `/admin/employees/${id.toLowerCase()}/${suffix}`); assert.equal(config.method, verb);
      assert.deepEqual(JSON.parse(config.data), input); assert.equal(config.headers.get('Authorization'), 'Bearer management-token');
      return { config, status: 200, headers: {}, data: { data: payload, requestId } };
    };
    assert.deepEqual(await client.employees[method](id, { ...input, confirmation: '不能发送', token: '不能发送', status: 'DISABLED' }), { data: payload, requestId });
    assert.equal(client.session.current(), before); assert.equal(calls, 1);
  });
  test(`${method}拒绝路径穿越，不能把管理操作发到其他目标`, async () => {
    const client = createEmployeeClient({ storage: () => null }); let calls = 0;
    client.api.defaults.adapter = async () => { calls++; throw new Error('不能到达传输层'); };
    await assert.rejects(client.employees[method]('../me', input), { code: 'CLIENT_REQUEST_TARGET_INVALID' }); assert.equal(calls, 0);
  });
}
test('权限目录GET支持取消，仅员工客户端暴露管理方法', async () => {
  const client = createEmployeeClient({ storage: () => null }); const abort = new AbortController();
  client.api.defaults.adapter = async config => {
    assert.equal(config.method, 'get'); assert.equal(config.url, '/admin/permissions'); assert.equal(config.signal, abort.signal);
    return { config, status: 200, headers: {}, data: { data: { permissions: [], roleTemplates: {} }, requestId } };
  };
  assert.deepEqual((await client.employees.catalog(undefined, abort.signal)).data, { permissions: [], roleTemplates: {} });
  assert.equal('employees' in createCustomerClient({ storage: () => null }), false);
});
test('版本冲突及最后管理员保护保留登录并传递错误码，不重放管理请求', async () => {
  for (const code of ['VERSION_CONFLICT', 'LAST_ADMIN_REQUIRED']) {
    const client = createEmployeeClient({ storage: () => null }); client.session.save({ accessToken: 'management-token', tokenType: 'Bearer', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const before = client.session.current(); let calls = 0;
    client.api.defaults.adapter = async config => { calls++; throw new AxiosError('内部异常', 'ERR_BAD_RESPONSE', config, {}, { config, status: 409, headers: {}, data: { code, message: '安全提示', requestId } }); };
    await assert.rejects(client.employees.disable(id, command), { code, status: 409, requestId }); assert.equal(calls, 1); assert.equal(client.session.current(), before);
  }
});
