/* global document, innerWidth */
/** 文件作用：使用真实后台页面和隔离测试库验证员工认证、强制改密、会话及异常恢复。 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 独立测试库中的自有夹具；不迁移、不seed、不修改开发库，也不输出凭据。
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
const { createServer } = await import(pathToFileURL(path.join(root, 'apps/admin-web/node_modules/vite/dist/node/index.js')).href);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const app = await NestFactory.create(AppModule, { logger: false });
const prisma = app.get(PrismaService);
let vite; let browser; let page; let scenario = '启动';
const employeeIds = [];
const checks = []; const requests = []; const pageErrors = [];
let report = null;
const artifacts = path.resolve(root, process.env.VERIFICATION_OUTPUT_DIR || 'output/playwright/step26');
const password = 'BrowserTemp#2026'; const newPassword = 'BrowserNew#2026';
const employeeKey = 'self-ecom.employee.session'; const customerKey = 'self-ecom.customer.session';
const requestId = '65b5f8a0-57a0-4482-b0f7-53dc5d5a2264';

try {
  configureApp(app); await app.listen(0, '127.0.0.1');
  assert.ok(await prisma.permissionDefinition.count(), '测试库缺权限目录，请先使用项目既有测试准备命令');
  const accountId = randomUUID();
  const username = `b_${accountId.replaceAll('-', '').slice(0, 20)}`;
  assert.equal(await prisma.employee.count({ where: { OR: [{ id: accountId }, { username }] } }), 0);
  await prisma.employee.create({ data: { id: accountId, username, displayName: '认证验收员工', role: 'CUSTOMER_SERVICE',
    mustChangePassword: true, passwordHash: await app.get(PasswordService).hash(password) } });
  employeeIds.push(accountId);
  scenario = '启动Vite';
  vite = await createServer({ root: path.join(root, 'apps/admin-web'), configFile: path.join(root, 'apps/admin-web/vite.config.ts'),
    logLevel: 'silent', clearScreen: false, server: { host: '127.0.0.1', port: 0, strictPort: false,
      proxy: { '/api': { target: await app.getUrl(), changeOrigin: true } } } });
  await vite.listen(); const origin = vite.resolvedUrls.local[0].replace(/\/$/, '');
  scenario = '启动Chromium';
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.name));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/')) requests.push({ method: response.request().method(), path: url.pathname,
      status: response.status(), requestId: response.headers()['x-request-id'] ?? null });
  });
  const count = (suffix, method) => requests.filter(item => item.path === `/api/v1${suffix}` && (!method || item.method === method)).length;
  const waitPath = suffix => page.waitForURL(`${origin}${suffix}`);
  // Ant Design默认在两个汉字按钮中插入排版空格，可访问名称也会包含该空格。
  const loginButton = () => page.getByRole('button', { name: /^登\s*录$/ });
  const home = () => page.getByRole('heading', { name: '欢迎，认证验收员工。' }).waitFor();
  const readCredential = () => page.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? 'null'), employeeKey);
  const logIn = async value => {
    await page.getByLabel('员工账号', { exact: true }).fill(username);
    await page.getByLabel('密码', { exact: true }).fill(value);
    await loginButton().click();
  };
  const forbiddenRequest = () => page.evaluate(async () => {
    const { api } = await import('/src/services/api.ts');
    try { await api.get('/admin/employees'); return 'UNEXPECTED_SUCCESS'; } catch (error) { return error.code; }
  });
  const failRoute = (status, code) => route => route.fulfill({ status, contentType: 'application/json', headers: { 'x-request-id': requestId },
    body: JSON.stringify({ code, message: '验收故障响应', requestId }) });
  await mkdir(artifacts, { recursive: true });

  scenario = '匿名与前端校验';
  await page.goto(origin); await waitPath('/login');
  await page.getByRole('heading', { name: '员工登录' }).waitFor();
  assert.equal(count('/admin/me'), 0);
  await loginButton().click();
  await page.getByText('请输入员工账号', { exact: true }).waitFor();
  await page.getByLabel('员工账号', { exact: true }).fill('bad');
  await page.getByLabel('密码', { exact: true }).fill('😀'.repeat(19));
  await loginButton().click();
  await page.getByText('密码的UTF-8编码不得超过72字节', { exact: true }).waitFor();
  assert.equal(count('/admin/auth/login'), 0); checks.push(scenario);

  scenario = '真实错误登录';
  await logIn('WrongBrowser#2026');
  await page.getByText(/请求编号：/).waitFor();
  await page.waitForFunction(() => document.querySelector('input[autocomplete="current-password"]').value === '');
  assert.equal(requests.at(-1).status, 401); assert.equal(await readCredential(), null); checks.push(scenario);

  scenario = '真实首次登录及强制改密路由';
  const permissionsBefore = count('/admin/me/permissions');
  await logIn(password); await waitPath('/change-password');
  await page.getByRole('heading', { name: '首次登录，请修改密码' }).waitFor();
  assert.equal(count('/admin/me/permissions'), permissionsBefore);
  assert.equal(await page.getByRole('link', { name: '首页', exact: true }).count(), 0);
  const oldCredential = await readCredential();
  await page.screenshot({ path: path.join(artifacts, 'forced-password.png'), fullPage: true });
  for (const pathname of ['/', '/unavailable-business', '/login']) {
    await page.goto(`${origin}${pathname}`); await waitPath('/change-password');
    await page.getByRole('heading', { name: '首次登录，请修改密码' }).waitFor();
  }
  await page.reload(); await page.getByRole('heading', { name: '首次登录，请修改密码' }).waitFor();
  assert.equal(count('/admin/me/permissions'), permissionsBefore); checks.push(scenario);

  scenario = '改密校验及真实改密';
  await page.getByLabel('旧密码', { exact: true }).fill(password);
  await page.getByLabel('新密码', { exact: true }).fill(password);
  await page.getByLabel('确认新密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '修改密码并重新登录' }).click();
  await page.getByText('新密码不得与旧密码相同', { exact: true }).waitFor();
  await page.getByLabel('新密码', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: '修改密码并重新登录' }).click();
  await page.getByText('两次新密码不一致', { exact: true }).waitFor();
  assert.equal(count('/admin/auth/change-password'), 0);
  await page.getByLabel('确认新密码', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: '修改密码并重新登录' }).click();
  await waitPath('/login'); await page.getByText('密码已修改，请使用新密码重新登录。', { exact: true }).waitFor();
  assert.equal(await readCredential(), null);
  const changed = await prisma.employee.findUniqueOrThrow({ where: { id: accountId } });
  assert.equal(changed.tokenVersion, 1); assert.equal(changed.mustChangePassword, false);
  assert.equal((await fetch(`${origin}/api/v1/admin/me`, { headers: { Authorization: `Bearer ${oldCredential.accessToken}` } })).status, 401);
  assert.equal(await prisma.auditLog.count({ where: { actorEmployeeId: accountId, action: 'employee.password.change' } }), 1);
  checks.push(scenario);

  scenario = '新密码登录、刷新恢复及最小存储';
  await logIn(password); await page.getByText(/请求编号：/).waitFor();
  await logIn(newPassword); await waitPath('/'); await home();
  const credential = await readCredential();
  assert.deepEqual(Object.keys(credential).sort(), ['accessToken', 'domain', 'expiresAt']);
  assert.equal(credential.domain, 'EMPLOYEE');
  const beforeReload = { me: count('/admin/me'), permissions: count('/admin/me/permissions') };
  await page.reload(); await home();
  assert.equal(count('/admin/me') - beforeReload.me, 1); assert.equal(count('/admin/me/permissions') - beforeReload.permissions, 1);
  assert.ok((await readCredential()).accessToken === credential.accessToken, '刷新凭证应保持');
  await page.evaluate(key => sessionStorage.setItem(key, 'customer-domain-preserved'), customerKey);
  assert.ok(await page.evaluate(() => !JSON.stringify(localStorage).includes('accessToken')));
  await page.screenshot({ path: path.join(artifacts, 'employee-home.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '移动端不应横向溢出');
  await page.screenshot({ path: path.join(artifacts, 'employee-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1365, height: 900 }); checks.push(scenario);

  scenario = '真实403保留会话并受控刷新';
  const before403 = { me: count('/admin/me'), permissions: count('/admin/me/permissions'), employees: count('/admin/employees') };
  assert.equal(await forbiddenRequest(), 'FORBIDDEN'); await home();
  await page.getByText('当前操作没有权限，已重新读取账号权限。', { exact: true }).waitFor();
  assert.ok((await readCredential()).accessToken === credential.accessToken, '403不应清除凭证');
  assert.equal(count('/admin/employees') - before403.employees, 1);
  assert.equal(count('/admin/me') - before403.me, 1); assert.equal(count('/admin/me/permissions') - before403.permissions, 1); checks.push(scenario);

  scenario = '权限刷新自身403不循环及重试';
  await page.route('**/api/v1/admin/me/permissions', failRoute(403, 'FORBIDDEN'));
  const own403 = count('/admin/me/permissions'); await forbiddenRequest();
  await page.getByRole('heading', { name: '暂时无法读取账号信息' }).waitFor();
  assert.equal(count('/admin/me/permissions') - own403, 1); assert.ok(await readCredential());
  assert.equal(await page.getByRole('link', { name: '首页', exact: true }).count(), 0);
  await page.unroute('**/api/v1/admin/me/permissions');
  await page.getByRole('button', { name: '重新读取' }).click(); await home(); checks.push(scenario);

  scenario = '恢复500隐藏业务、保留会话并可重试';
  await page.route('**/api/v1/admin/me', failRoute(500, 'INTERNAL_ERROR')); await page.reload();
  await page.getByRole('heading', { name: '暂时无法读取账号信息' }).waitFor();
  assert.ok(await readCredential()); assert.equal(await page.getByRole('link', { name: '首页', exact: true }).count(), 0);
  await page.unroute('**/api/v1/admin/me'); await page.getByRole('button', { name: '重新读取' }).click(); await home(); checks.push(scenario);

  scenario = '真实强制改密403立即切换页面';
  await prisma.employee.update({ where: { id: accountId }, data: { mustChangePassword: true } });
  assert.equal(await forbiddenRequest(), 'PASSWORD_CHANGE_REQUIRED'); await waitPath('/change-password');
  await page.getByRole('heading', { name: '首次登录，请修改密码' }).waitFor();
  assert.equal(await page.getByRole('link', { name: '首页', exact: true }).count(), 0); assert.ok(await readCredential());
  await prisma.employee.update({ where: { id: accountId }, data: { mustChangePassword: false } });
  await page.reload(); await page.getByRole('link', { name: '首页', exact: true }).click(); await home(); checks.push(scenario);

  scenario = '真实会话撤销401清身份及单域存储';
  const token = (await readCredential()).accessToken;
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
  await prisma.authSession.update({ where: { id: claims.sid }, data: { revokedAt: new Date(), revokeReason: 'BROWSER_TEST' } });
  const before401 = count('/admin/me/permissions'); await page.reload(); await waitPath('/login');
  await page.getByRole('heading', { name: '员工登录' }).waitFor();
  assert.equal(await readCredential(), null); assert.equal(count('/admin/me/permissions'), before401);
  assert.equal(await page.evaluate(key => sessionStorage.getItem(key), customerKey), 'customer-domain-preserved'); checks.push(scenario);

  scenario = '真实注销撤销服务端会话';
  await logIn(newPassword); await home(); const beforeLogout = await readCredential();
  await page.getByRole('button', { name: '退出登录', exact: true }).click(); await waitPath('/login');
  await page.getByText('已退出登录。', { exact: true }).waitFor(); assert.equal(await readCredential(), null);
  assert.equal((await fetch(`${origin}/api/v1/admin/me`, { headers: { Authorization: `Bearer ${beforeLogout.accessToken}` } })).status, 401);
  assert.equal(await page.evaluate(key => sessionStorage.getItem(key), customerKey), 'customer-domain-preserved'); checks.push(scenario);

  scenario = '注销网络失败仍清本地并提示';
  await logIn(newPassword); await home(); await page.route('**/api/v1/auth/logout', route => route.abort('failed'));
  await page.getByRole('button', { name: '退出登录', exact: true }).click(); await waitPath('/login');
  await page.getByText(/服务器注销未确认/).waitFor(); assert.equal(await readCredential(), null);
  await page.unroute('**/api/v1/auth/logout'); checks.push(scenario);

  scenario = '本地到期定时清理';
  await logIn(newPassword); await home();
  await page.evaluate(async () => {
    const { session } = await import('/src/services/api.ts'); const credential = session.current().credential;
    session.save({ ...credential, tokenType: 'Bearer', expiresAt: new Date(Date.now() + 1500).toISOString() });
  });
  await waitPath('/login'); await page.getByRole('heading', { name: '员工登录' }).waitFor(); assert.equal(await readCredential(), null); checks.push(scenario);

  scenario = '普通主动改密及所有会话撤销';
  await logIn(newPassword); await home(); const regularCredential = await readCredential();
  const secondLogin = await fetch(`${origin}/api/v1/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: newPassword }) });
  assert.equal(secondLogin.status, 200); const secondCredential = (await secondLogin.json()).data;
  await page.getByRole('link', { name: '修改密码', exact: true }).click();
  await page.getByRole('heading', { name: '修改密码', exact: true }).waitFor();
  await page.getByLabel('旧密码', { exact: true }).fill(newPassword);
  await page.getByLabel('新密码', { exact: true }).fill('RegularNew#2026');
  await page.getByLabel('确认新密码', { exact: true }).fill('RegularNew#2026');
  await page.getByRole('button', { name: '修改密码并重新登录' }).click(); await waitPath('/login');
  await page.getByText('密码已修改，请使用新密码重新登录。', { exact: true }).waitFor();
  for (const value of [regularCredential, secondCredential]) {
    assert.equal((await fetch(`${origin}/api/v1/admin/me`, { headers: { Authorization: `Bearer ${value.accessToken}` } })).status, 401);
  }
  await logIn(newPassword); await page.getByText(/请求编号：/).waitFor();
  await logIn('RegularNew#2026'); await home();
  assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: accountId } })).tokenVersion, 2);
  await page.getByRole('button', { name: '退出登录', exact: true }).click(); await waitPath('/login'); checks.push(scenario);

  scenario = '真实登录限流及Retry-After提示';
  const rateUsername = `r_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.getByLabel('员工账号', { exact: true }).fill(rateUsername);
    await page.getByLabel('密码', { exact: true }).fill(password);
    const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/admin/auth/login');
    await loginButton().click();
    assert.equal((await response).status(), attempt < 5 ? 401 : 429);
    await page.waitForFunction(() => document.querySelector('input[autocomplete="current-password"]').value === '');
  }
  await page.getByText(/请在 \d+ 秒后重试。/).waitFor(); await page.getByText(/请求编号：/).waitFor();
  assert.equal(await readCredential(), null); checks.push(scenario);
  assert.deepEqual(pageErrors, []);
  report = { date: new Date().toISOString(), node: process.version, browser: await browser.version(), database: safe.testName,
    backend: '真实Nest API及PostgreSQL测试库；仅500、权限刷新403和注销网络失败由浏览器注入', checks, requests, pageErrors,
    localExpiry: '客户端期限缩短验证定时器，不作为JWT服务端过期证据' };
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'failure-state.png'), fullPage: true }).catch(() => {});
  // 数据库异常和浏览器请求错误可能携带配置；输出前移除配置及本轮密码。
  let diagnostic = String(error.message);
  for (const value of [env.DATABASE_URL, env.TEST_DATABASE_URL, env.JWT_SECRET, process.env.JWT_SECRET, password, newPassword, 'RegularNew#2026']) {
    if (value) diagnostic = diagnostic.replaceAll(value, '[已隐藏]');
  }
  diagnostic = diagnostic.replace(/postgres(?:ql)?:\/\/\S+/gi, '[数据库连接已隐藏]').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [已隐藏]');
  console.error(JSON.stringify({ status: 'failed', scenario, error: error.name, message: diagnostic }));
  process.exitCode = 1;
} finally {
  await browser?.close(); await vite?.close();
  if (employeeIds.length) {
    assertSafeTestDatabase(env.DATABASE_URL, safe.testUrl);
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorEmployeeId: { in: employeeIds } }, { targetType: 'EMPLOYEE', targetId: { in: employeeIds } }] } });
    await prisma.employeeExtraPermission.deleteMany({ where: { OR: [{ employeeId: { in: employeeIds } }, { grantedById: { in: employeeIds } }] } });
    await prisma.authSession.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
    assert.equal(await prisma.employee.count({ where: { id: { in: employeeIds } } }), 0);
    assert.equal(await prisma.authSession.count({ where: { employeeId: { in: employeeIds } } }), 0);
    assert.equal(await prisma.auditLog.count({ where: { actorEmployeeId: { in: employeeIds } } }), 0);
    console.log('已清理本轮自建员工、会话及审计；未清空测试库。');
  }
  await app.close();
  if (report) {
    await writeFile(path.join(artifacts, 'result.json'), JSON.stringify({ ...report, cleanup: { employees: 0, sessions: 0, actorAudits: 0 } }, null, 2) + '\n');
    console.log(JSON.stringify({ status: 'passed', checks: checks.length, pageErrors: pageErrors.length, artifacts: path.relative(root, artifacts) }));
  }
}
