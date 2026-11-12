/* global document, innerWidth, window */
/** 文件作用：使用真实顾客页面验证注册登录、会话恢复、双端隔离、注销和异常处理。 */
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 复用正式API与两端页面；仅在明确隔离的测试库创建和清理本轮自有数据。
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
let storeVite; let adminVite; let browser; let page; let report = null; let scenario = '启动';
const ownedPhones = []; const employeeIds = [];
const checks = []; const requests = []; const pageErrors = [];
const password = ' CustomerBrowser#2026 ';
const redactions = [env.DATABASE_URL, env.TEST_DATABASE_URL, env.JWT_SECRET, process.env.JWT_SECRET, password, password.trim()];
const customerKey = 'self-ecom.customer.session'; const employeeKey = 'self-ecom.employee.session';
const requestId = 'ad66e49a-9239-43dd-97ae-0a91dc559136';
const artifacts = path.resolve(root, process.env.VERIFICATION_OUTPUT_DIR || 'output/playwright/step27');
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const within = (promise, label) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`${label}未在15秒内完成`)), 15_000);
  promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
});

try {
  configureApp(app); await app.listen(0, '127.0.0.1');
  assert.ok(await prisma.permissionDefinition.count(), '测试库缺权限目录');
  for (let index = 0; index < 3; index++) {
    let phone;
    do { phone = `139${randomInt(100_000_000).toString().padStart(8, '0')}`; }
    while (ownedPhones.includes(phone) || await prisma.customer.count({ where: { phone } }));
    ownedPhones.push(phone); redactions.push(phone);
  }
  const [phone, defaultPhone, latePhone] = ownedPhones;
  const employeeId = randomUUID(); const username = `b_${employeeId.replaceAll('-', '').slice(0, 20)}`;
  assert.equal(await prisma.employee.count({ where: { OR: [{ id: employeeId }, { username }] } }), 0);
  await prisma.employee.create({ data: { id: employeeId, username, displayName: '双端验收员工', role: 'CUSTOMER_SERVICE',
    mustChangePassword: false, passwordHash: await app.get(PasswordService).hash(password) } }); employeeIds.push(employeeId);
  const startVite = async directory => {
    const vite = await createServer({ root: path.join(root, directory), configFile: path.join(root, directory, 'vite.config.ts'),
      logLevel: 'silent', clearScreen: false, server: { host: '127.0.0.1', port: 0, strictPort: false,
        proxy: { '/api': { target: await app.getUrl(), changeOrigin: true } } } });
    await vite.listen(); return vite;
  };
  scenario = '启动Vite与浏览器';
  storeVite = await startVite('apps/store-web'); adminVite = await startVite('apps/admin-web');
  const origin = storeVite.resolvedUrls.local[0].replace(/\/$/, '');
  const adminOrigin = adminVite.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  page = await context.newPage(); const adminPage = await context.newPage();
  for (const [surface, currentPage] of [['store', page], ['admin', adminPage]]) {
    currentPage.on('pageerror', error => pageErrors.push({ surface, error: error.name }));
    currentPage.on('response', response => {
      const pathname = new URL(response.url()).pathname;
      if (pathname.startsWith('/api/')) requests.push({ surface, method: response.request().method(), path: pathname,
        status: response.status(), requestId: response.headers()['x-request-id'] ?? null,
        authorizationPresent: Boolean(response.request().headers()['authorization']) });
    });
  }
  const count = suffix => requests.filter(item => item.surface === 'store' && item.path === `/api/v1${suffix}`).length;
  const waitPath = suffix => page.waitForURL(`${origin}${suffix}`);
  const account = () => page.getByRole('heading', { name: '我的账号', exact: true }).waitFor();
  const readCredential = async (currentPage = page, key = customerKey) => {
    const value = await currentPage.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? 'null'), key);
    if (value?.accessToken) redactions.push(value.accessToken); return value;
  };
  // 页面只有一个提交表单；固定提交属性不受汉字间距和loading图标过渡影响。
  const loginButton = () => page.locator('form button[type="submit"]');
  const registerButton = () => page.locator('form button[type="submit"]');
  const fillRegistration = async (targetPhone, nickname) => {
    await page.getByLabel('手机号', { exact: true }).fill(` ${targetPhone} `);
    if (nickname !== undefined) await page.getByLabel('昵称（可选）', { exact: true }).fill(nickname);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByLabel('确认密码', { exact: true }).fill(password);
  };
  const login = async (value = password, targetPhone = phone) => {
    await page.getByLabel('手机号', { exact: true }).fill(` ${targetPhone} `);
    await page.getByLabel('密码', { exact: true }).fill(value); await loginButton().click();
  };
  const failRoute = (status, code) => route => route.fulfill({ status, contentType: 'application/json', headers: { 'x-request-id': requestId },
    body: JSON.stringify({ code, message: '验收故障响应', requestId }) });
  await mkdir(artifacts, { recursive: true });

  scenario = '公开首页与私有账号路由';
  await page.goto(origin); await page.getByRole('heading', { name: '欢迎来到我们的自营店铺。' }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/'); assert.equal(count('/store/me'), 0);
  await page.goto(`${origin}/account`); await waitPath('/login'); await page.getByRole('heading', { name: '顾客登录' }).waitFor();
  assert.equal(count('/store/me'), 0); checks.push(scenario);

  scenario = '注册前端边界';
  await page.goto(`${origin}/register`); await registerButton().click();
  await page.getByText('请输入有效的11位大陆手机号', { exact: true }).waitFor();
  await fillRegistration(phone, '😀'.repeat(41)); await page.getByLabel('密码', { exact: true }).fill('😀'.repeat(19));
  await registerButton().click(); await page.getByText('密码的UTF-8编码不得超过72字节', { exact: true }).waitFor();
  await page.getByText('昵称须为1～40个字符，不能只有空格', { exact: true }).waitFor();
  await fillRegistration(phone, ' 注册验收顾客 '); await page.getByLabel('确认密码', { exact: true }).fill('Different#2026');
  await registerButton().click(); await page.getByText('两次密码不一致', { exact: true }).waitFor();
  assert.equal(count('/store/auth/register'), 0); checks.push(scenario);

  scenario = '真实注册、提交loading及不自动登录';
  await page.getByLabel('确认密码', { exact: true }).fill(password);
  const registered = deferred(); const release = deferred(); let registerCalls = 0;
  await page.route('**/api/v1/store/auth/register', async route => {
    registerCalls++; const input = route.request().postDataJSON();
    assert.deepEqual(Object.keys(input).sort(), ['nickname', 'password', 'phone']);
    assert.ok(input.password === password, '密码必须保留首尾空格');
    const started = Date.now();
    try {
      const response = await route.fetch({ timeout: 5000 });
      console.log(JSON.stringify({ checkpoint: '注册转发完成', status: response.status(), elapsedMs: Date.now() - started }));
      registered.resolve({ ok: true }); await release.promise; await route.fulfill({ response });
    } catch (error) {
      console.log(JSON.stringify({ checkpoint: '注册转发失败', error: error.name, elapsedMs: Date.now() - started }));
      registered.resolve({ ok: false }); await route.abort('failed').catch(() => {});
    }
  });
  let clickSettled = false;
  const clickPending = registerButton().click().then(() => { clickSettled = true; });
  assert.ok((await within(registered.promise, '注册响应准备')).ok, '注册转发未完成');
  const submittingButton = page.locator('button[type="submit"]');
  console.log(JSON.stringify({ checkpoint: '注册提交状态', clickSettled, accessibleSnapshot: await submittingButton.ariaSnapshot() }));
  // loading图标会参与可访问名称；提交中按稳定的submit属性定位，避免等到超时后才找到空闲按钮。
  assert.ok(await submittingButton.isDisabled()); assert.ok(await page.getByLabel('手机号', { exact: true }).isDisabled()); assert.equal(registerCalls, 1);
  release.resolve(); await clickPending; await waitPath('/login'); await page.unroute('**/api/v1/store/auth/register');
  await page.getByText('注册成功，请使用手机号和密码登录。', { exact: true }).waitFor();
  assert.equal(await readCredential(), null); assert.equal(count('/store/auth/login'), 0); assert.equal(count('/store/me'), 0);
  const customer = await prisma.customer.findUniqueOrThrow({ where: { phone } });
  assert.equal(customer.nickname, '注册验收顾客'); assert.equal(customer.lastLoginAt, null);
  assert.equal(await prisma.authSession.count({ where: { customerId: customer.id } }), 0);
  assert.equal(await prisma.auditLog.count({ where: { actorCustomerId: customer.id, action: 'customer.register' } }), 1); checks.push(scenario);

  scenario = '重复手机号409与密码字段清理';
  await page.goto(`${origin}/register`); await fillRegistration(phone, '重复昵称'); await registerButton().click();
  await page.getByText(/请求编号：/).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('input[autocomplete="new-password"]')].every(input => input.value === ''));
  assert.equal(requests.at(-1).status, 409); assert.equal(await readCredential(), null);
  assert.equal(await prisma.customer.count({ where: { phone } }), 1); checks.push(scenario);

  scenario = '可选昵称省略使用默认值';
  await page.goto(`${origin}/register`); await fillRegistration(defaultPhone); await registerButton().click(); await waitPath('/login');
  const defaultCustomer = await prisma.customer.findUniqueOrThrow({ where: { phone: defaultPhone } });
  assert.equal(defaultCustomer.nickname, '新顾客'); assert.ok(!defaultCustomer.nickname.includes(defaultPhone));
  assert.equal(await readCredential(), null); assert.equal(count('/store/me'), 0); checks.push(scenario);

  scenario = '真实登录、密码原文及只读账号';
  await login(password.trim()); await page.getByText(/请求编号：/).waitFor();
  await page.waitForFunction(() => document.querySelector('input[autocomplete="current-password"]').value === '');
  assert.equal(requests.at(-1).status, 401); assert.equal(await readCredential(), null);
  await login(); await waitPath('/account'); await account(); await page.getByText(phone, { exact: true }).waitFor();
  await page.getByText('头像暂未设置', { exact: true }).waitFor();
  const credential = await readCredential();
  assert.deepEqual(Object.keys(credential).sort(), ['accessToken', 'domain', 'expiresAt']); assert.equal(credential.domain, 'CUSTOMER');
  await page.screenshot({ path: path.join(artifacts, 'customer-account.png'), fullPage: true }); checks.push(scenario);

  scenario = '刷新恢复与已登录表单保护';
  const meBefore = count('/store/me'); await page.reload(); await account(); assert.equal(count('/store/me') - meBefore, 1);
  assert.ok((await readCredential()).accessToken === credential.accessToken, '刷新不更换凭证');
  for (const route of ['/login', '/register']) { await page.goto(`${origin}${route}`); await waitPath('/account'); await account(); }
  assert.ok(await page.evaluate(() => !JSON.stringify(localStorage).includes('accessToken')));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '移动端不可横向溢出');
  await page.screenshot({ path: path.join(artifacts, 'customer-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1365, height: 900 }); checks.push(scenario);

  scenario = '真实双端登录及跨域凭证拒绝';
  await adminPage.goto(adminOrigin); await adminPage.getByRole('heading', { name: '员工登录' }).waitFor();
  await adminPage.getByLabel('员工账号', { exact: true }).fill(username); await adminPage.getByLabel('密码', { exact: true }).fill(password);
  await adminPage.getByRole('button', { name: /^登\s*录$/ }).click();
  await adminPage.getByRole('heading', { name: '欢迎，双端验收员工。' }).waitFor();
  const employeeCredential = await readCredential(adminPage, employeeKey);
  for (const [surfaceOrigin, endpoint, value] of [[origin, '/store/me', employeeCredential], [adminOrigin, '/admin/me', credential]]) {
    assert.equal((await fetch(`${surfaceOrigin}/api/v1${endpoint}`, { headers: { Authorization: `Bearer ${value.accessToken}` } })).status, 401);
  }
  const beforeCross = requests.filter(item => item.surface === 'store' && item.path.startsWith('/api/v1/admin/')).length;
  assert.equal(await page.evaluate(async () => {
    const { api } = await import('/src/services/api.ts'); try { await api.get('/admin/me'); } catch (error) { return error.code; }
  }), 'CLIENT_REQUEST_TARGET_INVALID');
  assert.equal(requests.filter(item => item.surface === 'store' && item.path.startsWith('/api/v1/admin/')).length, beforeCross);
  assert.ok((await readCredential()).accessToken === credential.accessToken, '域不匹配测试不修改顾客凭证'); checks.push(scenario);

  scenario = '交易受限可读取及焦点刷新';
  await prisma.customer.update({ where: { id: customer.id }, data: { status: 'TRADE_RESTRICTED' } });
  await page.bringToFront(); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByText('交易受限', { exact: true }).waitFor(); assert.ok(await readCredential()); checks.push(scenario);

  scenario = '本人500保留会话并可重试';
  await page.route('**/api/v1/store/me', failRoute(500, 'INTERNAL_ERROR')); await page.reload();
  await page.getByRole('heading', { name: '暂时无法读取账号信息' }).waitFor();
  assert.equal(await page.getByText(phone, { exact: true }).count(), 0); assert.ok(await readCredential());
  await page.unroute('**/api/v1/store/me'); await page.getByRole('button', { name: '重新读取' }).click(); await account(); checks.push(scenario);

  scenario = '本人403不注销或循环';
  await page.route('**/api/v1/store/me', failRoute(403, 'FORBIDDEN')); const own403 = count('/store/me'); await page.reload();
  await page.getByRole('heading', { name: '暂时无法读取账号信息' }).waitFor(); assert.equal(count('/store/me') - own403, 1); assert.ok(await readCredential());
  await page.unroute('**/api/v1/store/me'); await page.getByRole('button', { name: '重新读取' }).click(); await account(); checks.push(scenario);

  scenario = '真实冻结401清顾客身份且员工继续可用';
  await prisma.$transaction(async tx => {
    await tx.customer.update({ where: { id: customer.id }, data: { status: 'LOGIN_FROZEN', tokenVersion: { increment: 1 } } });
    await tx.authSession.updateMany({ where: { customerId: customer.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'BROWSER_TEST_FROZEN' } });
  });
  await page.reload(); await waitPath('/login'); await page.getByRole('heading', { name: '顾客登录' }).waitFor(); assert.equal(await readCredential(), null);
  const employeeMe = await adminPage.evaluate(async () => { const { auth } = await import('/src/services/api.ts'); return (await auth.me()).data.displayName; });
  assert.equal(employeeMe, '双端验收员工'); assert.ok((await readCredential(adminPage, employeeKey)).accessToken === employeeCredential.accessToken, '顾客401不清员工');
  await login(); await page.getByText(/请求编号：/).waitFor(); assert.equal(await readCredential(), null);
  await prisma.customer.update({ where: { id: customer.id }, data: { status: 'NORMAL' } }); checks.push(scenario);

  scenario = '真实注销只撤销当前会话且员工保持';
  await login(); await account(); const logoutCredential = await readCredential();
  const siblingResponse = await fetch(`${origin}/api/v1/store/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password }) });
  assert.equal(siblingResponse.status, 200); const siblingCredential = (await siblingResponse.json()).data; redactions.push(siblingCredential.accessToken);
  await page.getByRole('button', { name: '退出登录', exact: true }).click(); await waitPath('/login'); await page.getByText('已退出登录。', { exact: true }).waitFor();
  assert.equal(await readCredential(), null);
  for (const [value, expected] of [[logoutCredential, 401], [siblingCredential, 200]]) {
    assert.equal((await fetch(`${origin}/api/v1/store/me`, { headers: { Authorization: `Bearer ${value.accessToken}` } })).status, expected);
  }
  assert.ok((await readCredential(adminPage, employeeKey)).accessToken === employeeCredential.accessToken, '顾客退出不清员工'); checks.push(scenario);

  scenario = '员工退出不影响已登录顾客';
  await login(); await account(); const kept = await readCredential();
  await adminPage.getByRole('button', { name: '退出登录', exact: true }).click();
  await adminPage.getByRole('heading', { name: '员工登录' }).waitFor();
  assert.equal(await readCredential(adminPage, employeeKey), null); assert.ok((await readCredential()).accessToken === kept.accessToken, '员工退出不清顾客');
  assert.equal(await page.evaluate(async () => { const { auth } = await import('/src/services/api.ts'); return (await auth.me()).data.nickname; }), '注册验收顾客'); checks.push(scenario);

  scenario = '注销网络失败仍清本地';
  await page.route('**/api/v1/auth/logout', route => route.abort('failed'));
  await page.getByRole('button', { name: '退出登录', exact: true }).click(); await waitPath('/login');
  await page.getByText(/服务器注销未确认/).waitFor(); assert.equal(await readCredential(), null);
  await page.unroute('**/api/v1/auth/logout'); checks.push(scenario);

  scenario = '顾客本地到期定时清理';
  await login(); await account();
  await page.evaluate(async () => { const { session } = await import('/src/services/api.ts');
    session.save({ ...session.current().credential, tokenType: 'Bearer', expiresAt: new Date(Date.now() + 1500).toISOString() }); });
  await waitPath('/login'); await page.getByRole('heading', { name: '顾客登录' }).waitFor(); assert.equal(await readCredential(), null); checks.push(scenario);

  scenario = '离开注册页后迟到成功不跳转';
  await page.goto(`${origin}/register`); await fillRegistration(latePhone, '迟到注册顾客');
  const lateRegistered = deferred(); const lateRelease = deferred();
  await page.route('**/api/v1/store/auth/register', async route => {
    const response = await route.fetch(); lateRegistered.resolve(); await lateRelease.promise; await route.fulfill({ response });
  });
  const lateClick = registerButton().click(); await within(lateRegistered.promise, '迟到注册响应准备');
  await page.getByRole('link', { name: '首页', exact: true }).click(); await page.getByRole('heading', { name: '欢迎来到我们的自营店铺。' }).waitFor();
  const lateResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/store/auth/register');
  lateRelease.resolve(); assert.equal((await lateResponse).status(), 201); await lateClick;
  await page.getByText('注册成功，请使用手机号和密码登录。', { exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/'); assert.equal(await readCredential(), null); await page.unroute('**/api/v1/store/auth/register'); checks.push(scenario);

  scenario = '登录网络失败固定提示';
  await page.goto(`${origin}/login`); await page.route('**/api/v1/store/auth/login', route => route.abort('failed'));
  await login(); await page.getByText('网络连接失败，请稍后重试', { exact: true }).waitFor();
  assert.equal(await readCredential(), null); await page.unroute('**/api/v1/store/auth/login'); checks.push(scenario);

  scenario = '真实登录限流和Retry-After';
  let ratePhone;
  do { ratePhone = `138${randomInt(100_000_000).toString().padStart(8, '0')}`; } while (await prisma.customer.count({ where: { phone: ratePhone } }));
  redactions.push(ratePhone);
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/store/auth/login');
    await login(password, ratePhone); assert.equal((await response).status(), attempt < 5 ? 401 : 429);
    await page.waitForFunction(() => document.querySelector('input[autocomplete="current-password"]').value === '');
  }
  await page.getByText(/请在 \d+ 秒后重试。/).waitFor(); await page.getByText(/请求编号：/).waitFor();
  for (const request of requests.filter(item => /\/auth\/(login|register)$/.test(item.path))) assert.equal(request.authorizationPresent, false);
  assert.deepEqual(pageErrors, []); checks.push(scenario);
  report = { date: new Date().toISOString(), node: process.version, browser: await browser.version(), database: safe.testName,
    backend: '真实Nest API及PostgreSQL测试库，只有本人500/403与网络中止由浏览器注入', checks, requests, pageErrors,
    localExpiry: '客户端期限缩短仅验证定时清理，不作为JWT服务端到期证据', separation: '同一浏览器上下文中的真实后台与顾客两站登录/注销，跨域token由API拒绝' };
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'failure-state.png'), fullPage: true }).catch(() => {});
  let diagnostic = String(error.message);
  for (const value of redactions) if (value) diagnostic = diagnostic.replaceAll(value, '[已隐藏]');
  diagnostic = diagnostic.replace(/postgres(?:ql)?:\/\/\S+/gi, '[数据库连接已隐藏]').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [已隐藏]');
  console.error(JSON.stringify({ status: 'failed', scenario, error: error.name, message: diagnostic })); process.exitCode = 1;
} finally {
  await browser?.close(); await storeVite?.close(); await adminVite?.close();
  assertSafeTestDatabase(env.DATABASE_URL, safe.testUrl);
  const customerIds = (await prisma.customer.findMany({ where: { phone: { in: ownedPhones } }, select: { id: true } })).map(item => item.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorCustomerId: { in: customerIds } }, { actorEmployeeId: { in: employeeIds } }, { targetId: { in: [...customerIds, ...employeeIds] } }] } });
  await prisma.employeeExtraPermission.deleteMany({ where: { OR: [{ employeeId: { in: employeeIds } }, { grantedById: { in: employeeIds } }] } });
  await prisma.authSession.deleteMany({ where: { OR: [{ customerId: { in: customerIds } }, { employeeId: { in: employeeIds } }] } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } }); await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
  const cleanup = { customers: await prisma.customer.count({ where: { phone: { in: ownedPhones } } }),
    employees: await prisma.employee.count({ where: { id: { in: employeeIds } } }),
    sessions: await prisma.authSession.count({ where: { OR: [{ customerId: { in: customerIds } }, { employeeId: { in: employeeIds } }] } }),
    actorAudits: await prisma.auditLog.count({ where: { OR: [{ actorCustomerId: { in: customerIds } }, { actorEmployeeId: { in: employeeIds } }] } }) };
  assert.ok(Object.values(cleanup).every(value => value === 0), '自有数据清理未完成');
  console.log('已清理本轮顾客、员工、会话及审计，未清空测试库。'); await app.close();
  if (report) {
    await writeFile(path.join(artifacts, 'result.json'), JSON.stringify({ ...report, cleanup }, null, 2) + '\n');
    console.log(JSON.stringify({ status: 'passed', checks: checks.length, pageErrors: pageErrors.length, artifacts: path.relative(root, artifacts) }));
  }
}
