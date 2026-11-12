/* global document, innerWidth */
/** 文件作用：使用真实后台页面验证员工改名、启停、重置、调岗、授权及并发冲突处理。 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 使用真实Nest、Vite和已校验的隔离测试库；仅创建并清理本轮随机账号。
const root = fileURLToPath(new URL('../../../', import.meta.url)); const apiRequire = createRequire(path.join(root, 'apps/api/package.json'));
const { readDatabaseEnvironment, assertSafeTestDatabase } = apiRequire('./scripts/database-env.ts');
const env = readDatabaseEnvironment(); const safe = assertSafeTestDatabase(env.DATABASE_URL, env.TEST_DATABASE_URL);
Object.assign(process.env, env, { DATABASE_URL: safe.testUrl, NODE_ENV: 'test', LOG_LEVEL: 'silent', JWT_SECRET: randomBytes(48).toString('hex'), JWT_TTL_SECONDS: '7200' });
apiRequire('reflect-metadata');
const { NestFactory } = apiRequire('@nestjs/core'); const { AppModule } = apiRequire('./dist/app.module.js');
const { configureApp } = apiRequire('./dist/common/configure-app.js'); const { PrismaService } = apiRequire('./dist/prisma/prisma.service.js');
const { PasswordService } = apiRequire('./dist/auth/password.service.js'); const { PermissionService } = apiRequire('./dist/permissions/permission.service.js');
const { createServer } = await import(pathToFileURL(path.join(root, 'apps/admin-web/node_modules/vite/dist/node/index.js')).href);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const app = await NestFactory.create(AppModule, { logger: false }); const prisma = app.get(PrismaService); const passwords = app.get(PasswordService); const permissions = app.get(PermissionService);
const artifacts = path.resolve(root, process.env.VERIFICATION_OUTPUT_DIR || 'output/playwright/step31-35'); const checks = []; const requests = []; const pageErrors = []; const gates = [];
const prefix = `m_${randomUUID().replaceAll('-', '').slice(0, 10)}_`;
const fixtures = ['admin', 'target', 'peer', 'selfrole', 'selfdisable'].map((suffix, index) => ({ id: randomUUID(), username: prefix + suffix,
  displayName: ['管理验收管理员', '管理验收客服', '同岗对照客服', '本人调岗管理员', '本人停用管理员'][index],
  role: [0, 3, 4].includes(index) ? 'SUPER_ADMIN' : 'CUSTOMER_SERVICE' }));
const [operator, target, peer, selfRole, selfDisable] = fixtures; const ids = fixtures.map(item => item.id); const usernames = fixtures.map(item => item.username);
const password = ' Manage#2026 '; const temporaryPassword = ' Temporary#2026 '; const requestId = randomUUID(); const employeeKey = 'self-ecom.employee.session';
const redactions = [env.DATABASE_URL, env.TEST_DATABASE_URL, env.JWT_SECRET, process.env.JWT_SECRET, password, temporaryPassword];
let vite; let browser; let page; let report; let scenario = '启动'; let reserved = false; const debugPages = [];
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); const gate = { promise, resolve }; gates.push(gate); return gate; };
const within = (promise, label) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`${label}未在15秒内完成`)), 15_000);
  promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); }); });
const passed = () => { checks.push(scenario); console.log(JSON.stringify({ checkpoint: scenario, status: 'passed' })); };
try {
  await mkdir(artifacts, { recursive: true }); configureApp(app); await app.listen(0, '127.0.0.1');
  assert.ok(await prisma.permissionDefinition.count());
  assert.equal(await prisma.employee.count({ where: { OR: [{ id: { in: ids } }, { username: { in: usernames } }] } }), 0); reserved = true;
  const hash = await passwords.hash(password); redactions.push(hash);
  await prisma.employee.createMany({ data: fixtures.map(item => ({ ...item, passwordHash: hash, status: 'ACTIVE', mustChangePassword: false })) });
  vite = await createServer({ root: path.join(root, 'apps/admin-web'), configFile: path.join(root, 'apps/admin-web/vite.config.ts'), logLevel: 'silent', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, proxy: { '/api': { target: await app.getUrl(), changeOrigin: true } } } });
  await vite.listen(); const origin = vite.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } }); page = await context.newPage();
  const otherPage = await context.newPage(); const selfPage = await context.newPage();
  for (const [surface, currentPage] of [['admin', page], ['ordinary', otherPage], ['self', selfPage]]) {
    debugPages.push({ surface, currentPage });
    currentPage.on('pageerror', error => pageErrors.push({ surface, error: error.name }));
    currentPage.on('response', response => { const url = new URL(response.url()); if (url.pathname.startsWith('/api/')) {
      const req = response.request(); const body = req.postDataJSON();
      requests.push({ surface, method: req.method(), path: url.pathname, status: response.status(), requestId: response.headers()['x-request-id'] ?? null,
        bodyFields: body && typeof body === 'object' ? Object.keys(body).sort() : undefined });
    } });
  }
  const login = async (currentPage, user, value = password) => {
    if (new URL(currentPage.url()).pathname !== '/login') await currentPage.goto(`${origin}/login`);
    await currentPage.getByLabel('员工账号', { exact: true }).fill(user.username);
    await currentPage.getByLabel('密码', { exact: true }).fill(value);
    const signingIn = currentPage.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/admin/auth/login' && response.request().method() === 'POST');
    await currentPage.locator('form button[type="submit"]').click(); assert.equal((await signingIn).status(), 200);
    await currentPage.waitForFunction(async () => { const { employeeAuth } = await import('/src/services/api.ts'); return ['ready', 'password-change'].includes(employeeAuth.getSnapshot().status); });
    assert.ok(await currentPage.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? 'null')?.accessToken, employeeKey));
    console.log(JSON.stringify({ loginVerified: user.role, observedResponses: requests.length }));
  };
  const credential = async currentPage => { const value = await currentPage.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? 'null'), employeeKey);
    if (value?.accessToken) redactions.push(value.accessToken); return value; };
  const call = async (token, url, method = 'GET', body) => {
    const response = await fetch(`${origin}/api/v1${url}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, ...(await response.json()) };
  };
  const rawLogin = async (user, value = password) => { const response = await fetch(`${origin}/api/v1/admin/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user.username, password: value }) });
    assert.equal(response.status, 200); const { data } = await response.json(); redactions.push(data.accessToken); return data; };
  const readTarget = () => prisma.employee.findUniqueOrThrow({ where: { id: target.id } });
  const auditCount = action => prisma.auditLog.count({ where: { targetId: target.id, ...(action ? { action } : {}) } });
  const detailReady = async (user = target, currentPage = page) => { await currentPage.waitForFunction(async id => {
    const { employeeQueries } = await import('/src/services/api.ts'); const state = employeeQueries.detail.getSnapshot();
    return state.key === id && state.status === 'ready' && document.querySelector('.employee-result-heading h2')?.textContent === state.data.displayName;
  }, user.id); };
  const openDetail = async (user = target, currentPage = page) => { await currentPage.goto(`${origin}/employees/${user.id}?page=2&pageSize=10&keyword=${prefix}`); await detailReady(user, currentPage); };
  const dialog = (currentPage = page) => currentPage.getByRole('dialog');
  const open = async (label, currentPage = page) => { await currentPage.getByRole('button', { name: label, exact: true }).click(); await dialog(currentPage).waitFor(); };
  const close = async (currentPage = page) => { await dialog(currentPage).getByRole('button', { name: /取\s*消/ }).click(); await dialog(currentPage).waitFor({ state: 'hidden' }); };
  const reason = async (currentPage = page) => dialog(currentPage).getByLabel('操作原因', { exact: true }).fill(' 本轮员工安排 ');
  const submit = (currentPage = page) => dialog(currentPage).locator('form button[type="submit"]');
  const save = async (currentPage = page, user = target) => { await reason(currentPage); await submit(currentPage).click(); await dialog(currentPage).waitFor({ state: 'hidden' }); await detailReady(user, currentPage); };
  const selectRole = async (label, currentPage = page) => { await dialog(currentPage).getByLabel('新岗位', { exact: true }).click();
    const dropdown = currentPage.locator('.ant-select-dropdown:visible'); await dropdown.getByText(label, { exact: true }).click(); await dropdown.waitFor({ state: 'hidden' }); };
  const writes = () => requests.filter(item => ['PATCH', 'PUT', 'POST'].includes(item.method) && /\/employees\//.test(item.path)).length;
  const checkbox = code => dialog().locator('.ant-checkbox-wrapper').filter({ has: page.locator('code', { hasText: new RegExp(`^${code.replaceAll('.', '\\.')}$`) }) }).getByRole('checkbox');
  const preview = () => dialog().getByRole('region', { name: '权限变更预览' });
  const screenshot = async (name, currentPage = page) => {
    // 弹窗动画和视口调整结束后再取证；fullPage不能记录独立滚动的遮罩内容。
    await currentPage.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
    const visibleDialog = await dialog(currentPage).isVisible();
    if (visibleDialog && !name.includes('preview')) await currentPage.locator('.ant-modal-wrap').evaluate(element => element.scrollTo({ top: 0, behavior: 'instant' }));
    await currentPage.screenshot({ path: path.join(artifacts, name), fullPage: !visibleDialog });
  };
  const mobile = async name => { await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => { const modal = document.querySelector('.ant-modal'); const bounds = modal?.getBoundingClientRect();
      return document.documentElement.scrollWidth <= innerWidth && (!bounds || (bounds.left >= 0 && bounds.right <= innerWidth)); });
    await screenshot(name); await page.setViewportSize({ width: 1440, height: 1100 }); };

  scenario = '管理员入口与目录中文说明，普通同岗员工页面及全部写API拒绝';
  await login(page, operator); await openDetail(); const operatorCredential = await credential(page);
  // 当前目标为客服；确认已有默认权限的中文说明真实渲染，不能只调用count却不检查结果。
  await page.waitForFunction(() => [...document.querySelectorAll('.employee-permission-column li')]
    .some(item => item.querySelector('code')?.textContent === 'customer.read' && item.textContent.includes('顾客资料及完整地址簿查询')));
  await login(otherPage, peer); await otherPage.goto(`${origin}/employees/${target.id}`);
  await otherPage.getByRole('heading', { name: '没有查看员工的权限' }).waitFor(); const peerCredential = await credential(otherPage);
  const ordinaryCases = [['PATCH', 'profile', { displayName: '不可修改' }], ['POST', 'disable', {}], ['POST', 'enable', {}],
    ['POST', 'reset-password', { temporaryPassword }], ['POST', 'change-role', { role: 'MERCH_WAREHOUSE' }], ['PUT', 'extra-permissions', { permissions: ['shipment.pack'] }]];
  for (const [method, suffix, body] of ordinaryCases) assert.equal((await call(peerCredential.accessToken, `/admin/employees/${target.id}/${suffix}`, method, { ...body, expectedVersion: 0, reason: '无权' })).status, 403);
  assert.equal((await call(peerCredential.accessToken, '/admin/permissions')).status, 403); assert.equal(await auditCount(), 0); passed();

  scenario = '改名校验取消无HTTP，真实保存白名单审计和提交中防重复';
  await page.bringToFront(); await page.evaluate(async () => { const { employeeAuth } = await import('/src/services/api.ts'); await employeeAuth.restore(true); }); await detailReady();
  await open('修改显示名'); const beforeInvalid = writes(); await submit().click(); await dialog().getByText('请填写操作原因', { exact: true }).waitFor();
  await reason(); await dialog().getByLabel('显示名', { exact: true }).fill('😀'.repeat(41)); await submit().click(); await dialog().getByText('显示名最多40个字符').waitFor();
  await dialog().getByLabel('显示名', { exact: true }).fill('   '); await submit().click(); await dialog().getByText('请填写显示名', { exact: true }).waitFor();
  await dialog().getByLabel('显示名', { exact: true }).fill(' 新显示名 '); await dialog().getByLabel('操作原因', { exact: true }).fill('😀'.repeat(501));
  await submit().click(); await dialog().getByText('操作原因最多500个字符').waitFor(); assert.equal(writes(), beforeInvalid); await close();
  await open('修改显示名'); assert.equal(await dialog().getByLabel('显示名', { exact: true }).inputValue(), target.displayName);
  await mobile('employee-profile-mobile.png');
  await dialog().getByLabel('显示名', { exact: true }).fill(' 客服甲（晚班） '); await reason();
  const ready = deferred(); const release = deferred(); const profilePath = `/api/v1/admin/employees/${target.id}/profile`;
  await page.route(`**${profilePath}`, async route => { const response = await route.fetch(); assert.equal(response.status(), 200); ready.resolve(route.request()); await release.promise; await route.fulfill({ response }); });
  await submit().click(); const held = await within(ready.promise, '改名提交屏障'); assert.ok(await submit().isDisabled()); assert.ok(await dialog().getByLabel('显示名', { exact: true }).isDisabled());
  assert.equal(await dialog().getByRole('button', { name: /取\s*消/ }).isDisabled(), true);
  assert.deepEqual(held.postDataJSON(), { displayName: '客服甲（晚班）', expectedVersion: 0, reason: '本轮员工安排' });
  const responsePromise = held.response(); release.resolve(); assert.equal((await responsePromise).status(), 200); await dialog().waitFor({ state: 'hidden' }); await detailReady();
  await page.unroute(`**${profilePath}`); const renamed = await readTarget(); assert.equal(renamed.displayName, '客服甲（晚班）'); assert.equal(renamed.version, 1);
  assert.equal(writes(), beforeInvalid + 1); assert.equal(await auditCount('employee.profile.update'), 1);
  const renameAudit = await prisma.auditLog.findFirstOrThrow({ where: { targetId: target.id, action: 'employee.profile.update' } });
  assert.equal(renameAudit.actorEmployeeId, operator.id); assert.equal(renameAudit.reason, '本轮员工安排'); assert.deepEqual(renameAudit.afterData, { displayName: renamed.displayName });
  await screenshot('employee-management.png'); passed();

  scenario = '同名无变化不增版本审计，写入后返回筛选列表显示新名';
  await open('修改显示名'); await save(); assert.equal((await readTarget()).version, 1); assert.equal(await auditCount('employee.profile.update'), 1);
  await page.getByRole('link', { name: '返回员工列表' }).click(); assert.equal(new URL(page.url()).searchParams.get('page'), '2');
  await page.goto(`${origin}/employees?keyword=${target.username}`);
  await page.waitForFunction(() => document.querySelectorAll('.ant-table-tbody tr.ant-table-row').length === 1 && document.querySelector('.ant-table-tbody')?.textContent.includes('客服甲（晚班）'));
  await openDetail(); passed();

  scenario = '真实409禁止覆盖旧版本，刷新重开才可确认';
  await open('修改显示名'); await dialog().getByLabel('显示名', { exact: true }).fill('旧表单不应覆盖');
  const external = await call(operatorCredential.accessToken, `/admin/employees/${target.id}/profile`, 'PATCH', { displayName: '另一操作已更新', expectedVersion: 1, reason: '并发验收' }); assert.equal(external.status, 200);
  await reason(); await submit().click(); await dialog().getByText('资料已被更新，请重新确认', { exact: true }).waitFor(); assert.ok(await submit().isDisabled());
  assert.equal((await readTarget()).displayName, '另一操作已更新'); await screenshot('employee-conflict.png');
  await dialog().getByRole('button', { name: '刷新资料后重新确认' }).click(); await detailReady(); await open('修改显示名');
  assert.equal(await dialog().getByLabel('显示名', { exact: true }).inputValue(), '另一操作已更新'); await close(); passed();

  scenario = '真实停用撤销旧会话，启用不恢复旧会话且强制改密标志保持';
  const targetBefore = await rawLogin(target); const beforeStatus = await readTarget();
  await open('停用员工'); await mobile('employee-disable-mobile.png'); await save();
  let current = await readTarget(); assert.equal(current.status, 'DISABLED'); assert.equal(current.tokenVersion, beforeStatus.tokenVersion + 1); assert.equal(current.mustChangePassword, false);
  assert.equal((await call(targetBefore.accessToken, '/admin/me')).status, 401); assert.equal(await prisma.authSession.count({ where: { employeeId: target.id, revokedAt: null } }), 0);
  assert.equal(await auditCount('employee.disable'), 1); await open('启用员工'); await save(); current = await readTarget(); assert.equal(current.status, 'ACTIVE');
  assert.equal((await call(targetBefore.accessToken, '/admin/me')).status, 401); assert.equal(await auditCount('employee.enable'), 1);
  const unchanged = await call(operatorCredential.accessToken, `/admin/employees/${target.id}/enable`, 'POST', { expectedVersion: current.version, reason: '同状态' });
  assert.equal(unchanged.data.changed, false); assert.equal(await auditCount('employee.enable'), 1); passed();

  scenario = '重置密码本地校验、原密码400和所有失败路径清空密码';
  await open('重置员工密码'); const beforeResetInvalid = writes();
  await dialog().getByLabel('临时密码', { exact: true }).fill('short'); await dialog().getByLabel('确认临时密码', { exact: true }).fill('different'); await reason(); await submit().click();
  await dialog().getByText('两次临时密码不一致').waitFor(); assert.equal(writes(), beforeResetInvalid);
  await dialog().getByLabel('临时密码', { exact: true }).fill(password); await dialog().getByLabel('确认临时密码', { exact: true }).fill(password);
  const unchangedReset = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/reset-password') && response.request().method() === 'POST');
  await submit().click(); const unchangedResponse = await unchangedReset; assert.equal(unchangedResponse.status(), 400); assert.equal((await unchangedResponse.json()).code, 'VALIDATION_FAILED');
  await dialog().getByText('请求参数不合法', { exact: true }).waitFor();
  assert.equal(await dialog().getByLabel('临时密码', { exact: true }).inputValue(), ''); assert.equal(await dialog().getByLabel('确认临时密码', { exact: true }).inputValue(), '');
  assert.equal(await auditCount('employee.password.reset'), 0); await close(); passed();

  scenario = '真实重置保存原始临时密码，全部旧会话失效且首次改密拦截';
  const firstSession = await rawLogin(target); const secondSession = await rawLogin(target); const beforeReset = await readTarget();
  await open('重置员工密码'); await dialog().getByLabel('临时密码', { exact: true }).fill(temporaryPassword); await dialog().getByLabel('确认临时密码', { exact: true }).fill(temporaryPassword);
  await mobile('employee-reset-mobile.png'); await save(); current = await readTarget(); redactions.push(current.passwordHash);
  assert.ok(await passwords.verify(temporaryPassword, current.passwordHash)); assert.equal(await passwords.verify(temporaryPassword.trim(), current.passwordHash), false);
  assert.equal(current.mustChangePassword, true); assert.equal(current.tokenVersion, beforeReset.tokenVersion + 1); assert.equal(current.version, beforeReset.version + 1);
  for (const old of [firstSession, secondSession]) assert.equal((await call(old.accessToken, '/admin/me')).status, 401);
  assert.equal(await prisma.authSession.count({ where: { employeeId: target.id, revokedAt: null } }), 0); assert.equal(await auditCount('employee.password.reset'), 1);
  const resetAudit = await prisma.auditLog.findFirstOrThrow({ where: { targetId: target.id, action: 'employee.password.reset' } }); assert.deepEqual(resetAudit.afterData, { passwordChanged: true, mustChangePassword: true });
  const forced = await rawLogin(target, temporaryPassword); assert.equal(forced.mustChangePassword, true);
  assert.equal((await call(forced.accessToken, '/admin/me/permissions')).status, 403);
  await open('停用员工'); await save(); await open('启用员工'); await save(); assert.equal((await readTarget()).mustChangePassword, true);
  // 夹具恢复只解除本轮员工强制改密，便于独立验证后续权限变更；不是改密页面的验收依据。
  await prisma.employee.update({ where: { id: target.id }, data: { mustChangePassword: false } });
  await page.getByRole('button', { name: '刷新详情' }).click(); await detailReady(); passed();

  scenario = '真实权限目录与前端预览按多组输入逐项对照服务端算法';
  const catalog = permissions.catalog(); const comparisons = [];
  for (const role of ['CUSTOMER_SERVICE', 'MERCH_WAREHOUSE']) {
    const samples = [[], ['shipment.pack'], ['shipment.pack', 'shipment.handover'], ['product.manage', 'after-sale.refund.retry']];
    for (const requested of samples) {
      const old = permissions.resolveExtraPermissions(role, [], ['shipment.pack', 'after-sale.refund.retry']).resolvedExtraPermissions;
      for (const previous of [[], old]) {
        const expected = permissions.resolveExtraPermissions(role, previous, requested);
        const actual = await page.evaluate(async ({ catalog, role, previous, requested }) => {
          const { previewExtraPermissions } = await import('/src/employees/management.ts'); return previewExtraPermissions(catalog, role, previous, requested);
        }, { catalog, role, previous, requested });
        assert.deepEqual(actual, expected); comparisons.push({ role, previous: previous.length, requested: requested.length });
      }
    }
  }
  assert.equal(comparisons.length, 16); passed();

  scenario = '个人授权自动补齐、真实保存与旧token即时生效，同岗另一人不变';
  const targetCredential = await rawLogin(target, temporaryPassword);
  await open('编辑额外权限'); assert.equal(await dialog().getByRole('checkbox').count(), catalog.permissions.filter(item => !item.adminOnly && !catalog.roleTemplates.CUSTOMER_SERVICE.includes(item.code)).length);
  await checkbox('shipment.pack').check(); await checkbox('shipment.handover').check();
  await preview().getByRole('heading', { name: '自动补齐的依赖' }).waitFor();
  const expectedGrant = permissions.resolveExtraPermissions('CUSTOMER_SERVICE', [], ['shipment.pack', 'shipment.handover']);
  assert.ok((await preview().textContent()).includes('shipment.claim')); assert.ok((await preview().textContent()).includes('order.fulfillment.read'));
  await screenshot('employee-permissions.png'); await preview().scrollIntoViewIfNeeded(); await screenshot('employee-permissions-preview.png');
  await mobile('employee-permissions-mobile.png'); await page.setViewportSize({ width: 390, height: 844 }); await preview().scrollIntoViewIfNeeded(); await screenshot('employee-permissions-preview-mobile.png');
  await page.setViewportSize({ width: 1440, height: 1100 }); await save();
  let storedExtras = (await prisma.employeeExtraPermission.findMany({ where: { employeeId: target.id }, orderBy: { permissionCode: 'asc' } })).map(item => item.permissionCode);
  assert.deepEqual(storedExtras, expectedGrant.resolvedExtraPermissions); assert.equal(await auditCount('employee.permission.replace'), 1);
  await page.getByText('查看服务端确认的权限结果', { exact: true }).click();
  assert.ok((await page.locator('.ant-alert-success').textContent()).includes('shipment.claim'));
  const granted = await call(targetCredential.accessToken, '/admin/me/permissions'); assert.equal(granted.status, 200); assert.deepEqual(granted.data.extraPermissions, expectedGrant.resolvedExtraPermissions);
  assert.equal((await call(peerCredential.accessToken, '/admin/me/permissions')).data.extraPermissions.length, 0); passed();

  scenario = '完整额外集合无变化不增审计，撤销旧依赖级联且清空真实有效权限';
  current = await readTarget(); const beforePermissionVersion = current.permissionVersion;
  await open('编辑额外权限'); for (const code of expectedGrant.resolvedExtraPermissions) assert.ok(await checkbox(code).isChecked()); await save();
  assert.equal((await readTarget()).permissionVersion, beforePermissionVersion); assert.equal(await auditCount('employee.permission.replace'), 1);
  await open('编辑额外权限'); await checkbox('order.fulfillment.read').uncheck();
  const removalHeading = preview().getByRole('heading', { name: '级联撤销的操作' }); await removalHeading.waitFor();
  const removalList = removalHeading.locator('xpath=following-sibling::ul[1]'); assert.ok((await removalList.textContent()).includes('shipment.pack'));
  await screenshot('employee-permission-cascade.png'); await save();
  storedExtras = await prisma.employeeExtraPermission.findMany({ where: { employeeId: target.id } }); assert.equal(storedExtras.length, 0);
  const revoked = await call(targetCredential.accessToken, '/admin/me/permissions'); assert.equal(revoked.status, 200); assert.equal(revoked.data.extraPermissions.length, 0);
  assert.ok(!revoked.data.effectivePermissions.includes('shipment.pack')); assert.equal(await auditCount('employee.permission.replace'), 2); passed();

  scenario = '真实换岗清额外权限，同岗无变化保留，旧token实时采用新岗位';
  await open('编辑额外权限'); await checkbox('shipment.pack').check(); await save();
  const beforeRole = await readTarget(); await open('员工调岗'); await save(); assert.equal((await readTarget()).version, beforeRole.version);
  assert.ok(await prisma.employeeExtraPermission.count({ where: { employeeId: target.id } })); assert.equal(await auditCount('employee.role.change'), 0);
  await open('员工调岗'); await selectRole('商品与仓储'); await dialog().getByText('调岗将清空全部个人额外权限', { exact: true }).waitFor(); await mobile('employee-role-mobile.png'); await save();
  current = await readTarget(); assert.equal(current.role, 'MERCH_WAREHOUSE'); assert.equal(current.permissionVersion, beforeRole.permissionVersion + 1);
  assert.equal(await prisma.employeeExtraPermission.count({ where: { employeeId: target.id } }), 0);
  const roleChanged = await call(targetCredential.accessToken, '/admin/me/permissions'); assert.equal(roleChanged.status, 200); assert.equal(roleChanged.data.role, 'MERCH_WAREHOUSE');
  assert.ok(roleChanged.data.effectivePermissions.includes('shipment.pack')); assert.ok(!roleChanged.data.effectivePermissions.includes('customer.read'));
  assert.equal((await call(peerCredential.accessToken, '/admin/me/permissions')).data.role, 'CUSTOMER_SERVICE'); assert.equal(await auditCount('employee.role.change'), 1);
  await open('员工调岗'); await selectRole('超级管理员'); await save(); assert.equal(await page.getByRole('button', { name: '编辑额外权限', exact: true }).count(), 0);
  const invalidAdminExtras = await call(operatorCredential.accessToken, `/admin/employees/${target.id}/extra-permissions`, 'PUT', { permissions: [], expectedVersion: (await readTarget()).version, reason: '管理员不适用' });
  assert.equal(invalidAdminExtras.status, 400); assert.equal(invalidAdminExtras.code, 'EXTRA_PERMISSION_NOT_APPLICABLE');
  await open('员工调岗'); await selectRole('客服'); await save(); passed();

  scenario = '最后管理员保护409在页面安全呈现，未改未知管理员夹具';
  // 隔离库保留已有管理员，无法安全制造最后管理员条件；仅注入该UI错误，后端规则已有独立集成证据。
  await open('停用员工'); await page.route(`**/api/v1/admin/employees/${target.id}/disable`, route => route.fulfill({ status: 409, json: { code: 'LAST_ADMIN_REQUIRED', message: '必须保留至少一名可用超级管理员', requestId } }));
  await reason(); await submit().click(); await dialog().getByText('必须保留至少一名可用超级管理员', { exact: true }).waitFor();
  assert.equal(await dialog().getByText('资料已被更新，请重新确认', { exact: true }).count(), 0); assert.equal((await readTarget()).status, 'ACTIVE');
  await close(); await page.unroute(`**/api/v1/admin/employees/${target.id}/disable`); passed();

  scenario = '目录失败仅阻止授权编辑，其他操作可用且显式重试恢复';
  await page.route('**/api/v1/admin/permissions', route => route.fulfill({ status: 500, json: { code: 'INTERNAL_ERROR', message: '服务暂时不可用', requestId } }));
  await openDetail(); await page.getByText('权限目录读取失败，暂不能编辑额外权限', { exact: true }).waitFor();
  assert.ok(await page.getByRole('button', { name: '编辑额外权限', exact: true }).isDisabled()); assert.equal(await page.getByRole('button', { name: '修改显示名', exact: true }).isEnabled(), true);
  await page.unroute('**/api/v1/admin/permissions'); await page.getByRole('button', { name: '重试权限目录' }).click(); await page.getByRole('button', { name: '编辑额外权限', exact: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '编辑额外权限' && !button.disabled)); passed();

  scenario = '重置500和网络失败清密码并锁重试，刷新核实后重开';
  for (const failure of ['500', 'network']) {
    const resetPath = `**/api/v1/admin/employees/${target.id}/reset-password`; const before = await auditCount('employee.password.reset');
    await page.route(resetPath, route => failure === '500' ? route.fulfill({ status: 500, json: { code: 'INTERNAL_ERROR', message: '服务暂时不可用', requestId } }) : route.abort('failed'));
    await open('重置员工密码'); await dialog().getByLabel('临时密码', { exact: true }).fill(temporaryPassword); await dialog().getByLabel('确认临时密码', { exact: true }).fill(temporaryPassword); await reason(); await submit().click();
    await dialog().getByText('操作结果未确认', { exact: true }).waitFor(); assert.ok(await submit().isDisabled());
    assert.equal(await dialog().getByLabel('临时密码', { exact: true }).inputValue(), ''); assert.equal(await dialog().getByLabel('确认临时密码', { exact: true }).inputValue(), '');
    assert.equal(await auditCount('employee.password.reset'), before); await page.unroute(resetPath); await dialog().getByRole('button', { name: '刷新资料后重新确认' }).click(); await detailReady();
  } passed();

  scenario = '真实保存后丢响应不重发，刷新能看到已提交结果';
  const lostBefore = await auditCount('employee.profile.update');
  await page.route(`**${profilePath}`, async route => { const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort('failed'); });
  await open('修改显示名'); await dialog().getByLabel('显示名', { exact: true }).fill('响应丢失仍已保存'); await reason(); await submit().click(); await dialog().getByText('操作结果未确认', { exact: true }).waitFor();
  assert.equal((await readTarget()).displayName, '响应丢失仍已保存'); assert.equal(await auditCount('employee.profile.update'), lostBefore + 1);
  await page.unroute(`**${profilePath}`); await dialog().getByRole('button', { name: '刷新资料后重新确认' }).click(); await detailReady(); passed();

  scenario = '旧目标迟到写成功不清新目标详情，返回时读取真实结果';
  const lateReady = deferred(); const lateRelease = deferred();
  await page.route(`**${profilePath}`, async route => { const response = await route.fetch(); assert.equal(response.status(), 200); lateReady.resolve(route.request()); await lateRelease.promise; await route.fulfill({ response }); });
  await open('修改显示名'); await dialog().getByLabel('显示名', { exact: true }).fill('离开后已保存'); await reason(); await submit().click(); const lateRequest = await within(lateReady.promise, '旧目标提交');
  await page.evaluate(async id => { const { router } = await import('/src/app/router.tsx'); await router.navigate(`/employees/${id}`); }, peer.id); await detailReady(peer);
  lateRelease.resolve(); assert.equal((await lateRequest.response()).status(), 200); await detailReady(peer);
  assert.equal(await page.getByText('修改显示名已保存。', { exact: true }).count(), 0); assert.equal((await readTarget()).displayName, '离开后已保存');
  await page.unroute(`**${profilePath}`); await openDetail(); passed();

  scenario = '旧登录迟到成功不刷新新身份或员工缓存';
  const oldReady = deferred(); const oldRelease = deferred();
  await page.route(`**${profilePath}`, async route => { const response = await route.fetch(); assert.equal(response.status(), 200); oldReady.resolve(route.request()); await oldRelease.promise; await route.fulfill({ response }); });
  await open('修改显示名'); await dialog().getByLabel('显示名', { exact: true }).fill('旧登录已保存'); await reason(); await submit().click(); const oldRequest = await within(oldReady.promise, '旧登录提交');
  await page.evaluate(async () => { const { session } = await import('/src/services/api.ts'); session.clear(); }); await page.waitForURL(`${origin}/login`);
  await login(page, operator); await page.evaluate(async id => { const { router } = await import('/src/app/router.tsx'); await router.navigate(`/employees/${id}`); }, peer.id);
  await detailReady(peer); const beforeLate = requests.length; oldRelease.resolve(); assert.equal((await oldRequest.response()).status(), 200); await detailReady(peer);
  assert.equal(requests.slice(beforeLate).filter(item => item.path === '/api/v1/admin/me').length, 0); assert.equal((await credential(page)).domain, 'EMPLOYEE');
  await page.unroute(`**${profilePath}`); await openDetail(); passed();

  scenario = '本人改名更新导航，重置本人入口引导正常改密';
  await openDetail(operator); assert.equal(await page.getByRole('button', { name: '重置员工密码', exact: true }).count(), 0);
  assert.equal(await page.getByRole('link', { name: '修改本人密码', exact: true }).getAttribute('href'), '/change-password');
  await open('修改显示名'); await dialog().getByLabel('显示名', { exact: true }).fill('本人新显示名'); await reason(); await submit().click(); await detailReady(operator);
  await page.locator('.site-header').getByText('本人新显示名', { exact: true }).waitFor();
  assert.equal((await call((await credential(page)).accessToken, `/admin/employees/${operator.id}/reset-password`, 'POST', { temporaryPassword, expectedVersion: 1, reason: '本人应走改密' })).code, 'SELF_PASSWORD_RESET_NOT_ALLOWED'); passed();

  scenario = '本人调岗立即更新导航及访问资格，原会话保留使用新权限';
  await login(selfPage, selfRole); await openDetail(selfRole, selfPage); const beforeSelfRole = await credential(selfPage);
  await open('员工调岗', selfPage); await selectRole('客服', selfPage); await reason(selfPage); await submit(selfPage).click();
  await selfPage.getByRole('heading', { name: '没有查看员工的权限' }).waitFor(); assert.equal(await selfPage.getByRole('link', { name: '员工管理', exact: true }).count(), 0);
  const selfRoleResult = await call(beforeSelfRole.accessToken, '/admin/me/permissions'); assert.equal(selfRoleResult.status, 200); assert.equal(selfRoleResult.data.role, 'CUSTOMER_SERVICE');
  assert.equal((await credential(selfPage)).accessToken, beforeSelfRole.accessToken); passed();

  scenario = '本人停用真实撤销会话并回登录，不影响另一管理员';
  await selfPage.evaluate(async () => { const { session } = await import('/src/services/api.ts'); session.clear(); }); await login(selfPage, selfDisable); await openDetail(selfDisable, selfPage);
  const beforeSelfDisable = await credential(selfPage); await open('停用员工', selfPage); await reason(selfPage); await submit(selfPage).click(); await selfPage.waitForURL(`${origin}/login`);
  assert.equal(await credential(selfPage), null); assert.equal((await call(beforeSelfDisable.accessToken, '/admin/me')).status, 401);
  assert.equal((await call((await credential(page)).accessToken, '/admin/me')).status, 200); passed();

  scenario = '管理403只恢复一次身份不重放，真实401清会话及查询缓存';
  await openDetail(); const permissionBefore = requests.filter(item => item.surface === 'admin' && item.path === '/api/v1/admin/me/permissions').length;
  await page.route(`**${profilePath}`, route => route.fulfill({ status: 403, json: { code: 'FORBIDDEN', message: '当前操作没有权限', requestId } }));
  await open('修改显示名'); await reason(); const before403 = writes(); await submit().click(); await detailReady();
  assert.equal(writes(), before403 + 1); assert.equal(requests.filter(item => item.surface === 'admin' && item.path === '/api/v1/admin/me/permissions').length, permissionBefore + 1);
  await page.unroute(`**${profilePath}`); const revokedReady = deferred(); const revokedRelease = deferred();
  await page.route(`**${profilePath}`, async route => { revokedReady.resolve(route.request()); await revokedRelease.promise; await route.continue(); });
  await open('修改显示名'); await reason(); await submit().click(); const revokedRequest = await within(revokedReady.promise, '撤销会话提交');
  const revokedCount = await prisma.authSession.updateMany({ where: { employeeId: operator.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'LOGOUT' } }); assert.ok(revokedCount.count > 0);
  revokedRelease.resolve(); assert.equal((await revokedRequest.response()).status(), 401); await page.waitForURL(`${origin}/login`); assert.equal(await credential(page), null);
  assert.ok(await page.evaluate(async () => { const { employeeQueries } = await import('/src/services/api.ts'); return Object.values(employeeQueries).every(query => query.getSnapshot().data === null); }));
  assert.equal((await call(peerCredential.accessToken, '/admin/me')).status, 200); await page.unroute(`**${profilePath}`); passed();

  scenario = '同岗对照未变，审计无密码且最小存储不含表单资料';
  const peerRow = await prisma.employee.findUniqueOrThrow({ where: { id: peer.id } }); assert.equal(peerRow.role, 'CUSTOMER_SERVICE'); assert.equal(peerRow.status, 'ACTIVE');
  assert.equal(peerRow.displayName, peer.displayName); assert.equal(peerRow.version, 0); assert.equal(peerRow.passwordHash, hash); assert.equal(peerRow.permissionVersion, 0);
  const audits = await prisma.auditLog.findMany({ where: { targetId: { in: ids } } });
  for (const secret of [password, temporaryPassword, hash]) assert.ok(!JSON.stringify(audits).includes(secret));
  assert.deepEqual(Object.keys(await credential(otherPage)).sort(), ['accessToken', 'domain', 'expiresAt']);
  const stored = await otherPage.evaluate(() => JSON.stringify({ session: { ...sessionStorage }, local: { ...localStorage } }));
  for (const secret of [password, temporaryPassword, target.username]) assert.ok(!stored.includes(secret));
  assert.deepEqual(pageErrors, []); passed();
  report = { date: new Date().toISOString(), node: process.version, browser: await browser.version(), database: safe.testName, checks, requests, pageErrors,
    scope: '步骤31～35五组管理；真实改名/版本冲突/启停/重置/调岗/授权及16组算法对照；最后管理员409、403、500及部分网络失败为注入；不修改未知管理员' };
} catch (error) {
  const diagnostics = [];
  for (const { surface, currentPage } of debugPages) {
    if (currentPage.isClosed()) continue;
    await currentPage.screenshot({ path: path.join(artifacts, `failure-${surface}.png`), fullPage: true }).catch(() => {});
    diagnostics.push({ surface, ...(await currentPage.evaluate(async () => { const { employeeAuth } = await import('/src/services/api.ts'); const auth = employeeAuth.getSnapshot();
      return { path: document.location.pathname, status: auth.status, role: auth.employee?.role, permissions: auth.permissions?.effectivePermissions, headings: [...document.querySelectorAll('h1,h2')].map(item => item.textContent) }; }).catch(() => ({ unreadable: true }))) });
  }
  await writeFile(path.join(artifacts, 'failure-diagnostics.json'), JSON.stringify({ scenario, diagnostics, requests, pageErrors }, null, 2) + '\n');
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'failure-state.png'), fullPage: true }).catch(() => {});
  let message = String(error.message); for (const value of redactions) if (value) message = message.replaceAll(value, '[已隐藏]');
  message = message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[数据库连接已隐藏]').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [已隐藏]');
  const sourceLine = error.stack?.split('\n').find(line => /verify-employee-management-browser\.mjs:\d+/.test(line))?.trim();
  console.error(JSON.stringify({ status: 'failed', scenario, error: error.name, message, sourceLine })); process.exitCode = 1;
} finally {
  for (const gate of gates) gate.resolve(); await browser?.close(); await vite?.close(); assertSafeTestDatabase(env.DATABASE_URL, safe.testUrl);
  let cleanup;
  if (reserved) {
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorEmployeeId: { in: ids } }, { targetId: { in: ids } }] } });
    await prisma.employeeExtraPermission.deleteMany({ where: { OR: [{ employeeId: { in: ids } }, { grantedById: { in: ids } }] } });
    await prisma.authSession.deleteMany({ where: { employeeId: { in: ids } } }); await prisma.employee.deleteMany({ where: { id: { in: ids } } });
    cleanup = { employees: await prisma.employee.count({ where: { id: { in: ids } } }), sessions: await prisma.authSession.count({ where: { employeeId: { in: ids } } }),
      extraPermissions: await prisma.employeeExtraPermission.count({ where: { OR: [{ employeeId: { in: ids } }, { grantedById: { in: ids } }] } }),
      actorAudits: await prisma.auditLog.count({ where: { OR: [{ actorEmployeeId: { in: ids } }, { targetId: { in: ids } }] } }) };
    assert.ok(Object.values(cleanup).every(value => value === 0)); console.log('本轮5个自建员工及关联会话、授权和审计已精确清理，未清空测试库。');
  }
  await app.close();
  if (report) { await writeFile(path.join(artifacts, 'result.json'), JSON.stringify({ ...report, cleanup }, null, 2) + '\n');
    console.log(JSON.stringify({ status: 'passed', checks: checks.length, pageErrors: pageErrors.length, artifacts: path.relative(root, artifacts) })); }
}
