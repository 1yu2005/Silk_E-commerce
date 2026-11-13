/** 文件作用：验证生成调用器确实复用认证与错误处理，并拒绝路径覆盖；文件仍由薄封装处理。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AxiosError } from 'axios';
import { createGeneratedClient, createEmployeeClient, createCustomerClient } from '../dist/index.js';
const requestId = 'e0b033ca-326a-4c2d-a12b-f7b9fd45048b'; const id = '22c83526-f172-431a-a5f1-d6348f292e81';
const credential = { accessToken: 'generated-test-token', expiresAt: new Date(Date.now() + 60000).toISOString(), tokenType: 'Bearer' };
test('生成JSON调用器复用员工Bearer，只发契约内的查询；不接收覆盖url/header', async () => {
  const client = createEmployeeClient({ storage: () => null }); client.session.save(credential);
  client.api.defaults.adapter = async config => {
    assert.equal(config.url, '/admin/employees'); assert.equal(config.headers.get('Authorization'), `Bearer ${credential.accessToken}`);
    assert.deepEqual(config.params, { page: 2 }); assert.equal(config.baseURL, '/api/v1');
    return { config, status: 200, headers: {}, data: { data: { items: [], total: 0, page: 2, pageSize: 20 }, requestId } };
  };
  await createGeneratedClient(client.api).listEmployees({ query: { page: 2, secret: '不得发送' }, url: 'https://outside.invalid', headers: { Authorization: 'bad' } });
});
test('顾客不能借生成调用器调用员工域；非法UUID不能注入路径', async () => {
  const client = createCustomerClient({ storage: () => null }); let calls = 0;
  client.api.defaults.adapter = async () => { calls++; throw Error('不应请求'); };
  const generated = createGeneratedClient(client.api);
  await assert.rejects(generated.getEmployeeDetail({ path: { id } }), { code: 'CLIENT_REQUEST_TARGET_INVALID' });
  for (const value of ['../me', id + '?token=bad', id + '/content', '%2e%2e']) await assert.rejects(generated.getFileMetadata({ path: { id: value } }), { code: 'CLIENT_REQUEST_TARGET_INVALID' });
  assert.equal(calls, 0);
});
test('生成JSON失败仍清当前会话并保留安全requestId，不自动重试', async () => {
  let unauthorized = 0; let calls = 0; const client = createCustomerClient({ storage: () => null, onUnauthorized: () => unauthorized++ }); client.session.save(credential);
  client.api.defaults.adapter = async config => { calls++; throw new AxiosError('不展示的传输信息', 'ERR_BAD_RESPONSE', config, {},
    { status: 401, config, headers: {}, data: { code: 'SESSION_REVOKED', message: '登录已失效', requestId } }); };
  await assert.rejects(createGeneratedClient(client.api).getCustomerMe(), { status: 401, requestId });
  assert.equal(client.session.current().credential, null); assert.equal(unauthorized, 1); assert.equal(calls, 1);
});
