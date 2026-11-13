// 作用：验证设置生成调用器复用认证、并发错误与公开无凭证传输，不手写另一套设置类型。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AxiosError } from 'axios';
import { createEmployeeClient, createCustomerClient, createGeneratedClient } from '../dist/index.js';
const id = '22c83526-f172-431a-a5f1-d6348f292e81'; const requestId = 'e0b033ca-326a-4c2d-a12b-f7b9fd45048b';
const credential = { accessToken: 'settings-test-token', expiresAt: new Date(Date.now() + 60000).toISOString(), tokenType: 'Bearer' };
test('管理员设置读写及历史使用原Bearer，分页仅发送声明字段', async () => {
  const client = createEmployeeClient({ storage: () => null }); client.session.save(credential); const seen = [];
  client.api.defaults.adapter = async config => {
    assert.equal(config.headers.get('Authorization'), `Bearer ${credential.accessToken}`);
    seen.push({ url: config.url, method: config.method, params: config.params, body: config.data });
    return { config, status: 200, headers: {}, data: { data: {}, requestId } };
  };
  const api = createGeneratedClient(client.api); const body = { expectedVersion: 1, reason: '保存完整配置', deadlines: { reviewWorkdays: 2 } };
  await api.getStoreSettings(); await api.updateStoreSettings({ body });
  await api.listStoreSettingVersions({ query: { page: 2, pageSize: 5, secret: '不得发送' } });
  await api.getStoreSettingVersion({ path: { id: id.toUpperCase() } });
  assert.deepEqual(seen.map(row => [row.url, row.method]), [['/admin/settings', 'get'], ['/admin/settings', 'put'],
    ['/admin/settings/versions', 'get'], [`/admin/settings/versions/${id}`, 'get']]);
  assert.deepEqual(JSON.parse(seen[1].body), body); assert.deepEqual(seen[2].params, { page: 2, pageSize: 5 });
});
for (const [name, factory] of [['员工', createEmployeeClient], ['顾客', createCustomerClient]]) {
  test(`${name}读取公开联系方式不发送Bearer`, async () => {
    const client = factory({ storage: () => null }); client.session.save(credential);
    client.api.defaults.headers.common.Authorization = '不应发送的旧凭证';
    client.api.defaults.adapter = async config => {
      assert.equal(config.url, '/store/contact'); assert.equal(config.headers.get('Authorization'), undefined);
      return { config, status: 200, headers: {}, data: { data: { configured: false, servicePhone: null, serviceHours: null, settingsVersion: 0 }, requestId } };
    };
    assert.equal((await createGeneratedClient(client.api).getStoreContact()).data.configured, false);
  });
}
test('设置409只返回冲突和requestId，不清会话、不重试', async () => {
  let calls = 0; const client = createEmployeeClient({ storage: () => null }); client.session.save(credential);
  client.api.defaults.adapter = async config => { calls++; throw new AxiosError('不展示传输错误', 'ERR_BAD_RESPONSE', config, {},
    { status: 409, config, headers: {}, data: { code: 'VERSION_CONFLICT', message: '全店设置已更新，请刷新后重试', requestId } }); };
  await assert.rejects(createGeneratedClient(client.api).updateStoreSettings({ body: {} }), { status: 409, code: 'VERSION_CONFLICT', requestId });
  assert.equal(calls, 1); assert.ok(client.session.current().credential);
});
test('公开联系方式失败不触发认证失效或清除会话；顾客仍不能访问管理员设置', async () => {
  let notified = 0; const client = createCustomerClient({ storage: () => null, onUnauthorized: () => notified++ }); client.session.save(credential);
  client.api.defaults.adapter = async config => { throw new AxiosError('错误', 'ERR_BAD_RESPONSE', config, {},
    { status: 401, config, headers: {}, data: { code: 'UNAUTHORIZED', message: '暂不可用', requestId } }); };
  await assert.rejects(createGeneratedClient(client.api).getStoreContact(), { status: 401 });
  assert.equal(notified, 0); assert.ok(client.session.current().credential);
  await assert.rejects(createGeneratedClient(client.api).getStoreSettings(), { code: 'CLIENT_REQUEST_TARGET_INVALID' });
});
