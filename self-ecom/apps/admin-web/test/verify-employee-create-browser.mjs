/* global document, innerWidth */
/** 文件作用：使用真实后台页面验证员工创建、输入校验、权限保护和提交结果核实。 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 沿用真实Nest/Vite与隔离测试库；仅按预先确认不存在的本轮账号清理夹具。
const root = fileURLToPath(new URL('../../../', import.meta.url));
const apiRequire = createRequire(path.join(root, 'apps/api/package.json'));
const { readDatabaseEnvironment, assertSafeTestDatabase } = apiRequire('./scripts/database-env.ts');
const env = readDatabaseEnvironment(); const safe = assertSafeTestDatabase(env.DATABASE_URL, env.TEST_DATABASE_URL);
Object.assign(process.env, env, { DATABASE_URL: safe.testUrl, NODE_ENV: 'test', LOG_LEVEL: 'silent', JWT_SECRET: randomBytes(48).toString('hex'), JWT_TTL_SECONDS: '7200' });
apiRequire('reflect-metadata');
const { NestFactory } = apiRequire('@nestjs/core'); const { AppModule } = apiRequire('./dist/app.module.js');
const { configureApp } = apiRequire('./dist/common/configure-app.js'); const { PrismaService } = apiRequire('./dist/prisma/prisma.service.js');
const { PasswordService } = apiRequire('./dist/auth/password.service.js');
const { createServer } = await import(pathToFileURL(path.join(root, 'apps/admin-web/node_modules/vite/dist/node/index.js')).href);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const app = await NestFactory.create(AppModule, { logger: false }); const prisma = app.get(PrismaService); const passwords = app.get(PasswordService);
const artifacts = path.resolve(root, process.env.VERIFICATION_OUTPUT_DIR || 'output/playwright/step30'); const checks = []; const requests = []; const pageErrors = []; const gates = [];
const prefix = `c_${randomUUID().replaceAll('-', '').slice(0, 10)}_`;
const usernames = ['admin', 'ordinary', 'service', 'warehouse', 'super', 'unconfirmed', 'late', 'denied'].map(suffix => prefix + suffix);
const [operatorUsername, ordinaryUsername, serviceUsername, warehouseUsername, superUsername, unconfirmedUsername, lateUsername, deniedUsername] = usernames;
const operatorId = randomUUID(); const ordinaryId = randomUUID(); const fixtureIds = [operatorId, ordinaryId];
const password = ' Create#2026 '; const changedPassword = 'CreatedNew#2026'; const requestId = randomUUID(); const employeeKey = 'self-ecom.employee.session';
const redactions = [env.DATABASE_URL, env.TEST_DATABASE_URL, env.JWT_SECRET, process.env.JWT_SECRET, password, changedPassword];
let vite; let browser; let page; let report; let scenario = '启动'; let reserved = false;
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); const gate = { promise, resolve }; gates.push(gate); return gate; };
const within = (promise, label) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`${label}未在15秒内完成`)), 15_000);
  promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); }); });
const passed = () => { checks.push(scenario); console.log(JSON.stringify({ checkpoint: scenario, status: 'passed' })); };
try {
  await mkdir(artifacts, { recursive: true }); configureApp(app); await app.listen(0, '127.0.0.1');
  assert.ok(await prisma.permissionDefinition.count());
  assert.equal(await prisma.employee.count({ where: { OR: [{ username: { in: usernames } }, { id: { in: fixtureIds } }] } }), 0); reserved = true;
  const hash = await passwords.hash(password); redactions.push(hash);
  await prisma.employee.createMany({ data: [
    { id: operatorId, username: operatorUsername, displayName: '创建验收管理员', role: 'SUPER_ADMIN', status: 'ACTIVE', mustChangePassword: false, passwordHash: hash },
    { id: ordinaryId, username: ordinaryUsername, displayName: '创建验收普通员工', role: 'CUSTOMER_SERVICE', status: 'ACTIVE', mustChangePassword: false, passwordHash: hash },
  ] });
  vite = await createServer({ root: path.join(root, 'apps/admin-web'), configFile: path.join(root, 'apps/admin-web/vite.config.ts'), logLevel: 'silent', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, proxy: { '/api': { target: await app.getUrl(), changeOrigin: true } } } });
  await vite.listen(); const origin = vite.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); page = await context.newPage();
  const ordinaryPage = await context.newPage(); const createdPage = await context.newPage();
  for (const [surface, currentPage] of [['admin', page], ['ordinary', ordinaryPage], ['created', createdPage]]) {
    currentPage.on('pageerror', error => pageErrors.push({ surface, error: error.name }));
    currentPage.on('response', response => { const url = new URL(response.url()); if (url.pathname.startsWith('/api/')) {
      const req = response.request(); const body = req.postDataJSON();
      requests.push({ surface, method: req.method(), path: url.pathname, status: response.status(), requestId: response.headers()['x-request-id'] ?? null,
        bodyFields: body && typeof body === 'object' ? Object.keys(body).sort() : undefined });
    } });
  }
  const postCount = () => requests.filter(item => item.method === 'POST' && item.path === '/api/v1/admin/employees').length;
  const submit = () => page.locator('form button[type="submit"]');
  const login = async (currentPage, username, loginPassword = password) => {
    await currentPage.getByLabel('员工账号', { exact: true }).fill(username); await currentPage.getByLabel('密码', { exact: true }).fill(loginPassword);
    await currentPage.locator('form button[type="submit"]').click();
  };
  const credential = async currentPage => { const value = await currentPage.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? 'null'), employeeKey);
    if (value?.accessToken) redactions.push(value.accessToken); return value; };
  const createUrl = `${origin}/employees/new?page=2&pageSize=10&keyword=${prefix}`;
  const openCreate = async () => { await page.goto(createUrl); await page.getByRole('heading', { name: '创建员工', exact: true }).waitFor(); await submit().waitFor(); };
  const selectRole = async label => {
    await page.getByLabel('岗位', { exact: true }).click(); const dropdown = page.locator('.ant-select-dropdown:visible');
    await dropdown.getByText(label, { exact: true }).click(); await dropdown.waitFor({ state: 'hidden' });
  };
  const fill = async (username, role = '客服') => {
    await page.getByLabel('员工账号', { exact: true }).fill(username); await page.getByLabel('显示名', { exact: true }).fill(' 客服 甲 ');
    await selectRole(role); await page.getByLabel('初始密码', { exact: true }).fill(password); await page.getByLabel('确认初始密码', { exact: true }).fill(password);
    await page.getByLabel('创建原因', { exact: true }).fill(' 新增店铺员工 ');
  };
  const passwordsCleared = async () => { await page.waitForFunction(() => [...document.querySelectorAll('input[type="password"]')].every(input => input.value === '')); };
  const listReady = () => page.waitForFunction(async () => {
    const { employeeQueries } = await import('/src/services/api.ts'); const { parseEmployeeSearch } = await import('/src/employees/query.ts');
    const state = employeeQueries.list.getSnapshot(); if (state.status !== 'ready' || state.key !== JSON.stringify(parseEmployeeSearch(document.location.search).query)) return false;
    const body = document.querySelector('.ant-table-tbody'); if (!body) return false;
    const keys = [...body.querySelectorAll('tr.ant-table-row')].map(row => row.getAttribute('data-row-key'));
    return keys.length === state.data.items.length && keys.every((id, index) => id === state.data.items[index].id);
  });
  const oneEmployeeRow = username => page.waitForFunction(expected => {
    const rows = document.querySelectorAll('.ant-table-tbody tr.ant-table-row');
    return rows.length === 1 && rows[0].querySelector('td')?.textContent.trim() === expected;
  }, username);
  const creation = async username => {
    const row = await prisma.employee.findUniqueOrThrow({ where: { username } }); redactions.push(row.passwordHash);
    assert.equal(row.status, 'ACTIVE'); assert.equal(row.mustChangePassword, true); assert.equal(row.version, 0); assert.equal(row.permissionVersion, 0); assert.equal(row.tokenVersion, 0);
    assert.ok(await passwords.verify(password, row.passwordHash)); assert.equal(await passwords.verify(password.trim(), row.passwordHash), false);
    assert.equal(await prisma.authSession.count({ where: { employeeId: row.id } }), 0); assert.equal(await prisma.employeeExtraPermission.count({ where: { employeeId: row.id } }), 0);
    const audits = await prisma.auditLog.findMany({ where: { targetId: row.id, action: 'employee.create' } }); assert.equal(audits.length, 1);
    assert.equal(audits[0].actorEmployeeId, operatorId); assert.equal(audits[0].reason, '新增店铺员工'); assert.equal(audits[0].beforeData, null);
    assert.deepEqual(audits[0].afterData, { username, displayName: '客服 甲', role: row.role, status: 'ACTIVE', mustChangePassword: true });
    assert.ok(!JSON.stringify(audits).includes(row.passwordHash) && !JSON.stringify(audits).includes(password)); return row;
  };

  scenario = '匿名创建页保护与管理员创建入口';
  await page.goto(createUrl); await page.waitForURL(`${origin}/login`); assert.equal(postCount(), 0); await login(page, operatorUsername);
  await page.getByRole('link', { name: '员工管理', exact: true }).click(); await listReady();
  await page.getByRole('link', { name: '创建员工', exact: true }).click(); await page.getByRole('heading', { name: '创建员工', exact: true }).waitFor();
  const operatorCredential = await credential(page); passed();

  scenario = '表单必填账号Unicode岗位与密码规则阻止HTTP';
  await openCreate(); await submit().click(); await page.getByText('请填写创建原因', { exact: true }).waitFor(); assert.equal(postCount(), 0);
  await fill(serviceUsername);
  for (const [label, value, message] of [
    ['员工账号', 'abc', '账号须为4～32位，以字母开头，仅含字母、数字和下划线'], ['员工账号', '1abc', '账号须为4～32位，以字母开头，仅含字母、数字和下划线'],
    ['显示名', '😀'.repeat(41), '显示名最多40个字符'], ['显示名', '   ', '请填写显示名'], ['创建原因', '😀'.repeat(501), '创建原因最多500个字符'],
    ['初始密码', 'short', '密码至少8个Unicode字符'], ['初始密码', 'a'.repeat(65), '密码最多64个Unicode字符'], ['初始密码', '😀'.repeat(19), '密码的UTF-8编码不得超过72字节'],
    ['确认初始密码', 'Mismatch#2026', '两次初始密码不一致'],
  ]) {
    const previous = await page.getByLabel(label, { exact: true }).inputValue(); await page.getByLabel(label, { exact: true }).fill(value); await submit().click();
    await page.getByText(message, { exact: true }).waitFor(); assert.equal(postCount(), 0); await page.getByLabel(label, { exact: true }).fill(previous);
  }
  passed();

  scenario = '取消创建保留列表条件且不提交';
  await page.getByRole('link', { name: '返回员工列表', exact: true }).click(); await listReady(); assert.equal(postCount(), 0);
  assert.equal(new URL(page.url()).searchParams.get('page'), '2'); assert.equal(new URL(page.url()).searchParams.get('keyword'), prefix);
  await page.getByRole('link', { name: '创建员工', exact: true }).click(); await page.getByRole('heading', { name: '创建员工', exact: true }).waitFor();
  assert.equal(await page.getByLabel('员工账号', { exact: true }).inputValue(), ''); passed();

  scenario = '桌面与390px创建表单布局';
  await fill(` ${serviceUsername.toUpperCase()} `); await page.screenshot({ path: path.join(artifacts, 'employee-create.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(artifacts, 'employee-create-mobile.png'), fullPage: true }); await page.setViewportSize({ width: 1440, height: 1000 }); passed();

  scenario = '真实创建201单次提交白名单及审计初始状态';
  const committed = deferred(); const release = deferred(); let sent;
  await page.route('**/api/v1/admin/employees', async route => {
    if (route.request().method() !== 'POST') return route.continue(); sent = route.request().postDataJSON();
    const response = await route.fetch(); assert.equal(response.status(), 201); committed.resolve(); await release.promise; await route.fulfill({ response });
  });
  const before = postCount(); await submit().click(); await within(committed.promise, '真实创建提交屏障');
  assert.ok(await submit().isDisabled()); assert.ok(await page.getByLabel('员工账号', { exact: true }).isDisabled());
  assert.deepEqual(sent, { username: serviceUsername, displayName: '客服 甲', role: 'CUSTOMER_SERVICE', initialPassword: password, reason: '新增店铺员工' });
  const service = await creation(serviceUsername); release.resolve(); await page.getByRole('heading', { name: '员工已创建', exact: true }).waitFor();
  assert.equal(postCount() - before, 1); assert.equal(await page.locator('form,input').count(), 0);
  assert.equal((await credential(page)).accessToken, operatorCredential.accessToken); await page.unroute('**/api/v1/admin/employees');
  await page.screenshot({ path: path.join(artifacts, 'employee-created.png'), fullPage: true }); passed();

  scenario = '创建成功详情及列表能查询新员工';
  await page.getByRole('link', { name: '查看员工详情', exact: true }).click(); await page.getByRole('heading', { name: '员工权限', exact: true }).waitFor();
  await page.getByText(serviceUsername, { exact: true }).waitFor(); await page.getByText('是', { exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('page'), '2');
  await page.goto(`${origin}/employees?keyword=${serviceUsername}`); await listReady(); await oneEmployeeRow(serviceUsername); passed();

  scenario = '重复账号真实409保留文本清密码且不重复审计';
  await openCreate(); await fill(` ${serviceUsername.toUpperCase()} `); await submit().click(); await page.getByText('员工账号已存在', { exact: true }).waitFor(); await passwordsCleared();
  assert.equal(await page.getByLabel('员工账号', { exact: true }).inputValue(), ` ${serviceUsername.toUpperCase()} `);
  assert.equal(await page.getByLabel('显示名', { exact: true }).inputValue(), ' 客服 甲 '); assert.equal(await page.getByLabel('创建原因', { exact: true }).inputValue(), ' 新增店铺员工 ');
  await page.getByText(/请求编号：/).waitFor(); assert.equal(await prisma.employee.count({ where: { username: serviceUsername } }), 1); await creation(serviceUsername);
  assert.equal((await credential(page)).accessToken, operatorCredential.accessToken); passed();

  scenario = '商品仓储与管理员岗位真实创建且首次强制改密';
  for (const [username, role, label] of [[warehouseUsername, 'MERCH_WAREHOUSE', '商品与仓储'], [superUsername, 'SUPER_ADMIN', '超级管理员']]) {
    await openCreate(); await fill(username, label); if (role === 'SUPER_ADMIN') await page.getByText('超级管理员拥有全部后台管理权限，请确认该岗位安排。', { exact: true }).waitFor();
    await submit().click(); await page.getByRole('heading', { name: '员工已创建', exact: true }).waitFor(); assert.equal((await creation(username)).role, role);
  }
  passed();

  scenario = '普通员工页面拒绝与真实创建API403';
  await ordinaryPage.goto(`${origin}/login`); await login(ordinaryPage, ordinaryUsername);
  await ordinaryPage.getByRole('heading', { name: '欢迎，创建验收普通员工。', exact: true }).waitFor();
  assert.equal(await ordinaryPage.getByRole('link', { name: '创建员工', exact: true }).count(), 0); const ordinaryCredential = await credential(ordinaryPage); const postsBefore = postCount();
  await ordinaryPage.goto(`${origin}/employees/new`); await ordinaryPage.getByRole('heading', { name: '没有创建员工的权限', exact: true }).waitFor(); assert.equal(postCount(), postsBefore);
  const deniedBody = { username: deniedUsername, displayName: '拒绝夹具', role: 'SUPER_ADMIN', initialPassword: password, reason: '无权创建' };
  assert.equal((await fetch(`${origin}/api/v1/admin/employees`, { method: 'POST', headers: { Authorization: `Bearer ${ordinaryCredential.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(deniedBody) })).status, 403);
  assert.equal(await prisma.employee.count({ where: { username: deniedUsername } }), 0); passed();

  scenario = '新员工真实首次登录改密并用新密码重新登录';
  await createdPage.goto(`${origin}/employees/new`); await login(createdPage, serviceUsername);
  await createdPage.getByRole('heading', { name: '首次登录，请修改密码', exact: true }).waitFor(); const firstCredential = await credential(createdPage);
  const forced = await fetch(`${origin}/api/v1/admin/employees`, { method: 'POST', headers: { Authorization: `Bearer ${firstCredential.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(deniedBody) });
  assert.equal(forced.status, 403); assert.equal((await forced.json()).code, 'PASSWORD_CHANGE_REQUIRED');
  await createdPage.getByLabel('旧密码', { exact: true }).fill(password); await createdPage.getByLabel('新密码', { exact: true }).fill(changedPassword);
  await createdPage.getByLabel('确认新密码', { exact: true }).fill(changedPassword); await createdPage.locator('form button[type="submit"]').click(); await createdPage.waitForURL(`${origin}/login`);
  assert.equal((await fetch(`${origin}/api/v1/admin/me`, { headers: { Authorization: `Bearer ${firstCredential.accessToken}` } })).status, 401);
  const changed = await prisma.employee.findUniqueOrThrow({ where: { id: service.id } }); assert.equal(changed.mustChangePassword, false); assert.equal(changed.tokenVersion, 1); assert.ok(await passwords.verify(changedPassword, changed.passwordHash));
  await login(createdPage, serviceUsername, changedPassword); await createdPage.getByRole('heading', { name: '欢迎，客服 甲。', exact: true }).waitFor();
  assert.equal(await createdPage.getByRole('link', { name: '员工管理', exact: true }).count(), 0);
  assert.equal((await fetch(`${origin}/api/v1/admin/me`, { headers: { Authorization: `Bearer ${operatorCredential.accessToken}` } })).status, 200); passed();

  scenario = '400及500网络失败保留文本清密码且不自动重试';
  for (const status of [400, 500, null]) {
    await openCreate(); await fill(deniedUsername); const callsBefore = postCount();
    await page.route('**/api/v1/admin/employees', route => status ? route.fulfill({ status, contentType: 'application/json', headers: { 'x-request-id': requestId },
      body: JSON.stringify({ code: status === 400 ? 'VALIDATION_FAILED' : 'INTERNAL_ERROR', message: '创建验收固定失败', requestId,
        details: status === 400 ? [{ field: 'reason', message: '请核对创建原因' }] : undefined }) }) : route.abort('failed'));
    await submit().click(); await page.getByText(status ? '创建验收固定失败' : '网络连接失败，请稍后重试', { exact: true }).waitFor(); await passwordsCleared();
    assert.equal(await page.getByLabel('员工账号', { exact: true }).inputValue(), deniedUsername); assert.equal(postCount() - callsBefore, status ? 1 : 0);
    if (status !== 400) await page.getByText('创建结果未确认', { exact: true }).waitFor();
    assert.equal(await prisma.employee.count({ where: { username: deniedUsername } }), 0); assert.ok(await credential(page)); await page.unroute('**/api/v1/admin/employees');
  }
  passed();

  scenario = '403受控恢复资格不重复创建或注销';
  await openCreate(); await fill(deniedUsername); const forbiddenBefore = postCount();
  await page.route('**/api/v1/admin/employees', route => route.fulfill({ status: 403, contentType: 'application/json', headers: { 'x-request-id': requestId },
    body: JSON.stringify({ code: 'FORBIDDEN', message: '创建验收无权', requestId }) }));
  await submit().click(); await page.getByText('当前操作没有权限，已重新读取账号权限。', { exact: true }).waitFor();
  await page.waitForFunction(async () => (await import('/src/services/api.ts')).employeeAuth.getSnapshot().status === 'ready');
  await page.getByRole('heading', { name: '创建员工', exact: true }).waitFor(); assert.equal(postCount() - forbiddenBefore, 1);
  assert.equal((await credential(page)).accessToken, operatorCredential.accessToken); await page.unroute('**/api/v1/admin/employees'); passed();

  scenario = '真实提交后响应丢失先查询核实不自动重建';
  await openCreate(); await fill(unconfirmedUsername); let lostCalls = 0;
  await page.route('**/api/v1/admin/employees', async route => { lostCalls++; const response = await route.fetch(); assert.equal(response.status(), 201); await route.abort('failed'); });
  await submit().click(); await page.getByText('创建结果未确认', { exact: true }).waitFor(); await passwordsCleared(); assert.equal(lostCalls, 1); await creation(unconfirmedUsername);
  await page.unroute('**/api/v1/admin/employees'); await page.getByRole('link', { name: '返回员工列表', exact: true }).click(); await listReady();
  await page.getByLabel('搜索账号或姓名', { exact: true }).fill(unconfirmedUsername); await page.locator('form button[type="submit"]').click();
  await page.waitForURL(url => url.searchParams.get('keyword') === unconfirmedUsername); await listReady(); await oneEmployeeRow(unconfirmedUsername); passed();

  scenario = '离开表单后迟到的真实成功不改写当前页面';
  await openCreate(); await fill(lateUsername); const lateCommitted = deferred(); const lateRelease = deferred();
  await page.route('**/api/v1/admin/employees', async route => { const response = await route.fetch(); assert.equal(response.status(), 201); lateCommitted.resolve(); await lateRelease.promise; await route.fulfill({ response }); });
  await submit().click(); await within(lateCommitted.promise, '迟到创建提交屏障'); await page.getByRole('link', { name: '返回员工列表', exact: true }).click(); await listReady();
  const lateResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/admin/employees');
  lateRelease.resolve(); await lateResponse; await creation(lateUsername); assert.equal(new URL(page.url()).pathname, '/employees');
  assert.equal(await page.getByRole('heading', { name: '员工已创建', exact: true }).count(), 0); await page.unroute('**/api/v1/admin/employees'); passed();

  scenario = '真实会话撤销401拒绝创建且另一员工登录保持';
  await openCreate(); await fill(deniedUsername); const requestReady = deferred(); const requestRelease = deferred();
  await page.route('**/api/v1/admin/employees', async route => { requestReady.resolve(route.request()); await requestRelease.promise; await route.continue(); });
  await submit().click(); const held = await within(requestReady.promise, '创建会话撤销屏障');
  const revoked = await prisma.authSession.updateMany({ where: { employeeId: operatorId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'LOGOUT' } }); assert.ok(revoked.count > 0);
  requestRelease.resolve(); assert.equal((await held.response()).status(), 401); await page.waitForURL(`${origin}/login`); assert.equal(await credential(page), null);
  assert.equal(await prisma.employee.count({ where: { username: deniedUsername } }), 0); const otherCredential = await credential(createdPage);
  assert.equal((await fetch(`${origin}/api/v1/admin/me`, { headers: { Authorization: `Bearer ${otherCredential.accessToken}` } })).status, 200);
  assert.ok(await page.evaluate(async () => { const { employeeQueries } = await import('/src/services/api.ts'); return employeeQueries.list.getSnapshot().data === null && employeeQueries.detail.getSnapshot().data === null; }));
  await page.unroute('**/api/v1/admin/employees'); passed();

  scenario = '五次真实创建与最小存储无密码或内部字段泄漏';
  assert.equal(await prisma.employee.count({ where: { username: { in: [serviceUsername, warehouseUsername, superUsername, unconfirmedUsername, lateUsername] } } }), 5);
  assert.equal(await prisma.auditLog.count({ where: { actorEmployeeId: operatorId, action: 'employee.create' } }), 5);
  assert.deepEqual(Object.keys(await credential(createdPage)).sort(), ['accessToken', 'domain', 'expiresAt']);
  assert.ok(!(await createdPage.evaluate(() => JSON.stringify({ session: { ...sessionStorage }, local: { ...localStorage } }))).includes(changedPassword));
  assert.deepEqual(pageErrors, []); passed();
  report = { date: new Date().toISOString(), node: process.version, browser: await browser.version(), database: safe.testName, checks, requests, pageErrors,
    scope: '创建员工页面；五次真实创建、一次重复409和首次改密；400/403/500与网络失败为浏览器注入，丢失响应已实际提交，撤销只操作自有夹具' };
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'failure-state.png'), fullPage: true }).catch(() => {});
  let message = String(error.message); for (const value of redactions) if (value) message = message.replaceAll(value, '[已隐藏]');
  message = message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[数据库连接已隐藏]').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [已隐藏]');
  const sourceLine = error.stack?.split('\n').find(line => /verify-employee-create-browser\.mjs:\d+/.test(line))?.trim();
  console.error(JSON.stringify({ status: 'failed', scenario, error: error.name, message, sourceLine })); process.exitCode = 1;
} finally {
  for (const gate of gates) gate.resolve(); await browser?.close(); await vite?.close(); assertSafeTestDatabase(env.DATABASE_URL, safe.testUrl);
  let cleanup;
  if (reserved) {
    const ids = (await prisma.employee.findMany({ where: { username: { in: usernames } }, select: { id: true } })).map(row => row.id);
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorEmployeeId: { in: ids } }, { targetId: { in: ids } }] } });
    await prisma.employeeExtraPermission.deleteMany({ where: { OR: [{ employeeId: { in: ids } }, { grantedById: { in: ids } }] } });
    await prisma.authSession.deleteMany({ where: { employeeId: { in: ids } } }); await prisma.employee.deleteMany({ where: { id: { in: ids } } });
    cleanup = { employees: await prisma.employee.count({ where: { username: { in: usernames } } }), sessions: await prisma.authSession.count({ where: { employeeId: { in: ids } } }),
      extraPermissions: await prisma.employeeExtraPermission.count({ where: { OR: [{ employeeId: { in: ids } }, { grantedById: { in: ids } }] } }),
      actorAudits: await prisma.auditLog.count({ where: { OR: [{ actorEmployeeId: { in: ids } }, { targetId: { in: ids } }] } }) };
    assert.ok(Object.values(cleanup).every(value => value === 0)); console.log('本轮自建员工及会话、授权和审计已精确清理，未清空测试库。');
  }
  await app.close();
  if (report) { await writeFile(path.join(artifacts, 'result.json'), JSON.stringify({ ...report, cleanup }, null, 2) + '\n');
    console.log(JSON.stringify({ status: 'passed', checks: checks.length, pageErrors: pageErrors.length, artifacts: path.relative(root, artifacts) })); }
}
