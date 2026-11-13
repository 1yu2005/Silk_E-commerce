// 作用：在独立生产四服务中验收板块4设置、公开联系、任务空态与生产边界，不向开发库造数据。
/* global document, innerWidth */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function verifySettings(context) {
  const { origin, storeOrigin, adminToken, browser, call, passed, output, secrets, compose, env, login, adminUsername, adminPassword, pageErrors } = context;
  const request = (endpoint, method = 'GET', body, actor = adminToken, expected = 200, code) => call(origin, endpoint, method, body, actor, expected, code);
  const initial = await request('/admin/settings'); assert.equal(initial.configured, false); assert.equal(initial.version, 0);
  assert.deepEqual(await call(storeOrigin, '/store/contact'), { configured: false, servicePhone: null, serviceHours: null, settingsVersion: 0 });
  const input = { expectedVersion: 0, reason: '独立Docker初始化设置', shippingFeeCents: 29, freeShippingEnabled: false, freeShippingThresholdCents: 9901,
    returnAddress: { receiver: '隔离仓库', phone: '01000000000', province: '测试省', city: '测试市', district: '测试区', detail: '仅用于独立部署验收' },
    serviceContact: { phone: '01000000000', serviceHours: '周一至周五 09:00～18:00' },
    deadlines: { paymentMinutes: 30, autoReceiptDays: 10, afterSaleWindowDays: 7, reviewWorkdays: 2, supplementDays: 7, returnShipDays: 7, inspectionWorkdays: 2, refundWorkdays: 1 } };
  for (const invalid of [{ ...input, shippingFeeCents: 0.5 }, { ...input, shippingFeeCents: 1000001 }, { ...input, freeShippingEnabled: 'false' },
    { ...input, deadlines: { ...input.deadlines, reviewWorkdays: 0 } }, { ...input, createdBy: randomUUID() }])
    await request('/admin/settings', 'PUT', invalid, adminToken, 400, 'VALIDATION_FAILED');
  const first = await request('/admin/settings', 'PUT', input); assert.equal(first.version, 1); assert.equal(first.changed, true);
  const firstVersion = await request('/admin/settings/versions/' + first.settingVersionId); assert.equal(firstVersion.shippingFeeCents, 29);
  const replay = await request('/admin/settings', 'PUT', { ...input, expectedVersion: 1, reason: '相同内容不新增版本' }); assert.equal(replay.changed, false); assert.equal(replay.version, 1);
  await request('/admin/settings', 'PUT', { ...input, shippingFeeCents: 101 }, adminToken, 409, 'VERSION_CONFLICT');
  const updated = await request('/admin/settings', 'PUT', { ...input, expectedVersion: 1, shippingFeeCents: 101, reason: '独立Docker第二版本' }); assert.equal(updated.version, 2);
  assert.deepEqual(await request('/admin/settings/versions/' + first.settingVersionId), firstVersion);
  const contact = await call(storeOrigin, '/store/contact'); assert.deepEqual(Object.keys(contact).sort(), ['configured', 'serviceHours', 'servicePhone', 'settingsVersion']);
  assert.equal(contact.settingsVersion, 2); assert.equal(contact.servicePhone, '01000000000');
  passed('板块4：生产HTTP设置初始化/严格校验/版本冲突/同内容幂等/不可变历史与公开联系白名单');

  const password = `Acceptance#${randomBytes(16).toString('hex')}`; const nextPassword = `Changed#${randomBytes(16).toString('hex')}`; secrets.push(password, nextPassword);
  const username = 'settings_' + randomUUID().slice(0, 8);
  await request('/admin/employees', 'POST', { username, displayName: '独立设置验收客服', role: 'CUSTOMER_SERVICE', initialPassword: password, reason: '生产权限验收' }, adminToken, 201);
  let staff = await login(username, password); await request('/admin/auth/change-password', 'POST', { oldPassword: password, newPassword: nextPassword }, staff.accessToken); staff = await login(username, nextPassword);
  for (const method of ['GET', 'PUT']) await request('/admin/settings', method, method === 'PUT' ? input : undefined, staff.accessToken, 403, 'FORBIDDEN');
  await request('/admin/tasks?view=reassign', 'GET', undefined, staff.accessToken, 403, 'FORBIDDEN');
  for (const view of ['mine', 'pool', 'reassign']) { const list = await request('/admin/tasks?view=' + view); assert.equal(list.total, 0); assert.deepEqual(list.items, []); }
  const summary = await request('/admin/tasks/summary');
  for (const key of ['myPending', 'eligibleOpen', 'currentOverdue', 'everOverdue', 'reassignNeeded']) assert.equal(summary[key], 0);
  const missing = randomUUID(); await request('/admin/tasks/' + missing, 'GET', undefined, adminToken, 404, 'TASK_NOT_FOUND');
  await request('/admin/tasks/' + missing + '/claim', 'POST', { expectedVersion: 0 }, adminToken, 404, 'TASK_NOT_FOUND');
  await request('/admin/tasks', 'POST', {}, adminToken, 404);
  passed('板块4：真实员工设置/待安排权限拒绝，任务三列表和摘要真实空态，缺业务不伪造成功');

  const admin = await browser.newPage({ viewport: { width: 1440, height: 1050 } }); const store = await browser.newPage({ viewport: { width: 390, height: 844 } });
  for (const page of [admin, store]) page.on('pageerror', error => pageErrors.push(error.name));
  await admin.goto(origin + '/login'); await admin.getByLabel('员工账号', { exact: true }).fill(adminUsername); await admin.getByLabel('密码', { exact: true }).fill(adminPassword);
  await admin.locator('form button[type="submit"]').click(); await admin.waitForURL(origin + '/');
  await admin.goto(origin + '/settings'); await admin.getByLabel('基础运费（元）', { exact: true }).waitFor();
  assert.equal(await admin.getByLabel('基础运费（元）', { exact: true }).inputValue(), '1.01');
  await admin.getByLabel('基础运费（元）', { exact: true }).fill('2.22'); await admin.getByLabel('修改原因', { exact: true }).fill('生产页面确认整数分保存');
  const saving = admin.waitForResponse(response => response.url().endsWith('/api/v1/admin/settings') && response.request().method() === 'PUT');
  await admin.getByRole('button', { name: '保存全店设置', exact: true }).click(); assert.equal((await saving).status(), 200);
  await admin.getByText('当前版本 3', { exact: true }).waitFor(); await admin.screenshot({ path: path.join(output, 'settings-production.png'), fullPage: true });
  await admin.getByRole('link', { name: '查看版本历史', exact: true }).click(); await admin.getByRole('link', { name: '版本 1', exact: true }).click();
  await admin.getByText('0.29 元（29 分）', { exact: true }).waitFor();
  await admin.goto(origin + '/tasks'); await admin.getByText('暂无待办，可到岗位池查看可领取的任务。', { exact: true }).waitFor();
  await admin.getByRole('link', { name: '岗位池', exact: true }).click(); await admin.getByText('暂无可领取的任务。岗位池仅展示你有资格领取的任务。', { exact: true }).waitFor();
  await admin.getByRole('link', { name: '管理员待安排', exact: true }).click(); await admin.getByText('暂无待安排任务。', { exact: true }).waitFor();
  await admin.setViewportSize({ width: 390, height: 844 }); assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await admin.screenshot({ path: path.join(output, 'tasks-production-mobile.png'), fullPage: true });
  await store.goto(storeOrigin); await store.getByRole('link', { name: '01000000000', exact: true }).waitFor();
  assert.equal(await store.getByRole('link', { name: '01000000000', exact: true }).getAttribute('href'), 'tel:01000000000');
  await store.getByText('服务时间：周一至周五 09:00～18:00', { exact: true }).waitFor();
  assert.ok(await store.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await store.screenshot({ path: path.join(output, 'contact-production-mobile.png'), fullPage: true });
  await admin.close(); await store.close();
  passed('板块4：Nginx生产页面实际保存设置/历史、三种任务空态、手机布局和可拨打联系方式');

  const swagger = await browser.newPage(); swagger.on('pageerror', error => pageErrors.push(error.name));
  await swagger.goto(origin + '/api/docs'); await swagger.locator('.swagger-ui .auth-wrapper .authorize').click();
  await swagger.locator('.dialog-ux input').fill(adminToken); await swagger.locator('.dialog-ux .auth-btn-wrapper .authorize').click(); await swagger.locator('.dialog-ux .close-modal').click();
  const statuses = [];
  for (const [summary, endpoint] of [['查询当前全店设置', '/admin/settings'], ['查询本人待办、岗位池及逾期摘要', '/admin/tasks/summary']]) {
    const operation = swagger.locator('.opblock').filter({ has: swagger.getByText(summary, { exact: true }) });
    await operation.locator('.opblock-summary').click(); await operation.locator('.try-out__btn').click();
    const response = swagger.waitForResponse(response => response.url().endsWith('/api/v1' + endpoint) && response.request().method() === 'GET');
    await operation.locator('.execute').click(); const result = await response; assert.equal(result.status(), 200); assert.equal(result.request().headers().authorization, `Bearer ${adminToken}`); statuses.push(result.status());
  }
  await swagger.close(); passed('板块4：Swagger现场Authorize后真实设置/任务摘要GET200及Bearer核验');
  const productionBoundary = compose(['exec', '-T', 'api', 'node', '-e', "const f=require('node:fs');for(const p of ['/app/test','/app/dist/acceptance','/app/scripts/task-acceptance.mjs','/app/.env'])if(f.existsSync(p))process.exit(1)"], '确认生产镜像无测试适配器或隔离入口'); assert.equal(productionBoundary.status, 0);
  const query = sql => compose(['exec', '-T', 'db', 'psql', '-U', env.POSTGRES_USER, '-d', env.POSTGRES_DB, '-Atc', sql], '板块4数据库事实核对').stdout.trim();
  assert.equal(query('SELECT count(*) FROM task'), '0'); assert.equal(query('SELECT count(*) FROM store_setting_version'), '3');
  assert.ok(Number(query("SELECT count(*) FROM scheduler_run WHERE job_name='task-overdue-scan' AND status='SUCCEEDED' AND changed_count=0")) >= 1);
  assert.equal(query('SELECT count(*) FROM scheduler_failure'), '0'); passed('板块4：生产启动真实空扫描及运行记录，镜像无测试任务适配器');
  await writeFile(path.join(output, 'settings.json'), JSON.stringify({ checkedAt: new Date().toISOString(), passed: true, settingsVersion: 3, originalVersionImmutable: true,
    integerCents: 222, productionTaskCount: 0, swaggerStatuses: statuses, productionAdaptersAbsent: true }, null, 2) + '\n');
  return { async verifyPersistence() {
    const current = await request('/admin/settings'); assert.equal(current.version, 3); assert.equal(current.currentSetting.shippingFeeCents, 222);
    assert.deepEqual(await request('/admin/settings/versions/' + first.settingVersionId), firstVersion);
    assert.equal((await call(storeOrigin, '/store/contact')).settingsVersion, 3);
    assert.equal(query("SELECT count(*) FROM audit_log WHERE action='store.setting.update'"), '3');
    passed('板块4：数据库/API重启及API重建后，设置/旧版本/审计/公开联系保持');
  } };
}
