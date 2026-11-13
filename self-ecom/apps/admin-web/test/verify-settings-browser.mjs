/* global document, innerWidth */
/** 文件作用：用真实Nest、Vite、浏览器和独占测试库验证设置页面及商城公开联系，不伪造成功响应。 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

const root = fileURLToPath(new URL('../../../', import.meta.url)); const api = resolve(root, 'apps/api');
const require = createRequire(resolve(api, 'package.json')); const env = { ...parseEnv(readFileSync(resolve(root, '.env'), 'utf8')), ...process.env };
const dev = new URL(env.DATABASE_URL); const test = new URL(env.TEST_DATABASE_URL);
assert.notEqual(dev.pathname, test.pathname); assert.match(test.pathname, /^\/[a-z][a-z0-9_]*_test$/);
assert.equal(dev.hostname, test.hostname); assert.equal(dev.port, test.port);
const name = `settings_ui_${randomUUID().replaceAll('-', '')}_test`; assert.match(name, /^settings_ui_[a-f0-9]{32}_test$/);
const database = new URL(test); database.pathname = '/' + name; const postgres = new URL(test); postgres.pathname = '/postgres';
const temporarySecret = randomBytes(48).toString('hex');
Object.assign(process.env, env, { DATABASE_URL: database.toString(), NODE_ENV: 'test', LOG_LEVEL: 'silent', JWT_SECRET: temporarySecret });
require('reflect-metadata'); const { Client } = require('pg'); const dbAdmin = new Client({ connectionString: postgres.toString(), connectionTimeoutMillis: 3000 });
const { Test } = require('@nestjs/testing'); const { AppModule } = require('./dist/app.module.js');
const { configureApp } = require('./dist/common/configure-app.js'); const { APP_CONFIG, loadConfiguration } = require('./dist/config/environment.js');
const { PrismaService } = require('./dist/prisma/prisma.service.js'); const { PasswordService } = require('./dist/auth/password.service.js');
const { seedPermissionCatalog } = require('./dist/permissions/permission-seed.js');
const { createServer } = await import(pathToFileURL(resolve(root, 'apps/admin-web/node_modules/vite/dist/node/index.js')).href);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const artifacts = resolve(root, process.env.VERIFICATION_OUTPUT_DIR || 'output/playwright/M0-04-step04/manual');
assert.ok(!existsSync(resolve(artifacts, 'result.json')), '不能覆盖已有浏览器结果'); mkdirSync(artifacts, { recursive: true });
const report = { checkedAt: new Date().toISOString(), isolatedDatabase: name, checks: [], requests: [], writeAttempts: [], pageErrors: [], injectedFailures: [] };
const password = randomBytes(18).toString('base64url'); const redactions = [password, temporarySecret, env.JWT_SECRET, env.DATABASE_URL, env.TEST_DATABASE_URL, database.toString()];
let app; let browser; let adminVite; let storeVite; let created = false; let scenario = '启动隔离环境'; const pages = []; const gates = [];
const passed = () => { report.checks.push(scenario); console.log(JSON.stringify({ checkpoint: scenario, status: 'passed' })); };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); const gate = { promise, resolve }; gates.push(gate); return gate; };
const within = (promise, label) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`${label}超时`)), 15_000);
  promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
});
const snapshot = async (page, filename) => {
  await page.screenshot({ path: resolve(artifacts, filename), fullPage: true, animations: 'disabled' });
};
const mobile = async (page, filename) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
  await snapshot(page, filename); await page.setViewportSize({ width: 1440, height: 1050 });
};
try {
  await dbAdmin.connect(); await dbAdmin.query(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`); created = true;
  const migration = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], { cwd: api,
    env: { ...env, DATABASE_URL: database.toString() }, windowsHide: true, encoding: 'utf8', timeout: 60_000 });
  assert.equal(migration.status, 0, '专属测试库迁移失败');
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(APP_CONFIG).useValue(loadConfiguration({
    ...env, NODE_ENV: 'test', DATABASE_URL: database.toString(), LOG_LEVEL: 'silent', JWT_SECRET: temporarySecret,
  })).compile();
  app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1');
  const prisma = app.get(PrismaService); await seedPermissionCatalog(prisma);
  const passwordHash = await new PasswordService().hash(password); redactions.push(passwordHash);
  const admin = await prisma.employee.create({ data: { username: 'settings_ui_admin', displayName: '设置验收管理员', role: 'SUPER_ADMIN', mustChangePassword: false, passwordHash } });
  const employee = await prisma.employee.create({ data: { username: 'settings_ui_service', displayName: '设置验收客服', role: 'CUSTOMER_SERVICE', mustChangePassword: false, passwordHash } });
  const customer = await prisma.customer.create({ data: { phone: '19900000001', nickname: '隔离验收顾客', passwordHash } });
  const startVite = async folder => {
    const vite = await createServer({ root: resolve(root, folder), configFile: resolve(root, folder, 'vite.config.ts'), logLevel: 'silent', clearScreen: false,
      server: { host: '127.0.0.1', port: 0, strictPort: false, proxy: { '/api': { target: await app.getUrl(), changeOrigin: true } } } });
    await vite.listen(); return vite;
  };
  adminVite = await startVite('apps/admin-web'); storeVite = await startVite('apps/store-web');
  const adminOrigin = adminVite.resolvedUrls.local[0].replace(/\/$/, ''); const storeOrigin = storeVite.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  report.browser = await browser.version();
  const makePage = async surface => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, timezoneId: 'America/Los_Angeles' });
    const page = await context.newPage(); pages.push({ surface, page });
    page.on('request', request => { if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/v1/admin/settings') report.writeAttempts.push({ surface }); });
    page.on('pageerror', error => report.pageErrors.push({ surface, error: error.name }));
    page.on('response', response => {
      const request = response.request(); const url = new URL(response.url());
      if (url.pathname.startsWith('/api/')) report.requests.push({ surface, path: url.pathname, method: request.method(), status: response.status(),
        requestId: response.headers()['x-request-id'] ?? null, bearerAttached: !!request.headers().authorization });
    });
    return page;
  };
  const page = await makePage('admin'); const peer = await makePage('ordinary'); const other = await makePage('second-admin'); const store = await makePage('store');
  const login = async (surface, user, origin = adminOrigin, customerLogin = false) => {
    await surface.goto(`${origin}/login`);
    await surface.getByLabel(customerLogin ? '手机号' : '员工账号', { exact: true }).fill(customerLogin ? user.phone : user.username);
    await surface.getByLabel('密码', { exact: true }).fill(password);
    await surface.locator('form button[type="submit"]').click(); await surface.waitForURL(origin + (customerLogin ? '/account' : '/'));
    await surface.getByRole('button', { name: '退出登录' }).waitFor();
  };
  const token = async surface => {
    const value = await surface.evaluate(() => JSON.parse(sessionStorage.getItem('self-ecom.employee.session') ?? 'null')?.accessToken);
    assert.ok(value); redactions.push(value); return value;
  };
  const request = async (url, accessToken, body) => {
    const response = await fetch(adminOrigin + '/api/v1' + url, { method: body === undefined ? 'GET' : 'PUT',
      headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const ready = async (surface, version) => {
    await surface.locator('.settings-version-bar strong').filter({ hasText: new RegExp(`^当前版本 ${version}$`) }).waitFor();
    await surface.getByRole('button', { name: '保存全店设置' }).waitFor();
  };
  const save = async (surface, reason) => {
    await surface.getByLabel('修改原因', { exact: true }).fill(reason);
    const response = surface.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/admin/settings' && response.request().method() === 'PUT');
    await surface.getByRole('button', { name: '保存全店设置' }).click(); return response;
  };
  const writes = () => report.requests.filter(item => item.surface === 'admin' && item.path === '/api/v1/admin/settings' && item.method === 'PUT').length;
  const fillInitial = async () => {
    for (const [label, value] of [['基础运费（元）', '0.29'], ['包邮门槛（元）', '99.01'], ['退货收件人', ' 隔离仓库 '], ['退货联系电话', '010-00000000'],
      ['省份', '测试省'], ['城市', '测试市'], ['区县', '测试区'], ['详细地址', '仅供隔离测试的地址'], ['公开服务电话', ' +86 010-00000000 '], ['服务时间（选填）', ' 周一至周五 09:00～18:00 '], ['售后审核（工作日）', '3']]) {
      await page.getByLabel(label, { exact: true }).fill(value);
    }
    await page.getByRole('checkbox', { name: '开启满额包邮' }).uncheck();
  };

  scenario = '商城匿名维护空态、管理员首次配置与空历史、普通员工隐藏入口及真实403';
  await store.goto(storeOrigin + '/'); await store.getByText('联系方式维护中', { exact: true }).waitFor();
  await login(page, admin); await page.getByRole('link', { name: '全店设置', exact: true }).click(); await ready(page, 0);
  assert.equal(await page.getByLabel('公开服务电话', { exact: true }).inputValue(), '');
  assert.equal(await page.getByLabel('退货收件人', { exact: true }).inputValue(), '');
  await page.getByRole('link', { name: '查看版本历史' }).click(); await page.getByText('暂无设置版本，首次保存后将在这里保留历史。', { exact: true }).waitFor();
  await page.getByRole('link', { name: '返回全店设置', exact: true }).click(); await ready(page, 0); const adminToken = await token(page);
  assert.equal(await page.getByLabel('基础运费（元）', { exact: true }).inputValue(), '10.00');
  assert.ok(await page.getByRole('checkbox', { name: '开启满额包邮' }).isChecked());
  for (const [label, value] of [['付款期限（分钟）', '30'], ['自动收货（自然日）', '10'], ['售后申请窗口（自然日）', '7'], ['售后审核（工作日）', '2'],
    ['补充材料（自然日）', '7'], ['顾客寄回（自然日）', '7'], ['退货验收（工作日）', '2'], ['退款处理（工作日）', '1']]) assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), value);
  await login(peer, employee); assert.equal(await peer.getByRole('link', { name: '全店设置', exact: true }).count(), 0);
  for (const url of ['/settings', '/settings/versions']) { await peer.goto(adminOrigin + url); await peer.getByRole('heading', { name: '没有管理全店设置的权限' }).waitFor(); }
  const ordinaryToken = await token(peer);
  for (const url of ['/admin/settings', '/admin/settings/versions']) assert.equal((await request(url, ordinaryToken)).status, 403);
  assert.equal((await request('/admin/settings', ordinaryToken, {})).status, 403);
  assert.equal(report.requests.filter(item => item.surface === 'ordinary' && /\/settings/.test(item.path)).length, 0);
  await mobile(store, 'contact-empty-mobile.png'); await snapshot(page, 'settings-unconfigured.png'); passed();

  scenario = '表单金额和期限单位、必填与小数边界验证失败不发写请求';
  await fillInitial(); const beforeInvalid = writes();
  await page.getByLabel('基础运费（元）', { exact: true }).fill('0.291');
  await page.getByLabel('售后审核（工作日）', { exact: true }).fill('2.5');
  await page.getByRole('button', { name: '保存全店设置' }).click();
  await page.getByText('请输入0～10000元，最多两位小数', { exact: true }).waitFor();
  await page.locator('#store-settings_deadlines_reviewWorkdays_help').getByText('请输入1～30的整数', { exact: true }).waitFor(); await page.getByText('请填写修改原因', { exact: true }).waitFor();
  assert.equal(writes(), beforeInvalid); await page.getByLabel('基础运费（元）', { exact: true }).fill('0.29');
  await page.getByLabel('售后审核（工作日）', { exact: true }).fill('3'); await mobile(page, 'settings-form-mobile.png'); passed();

  scenario = '真实首次保存整数分与完整配置，提交中防重复，生成版本与审计';
  const held = deferred(); const release = deferred();
  await page.route('**/api/v1/admin/settings', async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    const response = await route.fetch(); assert.equal(response.status(), 200); held.resolve(route.request()); await release.promise; await route.fulfill({ response });
  });
  await page.getByLabel('修改原因', { exact: true }).fill('首次隔离验收配置');
  await page.getByRole('button', { name: '保存全店设置' }).click(); const firstRequest = await within(held.promise, '首次保存屏障');
  assert.ok(await page.getByRole('button', { name: '保存全店设置' }).isDisabled());
  assert.ok(await page.getByLabel('基础运费（元）', { exact: true }).isDisabled());
  await page.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
  const body = firstRequest.postDataJSON(); assert.equal(body.shippingFeeCents, 29); assert.equal(body.freeShippingThresholdCents, 9901);
  assert.equal(body.freeShippingEnabled, false); assert.equal(body.expectedVersion, 0); assert.equal(body.deadlines.reviewWorkdays, 3);
  assert.ok(!Object.hasOwn(body, 'shippingFeeYuan')); release.resolve(); await ready(page, 1); await page.unroute('**/api/v1/admin/settings');
  assert.equal(writes(), beforeInvalid + 1); assert.equal(await prisma.storeSettingVersion.count(), 1); assert.equal(await prisma.auditLog.count({ where: { action: 'store.setting.update' } }), 1);
  assert.equal(await page.getByLabel('公开服务电话', { exact: true }).inputValue(), '+8601000000000');
  const versionOne = await prisma.storeSettingVersion.findFirstOrThrow();
  await snapshot(page, 'settings-saved-desktop.png'); passed();

  scenario = '商城已配置电话可拨打，匿名和登录顾客公共请求均无令牌且不泄露内部地址';
  await store.reload(); await store.getByRole('link', { name: '+8601000000000', exact: true }).waitFor();
  assert.equal(await store.getByRole('link', { name: '+8601000000000', exact: true }).getAttribute('href'), 'tel:+8601000000000');
  await login(store, customer, storeOrigin, true); await store.reload(); await store.getByText('服务时间：周一至周五 09:00～18:00', { exact: true }).waitFor();
  assert.equal(await store.getByText('仅供隔离测试的地址', { exact: true }).count(), 0);
  const publicData = await request('/store/contact', null); assert.deepEqual(Object.keys(publicData.body.data).sort(), ['configured', 'serviceHours', 'servicePhone', 'settingsVersion']);
  assert.ok(report.requests.filter(item => item.surface === 'store' && item.path === '/api/v1/store/contact').every(item => !item.bearerAttached));
  await mobile(store, 'contact-configured-mobile.png'); passed();

  scenario = '相同配置保存明确未变化，不新增历史且修改原因清空';
  assert.equal((await save(page, '仅填写新原因不改变配置')).status(), 200); await ready(page, 1);
  await page.getByText('配置内容未变化，仍为版本 1，未新增历史。', { exact: true }).waitFor();
  assert.equal(await prisma.storeSettingVersion.count(), 1); assert.equal(await page.getByLabel('修改原因', { exact: true }).inputValue(), ''); passed();

  scenario = '两份真实表单产生409，旧表单禁止重发，读取新版后重新填写才能保存';
  await login(other, admin); await other.goto(adminOrigin + '/settings'); await ready(other, 1);
  await other.getByLabel('基础运费（元）', { exact: true }).fill('1.01'); assert.equal((await save(other, '另一表单先修改')).status(), 200); await ready(other, 2);
  await page.getByLabel('基础运费（元）', { exact: true }).fill('0.88'); assert.equal((await save(page, '旧版本尝试')).status(), 409);
  await page.getByText('设置已更新，请重新确认', { exact: true }).waitFor(); assert.ok(await page.getByRole('button', { name: '保存全店设置' }).isDisabled());
  assert.equal(await prisma.storeSettingVersion.count(), 2); await snapshot(page, 'settings-conflict.png');
  await page.getByRole('button', { name: '读取最新版本并重新填写' }).click(); await ready(page, 2);
  assert.equal(await page.getByLabel('基础运费（元）', { exact: true }).inputValue(), '1.01');
  assert.equal(await page.getByLabel('修改原因', { exact: true }).inputValue(), '');
  const beforeReview = writes(); await page.getByRole('button', { name: '保存全店设置' }).click(); await page.getByText('请填写修改原因', { exact: true }).waitFor(); assert.equal(writes(), beforeReview);
  await page.getByLabel('基础运费（元）', { exact: true }).fill('1.11'); await page.getByLabel('服务时间（选填）', { exact: true }).fill('');
  assert.equal((await save(page, '核对新版后重新调整并清除服务时间')).status(), 200); await ready(page, 3);
  assert.deepEqual(await prisma.storeSettingVersion.findUniqueOrThrow({ where: { id: versionOne.id } }), versionOne);
  await store.reload(); await store.getByRole('link', { name: '+8601000000000', exact: true }).waitFor();
  assert.equal(await store.getByText(/服务时间：/).count(), 0); passed();

  scenario = '历史分页与完整旧版详情显示元分和期限单位，详情返回保留页码且不存在版本真实404';
  let current = (await request('/admin/settings', adminToken)).body.data;
  // 分页夹具全部通过真实设置接口生成，每次修改确有内容变化，仅存在于本轮独占库。
  while (current.version < 12) {
    const { currentSetting: value, version } = current;
    const input = { expectedVersion: version, reason: `隔离历史分页版本${version + 1}`, shippingFeeCents: 100 + version,
      freeShippingEnabled: value.freeShippingEnabled, freeShippingThresholdCents: value.freeShippingThresholdCents,
      returnAddress: value.returnAddress, serviceContact: value.serviceContact, deadlines: value.deadlines };
    assert.equal((await request('/admin/settings', adminToken, input)).status, 200); current = (await request('/admin/settings', adminToken)).body.data;
  }
  await page.getByRole('link', { name: '查看版本历史' }).click(); await page.getByText('共 12 个版本', { exact: true }).waitFor();
  assert.equal(await page.locator('.settings-history li').count(), 10);
  await page.goto(adminOrigin + '/settings/versions?page=2'); await page.getByRole('link', { name: '版本 1', exact: true }).waitFor();
  assert.equal(await page.locator('.settings-history li').count(), 2);
  await page.getByRole('link', { name: '版本 1', exact: true }).click(); await page.getByRole('heading', { name: '设置版本 1', exact: true }).waitFor();
  await page.getByText('0.29 元（29 分）', { exact: true }).waitFor(); await page.getByText('3 工作日', { exact: true }).waitFor();
  await page.getByText('首次隔离验收配置', { exact: false }).waitFor(); await mobile(page, 'settings-version-mobile.png');
  // 浏览器刻意使用洛杉矶时区，页面仍须显示该记录的北京时间。
  const expectedDate = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(versionOne.createdAt);
  assert.ok((await page.locator('.settings-version-meta').innerText()).includes(expectedDate));
  await page.getByRole('link', { name: '返回版本历史', exact: true }).click(); assert.equal(new URL(page.url()).searchParams.get('page'), '2');
  await page.getByRole('link', { name: '版本 1', exact: true }).waitFor();
  await page.goto(adminOrigin + '/settings/versions/' + randomUUID()); await page.getByText('设置版本不存在', { exact: true }).waitFor(); passed();

  scenario = '公开联系读取失败与重试保留顾客登录，不以维护空态掩盖请求失败';
  const requestId = randomUUID(); report.injectedFailures.push('公开联系GET401，仅验证错误交互与会话保持');
  await store.route('**/api/v1/store/contact', route => route.fulfill({ status: 401, json: { code: 'TOKEN_INVALID', message: '隔离读取失败', requestId } }));
  await store.reload(); await store.getByText('暂时无法读取联系方式', { exact: true }).waitFor();
  await store.getByRole('button', { name: '退出登录' }).waitFor(); assert.equal(await store.getByText('联系方式维护中', { exact: true }).count(), 0);
  await store.getByText(`请求编号：${requestId}`, { exact: true }).waitFor();
  await store.unroute('**/api/v1/store/contact'); await store.getByRole('button', { name: '重试联系方式' }).click();
  await store.getByRole('link', { name: '+8601000000000', exact: true }).waitFor(); passed();

  scenario = '服务器已保存但网络失败时不重发，读取真实新版本后方可继续';
  await page.goto(adminOrigin + '/settings'); await ready(page, 12);
  const beforeNetwork = report.writeAttempts.length; report.injectedFailures.push('PUT先真实提交成功再abort浏览器响应，验证不确定结果处理');
  await page.route('**/api/v1/admin/settings', async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    assert.equal((await route.fetch()).status(), 200); await route.abort('failed');
  });
  await page.getByLabel('基础运费（元）', { exact: true }).fill('2.22');
  await page.getByLabel('修改原因', { exact: true }).fill('已写入但丢失响应'); await page.getByRole('button', { name: '保存全店设置' }).click();
  await page.getByText('保存结果尚未确认', { exact: true }).waitFor(); assert.ok(await page.getByRole('button', { name: '保存全店设置' }).isDisabled());
  assert.equal(await prisma.storeSettingVersion.count(), 13); await page.unroute('**/api/v1/admin/settings');
  await page.getByRole('button', { name: '读取最新版本并重新填写' }).click(); await ready(page, 13);
  assert.equal(await page.getByLabel('基础运费（元）', { exact: true }).inputValue(), '2.22');
  // abort没有response事件，因此以真实版本、审计和请求发出数共同确认没有重试。
  assert.equal(report.writeAttempts.length, beforeNetwork + 1); assert.equal(await prisma.auditLog.count({ where: { action: 'store.setting.update' } }), 13); passed();

  scenario = '设置读取失败可重试，真实权限变化403后隐藏表单且不重放写入';
  report.injectedFailures.push('后台当前设置GET500，仅验证错误显示和手动重试');
  await page.route('**/api/v1/admin/settings', route => route.request().method() === 'GET' ? route.fulfill({ status: 500, json: { code: 'INTERNAL_ERROR', message: '隔离读取失败', requestId } }) : route.continue());
  await page.reload(); await page.getByText('隔离读取失败', { exact: true }).waitFor();
  await page.unroute('**/api/v1/admin/settings'); await page.getByRole('button', { name: '重新读取', exact: true }).click(); await ready(page, 13);
  await snapshot(page, 'settings-final-desktop.png');
  await prisma.employee.update({ where: { id: admin.id }, data: { role: 'CUSTOMER_SERVICE', permissionVersion: { increment: 1 } } });
  assert.equal((await save(page, '权限已失效的提交')).status(), 403); await page.getByRole('heading', { name: '没有管理全店设置的权限' }).waitFor();
  assert.equal(await page.getByRole('link', { name: '全店设置', exact: true }).count(), 0); assert.equal(await prisma.storeSettingVersion.count(), 13);
  await page.getByRole('button', { name: '退出登录' }).click(); await page.waitForURL(adminOrigin + '/login');
  assert.ok(await page.evaluate(async () => { const { settingsQueries } = await import('/src/services/api.ts'); return Object.values(settingsQueries).every(query => query.getSnapshot().data === null); })); passed();

  scenario = '无浏览器异常、无敏感资料持久化、公开联系均不带令牌';
  assert.deepEqual(report.pageErrors, []);
  const persisted = await store.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  assert.ok(!persisted.includes(password)); assert.ok(!persisted.includes('隔离仓库')); assert.ok(!persisted.includes('01000000000'));
  assert.ok(report.requests.filter(item => item.path === '/api/v1/store/contact').every(item => !item.bearerAttached)); passed();
  report.passed = true;
} catch (error) {
  for (const { surface, page } of pages) if (!page.isClosed()) await snapshot(page, `failure-${surface}.png`).catch(() => {});
  let message = String(error.message);
  for (const value of redactions) if (value) message = message.replaceAll(value, '[已隐藏]');
  const sourceLine = error.stack?.split('\n').find(line => /verify-settings-browser\.mjs:\d+/.test(line))?.trim();
  report.failure = { scenario, error: error.name, message, sourceLine }; console.error(JSON.stringify(report.failure)); process.exitCode = 1;
} finally {
  for (const gate of gates) gate.resolve(); await browser?.close(); await adminVite?.close(); await storeVite?.close(); await app?.close();
  try { if (created) { await dbAdmin.query(`DROP DATABASE "${name}"`); report.databaseRemoved = true; } }
  finally { await dbAdmin.end(); writeFileSync(resolve(artifacts, 'result.json'), JSON.stringify(report, null, 2) + '\n'); }
}
console.log(JSON.stringify({ passed: !!report.passed, checks: report.checks.length, pageErrors: report.pageErrors.length, databaseRemoved: report.databaseRemoved, artifacts }));
