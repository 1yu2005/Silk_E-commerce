// 文件作用：在随机独立四服务中回归认证；--files追加板块3真实文件/Swagger/持久化验收，精确清理本轮资源。
/* global document, innerWidth */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { readdirSync, writeFileSync } from 'node:fs';

const root = fileURLToPath(new URL('../', import.meta.url));
const settingsMode = process.argv.includes('--settings');
const filesMode = process.argv.includes('--files') || settingsMode;
const outputArgument = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
const output = path.resolve(root, outputArgument ?? (filesMode ? 'output/playwright/M0-03-final/docker' : 'output/playwright/final-acceptance/docker'));
await mkdir(output, { recursive: true });
const project = `self-ecom-${settingsMode ? 'm004' : filesMode ? 'm003' : 'm002'}-acceptance-${randomUUID().slice(0, 8)}`;
const imagePrefix = process.argv.find(arg => arg.startsWith('--reuse-images-from='))?.slice(20) ?? project;
assert.match(imagePrefix, /^self-ecom-m00[234]-acceptance-[0-9a-f]{8}$/);
const docker = process.env.DOCKER_EXECUTABLE ?? 'docker';
const configured = parseEnv(await readFile(path.join(root, '.env'), 'utf8'));
const secret = randomBytes(48).toString('hex'); const dbPassword = randomBytes(24).toString('hex');
const initialPassword = `Init#${randomBytes(16).toString('hex')}`;
const adminPassword = `Admin#${randomBytes(16).toString('hex')}`;
const employeePassword = `Staff#${randomBytes(16).toString('hex')}`;
const changedEmployeePassword = `Changed#${randomBytes(16).toString('hex')}`;
const resetPassword = `Reset#${randomBytes(16).toString('hex')}`;
const customerPassword = `Customer#${randomBytes(16).toString('hex')}`;
const changedCustomerPassword = `Changed#${randomBytes(16).toString('hex')}`;
const secrets = [secret, dbPassword, initialPassword, adminPassword, employeePassword, changedEmployeePassword,
  resetPassword, customerPassword, changedCustomerPassword,
  ...Object.entries(configured).filter(([key, value]) => /SECRET|PASSWORD|DATABASE_URL/.test(key) && value.length > 4).map(([, value]) => value)];
const redact = value => secrets.reduce((text, value) => text.replaceAll(value, '[REDACTED]'), value);
const port = () => new Promise((resolve, reject) => { const server = net.createServer(); server.on('error', reject);
  server.listen(0, '127.0.0.1', () => { const number = server.address().port; server.close(error => error ? reject(error) : resolve(String(number))); }); });
const selected = new Set();
while (selected.size < 4) selected.add(await port());
const [apiPort, adminPort, storePort, dbPort] = [...selected];
const env = { ...process.env, POSTGRES_DB: 'acceptance_dev', POSTGRES_USER: 'acceptance', POSTGRES_PASSWORD: dbPassword,
  JWT_SECRET: secret, JWT_TTL_SECONDS: '7200', API_HOST_PORT: apiPort, ADMIN_HOST_PORT: adminPort, STORE_HOST_PORT: storePort,
  DB_HOST_PORT: dbPort, COMPOSE_CORS_ORIGINS: `http://localhost:${adminPort},http://localhost:${storePort}`,
  SWAGGER_ENABLED: 'true', LOG_LEVEL: 'info', INIT_ADMIN_USERNAME: 'acceptance_admin', INIT_ADMIN_PASSWORD: initialPassword,
  ...(filesMode ? { FILE_UPLOADS_PER_MINUTE: '100' } : {}) };
