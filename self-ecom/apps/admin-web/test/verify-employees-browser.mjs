/* global document, innerWidth, requestAnimationFrame */
/** 文件作用：使用真实后台页面验证员工查询、权限展示、请求竞态和只读数据边界。 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 真实查询API与页面；仅向已校验隔离的测试库写入本轮自有夹具。
const root = fileURLToPath(new URL('../../../', import.meta.url));
const apiRequire = createRequire(path.join(root, 'apps/api/package.json'));
const { readDatabaseEnvironment, assertSafeTestDatabase } = apiRequire('./scripts/database-env.ts');
const env = readDatabaseEnvironment(); const safe = assertSafeTestDatabase(env.DATABASE_URL, env.TEST_DATABASE_URL);
Object.assign(process.env, env, { DATABASE_URL: safe.testUrl, NODE_ENV: 'test', LOG_LEVEL: 'silent',
  JWT_SECRET: randomBytes(48).toString('hex'), JWT_TTL_SECONDS: '7200' });
apiRequire('reflect-metadata');
const { NestFactory } = apiRequire('@nestjs/core'); const { AppModule } = apiRequire('./dist/app.module.js');
const { configureApp } = apiRequire('./dist/common/configure-app.js'); const { PrismaService } = apiRequire('./dist/prisma/prisma.service.js');
const { PasswordService } = apiRequire('./dist/auth/password.service.js');
const { createServer } = await import(pathToFileURL(path.join(root, 'apps/admin-web/node_modules/vite/dist/node/index.js')).href);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const app = await NestFactory.create(AppModule, { logger: false }); const prisma = app.get(PrismaService);
const employeeIds = []; const checks = []; const requests = []; const pageErrors = []; const gates = [];
const artifacts = path.resolve(root, process.env.VERIFICATION_OUTPUT_DIR || 'output/playwright/step29'); const password = 'EmployeesBrowser#2026';
const redactions = [env.DATABASE_URL, env.TEST_DATABASE_URL, env.JWT_SECRET, process.env.JWT_SECRET, password];
const employeeKey = 'self-ecom.employee.session'; const requestId = '68f22884-dc8c-4de7-bdd8-5d51c83a088e';
let vite; let browser; let page; let report; let scenario = '启动';
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); const gate = { promise, resolve }; gates.push(gate); return gate; };
const within = (promise, label) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`${label}未在15秒内完成`)), 15_000);
  promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
});
function passed() { checks.push(scenario); console.log(JSON.stringify({ checkpoint: scenario, status: 'passed' })); }

try {
  await mkdir(artifacts, { recursive: true }); configureApp(app); await app.listen(0, '127.0.0.1');
  assert.ok(await prisma.permissionDefinition.count(), '测试库缺权限目录');
  const namespace = randomUUID().replaceAll('-', '').slice(0, 10); const prefix = `q_${namespace}_`; const operatorId = randomUUID();
  const hash = await app.get(PasswordService).hash(password); redactions.push(hash);
  const operator = { id: operatorId, username: `r_${namespace}_admin`, displayName: '只读验收管理员', role: 'SUPER_ADMIN', status: 'ACTIVE', mustChangePassword: false };
  const rows = Array.from({ length: 14 }, (_, index) => ({ id: randomUUID(), username: `${prefix}${String(index).padStart(2, '0')}`,
    displayName: index === 13 ? '折扣%_顾问' : `列表员工${String(index).padStart(2, '0')}`, role: index % 2 ? 'CUSTOMER_SERVICE' : 'MERCH_WAREHOUSE',
    status: index % 4 ? 'ACTIVE' : 'DISABLED', mustChangePassword: index === 2, createdAt: new Date(Date.UTC(2026, 10, 12, 1, index)) }));
  assert.equal(await prisma.employee.count({ where: { OR: [{ id: { in: [operator.id, ...rows.map(row => row.id)] } }, { username: { in: [operator.username, ...rows.map(row => row.username)] } }] } }), 0);
  await prisma.employee.create({ data: { ...operator, passwordHash: hash } }); employeeIds.push(operator.id);
  await prisma.employee.createMany({ data: rows.map(row => ({ ...row, passwordHash: hash })) }); employeeIds.push(...rows.map(row => row.id));
  const extras = ['order.fulfillment.read', 'shipment.claim', 'shipment.tracking.correct'];
  assert.equal(await prisma.permissionDefinition.count({ where: { code: { in: extras } } }), extras.length);
  await prisma.employeeExtraPermission.createMany({ data: extras.map(permissionCode => ({ employeeId: rows[1].id, permissionCode, grantedById: operator.id })) });
  const rowBaseline = await prisma.employee.findMany({ where: { id: { in: rows.map(row => row.id) } } });
  vite = await createServer({ root: path.join(root, 'apps/admin-web'), configFile: path.join(root, 'apps/admin-web/vite.config.ts'),
    logLevel: 'silent', clearScreen: false, server: { host: '127.0.0.1', port: 0, strictPort: false, proxy: { '/api': { target: await app.getUrl(), changeOrigin: true } } } });
  await vite.listen(); const origin = vite.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); page = await context.newPage();
  const staffPage = await context.newPage(); const forcedPage = await context.newPage();
  for (const [surface, currentPage] of [['admin', page], ['staff', staffPage], ['forced', forcedPage]]) {
    currentPage.on('pageerror', error => pageErrors.push({ surface, error: error.name }));
    currentPage.on('response', response => {
      const url = new URL(response.url()); if (url.pathname.startsWith('/api/')) requests.push({ surface, method: response.request().method(), path: url.pathname,
        status: response.status(), requestId: response.headers()['x-request-id'] ?? null,
        query: url.pathname === '/api/v1/admin/employees' ? Object.fromEntries(url.searchParams) : undefined });
    });
  }
  const count = (pathname, surface = 'admin') => requests.filter(item => item.surface === surface && item.path === `/api/v1${pathname}`).length;
  const listCount = () => count('/admin/employees'); const listRows = () => page.locator('.ant-table-tbody tr.ant-table-row');
  const submit = () => page.locator('form button[type="submit"]');
  const login = async (currentPage, username) => {
    await currentPage.getByLabel('员工账号', { exact: true }).fill(username); await currentPage.getByLabel('密码', { exact: true }).fill(password);
    await currentPage.locator('form button[type="submit"]').click();
  };
  const credential = async currentPage => {
    const value = await currentPage.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? 'null'), employeeKey);
    if (value?.accessToken) redactions.push(value.accessToken); return value;
  };
  const listReady = () => page.getByRole('button', { name: '刷新列表', exact: true }).waitFor({ state: 'visible' }).then(() => page.waitForFunction(async () => {
    const { employeeAuth, employeeQueries } = await import('/src/services/api.ts'); const { parseEmployeeSearch } = await import('/src/employees/query.ts');
    const auth = employeeAuth.getSnapshot(); const state = employeeQueries.list.getSnapshot();
    const matches = () => {
      if (auth.status !== 'ready' || employeeAuth.getSnapshot() !== auth || employeeQueries.list.getSnapshot() !== state
        || state.status !== 'ready' || state.key !== JSON.stringify(parseEmployeeSearch(document.location.search).query)) return false;
      const body = document.querySelector('.ant-table-tbody'); if (!body) return false;
      const rendered = [...body.querySelectorAll('tr.ant-table-row')].map(row => row.getAttribute('data-row-key'));
      return rendered.length === state.data.items.length && rendered.every((id, index) => id === state.data.items[index].id);
    };
    if (!matches()) return false;
    // 认证恢复后的重挂载会在effect中重读；等两次绘制，再确认仍是同一就绪快照和对应DOM。
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return matches();
  }));
  const detailReady = () => page.getByRole('heading', { name: '员工权限', exact: true }).waitFor();
  const listUrl = (extra = {}) => `${origin}/employees?${new URLSearchParams({ page: '1', pageSize: '10', keyword: prefix, ...extra })}`;
  const queryResponse = () => page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/v1/admin/employees');
  // 虚拟列表的ARIA option是隐藏辅助节点；点击实际可见的下拉文本。
  const select = async (label, option) => { await page.getByLabel(label, { exact: true }).click(); await page.locator('.ant-select-dropdown:visible').getByText(option, { exact: true }).click(); };

  scenario = '匿名列表保护与管理员入口';
  await page.goto(`${origin}/employees`); await page.waitForURL(`${origin}/login`);
  assert.equal(listCount(), 0, '匿名跳转登录前不应请求员工列表');
  await login(page, operator.username); await page.getByRole('link', { name: '员工管理', exact: true }).click(); await listReady();
  // 查询缓存和表格就绪后，认证焦点恢复仍可能重挂载页面；创建入口单独等待实际可见。
  const createLink = page.getByRole('link', { name: '创建员工', exact: true });
  await createLink.waitFor({ state: 'visible' });
  assert.equal(listCount(), 1, '管理员首次进入列表应只完成一次员工列表请求');
  assert.equal(await createLink.count(), 1, '管理员列表应展示唯一创建员工链接');
  assert.equal(await page.getByRole('button', { name: /创建员工|启用员工|停用员工|重置密码|保存权限/ }).count(), 0,
    '列表页不应直接展示员工管理写操作按钮'); passed();

  scenario = '真实筛选分页及详情返回保留条件';
  await page.goto(listUrl()); await listReady(); assert.equal(await listRows().count(), 10);
  assert.equal(await listRows().first().locator('td').first().innerText(), rows[13].username);
  const paged = queryResponse(); await page.locator('.ant-pagination-next').click(); assert.equal((await paged).status(), 200); await listReady();
  await page.waitForFunction(() => new URL(document.location.href).searchParams.get('page') === '2'); assert.equal(await listRows().count(), 4);
  const secondPage = new URL(page.url()).search;
  await listRows().last().getByRole('link', { name: '查看详情', exact: true }).click(); await detailReady();
  await page.getByText('停用', { exact: true }).waitFor(); await page.getByText('从未登录', { exact: true }).waitFor();
  const returned = queryResponse(); await page.getByRole('link', { name: '返回员工列表', exact: true }).click(); assert.equal((await returned).status(), 200);
  await listReady(); assert.equal(new URL(page.url()).search, secondPage);
  assert.equal(await listRows().count(), 4); passed();

  scenario = '岗位状态组合筛选与页大小变更';
  await select('岗位', '商品与仓储'); await select('状态', '停用'); const filtered = queryResponse(); await submit().click(); assert.equal((await filtered).status(), 200);
  await listReady(); assert.equal(new URL(page.url()).searchParams.get('page'), '1'); assert.equal(await listRows().count(), 4);
  assert.ok((await listRows().allTextContents()).every(text => text.includes('商品与仓储') && text.includes('停用')));
  await page.locator('.ant-pagination-options').getByRole('combobox').click(); const resized = queryResponse();
  await page.locator('.ant-select-dropdown:visible').getByText(/^20\s*条\/页$/).click(); assert.equal((await resized).status(), 200); await listReady();
  assert.equal(new URL(page.url()).searchParams.get('pageSize'), '20'); assert.equal(new URL(page.url()).searchParams.get('page'), '1');
  const reset = queryResponse(); await page.getByRole('button', { name: '重置筛选', exact: true }).click(); assert.equal((await reset).status(), 200); await listReady();
  assert.equal(new URL(page.url()).searchParams.has('keyword'), false); assert.equal(new URL(page.url()).searchParams.get('pageSize'), '20'); passed();

  scenario = '文字通配符按字面搜索及空结果';
  await page.getByLabel('搜索账号或姓名', { exact: true }).fill(' 折扣%_ '); const literal = queryResponse(); await submit().click(); assert.equal((await literal).status(), 200); await listReady();
  assert.equal(await listRows().count(), 1); assert.equal(await listRows().first().locator('td').first().innerText(), rows[13].username);
  await page.getByLabel('搜索账号或姓名', { exact: true }).fill(`missing_${namespace}`); const empty = queryResponse(); await submit().click(); assert.equal((await empty).status(), 200); await listReady();
  await page.getByText('没有符合条件的员工，请调整或重置筛选。', { exact: true }).waitFor(); assert.equal(await listRows().count(), 0); passed();

  scenario = '地址栏非法参数与无效员工编号不发送查询';
  for (const query of ['page=0', 'role=UNKNOWN', 'page=1&page=2', 'pageSize=101']) {
    const before = listCount(); await page.goto(`${origin}/employees?${query}`); await page.getByRole('button', { name: '重置筛选', exact: true }).waitFor(); assert.equal(listCount(), before);
  }
  const beforeBadId = requests.filter(item => item.path.startsWith('/api/v1/admin/employees/')).length;
  await page.goto(`${origin}/employees/not-a-uuid`); await page.getByText('员工编号格式无效', { exact: true }).waitFor();
  assert.equal(requests.filter(item => item.path.startsWith('/api/v1/admin/employees/')).length, beforeBadId); passed();

  scenario = '真实不存在员工404与安全错误';
  let missing;
  do { missing = randomUUID(); } while (await prisma.employee.count({ where: { id: missing } }));
  // 详情同时读取权限目录，必须绑定本次目标响应，不能用全局最后一条HTTP记录判断404。
  const missingResponse = page.waitForResponse(response => response.request().method() === 'GET'
    && new URL(response.url()).pathname === `/api/v1/admin/employees/${missing}`);
  await page.goto(`${origin}/employees/${missing}`);
  const notFoundResponse = await missingResponse; const notFoundBody = await notFoundResponse.json();
  assert.equal(notFoundResponse.status(), 404, '不存在员工的精确详情请求应返回404');
  assert.equal(notFoundBody.code, 'EMPLOYEE_NOT_FOUND');
  const notFoundRequestId = notFoundResponse.headers()['x-request-id'];
  assert.ok(notFoundRequestId, '不存在员工响应应包含请求编号'); assert.equal(notFoundBody.requestId, notFoundRequestId);
  await page.getByRole('heading', { name: '员工不存在', exact: true }).waitFor();
  await page.getByText(`请求编号：${notFoundRequestId}`, { exact: true }).waitFor();
  assert.ok(await credential(page)); passed();

  scenario = '员工详情公开资料与只读权限三栏';
  await page.goto(`${origin}/employees/${rows[1].id}?page=2&pageSize=10&keyword=${prefix}`); await detailReady();
  await page.getByText(rows[1].username, { exact: true }).waitFor(); assert.equal(await page.locator('.employee-permission-column').count(), 3);
  const extraColumn = page.locator('.employee-permission-column').nth(1); assert.equal(await extraColumn.locator('li').count(), extras.length);
  // 权限条目同时展示中文说明和编码；精确核对code节点，避免把展示文字误当权限码。
  assert.deepEqual((await extraColumn.locator('li code').allTextContents()).sort(), extras.slice().sort());
  assert.equal(await page.getByRole('dialog').count(), 0); assert.equal(await page.locator('input,form').count(), 0);
  assert.ok(!(await page.locator('body').innerText()).includes(hash));
  await page.screenshot({ path: path.join(artifacts, 'employee-detail.png'), fullPage: true }); passed();

  scenario = '列表与详情桌面手机布局';
  await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(artifacts, 'employee-detail-mobile.png'), fullPage: true });
  await page.goto(listUrl()); await listReady(); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await page.locator('.ant-table-content').evaluate(element => element.scrollWidth > element.clientWidth), '宽表格应在容器内滚动');
  await page.screenshot({ path: path.join(artifacts, 'employee-list-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: path.join(artifacts, 'employee-list.png'), fullPage: true }); passed();

  scenario = '列表500网络失败与详情500可手动重试';
  for (const status of [500, null]) {
    await page.route('**/api/v1/admin/employees?**', route => status ? route.fulfill({ status, contentType: 'application/json', headers: { 'x-request-id': requestId },
      body: JSON.stringify({ code: 'INTERNAL_ERROR', message: '员工查询验收失败', requestId }) }) : route.abort('failed'));
    await page.getByRole('button', { name: '刷新列表', exact: true }).click();
    await page.getByText(status ? '员工查询验收失败' : '网络连接失败，请稍后重试', { exact: true }).waitFor(); assert.equal(await listRows().count(), 0); assert.ok(await credential(page));
    await page.unroute('**/api/v1/admin/employees?**'); await page.getByRole('button', { name: '重新读取', exact: true }).click(); await listReady();
  }
  await page.route(`**/api/v1/admin/employees/${rows[1].id}`, route => route.fulfill({ status: 500, contentType: 'application/json',
    headers: { 'x-request-id': requestId }, body: JSON.stringify({ code: 'INTERNAL_ERROR', message: '员工查询验收失败', requestId }) }));
  await page.goto(`${origin}/employees/${rows[1].id}`); await page.getByText('员工查询验收失败', { exact: true }).waitFor();
  assert.equal(await page.locator('.employee-permission-column').count(), 0); await page.unroute(`**/api/v1/admin/employees/${rows[1].id}`);
  await page.getByRole('button', { name: '重新读取', exact: true }).click(); await detailReady(); passed();

  scenario = '新筛选取消旧请求且旧结果不覆盖';
  await page.goto(listUrl()); await listReady(); const ready = deferred(); const release = deferred(); let intercepted = false;
  await page.route('**/api/v1/admin/employees?**', async route => {
    if (intercepted) return route.continue(); intercepted = true; const response = await route.fetch(); ready.resolve(); await release.promise;
    // 旧XHR已被AbortController取消时，浏览器会拒绝履行旧拦截，不影响新请求。
    await route.fulfill({ response }).catch(() => {});
  });
  await page.getByRole('button', { name: '刷新列表', exact: true }).click(); await within(ready.promise, '旧列表响应屏障');
  await page.getByLabel('搜索账号或姓名', { exact: true }).fill('折扣%_'); const latest = queryResponse(); await submit().click(); assert.equal((await latest).status(), 200); await listReady();
  release.resolve(); assert.equal(await listRows().count(), 1); assert.equal(await listRows().first().locator('td').first().innerText(), rows[13].username);
  await page.unroute('**/api/v1/admin/employees?**'); passed();

  scenario = '403权限刷新不循环且显式重试受控';
  const operatorCredential = await credential(page); let deniedCalls = 0;
  await page.route('**/api/v1/admin/employees?**', route => { deniedCalls++; return route.fulfill({ status: 403, contentType: 'application/json', headers: { 'x-request-id': requestId },
    body: JSON.stringify({ code: 'FORBIDDEN', message: '员工查询验收无权', requestId }) }); });
  const meBefore = count('/admin/me'); const permissionsBefore = count('/admin/me/permissions');
  await page.getByRole('button', { name: '刷新列表', exact: true }).click(); await page.getByText('员工查询验收无权', { exact: true }).waitFor();
  await page.waitForFunction(async () => { const { employeeAuth, employeeQueries } = await import('/src/services/api.ts'); return employeeAuth.getSnapshot().status === 'ready' && employeeQueries.list.getSnapshot().error?.status === 403; });
  assert.equal(deniedCalls, 1); assert.equal(count('/admin/me') - meBefore, 1); assert.equal(count('/admin/me/permissions') - permissionsBefore, 1);
  assert.ok((await credential(page)).accessToken === operatorCredential.accessToken, '403保留合法管理员会话');
  await page.getByRole('button', { name: '重新读取', exact: true }).click(); await page.getByText('员工查询验收无权', { exact: true }).waitFor(); assert.equal(deniedCalls, 2);
  await page.unroute('**/api/v1/admin/employees?**'); await page.getByRole('button', { name: '重新读取', exact: true }).click(); await listReady(); passed();

  scenario = '普通员工页面拒绝与真实API403';
  await staffPage.goto(`${origin}/login`); await login(staffPage, rows[1].username);
  await staffPage.getByRole('heading', { name: `欢迎，${rows[1].displayName}。`, exact: true }).waitFor(); const staffCredential = await credential(staffPage);
  assert.equal(await staffPage.getByRole('link', { name: '员工管理', exact: true }).count(), 0);
  for (const pathname of ['/employees', `/employees/${rows[0].id}`]) {
    const before = requests.filter(item => item.surface === 'staff' && item.path.startsWith('/api/v1/admin/employees')).length;
    await staffPage.goto(`${origin}${pathname}`); await staffPage.getByRole('heading', { name: '没有查看员工的权限', exact: true }).waitFor();
    assert.equal(requests.filter(item => item.surface === 'staff' && item.path.startsWith('/api/v1/admin/employees')).length, before);
    assert.equal((await fetch(`${origin}/api/v1/admin${pathname}`, { headers: { Authorization: `Bearer ${staffCredential.accessToken}` } })).status, 403);
  }
  assert.ok((await credential(staffPage)).accessToken === staffCredential.accessToken); passed();

  scenario = '强制改密不能进入员工查询';
  await forcedPage.goto(`${origin}/employees`); await login(forcedPage, rows[2].username);
  await forcedPage.getByRole('heading', { name: '首次登录，请修改密码', exact: true }).waitFor();
  assert.equal(count('/admin/employees', 'forced'), 0); assert.equal(count('/admin/me/permissions', 'forced'), 0);
  const forcedCredential = await credential(forcedPage);
  const forcedResponse = await fetch(`${origin}/api/v1/admin/employees`, { headers: { Authorization: `Bearer ${forcedCredential.accessToken}` } });
  assert.equal(forcedResponse.status, 403); assert.equal((await forcedResponse.json()).code, 'PASSWORD_CHANGE_REQUIRED'); passed();

  scenario = '真实撤销查看资格后原token403并更新菜单';
  await prisma.employee.update({ where: { id: operator.id }, data: { role: 'CUSTOMER_SERVICE', version: { increment: 1 }, permissionVersion: { increment: 1 } } });
  const deniedResponse = queryResponse(); await page.getByRole('button', { name: '刷新列表', exact: true }).click(); assert.equal((await deniedResponse).status(), 403);
  await page.getByRole('heading', { name: '没有查看员工的权限', exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: '员工管理', exact: true }).count(), 0); assert.ok((await credential(page)).accessToken === operatorCredential.accessToken);
  await prisma.employee.update({ where: { id: operator.id }, data: { role: 'SUPER_ADMIN', version: { increment: 1 }, permissionVersion: { increment: 1 } } });
  await page.evaluate(async () => { const { employeeAuth } = await import('/src/services/api.ts'); await employeeAuth.restore(true); });
  await page.getByRole('button', { name: '重新读取', exact: true }).click(); await listReady(); passed();

  scenario = '真实401清当前员工查询与身份且另一登录保持';
  // 先由页面发出刷新，再在转发API前撤销会话，避免撤销期间已有重挂载查询先清登录。
  const revokedReady = deferred(); const revokedRelease = deferred();
  await page.route('**/api/v1/admin/employees?**', async route => { revokedReady.resolve(route.request()); await revokedRelease.promise; await route.continue(); });
  await page.getByRole('button', { name: '刷新列表', exact: true }).click();
  const revokedRequest = await within(revokedReady.promise, '会话撤销请求屏障');
  const revoked = await prisma.authSession.updateMany({ where: { employeeId: operator.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'LOGOUT' } });
  assert.ok(revoked.count > 0); assert.equal(await prisma.authSession.count({ where: { employeeId: operator.id, revokedAt: null } }), 0);
  revokedRelease.resolve(); assert.equal((await revokedRequest.response()).status(), 401); await page.waitForURL(`${origin}/login`);
  await page.unroute('**/api/v1/admin/employees?**');
  assert.equal(await credential(page), null); assert.equal(await page.locator('.ant-table-tbody').count(), 0);
  assert.ok(await page.evaluate(async () => { const { employeeQueries } = await import('/src/services/api.ts'); return employeeQueries.list.getSnapshot().data === null && employeeQueries.detail.getSnapshot().data === null; }));
  assert.ok(await credential(staffPage));
  const staffValue = await credential(staffPage); assert.equal((await fetch(`${origin}/api/v1/admin/me`, { headers: { Authorization: `Bearer ${staffValue.accessToken}` } })).status, 200); passed();

  scenario = '查询未写员工字段额外授权或审计且最小存储保持';
  const after = await prisma.employee.findMany({ where: { id: { in: rows.map(row => row.id) } } });
  for (const before of rowBaseline) {
    const actual = after.find(row => row.id === before.id);
    for (const field of ['username', 'displayName', 'passwordHash', 'role', 'status', 'mustChangePassword', 'tokenVersion', 'version', 'permissionVersion']) assert.ok(actual[field] === before[field], `只读页面不修改${field}`);
  }
  assert.deepEqual((await prisma.employeeExtraPermission.findMany({ where: { employeeId: rows[1].id }, orderBy: { permissionCode: 'asc' } })).map(item => item.permissionCode), extras.slice().sort());
  assert.equal(await prisma.auditLog.count({ where: { OR: [{ actorEmployeeId: { in: employeeIds } }, { targetId: { in: employeeIds } }] } }), 0);
  assert.deepEqual(Object.keys(await credential(staffPage)).sort(), ['accessToken', 'domain', 'expiresAt']); assert.deepEqual(pageErrors, []); passed();
  report = { date: new Date().toISOString(), node: process.version, browser: await browser.version(), database: safe.testName,
    backend: '真实Nest与PostgreSQL；500/网络失败及一次403为浏览器注入，资格变化/会话撤销为自有数据库夹具', checks, requests, pageErrors,
    scope: '仅员工列表/详情读取页面；无员工创建、启停、重置、调岗或授权页面操作，权限三栏仅查看' };
} catch (error) {
  // 只采集状态、权限码及既有安全请求摘要，不记录凭证、账号资料或请求正文。
  const state = page && !page.isClosed() ? await page.evaluate(async () => {
    const { employeeAuth, employeeQueries } = await import('/src/services/api.ts');
    const auth = employeeAuth.getSnapshot(); const list = employeeQueries.list.getSnapshot();
    return { path: document.location.pathname, visibility: document.visibilityState, authStatus: auth.status,
      role: auth.employee?.role, effectivePermissions: auth.permissions?.effectivePermissions,
      listStatus: list.status, listKey: list.key, listItems: list.data?.items.length,
      renderedRows: document.querySelectorAll('.ant-table-tbody tr.ant-table-row').length,
      createLinks: document.querySelectorAll('a.employee-create-link').length };
  }).catch(() => ({ unreadable: true })) : null;
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'failure-state.png'), fullPage: true }).catch(() => {});
  let diagnostic = String(error.message); for (const value of redactions) if (value) diagnostic = diagnostic.replaceAll(value, '[已隐藏]');
  diagnostic = diagnostic.replace(/postgres(?:ql)?:\/\/\S+/gi, '[数据库连接已隐藏]').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [已隐藏]');
  const sourceLine = error.stack?.split('\n').find(line => /verify-employees-browser\.mjs:\d+/.test(line))?.trim();
  let failure = JSON.stringify({ status: 'failed', scenario, error: error.name, message: diagnostic, sourceLine, checks, state, requests, pageErrors });
  for (const value of redactions) if (value) failure = failure.replaceAll(value, '[已隐藏]');
  failure = failure.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[数据库连接已隐藏]').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [已隐藏]');
  await writeFile(path.join(artifacts, 'failure-diagnostics.json'), failure + '\n').catch(() => {});
  console.error(failure); process.exitCode = 1;
} finally {
  for (const gate of gates) gate.resolve(); await browser?.close(); await vite?.close(); assertSafeTestDatabase(env.DATABASE_URL, safe.testUrl);
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorEmployeeId: { in: employeeIds } }, { targetId: { in: employeeIds } }] } });
  await prisma.employeeExtraPermission.deleteMany({ where: { OR: [{ employeeId: { in: employeeIds } }, { grantedById: { in: employeeIds } }] } });
  await prisma.authSession.deleteMany({ where: { employeeId: { in: employeeIds } } }); await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
  const cleanup = { employees: await prisma.employee.count({ where: { id: { in: employeeIds } } }), sessions: await prisma.authSession.count({ where: { employeeId: { in: employeeIds } } }),
    extraPermissions: await prisma.employeeExtraPermission.count({ where: { OR: [{ employeeId: { in: employeeIds } }, { grantedById: { in: employeeIds } }] } }),
    actorAudits: await prisma.auditLog.count({ where: { OR: [{ actorEmployeeId: { in: employeeIds } }, { targetId: { in: employeeIds } }] } }) };
  assert.ok(Object.values(cleanup).every(value => value === 0), '自有数据清理未完成'); await app.close();
  console.log('本轮自有员工、会话、授权及审计已清理，未清空测试库。');
  if (report) { await writeFile(path.join(artifacts, 'result.json'), JSON.stringify({ ...report, cleanup }, null, 2) + '\n');
    console.log(JSON.stringify({ status: 'passed', checks: checks.length, pageErrors: pageErrors.length, artifacts: path.relative(root, artifacts) })); }
}
