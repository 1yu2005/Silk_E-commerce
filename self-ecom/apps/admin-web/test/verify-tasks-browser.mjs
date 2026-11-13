/* global document, innerWidth */
/** 文件作用：用真实隔离Nest/SQL、Vite和浏览器验收任务页面；按组独立建库，失败后可只复验受影响组。 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
const root = fileURLToPath(new URL('../../../', import.meta.url)); const require = createRequire(resolve(root, 'apps/api/package.json'));
const { startTaskAcceptance } = require(resolve(root, 'apps/api/dist/acceptance/test/acceptance/application.js'));
const { createServer } = await import(pathToFileURL(resolve(root, 'apps/admin-web/node_modules/vite/dist/node/index.js')).href);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const env = { ...parseEnv(readFileSync(resolve(root, '.env'), 'utf8')), ...process.env, NODE_ENV: 'test' };
const artifacts = resolve(root, process.env.VERIFICATION_OUTPUT_DIR || 'output/playwright/M0-04-step10/manual');
assert.ok(!existsSync(resolve(artifacts, 'result.json')), '不能覆盖浏览器证据'); mkdirSync(artifacts, { recursive: true });
const report = { checkedAt: new Date().toISOString(), checks: [], requests: [], writes: [], pageErrors: [], injectedFailures: [], groups: [], probes: [] };
const groups = (process.env.TASK_BROWSER_GROUPS || 'core,deadline,scope,resilience,empty').split(',');
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) }); report.browser = browser.version();
async function runGroup(name, execute, fixtures = true) {
  if (!groups.includes(name)) return;
  let app; let vite; const contexts = []; const gates = []; let scenario = '启动';
  const group = { name, passed: false }; report.groups.push(group);
  try {
    app = await startTaskAcceptance({ root, env, fixtures, port: 0 }); group.databaseName = app.databaseName;
    const apiOrigin = app.base.replace('/api/v1', '');
    vite = await createServer({ configFile: resolve(root, 'apps/admin-web/vite.config.ts'), root: resolve(root, 'apps/admin-web'), logLevel: 'silent',
      define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api/v1') }, server: { port: 0, strictPort: false, proxy: { '/api': { target: apiOrigin, changeOrigin: true } } } });
    await vite.listen(); const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    const snapshot = async (page, filename) => page.screenshot({ path: resolve(artifacts, `${name}-${filename}.png`), fullPage: true, animations: 'disabled' });
    const request = async (path, token, method = 'GET', body, status = 200) => {
      const response = await fetch(app.base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const value = await response.json(); assert.equal(response.status, status, path); assert.equal(value.requestId, response.headers.get('x-request-id'));
      report.requests.push({ source: 'direct', group: name, path, method, status, requestId: value.requestId, ...(value.code ? { code: value.code } : {}) }); return value.data;
    };
    const token = async username => (await request('/admin/auth/login', null, 'POST', { username, password: app.password })).accessToken;
    const pageFor = async username => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, timezoneId: 'America/Los_Angeles' }); contexts.push(context);
      const page = await context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', error => report.pageErrors.push({ group: name, message: error.message }));
      page.on('request', request => { const path = new URL(request.url()).pathname; if (path.startsWith('/api/v1/admin/tasks') && request.method() === 'POST') report.writes.push({ group: name, path, body: request.postDataJSON() }); });
      page.on('response', response => { const path = new URL(response.url()).pathname; if (path.startsWith('/api/v1/admin/tasks')) report.requests.push({ source: 'browser', group: name, path, method: response.request().method(), status: response.status(), requestId: response.headers()['x-request-id'] }); });
      await page.goto(origin + '/login'); await page.getByLabel('员工账号', { exact: true }).fill(username); await page.getByLabel('密码', { exact: true }).fill(app.password);
      await page.locator('form button[type="submit"]').click(); await page.waitForURL(origin + '/'); return page;
    };
    const detail = async (page, id) => { await page.goto(`${origin}/tasks/${id}?view=pool&page=1&pageSize=20`); await page.getByRole('heading', { name: '任务详情', exact: true }).waitFor(); await page.getByText('任务版本', { exact: true }).waitFor(); };
    const open = async (page, action) => { await page.getByRole('button', { name: action, exact: true }).click(); return page.getByRole('dialog'); };
    const waitSuccess = async page => { await page.getByRole('dialog').waitFor({ state: 'hidden' }); await page.getByText('任务版本', { exact: true }).waitFor(); };
    const select = async (page, label, value) => { await page.getByLabel(label, { exact: true }).click(); await page.locator('.ant-select-dropdown:visible').getByText(value, { exact: true }).click(); };
    const check = (text) => { scenario = text; };
    const passed = () => { report.checks.push({ group: name, scenario }); console.log(JSON.stringify({ group: name, scenario, passed: true })); };
    const mobile = async (page, filename) => { await page.setViewportSize({ width: 390, height: 844 }); await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1); await snapshot(page, filename); await page.setViewportSize({ width: 1440, height: 1050 }); };
    const gate = () => { let release; let signal; const held = new Promise(yes => { release = yes; }); const ready = new Promise(yes => { signal = yes; }); gates.push(release); return { release, signal, held, ready }; };
    await execute({ app, origin, pageFor, token, request, snapshot, detail, open, waitSuccess, select, check, passed, mobile, gate });
    group.passed = true;
  } catch (error) {
    group.failure = { scenario, message: String(error.message).replaceAll(app?.password ?? 'no-password', '[已隐藏]').slice(0, 1800), line: error.stack?.split('\n').find(line => /verify-tasks-browser.mjs:\d+/.test(line))?.trim() };
    if (app) group.taskStateAtFailure = await app.prisma.task.findMany({ select: { id: true, version: true, status: true, assigneeId: true } });
    console.error(JSON.stringify({ group: name, ...group.failure })); process.exitCode = 1;
    for (let i = 0; i < contexts.length; i++) for (const page of contexts[i].pages()) await page.screenshot({ path: resolve(artifacts, `${name}-failure-${i}.png`), fullPage: true }).catch(() => {});
  } finally {
    for (const release of gates) release(); for (const context of contexts) await context.close(); await vite?.close(); await app?.close(); group.databaseRemoved = !!app;
  }
}
try {
  await runGroup('core', async ({ app, origin, pageFor, token, request, snapshot, detail, open, waitSuccess, select, check, passed, mobile, gate }) => {
    const page = await pageFor('warehouse_a');
    check('本人、岗位池和后端动作范围，桌面与手机列表');
    await page.goto(origin + '/tasks'); await page.getByRole('link', { name: '验收-T4', exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: '管理员待安排', exact: true }).count(), 0);
    await page.getByRole('link', { name: '岗位池', exact: true }).click(); await page.getByRole('link', { name: '验收-T1', exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: '验收-T2', exact: true }).count(), 0); await snapshot(page, 'pool-desktop'); await mobile(page, 'pool-mobile'); passed();
    const id = app.taskIds.T1; await detail(page, id); assert.equal(await page.getByRole('button', { name: '指派或转交', exact: true }).count(), 0);
    check('领取同步禁用、防重复提交和实际经办历史');
    const probe = point => { report.probes.push({ point, at: new Date().toISOString() }); console.log(JSON.stringify({ probe: point })); };
    const hold = gate(); await page.route(`**/admin/tasks/${id}/claim`, async route => { probe('claim-intercepted'); hold.signal(); await hold.held; probe('claim-released'); await route.continue(); probe('claim-forwarded'); });
    let dialog = await open(page, '领取任务'); probe('before-click'); const submitting = dialog.getByRole('button', { name: '确认领取', exact: true }).click(); await hold.ready; probe('gate-ready');
    const pendingButtons = await page.locator('[role="dialog"] button[type="submit"]').evaluateAll(buttons => buttons.map(button => ({ text: button.textContent, disabled: button.disabled, className: button.className })));
    report.probes.push({ point: 'pending-button-state', at: new Date().toISOString(), buttons: pendingButtons });
    assert.ok(pendingButtons[0]?.disabled); probe('button-disabled');
    await dialog.locator('button[type="submit"]').evaluate(button => button.click()); assert.equal(report.writes.filter(row => row.group === 'core').length, 1);
    hold.release(); probe('gate-release-called'); await submitting; probe('click-complete'); await waitSuccess(page); await page.unroute(`**/admin/tasks/${id}/claim`);
    let task = await app.prisma.task.findUniqueOrThrow({ where: { id } }); assert.equal(task.version, 1); assert.equal(task.assigneeId, app.accounts.find(row => row.username === 'warehouse_a').id);
    assert.equal(await app.prisma.taskHistory.count({ where: { taskId: id, action: 'CLAIMED' } }), 1); passed();
    check('释放原因必填，真实释放不改轮次和原截止');
    dialog = await open(page, '释放任务'); const before = report.writes.length;
    await dialog.getByRole('button', { name: '确认释放', exact: true }).click(); await dialog.getByText('请填写操作原因', { exact: true }).waitFor(); assert.equal(report.writes.length, before);
    await dialog.getByLabel('操作原因', { exact: true }).fill('交接前重新安排'); await dialog.getByRole('button', { name: '确认释放', exact: true }).click(); await waitSuccess(page);
    task = await app.prisma.task.findUniqueOrThrow({ where: { id } }); assert.equal(task.status, 'OPEN'); assert.equal(task.round, 1); assert.equal(task.originalDueAt, null); passed();
    check('另一员工已领取时旧版本409，读取最新前不能重发');
    dialog = await open(page, '领取任务'); const other = await token('warehouse_b'); await request(`/admin/tasks/${id}/claim`, other, 'POST', { expectedVersion: task.version });
    const writesBefore = report.writes.length; await dialog.getByRole('button', { name: '确认领取', exact: true }).click(); await dialog.getByText('任务状态或操作条件已变化', { exact: true }).waitFor();
    assert.ok(await dialog.getByRole('button', { name: '确认领取', exact: true }).isDisabled()); assert.equal(report.writes.length, writesBefore + 1); await snapshot(page, 'conflict');
    await dialog.getByRole('button', { name: '读取最新任务', exact: true }).click(); await page.getByText('仓储乙', { exact: true }).waitFor(); passed();
    check('管理员候选来自真实员工查询，不合资格拒绝后可重新选择合资格员工');
    const admin = await pageFor('task_admin'); await detail(admin, id); dialog = await open(admin, '指派或转交'); await select(admin, '目标员工', '客服乙（support_b，客服）');
    await dialog.getByLabel('操作原因', { exact: true }).fill('验证目标完整资格'); await dialog.getByRole('button', { name: '确认转交', exact: true }).click();
    await dialog.getByText('目标员工当前不具备任务完整资格', { exact: true }).waitFor(); await dialog.getByRole('button', { name: '读取最新任务', exact: true }).click(); await admin.getByText('任务版本', { exact: true }).waitFor();
    dialog = await open(admin, '指派或转交'); await select(admin, '目标员工', '仓储甲（warehouse_a，商品与仓储）'); await dialog.getByLabel('操作原因', { exact: true }).fill('核实后转交仓储甲');
    await dialog.getByRole('button', { name: '确认转交', exact: true }).click(); await waitSuccess(admin); await admin.getByText('仓储甲', { exact: true }).waitFor();
    task = await app.prisma.task.findUniqueOrThrow({ where: { id } }); assert.equal(task.assigneeId, app.accounts.find(row => row.username === 'warehouse_a').id); assert.equal(task.round, 1); await mobile(admin, 'detail-mobile'); passed();
    check('领域阻塞任务不提供释放入口'); await detail(page, app.taskIds.T4); assert.equal(await page.getByRole('button', { name: '释放任务', exact: true }).count(), 0); passed();
  });
  await runGroup('deadline', async ({ app, pageFor, token, request, snapshot, detail, open, waitSuccess, check, passed, mobile }) => {
    const page = await pageFor('task_admin'); const id = app.taskIds.T2;
    check('已逾期后延期保留原始截止、曾逾期和真实事件，浏览器非北京时间也正确');
    await detail(page, id); await page.getByText('当前已逾期', { exact: true }).waitFor();
    const before = await app.prisma.task.findUniqueOrThrow({ where: { id } }); const local = new Date(Date.now() + 2 * 86400_000 + 8 * 3600_000).toISOString().slice(0, 19);
    let dialog = await open(page, '调整截止时间'); await dialog.getByLabel('新截止时间（北京时间）', { exact: true }).fill(local); await dialog.getByLabel('操作原因', { exact: true }).fill('核实开衫资料后延长期限');
    await dialog.getByRole('button', { name: '确认截止时间', exact: true }).click(); await waitSuccess(page); await page.getByText('曾逾期', { exact: true }).waitFor();
    assert.equal(await page.getByText('当前已逾期', { exact: true }).count(), 0); let task = await app.prisma.task.findUniqueOrThrow({ where: { id } });
    assert.equal(task.originalDueAt.toISOString(), before.originalDueAt.toISOString()); assert.equal(task.dueAt.toISOString(), new Date(local + '+08:00').toISOString()); assert.equal(task.round, 1);
    assert.equal(await app.prisma.deadlineEvent.count({ where: { taskId: id, eventType: 'OVERDUE' } }), 1); await snapshot(page, 'extended-desktop'); passed();
    check('处理和期限统一时间线分页，详情返回保留筛选位置');
    const admin = await token('task_admin');
    for (let i = 0; i < 5; i++) { await request(`/admin/tasks/${id}/extend-deadline`, admin, 'POST', { expectedVersion: task.version, newDueAt: new Date(+task.dueAt + 86400_000).toISOString(), reason: `隔离分页记录${i + 1}` }); task = await app.prisma.task.findUniqueOrThrow({ where: { id } }); }
    await page.getByRole('button', { name: '刷新详情', exact: true }).click(); await page.locator('.task-history > ol > li').first().waitFor(); assert.equal(await page.locator('.task-history > ol > li').count(), 10);
    await page.locator('.task-history .ant-pagination-next button').click(); await page.locator('.task-history > ol > li').first().waitFor(); assert.ok(await page.locator('.task-history > ol > li').count() < 10); await mobile(page, 'history-mobile');
    await page.getByRole('link', { name: '返回任务列表', exact: true }).click(); await page.waitForURL(/view=pool.*page=1.*pageSize=20/); passed();
    check('首次指定截止保留originalDueAt为空并写DEADLINE_ASSIGNED');
    await detail(page, app.taskIds.T1); dialog = await open(page, '调整截止时间'); await dialog.getByText('本次是首次指定人工截止，原始截止仍为空。原截止与曾逾期记录会保留。', { exact: true }).waitFor();
    await dialog.getByLabel('新截止时间（北京时间）', { exact: true }).fill(local); await dialog.getByLabel('操作原因', { exact: true }).fill('首次指定人工截止'); await dialog.getByRole('button', { name: '确认截止时间', exact: true }).click(); await waitSuccess(page);
    task = await app.prisma.task.findUniqueOrThrow({ where: { id: app.taskIds.T1 } }); assert.equal(task.originalDueAt, null);
    assert.equal(await app.prisma.deadlineEvent.count({ where: { taskId: task.id, eventType: 'DEADLINE_ASSIGNED' } }), 1); passed();
  });
  await runGroup('scope', async ({ app, origin, pageFor, token, request, snapshot, detail, select, check, passed }) => {
    const page = await pageFor('task_admin'); const admin = await token('task_admin');
    check('真实撤权回池后管理员待安排和摘要刷新');
    const support = app.accounts.find(row => row.username === 'support_a'); await request(`/admin/employees/${support.id}/extra-permissions`, admin, 'PUT', { expectedVersion: 0, permissions: [], reason: '验证回池工作台' });
    await page.goto(origin + '/tasks?view=reassign'); await page.getByRole('link', { name: '验收-T3', exact: true }).waitFor(); await snapshot(page, 'reassign-desktop');
    const task = await app.prisma.task.findUniqueOrThrow({ where: { id: app.taskIds.T3 } }); assert.equal(task.assigneeId, null); assert.equal(task.reassignNeeded, true); assert.equal(task.round, 1); passed();
    check('普通员工隐藏待安排入口，直接地址不发管理员列表请求');
    const service = await pageFor('support_a'); const before = report.requests.filter(row => row.group === 'scope' && row.path === '/api/v1/admin/tasks').length;
    await service.goto(origin + '/tasks?view=reassign'); await service.getByText('没有查看管理员待安排的权限', { exact: true }).waitFor();
    assert.equal(report.requests.filter(row => row.group === 'scope' && row.path === '/api/v1/admin/tasks').length, before);
    await detail(service, app.taskIds.T3); assert.equal(await service.getByRole('button', { name: '领取任务', exact: true }).count(), 0); passed();
    check('真实筛选分页与URL往返，false逾期不丢失，非法地址不查询');
    await page.goto(origin + '/tasks?view=pool&pageSize=1'); await page.locator('.task-table tbody tr.ant-table-row').first().waitFor(); await page.locator('.task-table .ant-pagination-next button').click(); await page.waitForURL(/page=2/);
    await page.getByRole('link', { name: '查看任务', exact: true }).click(); await page.getByText('任务版本', { exact: true }).waitFor(); await page.getByRole('link', { name: '返回任务列表', exact: true }).click(); await page.waitForURL(/page=2/);
    await select(page, '当前逾期', '当前未逾期'); await page.getByRole('button', { name: '查询任务', exact: true }).click(); await page.waitForURL(/overdue=false/);
    await page.getByRole('button', { name: '重置筛选', exact: true }).click(); await page.waitForURL(/pageSize=20/);
    await select(page, '任务状态', '本环节完成'); await page.getByRole('button', { name: '查询任务', exact: true }).click(); await page.getByText('暂无可领取的任务。岗位池仅展示你有资格领取的任务。', { exact: true }).waitFor();
    await page.goto(origin + '/tasks?view=pool&page=0'); await page.getByText('页码或每页数量不正确，请重置筛选。', { exact: true }).waitFor();
    await page.goto(origin + '/tasks/not-an-id'); await page.getByText('任务或业务编号格式不正确', { exact: true }).waitFor(); passed();
    check('不可见详情真实404，不显示旧资料或假业务链接'); await detail(service, app.taskIds.T2); await service.goto(origin + '/tasks/' + randomUUID());
    await service.getByText('任务不存在或当前不可查看', { exact: true }).waitFor(); assert.equal(await service.getByText('验收-T2', { exact: true }).count(), 0); passed();
  });
  await runGroup('resilience', async ({ app, origin, pageFor, detail, open, waitSuccess, snapshot, check, passed }) => {
    const page = await pageFor('warehouse_a'); const id = app.taskIds.T1;
    check('真实提交后丢失响应不能重复释放，重读后呈现真实OPEN'); await detail(page, id);
    let dialog = await open(page, '领取任务'); await dialog.getByRole('button', { name: '确认领取', exact: true }).click(); await waitSuccess(page);
    report.injectedFailures.push('真实提交release成功后abort响应，只验证网络结果不确定保护');
    await page.route(`**/admin/tasks/${id}/release`, async route => { assert.equal((await route.fetch()).status(), 200); await route.abort('failed'); });
    dialog = await open(page, '释放任务'); await dialog.getByLabel('操作原因', { exact: true }).fill('提交后丢失响应'); const before = report.writes.length;
    await dialog.getByRole('button', { name: '确认释放', exact: true }).click(); await dialog.getByText('操作结果尚未确认', { exact: true }).waitFor(); assert.equal(report.writes.length, before + 1);
    assert.ok(await dialog.getByRole('button', { name: '确认释放', exact: true }).isDisabled()); assert.equal((await app.prisma.task.findUniqueOrThrow({ where: { id } })).status, 'OPEN'); await snapshot(page, 'uncertain');
    await page.unroute(`**/admin/tasks/${id}/release`); await dialog.getByRole('button', { name: '读取最新任务', exact: true }).click(); await page.getByRole('button', { name: '领取任务', exact: true }).waitFor();
    assert.equal(await app.prisma.taskHistory.count({ where: { taskId: id, action: 'RELEASED' } }), 1); passed();
    check('读取500保留requestId且可手动重试，不能当作空列表'); const requestId = randomUUID();
    report.injectedFailures.push('GET任务列表500只验证读取错误与手动重试，不伪造成功');
    await page.route('**/api/v1/admin/tasks?**', route => route.fulfill({ status: 500, json: { code: 'INTERNAL_ERROR', message: '隔离任务读取失败', requestId } }));
    await page.goto(origin + '/tasks?view=pool'); await page.getByText('隔离任务读取失败', { exact: true }).waitFor(); await page.getByText('请求编号：' + requestId, { exact: true }).waitFor();
    await page.unroute('**/api/v1/admin/tasks?**'); await page.getByRole('button', { name: '重新读取任务', exact: true }).click(); await page.getByRole('link', { name: '验收-T1', exact: true }).waitFor(); passed();
    check('真实会话撤销后401清缓存并返回登录，任务和密码不持久化');
    const credential = await page.evaluate(async () => { const { session } = await import('/src/services/api.ts'); return session.current().credential.accessToken; });
    const logout = await fetch(app.base + '/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${credential}` } }); assert.equal(logout.status, 200);
    await page.getByRole('button', { name: '刷新任务', exact: true }).click(); await page.waitForURL(origin + '/login');
    assert.ok(await page.evaluate(async () => { const { taskQueries } = await import('/src/services/api.ts'); return Object.values(taskQueries).every(query => query.getSnapshot().data === null); }));
    const persisted = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } })); assert.ok(!persisted.includes(app.password)); assert.ok(!persisted.includes('验收-T1')); passed();
  });
  await runGroup('empty', async ({ origin, pageFor, snapshot, mobile, check, passed }) => {
    const page = await pageFor('task_admin'); check('未配置无任务应用显示真实0摘要及空态，桌面和手机可用');
    await page.goto(origin + '/tasks'); await page.getByText('暂无待办，可到岗位池查看可领取的任务。', { exact: true }).waitFor(); assert.equal(await page.locator('.task-summary dd').count(), 5);
    assert.deepEqual(await page.locator('.task-summary dd').allTextContents(), ['0', '0', '0', '0', '0']); await snapshot(page, 'mine-desktop'); await mobile(page, 'mine-mobile');
    await page.getByRole('link', { name: '岗位池', exact: true }).click(); await page.getByText('暂无可领取的任务。岗位池仅展示你有资格领取的任务。', { exact: true }).waitFor();
    await page.getByRole('link', { name: '管理员待安排', exact: true }).click(); await page.getByText('暂无待安排任务。', { exact: true }).waitFor(); passed();
  }, false);
  assert.deepEqual(report.pageErrors, []); report.passed = report.groups.length === groups.length && report.groups.every(group => group.passed && group.databaseRemoved);
} finally {
  await browser.close(); writeFileSync(resolve(artifacts, 'result.json'), JSON.stringify(report, null, 2) + '\n');
}
if (!report.passed) process.exitCode = 1;
console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, groups: report.groups.map(group => ({ name: group.name, passed: group.passed, databaseRemoved: group.databaseRemoved })), artifacts }));
