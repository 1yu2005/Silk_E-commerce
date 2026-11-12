/* global document, innerWidth, window */
/** 文件作用：使用真实顾客页面验证本人昵称修改、改密、多会话撤销及请求竞态。 */
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 只使用独立测试库的本轮自有账号；不迁移、初始化或清空任何数据库。
const root = fileURLToPath(new URL('../../../', import.meta.url));
const apiRequire = createRequire(path.join(root, 'apps/api/package.json'));
const { readDatabaseEnvironment, assertSafeTestDatabase } = apiRequire('./scripts/database-env.ts');
const env = readDatabaseEnvironment();
const safe = assertSafeTestDatabase(env.DATABASE_URL, env.TEST_DATABASE_URL);
Object.assign(process.env, env, { DATABASE_URL: safe.testUrl, NODE_ENV: 'test', LOG_LEVEL: 'silent',
  JWT_SECRET: randomBytes(48).toString('hex'), JWT_TTL_SECONDS: '7200' });
apiRequire('reflect-metadata');
const { NestFactory } = apiRequire('@nestjs/core');
const { AppModule } = apiRequire('./dist/app.module.js');
const { configureApp } = apiRequire('./dist/common/configure-app.js');
const { PrismaService } = apiRequire('./dist/prisma/prisma.service.js');
const { PasswordService } = apiRequire('./dist/auth/password.service.js');
const { createServer } = await import(pathToFileURL(path.join(root, 'apps/store-web/node_modules/vite/dist/node/index.js')).href);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const app = await NestFactory.create(AppModule, { logger: false });
const prisma = app.get(PrismaService);
const passwords = app.get(PasswordService);
const password = ' ProfileBrowser#2026 ';
const newPassword = ' ChangedBrowser#2026 ';
const customerKey = 'self-ecom.customer.session'; const employeeKey = 'self-ecom.employee.session';
const requestId = '756cb718-663e-4c1f-bd19-425647d65ff8';
const artifacts = path.resolve(root, process.env.VERIFICATION_OUTPUT_DIR || 'output/playwright/step28');
const ownedPhones = []; const employeeIds = []; const checks = []; const requests = []; const pageErrors = [];
const redactions = [env.DATABASE_URL, env.TEST_DATABASE_URL, env.JWT_SECRET, process.env.JWT_SECRET, password, newPassword];
let storeVite; let adminVite; let browser; let page; let report; let scenario = '启动';
const gates = [];
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); const gate = { promise, resolve }; gates.push(gate); return gate; }
const within = (promise, label) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`${label}未在15秒内完成`)), 15_000);
  promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
});