const override = path.join(output, 'compose.override.yaml');
await writeFile(override, `# 本次验收只使用独立镜像标签，不改变原有开发镜像。\nservices:\n  api:\n    image: ${imagePrefix}-api:local\n  admin-web:\n    image: ${imagePrefix}-admin:local\n  store-web:\n    image: ${imagePrefix}-store:local\n`);
const base = ['compose', '--project-name', project, '--env-file', path.join(root, '.env'), '-f', path.join(root, 'infra/compose.yaml'), '-f', override];
const checks = []; const requests = []; const commands = []; const pageErrors = []; let browser; let owned = false; let failure;
function run(args, label, { variables = env, allowFailure = false, input } = {}) {
  const result = spawnSync(docker, args, { cwd: root, env: variables, input, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  const text = (result.stdout ?? '') + (result.stderr ?? '');
  commands.push({ label, status: result.status });
  if (result.error || (!allowFailure && result.status !== 0)) {
    writeFileSync(path.join(output, 'command-failure.log'), redact(text));
    console.error(redact(text).slice(-9000)); throw new Error(`Docker步骤失败：${label}`);
  }
  return { ...result, text };
}
const compose = (args, label, options) => run([...base, ...args], label, options);
const passed = label => { checks.push(label); console.log(JSON.stringify({ checkpoint: label, status: 'passed' })); };
const origin = `http://localhost:${adminPort}`; const storeOrigin = `http://localhost:${storePort}`;
async function call(baseUrl, endpoint, method = 'GET', body, token, expected = 200, code) {
  const response = await fetch(`${baseUrl}/api/v1${endpoint}`, { method, signal: AbortSignal.timeout(10000),
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  requests.push({ method, path: endpoint, status: response.status, requestId: response.headers.get('x-request-id') });
  assert.equal(response.status, expected, `${method} ${endpoint}`);
  assert.match(result.requestId, /^[0-9a-f-]{36}$/); assert.equal(response.headers.get('x-request-id'), result.requestId);
  if (code) assert.equal(result.code, code, endpoint);
  if (result.data?.accessToken) secrets.push(result.data.accessToken);
  return result.data ?? result;
}
const login = (username, password, expected = 200, code) => call(origin, '/admin/auth/login', 'POST', { username, password }, undefined, expected, code);
const customerLogin = (phone, password) => call(storeOrigin, '/store/auth/login', 'POST', { phone, password });
async function ready() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${origin}/api/v1/health/ready`, { signal: AbortSignal.timeout(2000) })).status === 200) return; } catch { /* 重建后等待代理DNS更新。 */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('重建后同源代理未恢复就绪');
}
const existing = run(['ps', '-aq'], '读取原有容器').stdout.trim().split(/\s+/).filter(Boolean);
const originalVolumes = run(['volume', 'ls', '--format', '{{.Name}}'], '读取原有卷').stdout.trim().split(/\s+/).filter(Boolean);
const originalState = existing.length ? JSON.parse(run(['inspect', '--format', '{{json .State}}', ...existing], '读取原有容器状态').stdout.trim().split('\n').map(line => line.trim()).join(',' ).replace(/^/, '[').replace(/$/, ']')) : [];
try {
  const invalid = compose(['config', '--quiet'], '缺少JWT密钥必须失败', { variables: { ...env, JWT_SECRET: '' }, allowFailure: true });
  assert.notEqual(invalid.status, 0); assert.match(invalid.text, /JWT_SECRET/);
  compose(['config', '--quiet'], '校验Compose配置');
  if (imagePrefix === project) {
    console.log(JSON.stringify({ checkpoint: '构建三个应用镜像', status: 'running', project }));
    const built = compose(['build'], '构建三个应用镜像'); await writeFile(path.join(output, 'build.log'), redact(built.text));
    passed('Compose强制JWT密钥，三个应用使用独立标签构建成功');
  } else {
    for (const name of ['api', 'admin', 'store']) run(['image', 'inspect', `${imagePrefix}-${name}:local`], '确认本轮已构建镜像存在');
    passed('复用本轮首次已构建镜像；仅验收脚本/测试变更，业务源码无变更');
  }
  owned = true;
  compose(['up', '-d', '--wait', '--wait-timeout', '90', 'db'], '从空数据卷启动数据库');
  compose(['run', '--rm', '--no-deps', 'api', 'pnpm', 'db:migrate:deploy'], '空库执行全部迁移');
  const firstPermissions = compose(['run', '--rm', '--no-deps', 'api', 'pnpm', 'db:seed:permissions'], '首次权限seed');
  const secondPermissions = compose(['run', '--rm', '--no-deps', 'api', 'pnpm', 'db:seed:permissions'], '重复权限seed');
  assert.match(firstPermissions.text, /52/); assert.match(secondPermissions.text, /52/);
  const seedArgs = ['run', '--rm', '--no-deps', '-e', 'INIT_ADMIN_USERNAME', '-e', 'INIT_ADMIN_PASSWORD', 'api', 'pnpm', 'db:seed:admin'];
  assert.match(compose(seedArgs, '首次管理员seed').text, /"created":true/);
  assert.match(compose(seedArgs, '重复管理员seed').text, /"created":false/);
  compose(['up', '-d', '--wait', '--wait-timeout', '120'], '启动四服务并等待健康'); await ready();
  const health = spawnSync(process.execPath, ['infra/verify-compose.mjs'], { cwd: root, env, encoding: 'utf8', windowsHide: true });
  assert.equal(health.status, 0, redact((health.stdout ?? '') + (health.stderr ?? '')));
  await writeFile(path.join(output, 'health.log'), redact(health.stdout + health.stderr));
  passed('空库迁移、两类seed幂等、四服务健康与两站代理/缓存/Swagger/私有目录');

  let admin = await login(env.INIT_ADMIN_USERNAME, initialPassword); assert.equal(admin.mustChangePassword, false);
  await call(origin, '/admin/employees', 'GET', undefined, admin.accessToken);
  await call(origin, '/admin/auth/change-password', 'POST', { oldPassword: initialPassword, newPassword: adminPassword }, admin.accessToken);
  await call(origin, '/admin/me', 'GET', undefined, admin.accessToken, 401, 'SESSION_REVOKED');
  await login(env.INIT_ADMIN_USERNAME, initialPassword, 401, 'INVALID_CREDENTIALS');
  admin = await login(env.INIT_ADMIN_USERNAME, adminPassword); const otherAdmin = await login(env.INIT_ADMIN_USERNAME, adminPassword);
  const me = await call(origin, '/admin/me', 'GET', undefined, admin.accessToken);
  assert.equal(me.mustChangePassword, false); assert.equal(me.role, 'SUPER_ADMIN');
  assert.equal((await call(origin, '/admin/me/permissions', 'GET', undefined, admin.accessToken)).effectivePermissions.length, 52);
  assert.equal((await call(origin, '/admin/permissions', 'GET', undefined, admin.accessToken)).permissions.length, 52);
  const detail = id => call(origin, `/admin/employees/${id}`, 'GET', undefined, admin.accessToken);
  const self = await detail(me.id);
  await call(origin, `/admin/employees/${me.id}/disable`, 'POST', { expectedVersion: self.version, reason: '隔离验收最后管理员保护' }, admin.accessToken, 409, 'LAST_ADMIN_REQUIRED');
  await call(origin, `/admin/employees/${randomUUID()}`, 'GET', undefined, admin.accessToken, 404, 'EMPLOYEE_NOT_FOUND');
  passed('首管理员直接登录、主动改密及会话撤销、最终权限与最后可用管理员保护');

  const username = `staff_${randomUUID().slice(0, 8)}`; const reason = '隔离四服务功能验收';
  const employee = await call(origin, '/admin/employees', 'POST', { username, displayName: 'Docker验收员工', role: 'CUSTOMER_SERVICE', initialPassword: employeePassword, reason }, admin.accessToken, 201);
  const employeeId = employee.id; let target = await detail(employeeId);
  let staff = await login(username, employeePassword); assert.equal(staff.mustChangePassword, true);
  await call(origin, '/admin/auth/change-password', 'POST', { oldPassword: employeePassword, newPassword: changedEmployeePassword }, staff.accessToken);
  staff = await login(username, changedEmployeePassword);
  await call(origin, '/admin/employees', 'GET', undefined, staff.accessToken, 403, 'FORBIDDEN');
  target = await detail(employeeId); const stale = target.version;
  await call(origin, `/admin/employees/${employeeId}/profile`, 'PATCH', { displayName: ' 更新后的员工 ', expectedVersion: target.version, reason }, admin.accessToken);
  await call(origin, `/admin/employees/${employeeId}/profile`, 'PATCH', { displayName: '过时更新', expectedVersion: stale, reason }, admin.accessToken, 409, 'VERSION_CONFLICT');
  target = await detail(employeeId); assert.equal(target.displayName, '更新后的员工');
  await call(origin, `/admin/employees/${employeeId}/extra-permissions`, 'PUT', { permissions: ['shipment.pack'], expectedVersion: target.version, reason }, admin.accessToken);
  target = await detail(employeeId); assert.ok(target.extraPermissions.includes('shipment.pack'));
  assert.ok(target.extraPermissions.includes('order.fulfillment.read')); assert.ok(target.extraPermissions.includes('shipment.claim'));
  const authorized = await call(origin, '/admin/me/permissions', 'GET', undefined, staff.accessToken); assert.ok(authorized.effectivePermissions.includes('shipment.pack'));
  await call(origin, `/admin/employees/${employeeId}/change-role`, 'POST', { role: 'MERCH_WAREHOUSE', expectedVersion: target.version, reason }, admin.accessToken);
  target = await detail(employeeId); assert.deepEqual(target.extraPermissions, []);
  assert.equal((await call(origin, '/admin/me', 'GET', undefined, staff.accessToken)).role, 'MERCH_WAREHOUSE');
  await call(origin, `/admin/employees/${employeeId}/disable`, 'POST', { expectedVersion: target.version, reason }, admin.accessToken);
  await call(origin, '/admin/me', 'GET', undefined, staff.accessToken, 401);
  target = await detail(employeeId);
  await call(origin, `/admin/employees/${employeeId}/enable`, 'POST', { expectedVersion: target.version, reason }, admin.accessToken);
  await call(origin, '/admin/me', 'GET', undefined, staff.accessToken, 401, 'SESSION_REVOKED');
  staff = await login(username, changedEmployeePassword); target = await detail(employeeId);
  await call(origin, `/admin/employees/${employeeId}/reset-password`, 'POST', { temporaryPassword: resetPassword, expectedVersion: target.version, reason }, admin.accessToken);
  await call(origin, '/admin/me', 'GET', undefined, staff.accessToken, 401, 'SESSION_REVOKED');
  assert.equal((await login(username, resetPassword)).mustChangePassword, true);
  const list = await call(origin, `/admin/employees?keyword=${username}&page=1&pageSize=10`, 'GET', undefined, admin.accessToken);
  assert.equal(list.total, 1); assert.equal(list.items[0].id, employeeId);
  passed('员工创建、列表详情、改名、版本冲突、依赖授权、调岗、启停、重置密码');

  const phone = `139${String(BigInt(`0x${randomBytes(6).toString('hex')}`) % 100000000n).padStart(8, '0')}`;
  await call(storeOrigin, '/store/auth/register', 'POST', { phone: 'bad', password: customerPassword }, undefined, 400, 'VALIDATION_FAILED');
  await call(storeOrigin, '/store/auth/register', 'POST', { phone, password: customerPassword, nickname: ' Docker顾客 ' }, undefined, 201);
  await call(storeOrigin, '/store/auth/register', 'POST', { phone, password: customerPassword }, undefined, 409, 'PHONE_EXISTS');
  let customer = await customerLogin(phone, customerPassword); const customerSecond = await customerLogin(phone, customerPassword);
  const profile = await call(storeOrigin, '/store/me', 'GET', undefined, customer.accessToken);
  assert.equal(profile.avatarUrl, null); assert.equal(profile.nickname, 'Docker顾客');
  await call(origin, '/admin/me', 'GET', undefined, customer.accessToken, 401, 'TOKEN_SUBJECT_MISMATCH');
  await call(storeOrigin, '/store/me', 'GET', undefined, admin.accessToken, 401, 'TOKEN_SUBJECT_MISMATCH');
  assert.equal((await call(storeOrigin, '/store/me', 'PATCH', { nickname: ' 新昵称 ' }, customer.accessToken)).nickname, '新昵称');
  await call(storeOrigin, '/store/me', 'PATCH', { nickname: '越权字段', status: 'NORMAL' }, customer.accessToken, 400, 'VALIDATION_FAILED');
  await call(storeOrigin, '/store/auth/change-password', 'POST', { oldPassword: customerPassword, newPassword: changedCustomerPassword }, customer.accessToken);
  for (const token of [customer.accessToken, customerSecond.accessToken]) await call(storeOrigin, '/store/me', 'GET', undefined, token, 401, 'SESSION_REVOKED');
  customer = await customerLogin(phone, changedCustomerPassword); const survivingCustomer = await customerLogin(phone, changedCustomerPassword);
  await call(storeOrigin, '/auth/logout', 'POST', {}, customer.accessToken);
  await call(storeOrigin, '/auth/logout', 'POST', {}, customer.accessToken);
  await call(storeOrigin, '/store/me', 'GET', undefined, customer.accessToken, 401, 'SESSION_REVOKED');
  await call(storeOrigin, '/store/me', 'GET', undefined, survivingCustomer.accessToken);
  await call(origin, '/auth/logout', 'POST', {}, admin.accessToken);
  await call(origin, '/admin/me', 'GET', undefined, admin.accessToken, 401, 'SESSION_REVOKED');
  await call(origin, '/admin/me', 'GET', undefined, otherAdmin.accessToken);
  passed('顾客注册/重复/校验、双域隔离、本人资料/昵称/改密与仅撤销当前会话的幂等注销');

  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const files = filesMode ? await (await import('./verify-files-http.mjs')).verifyFiles({ origin, storeOrigin,
    token: survivingCustomer.accessToken, adminToken: otherAdmin.accessToken, browser, call, passed, requests, output,
    secrets, compose, env, login, staffUsername: username, resetPassword }) : null;
  const settings = settingsMode ? await (await import('./verify-settings-http.mjs')).verifySettings({ origin, storeOrigin,
    adminToken: otherAdmin.accessToken, browser, call, passed, output, secrets, compose, env, login,
    adminUsername: env.INIT_ADMIN_USERNAME, adminPassword, pageErrors }) : null;
  const adminPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const storePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  for (const page of [adminPage, storePage]) page.on('pageerror', error => pageErrors.push(error.name));
  await adminPage.goto(`${origin}/login`); await adminPage.getByLabel('员工账号', { exact: true }).fill(env.INIT_ADMIN_USERNAME);
  await adminPage.getByLabel('密码', { exact: true }).fill(adminPassword); await adminPage.locator('form button[type="submit"]').click();
  await adminPage.getByRole('link', { name: '员工管理', exact: true }).click(); await adminPage.getByRole('link', { name: '创建员工', exact: true }).waitFor();
  await adminPage.screenshot({ path: path.join(output, 'docker-admin.png'), fullPage: true });
  await storePage.goto(`${storeOrigin}/login`); await storePage.getByLabel('手机号', { exact: true }).fill(phone);
  await storePage.getByLabel('密码', { exact: true }).fill(changedCustomerPassword); await storePage.locator('form button[type="submit"]').click();
  await storePage.waitForURL(url => url.pathname !== '/login');
  await storePage.goto(`${storeOrigin}/account`); await storePage.locator('.account-panel').getByText('新昵称', { exact: true }).waitFor();
  assert.ok(await storePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await storePage.screenshot({ path: path.join(output, 'docker-store-mobile.png'), fullPage: true });
  await browser.close(); browser = undefined; assert.deepEqual(pageErrors, []);
  passed('Nginx生产页面真实登录、后台员工入口与顾客手机账号页，浏览器无运行错误');

  compose(['exec', '-T', 'api', 'node', '-e', "require('node:fs').writeFileSync('/app/storage/uploads/acceptance-probe.txt','acceptance-persistence')"], '写入隔离上传卷探针');
  compose(['restart', 'db', 'api'], '重启数据库和API'); compose(['up', '-d', '--wait', '--wait-timeout', '120'], '等待重启恢复'); await ready();
  await call(origin, '/admin/me', 'GET', undefined, otherAdmin.accessToken);
  await call(storeOrigin, '/store/me', 'GET', undefined, survivingCustomer.accessToken);
  compose(['up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '90', 'api'], '重建API验证卷与会话持久化'); await ready();
  const probe = compose(['exec', '-T', 'api', 'node', '-e', "process.stdout.write(require('node:fs').readFileSync('/app/storage/uploads/acceptance-probe.txt','utf8'))"], '读取上传卷探针');
  assert.equal(probe.stdout, 'acceptance-persistence');
  if (files) await files.verifyPersistence();
  if (settings) await settings.verifyPersistence();
  await call(storeOrigin, '/store/me', 'GET', undefined, survivingCustomer.accessToken);
  assert.equal((await fetch(`${storeOrigin}/uploads/acceptance-probe.txt`)).status, 404);
  passed('数据库/会话在重启后持久化，API重建保留上传卷且Nginx仍禁止直读');

  env.JWT_TTL_SECONDS = '3';
  if (files) { env.FILE_STAGED_QUOTA = '1'; env.FILE_UPLOADS_PER_MINUTE = '2'; }
  compose(['up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '90', 'api'], '以三秒JWT期限重建独立API'); await ready();
  if (files) await files.verifyLimits();
  const shortAdmin = await login(env.INIT_ADMIN_USERNAME, adminPassword); const shortCustomer = await customerLogin(phone, changedCustomerPassword);
  await call(origin, '/admin/me', 'GET', undefined, shortAdmin.accessToken);
  await call(storeOrigin, '/store/me', 'GET', undefined, shortCustomer.accessToken);
  const remaining = Math.max(Date.parse(shortAdmin.expiresAt), Date.parse(shortCustomer.expiresAt)) - Date.now() + 150;
  await new Promise(resolve => setTimeout(resolve, Math.max(0, remaining)));
  await call(origin, '/admin/me', 'GET', undefined, shortAdmin.accessToken, 401, 'TOKEN_EXPIRED');
  await call(storeOrigin, '/store/me', 'GET', undefined, shortCustomer.accessToken, 401, 'TOKEN_EXPIRED');
  passed('SW-13：三秒真实JWT在两个登录域均为本人200→自然到期401 TOKEN_EXPIRED');

  const user = compose(['exec', '-T', 'api', 'id', '-u'], '检查API非root用户').stdout.trim(); assert.equal(user, '1000');
  compose(['exec', '-T', 'api', 'node', '-e', "const f=require('node:fs');if(f.existsSync('/app/.env')||f.existsSync('/app/output'))process.exit(1)"], '镜像未包含.env或验收证据');
  const migrationCount = compose(['exec', '-T', 'db', 'psql', '-U', env.POSTGRES_USER, '-d', env.POSTGRES_DB, '-Atc', 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'], '查询成功迁移数量');
  const expectedMigrations = readdirSync(path.join(root, 'apps/api/prisma/migrations'), { withFileTypes: true }).filter(entry => entry.isDirectory()).length;
  assert.equal(migrationCount.stdout.trim(), String(expectedMigrations));
  for (const imageName of [`${imagePrefix}-api:local`, `${imagePrefix}-admin:local`, `${imagePrefix}-store:local`]) {
    const imageEnv = run(['image', 'inspect', '--format', '{{json .Config.Env}}', imageName], '检查镜像配置未固化秘密').stdout;
    assert.ok(!secrets.some(value => imageEnv.includes(value)));
  }
  for (const site of [origin, storeOrigin]) {
    const html = await (await fetch(site)).text();
    for (const asset of [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(match => match[1])) {
      const contents = await (await fetch(`${site}${asset}`)).text(); assert.ok(!secrets.some(value => contents.includes(value)), '前端产物秘密扫描');
    }
  }
  const logs = compose(['logs', '--no-color', 'api'], '读取脱敏日志').text;
  assert.ok(!secrets.some(value => logs.includes(value)), 'API日志不包含密码、密钥、连接串或token');
  await writeFile(path.join(output, 'runtime.log'), redact(logs));
  passed(`${expectedMigrations}条迁移、非root运行、镜像/前端产物/运行日志秘密扫描`);
} catch (error) {
  failure = redact(error instanceof Error ? error.stack : String(error)); console.error(failure);
} finally {
  if (browser) await browser.close();
  let cleaned = false; let originalResourcesPreserved = false;
  try {
    if (owned) {
      // project由本脚本随机生成；删除前逐个验证卷归属且不在启动前清单中。
      const names = run(['volume', 'ls', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.Name}}'], '确认自建卷归属').stdout.trim().split(/\s+/).filter(Boolean);
      for (const name of names) { assert.ok(name.startsWith(`${project}_`)); assert.ok(!originalVolumes.includes(name)); }
      compose(['down', '--volumes', '--remove-orphans'], '仅移除本次随机项目及所属新卷');
      cleaned = true;
    }
    const remainingVolumes = run(['volume', 'ls', '--format', '{{.Name}}'], '复核原有卷').stdout.trim().split(/\s+/);
    assert.ok(originalVolumes.every(name => remainingVolumes.includes(name)));
    if (existing.length) {
      const states = run(['inspect', '--format', '{{json .State}}', ...existing], '复核原有容器').stdout.trim().split('\n').map(line => JSON.parse(line));
      states.forEach((state, index) => { assert.equal(state.Running, originalState[index].Running); assert.equal(state.StartedAt, originalState[index].StartedAt); });
    }
    originalResourcesPreserved = true;
  } catch (error) { failure = failure ?? redact(error instanceof Error ? error.stack : String(error)); }
  const report = { timestamp: new Date().toISOString(), status: failure ? 'failed' : 'passed', project, imagePrefix,
    ports: { api: apiPort, admin: adminPort, store: storePort, database: dbPort }, checks, requests, commands, pageErrors,
    cleaned, originalResourcesPreserved, ...(failure ? { failure } : {}) };
  await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, checks: checks.length, httpRequests: requests.length, cleaned, originalResourcesPreserved }));
  if (failure) process.exitCode = 1;
}
