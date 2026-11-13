// 文件作用：为独立Compose验收补充真实图片、两站代理、Swagger操作和跨重建读取证据；不连接开发库。
/* global document, NodeFilter */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

export async function verifyFiles(context) {
  const { origin, storeOrigin, token, adminToken, browser, call, passed, requests, output, secrets,
    compose, env, login, staffUsername, resetPassword } = context;
  const require = createRequire(new URL('../apps/api/package.json', import.meta.url)); const sharp = require('sharp');
  const image = sharp({ create: { width: 96, height: 96, channels: 3, background: '#087e8b' } });
  const png = await image.clone().png().toBuffer();
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  async function upload(site, purpose, bytes = png, actor = token, expected = 201, code, extra) {
    const form = new FormData(); form.append('purpose', purpose);
    if (extra) for (const [key, value] of Object.entries(extra)) form.append(key, value);
    form.append('file', new Blob([bytes]), '../../private-marker.png');
    const response = await fetch(`${site}/api/v1/files`, { method: 'POST', body: form,
      headers: actor ? { Authorization: `Bearer ${actor}` } : {}, signal: AbortSignal.timeout(15000) });
    const body = await response.json();
    requests.push({ method: 'POST', path: '/files', site: new URL(site).port, status: response.status,
      requestId: response.headers.get('x-request-id'), ...(code ? { code } : {}) });
    assert.equal(response.status, expected, `上传 ${purpose} ${code ?? ''}`);
    assert.equal(response.headers.get('x-request-id'), body.requestId);
    if (expected === 429) assert.ok(Number(response.headers.get('retry-after')) >= 1);
    assert.match(body.requestId, /^[0-9a-f-]{36}$/); if (code) assert.equal(body.code, code);
    assert.ok(!JSON.stringify(body).includes('private-marker')); return body.data ?? body;
  }
  async function content(site, asset, actor, expected = 200, expectedHash) {
    const response = await fetch(`${site}${asset.contentUrl}`, { headers: actor ? { Authorization: `Bearer ${actor}` } : {}, signal: AbortSignal.timeout(10000) });
    requests.push({ method: 'GET', path: asset.contentUrl, site: new URL(site).port, status: response.status,
      requestId: response.headers.get('x-request-id') });
    assert.equal(response.status, expected); assert.match(response.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
    if (expected !== 200) { assert.equal((await response.json()).code, 'FILE_NOT_FOUND'); return; }
    assert.match(response.headers.get('content-type'), /^image\/(png|jpeg|webp)/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const hash = digest(Buffer.from(await response.arrayBuffer())); if (expectedHash) assert.equal(hash, expectedHash);
    return { hash, cache: response.headers.get('cache-control') };
  }
  const json = (endpoint, method = 'GET', body, actor = token, expected = 200, code) => call(storeOrigin, endpoint, method, body, actor, expected, code);
  const privateImage = await upload(storeOrigin, 'AFTER_SALE_EVIDENCE');
  assert.equal(privateImage.state, 'STAGED'); assert.equal(privateImage.visibility, 'PRIVATE');
  const originalPrivate = await content(storeOrigin, privateImage, token); assert.match(originalPrivate.cache, /private.*no-store/);
  await content(storeOrigin, privateImage, undefined, 404);
  const privateMeta = await json(`/files/${privateImage.id}`); assert.equal(privateMeta.id, privateImage.id);
  for (const field of ['storageKey', 'uploaderCustomerId', 'uploaderEmployeeId', 'sha256', 'originalName']) assert.ok(!Object.hasOwn(privateMeta, field));
  const otherPhone = `138${String(BigInt(`0x${randomBytes(6).toString('hex')}`) % 100000000n).padStart(8, '0')}`;
  const password = `Files#${randomBytes(12).toString('hex')}`; secrets.push(password);
  await call(storeOrigin, '/store/auth/register', 'POST', { phone: otherPhone, password, nickname: '隔离图片验收乙' }, undefined, 201);
  const other = await call(storeOrigin, '/store/auth/login', 'POST', { phone: otherPhone, password });
  await content(storeOrigin, privateImage, other.accessToken, 404);
  await json(`/files/${privateImage.id}`, 'GET', undefined, other.accessToken, 404, 'FILE_NOT_FOUND');
  await json(`/files/${randomUUID()}`, 'GET', undefined, other.accessToken, 404, 'FILE_NOT_FOUND');
  await upload(storeOrigin, 'PRODUCT_IMAGE', png, token, 403, 'FORBIDDEN');
  await upload(storeOrigin, 'CUSTOMER_AVATAR', png, null, 401, 'TOKEN_INVALID');
  await upload(storeOrigin, 'CUSTOMER_AVATAR', png, token, 400, 'FILE_INVALID_UPLOAD', { visibility: 'PUBLIC' });
  await upload(storeOrigin, 'CUSTOMER_AVATAR', Buffer.from('fake png'), token, 400, 'FILE_TYPE_NOT_ALLOWED');
  await upload(storeOrigin, 'CUSTOMER_AVATAR', Buffer.from('<svg/>'), token, 400, 'FILE_TYPE_NOT_ALLOWED');
  await upload(storeOrigin, 'CUSTOMER_AVATAR', Buffer.alloc(5 * 1024 * 1024 + 1), token, 413, 'FILE_TOO_LARGE');
  for (const site of [origin, storeOrigin]) {
    const proxy = await fetch(`${site}/api/v1/files`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: Buffer.alloc(6 * 1024 * 1024 + 1) });
    const body = await proxy.json(); assert.equal(proxy.status, 413); assert.equal(body.code, 'FILE_TOO_LARGE');
    assert.match(body.requestId, /^[0-9a-f]{32}$/); assert.equal(body.requestId, proxy.headers.get('x-request-id'));
    requests.push({ method: 'POST', path: '/files', site: new URL(site).port, status: 413, requestId: body.requestId, source: 'nginx' });
  }
  passed('SW-03/04/05/07：私有图隔离、安全元数据、用途校验、伪装图、5MiB API及两代理6MiB JSON413');

  const avatar = await upload(storeOrigin, 'CUSTOMER_AVATAR', await image.clone().jpeg().toBuffer());
  await json('/store/me/avatar', 'PUT', { fileId: avatar.id }, other.accessToken, 404, 'FILE_NOT_FOUND');
  await json('/store/me/avatar', 'PUT', { fileId: privateImage.id }, token, 409, 'FILE_PURPOSE_MISMATCH');
  assert.equal((await json('/store/me/avatar', 'PUT', { fileId: avatar.id })).changed, true);
  assert.equal((await json('/store/me/avatar', 'PUT', { fileId: avatar.id })).changed, false);
  const oldPublic = await content(storeOrigin, avatar); assert.match(oldPublic.cache, /public/);
  const replacement = await upload(origin, 'CUSTOMER_AVATAR', await image.clone().webp().toBuffer());
  await json('/store/me/avatar', 'PUT', { fileId: replacement.id });
  assert.equal((await json('/store/me')).avatarUrl, replacement.contentUrl);
  await json('/store/me/avatar', 'DELETE'); assert.equal((await json('/store/me/avatar', 'DELETE')).changed, false);
  assert.equal((await json('/store/me')).avatarUrl, null); await content(storeOrigin, avatar, undefined, 200, oldPublic.hash);
  passed('SW-01/02/06：JPEG/PNG/WebP、本人绑定、重复命令、更换/移除与历史公开图片保留');

  const forced = await login(staffUsername, resetPassword);
  await upload(origin, 'PRODUCT_IMAGE', png, forced.accessToken, 403, 'PASSWORD_CHANGE_REQUIRED');
  await call(origin, '/admin/auth/change-password', 'POST', { oldPassword: resetPassword, newPassword: password }, forced.accessToken);
  const staff = await login(staffUsername, password); const staffId = (await call(origin, '/admin/me', 'GET', undefined, staff.accessToken)).id;
  let detail = await call(origin, `/admin/employees/${staffId}`, 'GET', undefined, adminToken);
  assert.equal(detail.role, 'MERCH_WAREHOUSE'); await upload(origin, 'PRODUCT_IMAGE', png, staff.accessToken);
  await call(origin, `/admin/employees/${staffId}/change-role`, 'POST', { role: 'CUSTOMER_SERVICE', expectedVersion: detail.version, reason: '隔离用途岗位边界验收' }, adminToken);
  await upload(origin, 'PRODUCT_IMAGE', png, staff.accessToken, 403, 'FORBIDDEN');
  detail = await call(origin, `/admin/employees/${staffId}`, 'GET', undefined, adminToken);
  await call(origin, `/admin/employees/${staffId}/extra-permissions`, 'PUT', { permissions: ['product.manage'], expectedVersion: detail.version, reason: '隔离图片用途授权验收' }, adminToken);
  await upload(origin, 'PRODUCT_IMAGE', png, staff.accessToken);
  detail = await call(origin, `/admin/employees/${staffId}`, 'GET', undefined, adminToken);
  await call(origin, `/admin/employees/${staffId}/extra-permissions`, 'PUT', { permissions: [], expectedVersion: detail.version, reason: '隔离撤权验收' }, adminToken);
  await upload(origin, 'PRODUCT_IMAGE', png, staff.accessToken, 403, 'FORBIDDEN');
  await call(origin, '/admin/me', 'GET', undefined, staff.accessToken);
  detail = await call(origin, `/admin/employees/${staffId}`, 'GET', undefined, adminToken);
  await call(origin, `/admin/employees/${staffId}/disable`, 'POST', { expectedVersion: detail.version, reason: '隔离停用验收' }, adminToken);
  await upload(origin, 'PRODUCT_IMAGE', png, staff.accessToken, 401, 'SESSION_REVOKED');
  passed('SW-08：强改密拦截、个人额外用途权限授予/实时撤销、停用后旧token拒绝上传');

  const page = await browser.newPage(); const swaggerErrors = []; page.on('pageerror', error => swaggerErrors.push(error.name));
  await page.goto(`${storeOrigin}/api/docs`); await page.locator('.swagger-ui .auth-wrapper .authorize').click();
  await page.locator('.dialog-ux input').fill(token); await page.locator('.dialog-ux .auth-btn-wrapper .authorize').click();
  await page.locator('.dialog-ux .close-modal').click();
  const operation = summary => page.locator('.opblock').filter({ has: page.getByText(summary, { exact: true }) });
  const uploadOp = operation('上传一张受控图片'); await uploadOp.locator('.opblock-summary').click(); await uploadOp.locator('.try-out__btn').click();
  await uploadOp.locator('select').filter({ has: page.locator('option[value="CUSTOMER_AVATAR"]') }).selectOption('CUSTOMER_AVATAR');
  await uploadOp.locator('input[type=file]').setInputFiles({ name: 'swagger-avatar.png', mimeType: 'image/png', buffer: png });
  const uploaded = page.waitForResponse(response => response.url() === `${storeOrigin}/api/v1/files` && response.request().method() === 'POST');
  await uploadOp.locator('.execute').click(); const swaggerUpload = await uploaded;
  assert.equal(swaggerUpload.request().headers().authorization, `Bearer ${token}`); assert.equal(swaggerUpload.status(), 201);
  const uiAsset = (await swaggerUpload.json()).data;
  const avatarOp = operation('设置本人头像'); await avatarOp.locator('.opblock-summary').click(); await avatarOp.locator('.try-out__btn').click();
  await avatarOp.locator('textarea').fill(JSON.stringify({ fileId: uiAsset.id }, null, 2));
  const bound = page.waitForResponse(response => response.url().endsWith('/api/v1/store/me/avatar') && response.request().method() === 'PUT');
  await avatarOp.locator('.execute').click(); assert.equal((await bound).status(), 200);
  const readOp = operation('读取有权访问的安全图片元数据'); await readOp.locator('.opblock-summary').click(); await readOp.locator('.try-out__btn').click();
  await readOp.locator('input[type=text]').fill(uiAsset.id);
  const read = page.waitForResponse(response => response.url().endsWith(`/api/v1/files/${uiAsset.id}`));
  await readOp.locator('.execute').click(); assert.equal((await read).status(), 200);
  const contentOp = operation('读取图片内容'); await contentOp.locator('.opblock-summary').click(); await contentOp.locator('.try-out__btn').click();
  await contentOp.locator('input[type=text]').fill(uiAsset.id);
  const contentResponse = page.waitForResponse(response => response.url().endsWith(`/api/v1/files/${uiAsset.id}/content`));
  await contentOp.locator('.execute').click(); const binary = await contentResponse;
  assert.equal(binary.status(), 200); assert.match(binary.headers()['content-type'], /^image\/png/);
  // Swagger响应会异步排版，隐藏节点本身并替换文本，避免长截图中坐标遮罩随布局变化而错位。
  await page.addStyleTag({ content: '.curl-command,.request-snippets,.curl { visibility: hidden !important; }' });
  await page.evaluate(value => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent.includes(value)) node.textContent = node.textContent.replaceAll(value, '[已隐藏测试凭据]');
  }, token);
  assert.ok(!(await page.locator('body').innerText()).includes(token));
  await page.screenshot({ path: path.join(output, 'swagger-files.png'), fullPage: true });
  await page.close(); assert.deepEqual(swaggerErrors, []);
  const publicProof = await content(origin, uiAsset);
  await writeFile(path.join(output, 'files.json'), JSON.stringify({ timestamp: new Date().toISOString(),
    publicFileId: uiAsset.id, privateFileId: privateImage.id, publicSha256: publicProof.hash, privateSha256: originalPrivate.hash,
    swagger: { browserAutomated: true, authorizedHeaderChecked: true, uploadStatus: 201, bindStatus: 200, metadataStatus: 200, contentStatus: 200, pageErrors: swaggerErrors } }, null, 2) + '\n');
  passed('Swagger浏览器现场：Authorize真实Bearer、multipart上传201、头像PUT200、元数据及二进制GET200');
  return { async verifyLimits() {
    await upload(storeOrigin, 'CUSTOMER_AVATAR', png, token, 429, 'FILE_QUOTA_EXCEEDED');
    for (let index = 0; index < 2; index++) await upload(storeOrigin, 'CUSTOMER_AVATAR', Buffer.from('fake'), other.accessToken, 400, 'FILE_TYPE_NOT_ALLOWED');
    await upload(storeOrigin, 'CUSTOMER_AVATAR', png, other.accessToken, 429, 'FILE_RATE_LIMITED');
    await json('/store/me', 'GET', undefined, other.accessToken);
    passed('SW-08：独立API调整配额/频率后真实429及Retry-After，正常本人查询仍200');
  }, async verifyPersistence() {
    assert.equal((await json('/store/me')).avatarUrl, uiAsset.contentUrl);
    for (const site of [origin, storeOrigin]) {
      await content(site, uiAsset, undefined, 200, publicProof.hash);
      await content(site, privateImage, token, 200, originalPrivate.hash); await content(site, privateImage, undefined, 404);
    }
    const refs = compose(['exec', '-T', 'db', 'psql', '-U', env.POSTGRES_USER, '-d', env.POSTGRES_DB, '-Atc',
      `SELECT count(*) FROM file_reference WHERE file_asset_id='${uiAsset.id}'::uuid`], '重建后核对真实头像引用');
    assert.equal(refs.stdout.trim(), '1');
    passed('IT-09：真实公开头像/私有图片跨DB/API重启和API重建，原内容摘要/引用/授权保留');
  } };
}