try {
  await mkdir(artifacts, { recursive: true });
  configureApp(app); await app.listen(0, '127.0.0.1');
  assert.ok(await prisma.permissionDefinition.count(), '测试库缺权限目录');
  for (let index = 0; index < 2; index++) {
    let phone;
    do { phone = `139${randomInt(100_000_000).toString().padStart(8, '0')}`; }
    while (ownedPhones.includes(phone) || await prisma.customer.count({ where: { phone } }));
    ownedPhones.push(phone); redactions.push(phone);
    const response = await fetch(`${await app.getUrl()}/api/v1/store/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password, nickname: index ? '另一位顾客' : '昵称页面验收' }) });
    assert.equal(response.status, 201);
  }
  const [phone, otherPhone] = ownedPhones;
  const customer = await prisma.customer.findUniqueOrThrow({ where: { phone } });
  const otherCustomer = await prisma.customer.findUniqueOrThrow({ where: { phone: otherPhone } });
  const employeeId = randomUUID(); const username = `p_${employeeId.replaceAll('-', '').slice(0, 20)}`;
  assert.equal(await prisma.employee.count({ where: { OR: [{ id: employeeId }, { username }] } }), 0);
  await prisma.employee.create({ data: { id: employeeId, username, displayName: '资料验收员工', role: 'CUSTOMER_SERVICE',
    mustChangePassword: false, passwordHash: await passwords.hash(password) } }); employeeIds.push(employeeId);
  const startVite = async directory => {
    const vite = await createServer({ root: path.join(root, directory), configFile: path.join(root, directory, 'vite.config.ts'),
      logLevel: 'silent', clearScreen: false, server: { host: '127.0.0.1', port: 0, strictPort: false,
        proxy: { '/api': { target: await app.getUrl(), changeOrigin: true } } } });
    await vite.listen(); return vite;
  };
  storeVite = await startVite('apps/store-web'); adminVite = await startVite('apps/admin-web');
  const origin = storeVite.resolvedUrls.local[0].replace(/\/$/, ''); const adminOrigin = adminVite.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1365, height: 1000 } });
  page = await context.newPage(); const siblingPage = await context.newPage(); const adminPage = await context.newPage();
  for (const [surface, currentPage] of [['store', page], ['sibling', siblingPage], ['admin', adminPage]]) {
    currentPage.on('pageerror', error => pageErrors.push({ surface, error: error.name }));
    currentPage.on('response', response => {
      const pathname = new URL(response.url()).pathname;
      if (pathname.startsWith('/api/')) requests.push({ surface, method: response.request().method(), path: pathname,
        status: response.status(), requestId: response.headers()['x-request-id'] ?? null,
        authorizationPresent: Boolean(response.request().headers()['authorization']) });
    });
  }
  const submit = (currentPage = page) => currentPage.locator('form button[type="submit"]');
  const account = (currentPage = page) => currentPage.getByRole('heading', { name: '我的账号', exact: true }).waitFor();
  const credential = async (currentPage = page, key = customerKey) => {
    const value = await currentPage.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? 'null'), key);
    if (value?.accessToken) redactions.push(value.accessToken); return value;
  };
  const login = async (currentPage = page, value = password) => {
    await currentPage.getByLabel('手机号', { exact: true }).fill(phone);
    await currentPage.getByLabel('密码', { exact: true }).fill(value); await submit(currentPage).click();
  };
  const edit = async value => {
    await page.getByRole('button', { name: '编辑昵称', exact: true }).click();
    if (value !== undefined) await page.getByLabel('昵称', { exact: true }).fill(value);
  };
  const fillPasswords = async (oldValue = password, newValue = newPassword, confirmation = newValue) => {
    await page.getByLabel('旧密码', { exact: true }).fill(oldValue);
    await page.getByLabel('新密码', { exact: true }).fill(newValue);
    await page.getByLabel('确认新密码', { exact: true }).fill(confirmation);
  };
  const count = (method, pathname) => requests.filter(item => item.surface === 'store' && item.method === method && item.path === `/api/v1${pathname}`).length;
  const responseFor = (method, pathname) => page.waitForResponse(response => response.request().method() === method && new URL(response.url()).pathname === `/api/v1${pathname}`);
  const requestMe = value => fetch(`${origin}/api/v1/store/me`, { headers: { Authorization: `Bearer ${value.accessToken}` } });
  const safeError = status => ({ code: status === 400 ? 'VALIDATION_FAILED' : status === 403 ? 'FORBIDDEN' : 'INTERNAL_ERROR',
    message: '资料操作验收失败', requestId, ...(status === 400 ? { details: [{ field: 'nickname', message: '验收字段提示' }] } : {}) });

  scenario = '改密路由保护与真实顾客登录';
  await page.goto(`${origin}/change-password`); await page.waitForURL(`${origin}/login`);
  assert.equal(count('GET', '/store/me'), 0); await login(); await account();
  const firstCredential = await credential(); assert.ok(firstCredential);
  await page.getByRole('link', { name: '修改密码', exact: true }).waitFor(); checks.push(scenario);

  scenario = '昵称取消及必填Unicode边界';
  const patchBefore = count('PATCH', '/store/me'); await edit('取消的昵称'); await page.getByRole('button', { name: /^取\s*消$/ }).click();
  assert.equal(count('PATCH', '/store/me'), patchBefore); assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).nickname, customer.nickname);
  await edit(''); await submit().click(); await page.getByText('请填写昵称', { exact: true }).waitFor();
  for (const invalid of ['   ', '😀'.repeat(41)]) {
    await page.getByLabel('昵称', { exact: true }).fill(invalid); await submit().click();
    await page.getByText('昵称须为1～40个字符，不能只有空格', { exact: true }).waitFor();
  }
  assert.equal(count('PATCH', '/store/me'), patchBefore); checks.push(scenario);

  scenario = '真实昵称保存loading严格字段及即时同步';
  const emojiName = '😀'.repeat(40); await page.getByLabel('昵称', { exact: true }).fill(` ${emojiName} `);
  const nicknameFetched = deferred(); const nicknameRelease = deferred(); let patchCalls = 0;
  await page.route('**/api/v1/store/me', async route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    patchCalls++; assert.deepEqual(route.request().postDataJSON(), { nickname: emojiName });
    const response = await route.fetch(); assert.equal(response.status(), 200); nicknameFetched.resolve();
    await nicknameRelease.promise; await route.fulfill({ response });
  });
  await submit().click(); await within(nicknameFetched.promise, '昵称保存响应');
  assert.ok(await submit().isDisabled()); assert.ok(await page.getByLabel('昵称', { exact: true }).isDisabled()); assert.equal(patchCalls, 1);
  nicknameRelease.resolve(); await page.getByRole('button', { name: '编辑昵称', exact: true }).waitFor();
  await page.locator('.customer-name').getByText(emojiName, { exact: true }).waitFor(); await page.unroute('**/api/v1/store/me');
  assert.ok((await credential()).accessToken === firstCredential.accessToken, '改昵称不更换凭证');
  const afterNickname = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
  for (const field of ['phone', 'passwordHash', 'tokenVersion', 'status']) assert.ok(afterNickname[field] === customer[field], `改昵称不改变${field}`);
  assert.equal(afterNickname.nickname, emojiName); const profileAudit = await prisma.auditLog.findMany({ where: { actorCustomerId: customer.id, action: 'customer.profile.update' } });
  assert.equal(profileAudit.length, 1); assert.deepEqual(profileAudit[0].beforeData, { nickname: customer.nickname }); assert.deepEqual(profileAudit[0].afterData, { nickname: emojiName });
  checks.push(scenario);

  scenario = '同昵称无重复审计且刷新保留新昵称';
  await edit(` ${emojiName} `); const sameResponse = responseFor('PATCH', '/store/me'); await submit().click(); assert.equal((await sameResponse).status(), 200);
  await page.getByRole('button', { name: '编辑昵称', exact: true }).waitFor();
  assert.equal(await prisma.auditLog.count({ where: { actorCustomerId: customer.id, action: 'customer.profile.update' } }), 1);
  await page.reload(); await account(); await page.locator('.customer-name').getByText(emojiName, { exact: true }).waitFor(); checks.push(scenario);

  scenario = '昵称400403500和网络失败保留账号且可修正';
  for (const status of [400, 403, 500, null]) {
    await edit('失败昵称'); const before = count('PATCH', '/store/me');
    await page.route('**/api/v1/store/me', route => {
      if (route.request().method() !== 'PATCH') return route.continue();
      return status ? route.fulfill({ status, contentType: 'application/json', headers: { 'x-request-id': requestId }, body: JSON.stringify(safeError(status)) }) : route.abort('failed');
    });
    await submit().click(); await page.getByText(status ? '资料操作验收失败' : '网络连接失败，请稍后重试', { exact: true }).waitFor();
    if (status) await page.getByText(`请求编号：${requestId}`, { exact: true }).waitFor();
    if (status === 400) await page.getByText('nickname：验收字段提示', { exact: true }).waitFor();
    assert.ok((await credential()).accessToken === firstCredential.accessToken, '昵称失败不清合法会话');
    assert.equal(count('PATCH', '/store/me') - before, status ? 1 : 0); assert.equal(await page.getByLabel('昵称', { exact: true }).inputValue(), '失败昵称');
    await page.getByRole('button', { name: /^取\s*消$/ }).click(); await page.unroute('**/api/v1/store/me');
  }
  checks.push(scenario);

  scenario = '旧本人查询迟到不能覆盖昵称保存结果';
  await edit('更新后昵称'); const patchEntered = deferred(); const patchRelease = deferred(); const oldReadReady = deferred(); const oldReadRelease = deferred();
  await page.route('**/api/v1/store/me', async route => {
    if (route.request().method() === 'PATCH') {
      patchEntered.resolve(); await patchRelease.promise; const response = await route.fetch(); await route.fulfill({ response });
    } else {
      const response = await route.fetch(); oldReadReady.resolve(); await oldReadRelease.promise; await route.fulfill({ response });
    }
  });
  await submit().click(); await within(patchEntered.promise, '昵称请求屏障');
  const oldRead = page.evaluate(async () => { const { customerAuth } = await import('/src/services/api.ts'); await customerAuth.restore(true); });
  await within(oldReadReady.promise, '旧本人响应屏障'); patchRelease.resolve(); await account();
  await page.locator('.customer-name').getByText('更新后昵称', { exact: true }).waitFor(); oldReadRelease.resolve(); await oldRead;
  assert.equal(await page.locator('.customer-name').innerText(), '更新后昵称'); await page.unroute('**/api/v1/store/me'); checks.push(scenario);

  scenario = '交易受限仍可改昵称且不影响其他顾客';
  await prisma.customer.update({ where: { id: customer.id }, data: { status: 'TRADE_RESTRICTED' } });
  await page.evaluate(async () => { const { customerAuth } = await import('/src/services/api.ts'); await customerAuth.restore(true); }); await account();
  await edit('交易受限顾客'); await submit().click(); await page.getByRole('button', { name: '编辑昵称', exact: true }).waitFor();
  await page.getByText('交易受限', { exact: true }).waitFor();
  assert.deepEqual(await prisma.customer.findUniqueOrThrow({ where: { id: otherCustomer.id } }), otherCustomer);
  await page.screenshot({ path: path.join(artifacts, 'customer-profile.png'), fullPage: true }); checks.push(scenario);

  scenario = '改密前端格式原文相等和确认校验';
  await page.getByRole('link', { name: '修改密码', exact: true }).click(); await page.getByRole('heading', { name: '修改密码', exact: true }).waitFor();
  const passwordCount = count('POST', '/store/auth/change-password');
  for (const [oldValue, newValue, confirmation, message] of [
    [password, 'short', 'short', '密码至少8个Unicode字符'],
    [password, 'a'.repeat(65), 'a'.repeat(65), '密码最多64个Unicode字符'],
    [password, '😀'.repeat(19), '😀'.repeat(19), '密码的UTF-8编码不得超过72字节'],
    [password, password, password, '新密码不得与旧密码相同'],
    [password, newPassword, 'Mismatch#2026', '两次新密码不一致'],
  ]) {
    await fillPasswords(oldValue, newValue, confirmation); await submit().click(); await page.getByText(message, { exact: true }).waitFor();
  }
  assert.equal(count('POST', '/store/auth/change-password'), passwordCount); checks.push(scenario);

  scenario = '旧密码错误401清本地并在登录页保留原因';
  const beforeWrongPassword = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
  await fillPasswords('WrongPassword#2026'); const wrong = responseFor('POST', '/store/auth/change-password'); await submit().click();
  assert.equal((await wrong).status(), 401); await page.waitForURL(`${origin}/login`);
  await page.getByText('密码未修改，请重新登录后确认旧密码。', { exact: true }).waitFor(); await page.getByText(/请求编号：/).waitFor();
  assert.equal(await credential(), null); assert.deepEqual(await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } }), beforeWrongPassword);
  assert.equal(await prisma.auditLog.count({ where: { actorCustomerId: customer.id, action: 'customer.password.change' } }), 0);
  assert.equal((await requestMe(firstCredential)).status, 200, '旧密码错误只清本地，不冒称服务器注销');
  checks.push(scenario);

  scenario = '真实双端及同顾客多会话';
  await login(); await account(); const passwordCredential = await credential();
  await siblingPage.goto(`${origin}/login`); await login(siblingPage); await account(siblingPage); const siblingCredential = await credential(siblingPage);
  assert.ok(passwordCredential.accessToken !== siblingCredential.accessToken, '独立登录应有不同会话');
  await adminPage.goto(`${adminOrigin}/login`); await adminPage.getByLabel('员工账号', { exact: true }).fill(username);
  await adminPage.getByLabel('密码', { exact: true }).fill(password); await submit(adminPage).click();
  await adminPage.getByRole('heading', { name: '欢迎，资料验收员工。', exact: true }).waitFor(); const employeeCredential = await credential(adminPage, employeeKey);
  const otherLogin = await fetch(`${origin}/api/v1/store/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: otherPhone, password }) });
  assert.equal(otherLogin.status, 200); const otherCredential = (await otherLogin.json()).data; redactions.push(otherCredential.accessToken); checks.push(scenario);

  scenario = '改密400403500和网络失败不假报成功并清密码';
  await page.getByRole('link', { name: '修改密码', exact: true }).click();
  for (const status of [400, 403, 500, null]) {
    await page.route('**/api/v1/store/auth/change-password', route => status ? route.fulfill({ status, contentType: 'application/json',
      headers: { 'x-request-id': requestId }, body: JSON.stringify({ ...safeError(status), details: undefined }) }) : route.abort('failed'));
    await fillPasswords(); await submit().click();
    await page.getByText(status ? '资料操作验收失败' : '网络连接失败，请稍后重试', { exact: true }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('input[autocomplete$="-password"]')].every(input => input.value === ''));
    assert.ok((await credential()).accessToken === passwordCredential.accessToken, '非401失败保留会话');
    assert.equal(await prisma.auditLog.count({ where: { actorCustomerId: customer.id, action: 'customer.password.change' } }), 0);
    await page.unroute('**/api/v1/store/auth/change-password');
  }
  checks.push(scenario);

  scenario = '改密页桌面与移动布局';
  await page.reload(); await page.getByRole('heading', { name: '修改密码', exact: true }).waitFor();
  await page.screenshot({ path: path.join(artifacts, 'customer-password.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(artifacts, 'customer-password-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1365, height: 1000 }); checks.push(scenario);

  scenario = '真实改密loading严格字段及全部旧会话失效';
  const beforeChange = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
  const changedReady = deferred(); const changedRelease = deferred(); let changedCalls = 0;
  await page.route('**/api/v1/store/auth/change-password', async route => {
    changedCalls++; const input = route.request().postDataJSON();
    assert.deepEqual(Object.keys(input).sort(), ['newPassword', 'oldPassword']); assert.ok(input.oldPassword === password && input.newPassword === newPassword, '密码必须保留原文');
    const response = await route.fetch(); assert.equal(response.status(), 200); changedReady.resolve(); await changedRelease.promise; await route.fulfill({ response });
  });
  await fillPasswords(); await submit().click(); await within(changedReady.promise, '改密真实响应');
  assert.ok(await submit().isDisabled()); assert.ok(await page.getByLabel('旧密码', { exact: true }).isDisabled()); assert.equal(changedCalls, 1);
  changedRelease.resolve(); await page.waitForURL(`${origin}/login`); await page.getByText('密码已修改，请使用新密码重新登录。', { exact: true }).waitFor();
  assert.equal(await credential(), null); assert.equal(await page.getByLabel('密码', { exact: true }).inputValue(), ''); await page.unroute('**/api/v1/store/auth/change-password');
  for (const value of [firstCredential, passwordCredential, siblingCredential]) assert.equal((await requestMe(value)).status, 401);
  const afterChange = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
  assert.equal(afterChange.tokenVersion, beforeChange.tokenVersion + 1); assert.equal(afterChange.nickname, beforeChange.nickname); assert.equal(afterChange.status, 'TRADE_RESTRICTED');
  assert.ok(afterChange.passwordHash !== beforeChange.passwordHash && await passwords.verify(newPassword, afterChange.passwordHash), '数据库密码应更新');
  assert.equal(await prisma.authSession.count({ where: { customerId: customer.id, revokedAt: null } }), 0);
  const audits = await prisma.auditLog.findMany({ where: { actorCustomerId: customer.id, action: 'customer.password.change' } });
  assert.equal(audits.length, 1); assert.deepEqual(audits[0].afterData, { passwordChanged: true });
  await siblingPage.evaluate(() => window.dispatchEvent(new Event('focus'))); await siblingPage.waitForURL(`${origin}/login`); assert.equal(await credential(siblingPage), null);
  checks.push(scenario);

  scenario = '旧密码拒绝新密码重新登录且其他主体保持';
  await login(); await page.getByText(/请求编号：/).waitFor(); assert.equal(await credential(), null);
  await login(page, newPassword); await account(); await page.locator('.customer-name').getByText('交易受限顾客', { exact: true }).waitFor();
  assert.ok((await credential(adminPage, employeeKey)).accessToken === employeeCredential.accessToken, '顾客改密不清员工');
  assert.equal((await fetch(`${adminOrigin}/api/v1/admin/me`, { headers: { Authorization: `Bearer ${employeeCredential.accessToken}` } })).status, 200);
  assert.equal((await requestMe(otherCredential)).status, 200); assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: otherCustomer.id } })).nickname, otherCustomer.nickname);
  assert.deepEqual(Object.keys(await credential()).sort(), ['accessToken', 'domain', 'expiresAt']);
  assert.deepEqual(pageErrors, []); checks.push(scenario);
  report = { date: new Date().toISOString(), node: process.version, browser: await browser.version(), database: safe.testName,
    backend: '真实Nest API与PostgreSQL；400/403/500及网络失败仅由浏览器注入，受限状态为自有夹具', checks, requests, pageErrors,
    wrongPassword: '旧密码401按既有规则清本地；API未撤销会话，不冒称服务器注销',
    expiry: '本步未修改JWT期限；多设备失效通过真实改密撤销及API401验证' };
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'failure-state.png'), fullPage: true }).catch(() => {});
  let diagnostic = String(error.message);
  for (const value of redactions) if (value) diagnostic = diagnostic.replaceAll(value, '[已隐藏]');
  diagnostic = diagnostic.replace(/postgres(?:ql)?:\/\/\S+/gi, '[数据库连接已隐藏]').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [已隐藏]');
  console.error(JSON.stringify({ status: 'failed', scenario, error: error.name, message: diagnostic })); process.exitCode = 1;
} finally {
  for (const gate of gates) gate.resolve();
  await browser?.close(); await storeVite?.close(); await adminVite?.close();
  assertSafeTestDatabase(env.DATABASE_URL, safe.testUrl);
  const customerIds = (await prisma.customer.findMany({ where: { phone: { in: ownedPhones } }, select: { id: true } })).map(item => item.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorCustomerId: { in: customerIds } }, { actorEmployeeId: { in: employeeIds } }, { targetId: { in: [...customerIds, ...employeeIds] } }] } });
  await prisma.employeeExtraPermission.deleteMany({ where: { OR: [{ employeeId: { in: employeeIds } }, { grantedById: { in: employeeIds } }] } });
  await prisma.authSession.deleteMany({ where: { OR: [{ customerId: { in: customerIds } }, { employeeId: { in: employeeIds } }] } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } }); await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
  const cleanup = { customers: await prisma.customer.count({ where: { phone: { in: ownedPhones } } }), employees: await prisma.employee.count({ where: { id: { in: employeeIds } } }),
    sessions: await prisma.authSession.count({ where: { OR: [{ customerId: { in: customerIds } }, { employeeId: { in: employeeIds } }] } }),
    actorAudits: await prisma.auditLog.count({ where: { OR: [{ actorCustomerId: { in: customerIds } }, { actorEmployeeId: { in: employeeIds } }] } }) };
  assert.ok(Object.values(cleanup).every(value => value === 0), '自有数据清理未完成'); await app.close();
  console.log('本轮自有顾客、员工、会话与审计已清理，未清空测试库。');
  if (report) {
    await writeFile(path.join(artifacts, 'result.json'), JSON.stringify({ ...report, cleanup }, null, 2) + '\n');
    console.log(JSON.stringify({ status: 'passed', checks: checks.length, pageErrors: pageErrors.length, artifacts: path.relative(root, artifacts) }));
  }
}
