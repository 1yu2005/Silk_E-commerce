/** 文件作用：验证文件请求双域隔离、multipart、Blob错误解析与头像命令白名单。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AxiosError } from 'axios';
import { createCustomerClient, createEmployeeClient } from '../dist/index.js';
const id = '84266f49-376a-4abc-9342-174b06e60978'; const requestId = '74266f49-376a-4abc-9342-174b06e60978';
function client(factory = createCustomerClient) {
  const values = new Map(); const result = factory({ storage: () => ({ getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }) });
  result.session.save({ accessToken: '仅文件测试的本域令牌', tokenType: 'Bearer', expiresAt: new Date(Date.now() + 60000).toISOString() }); return result;
}
const success = (config, data) => ({ config, data, status: 200, headers: {}, statusText: '' });
for (const factory of [createCustomerClient, createEmployeeClient]) test(`${factory.name}受限文件上传与私有Blob带本域凭证，URL无token`, async () => {
  const c = client(factory); const seen = [];
  c.api.defaults.adapter = async config => {
    seen.push(config.url); assert.equal(config.headers.get('Authorization'), 'Bearer 仅文件测试的本域令牌');
    if (config.url === '/files') {
      assert.equal(config.timeout, 45000); assert.ok(config.data instanceof FormData);
      assert.deepEqual([...config.data.keys()], ['purpose', 'file']); return success(config, { data: { id }, requestId });
    }
    return success(config, new Blob(['png'], { type: 'image/png' }));
  };
  assert.equal((await c.files.upload(factory === createCustomerClient ? 'CUSTOMER_AVATAR' : 'PRODUCT_IMAGE', new File(['img'], 'x.png', { type: 'image/png' }))).data.id, id);
  assert.equal((await c.files.content(id)).type, 'image/png'); assert.deepEqual(seen, ['/files', `/files/${id}/content`]);
  for (const path of ['/files/private', '/files/' + id + '/bind', '/files/' + id + '/content/other']) await assert.rejects(c.api.get(path), { code: 'CLIENT_REQUEST_TARGET_INVALID' });
  await assert.rejects(c.files.content('../admin/me'), { code: 'CLIENT_REQUEST_TARGET_INVALID' });
});
for (const status of [401, 403, 404, 413, 429]) test(`Blob JSON ${status}保留错误码/编号，只有401清当前会话`, async () => {
  const c = client(); c.api.defaults.adapter = async config => {
    throw new AxiosError('不能回显的请求细节', 'ERR_BAD_RESPONSE', config, {}, { config, status, statusText: '', headers: { 'retry-after': '3' },
      data: new Blob([JSON.stringify({ code: 'FILE_TEST_FAILURE', message: '安全图片错误', requestId })], { type: 'application/json' }) });
  };
  await assert.rejects(c.files.content(id), { status, code: 'FILE_TEST_FAILURE', requestId, retryAfterSeconds: 3 });
  assert.equal(Boolean(c.session.current().credential), status !== 401);
});
test('200 JSON不能被当成图片，头像PUT只发fileId，DELETE无业务体', async () => {
  const c = client(); c.api.defaults.adapter = async config => {
    if (config.responseType === 'blob') return success(config, new Blob(['{}'], { type: 'application/json' }));
    assert.equal(config.url, '/store/me/avatar');
    if (config.method === 'put') assert.deepEqual(JSON.parse(config.data), { fileId: id }); else { assert.equal(config.method, 'delete'); assert.equal(config.data, undefined); }
    return success(config, { data: { changed: true }, requestId });
  };
  await assert.rejects(c.files.content(id), { code: 'FILE_RESPONSE_INVALID' }); await c.auth.setAvatar(id); await c.auth.removeAvatar();
});
