/* global window, document, innerWidth */
/** 文件作用：用独立测试库和真实编译API验收头像页面、失败重试、Blob预览与移动布局；只清理本轮夹具。 */
import assert from 'node:assert/strict';
import { randomBytes, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const env = parseEnv(readFileSync(path.join(root, '.env'), 'utf8')); const dev = new URL(env.DATABASE_URL); const test = new URL(env.TEST_DATABASE_URL);
assert.ok(test.pathname !== dev.pathname && /^[a-z][a-z0-9_]*_test$/.test(test.pathname.slice(1)));
const directory = await mkdtemp(path.join(tmpdir(), 'self-ecom-avatar-browser-'));
Object.assign(process.env, env, { DATABASE_URL: test.toString(), NODE_ENV: 'test', LOG_LEVEL: 'silent', UPLOAD_DIR: directory,
  JWT_SECRET: randomBytes(48).toString('hex'), SWAGGER_ENABLED: 'false' });
const apiRequire = createRequire(path.join(root, 'apps/api/package.json')); apiRequire('reflect-metadata');
const { NestFactory } = apiRequire('@nestjs/core'); const { AppModule } = apiRequire('./dist/app.module.js');
const { configureApp } = apiRequire('./dist/common/configure-app.js'); const { PrismaService } = apiRequire('./dist/prisma/prisma.service.js');
const { PasswordService } = apiRequire('./dist/auth/password.service.js'); const sharp = apiRequire('sharp');
const { createServer } = await import(pathToFileURL(path.join(root, 'apps/store-web/node_modules/vite/dist/node/index.js')).href);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const app = await NestFactory.create(AppModule, { logger: false }); const prisma = app.get(PrismaService);
const artifacts = path.resolve(root, process.argv.find(arg => arg.startsWith('--output='))?.slice(9) ?? 'output/playwright/M0-03-step04'); await mkdir(artifacts, { recursive: true });
const password = 'AvatarBrowser#2026'; const phone = `134${String(randomInt(100000000)).padStart(8, '0')}`;
const requestId = '3433bc36-76da-4b61-8e06-2107596c234a'; const checks = []; const errors = []; const requests = [];
let vite; let browser; let page; let customerId; let scenario = '启动'; let report;
try {
  configureApp(app); await app.listen(0, '127.0.0.1');
  const customer = await prisma.customer.create({ data: { phone, nickname: '头像页面验收', passwordHash: await app.get(PasswordService).hash(password) } }); customerId = customer.id;
  vite = await createServer({ root: path.join(root, 'apps/store-web'), cacheDir: path.join(directory, 'vite-cache'),
    configFile: path.join(root, 'apps/store-web/vite.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false,
      proxy: { '/api': { target: await app.getUrl(), changeOrigin: true } } } }); await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, channel: 'msedge' }); page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  page.on('pageerror', error => errors.push(error.name));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/v1/files')) { assert.equal(url.search, ''); requests.push({ method: request.method(), path: url.pathname }); }
  });
  await page.addInitScript(() => {
    window.__imageUrls = { created: [], revoked: [] };
    const create = URL.createObjectURL.bind(URL); const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); window.__imageUrls.created.push(url); return url; };
    URL.revokeObjectURL = url => { window.__imageUrls.revoked.push(url); revoke(url); };
  });
  const input = () => page.getByLabel('选择头像图片', { exact: true });
  const image = await sharp({ create: { width: 96, height: 96, channels: 3, background: '#087e8b' } }).png().toBuffer();
  const choose = () => input().setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: image });
  const login = async () => {
    await page.goto(origin + '/login'); await page.getByLabel('手机号', { exact: true }).fill(phone); await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: /^登\s*录$/ }).click(); await page.getByRole('heading', { name: '我的账号', exact: true }).waitFor();
  };
  await login();
  scenario = '前端预检拒绝超限及SVG，不发送上传'; await page.getByRole('button', { name: '更换头像', exact: true }).click();
  const before = requests.filter(item => item.method === 'POST').length;
  for (const file of [{ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') }, { name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(5242881) }]) {
    await input().setInputFiles(file); await page.getByRole('alert').getByText('请选择非空的JPEG、PNG或WebP图片，每张不超过5MiB', { exact: true }).waitFor();
  }
  assert.equal(requests.filter(item => item.method === 'POST').length, before); checks.push(scenario);
  scenario = '429上传失败保留选择并手动重试，错误编号显示';
  await page.route('**/api/v1/files', route => route.fulfill({ status: 429, contentType: 'application/json', headers: { 'Retry-After': '1' },
    body: JSON.stringify({ code: 'FILE_RATE_LIMITED', message: '测试上传限流', requestId }) }));
  await choose(); await page.getByText('测试上传限流', { exact: true }).waitFor(); await page.getByText(`请求编号：${requestId}`, { exact: true }).waitFor();
  await page.unroute('**/api/v1/files'); await page.getByRole('button', { name: '重试上传', exact: true }).click();
  await page.getByRole('img', { name: '待确认的图片预览', exact: true }).waitFor(); checks.push(scenario);
  scenario = '私有Blob预览、选图返回焦点后保留选择及业务失败重试不重传';
  assert.ok((await page.getByRole('img', { name: '待确认的图片预览', exact: true }).getAttribute('src')).startsWith('blob:'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.getByRole('button', { name: '保存头像', exact: true }).waitFor();
  const uploads = requests.filter(item => item.method === 'POST').length;
  await page.route('**/api/v1/store/me/avatar', route => route.fulfill({ status: 500, contentType: 'application/json',
    body: JSON.stringify({ code: 'INTERNAL_ERROR', message: '测试头像保存失败', requestId }) }));
  await page.getByRole('button', { name: '保存头像', exact: true }).click(); await page.getByText('测试头像保存失败', { exact: true }).waitFor();
  assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).avatarAssetId, null);
  await page.unroute('**/api/v1/store/me/avatar'); await page.getByRole('button', { name: /保存头像/ }).click();
  await page.getByRole('img', { name: '当前头像', exact: true }).waitFor(); assert.equal(requests.filter(item => item.method === 'POST').length, uploads);
  const current = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } }); const oldUrl = `/api/v1/files/${current.avatarAssetId}/content`;
  checks.push(scenario);
  scenario = '公开头像刷新保留、桌面和移动布局'; await page.reload(); await page.getByRole('img', { name: '当前头像', exact: true }).waitFor();
  await page.screenshot({ path: path.join(artifacts, 'account-desktop.png'), fullPage: true }); await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(artifacts, 'account-mobile.png'), fullPage: true }); checks.push(scenario);
  scenario = '移除只清当前头像，旧链接仍可读'; await page.getByRole('button', { name: '移除头像', exact: true }).click();
  await page.getByText('头像已移除。', { exact: true }).waitFor(); assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).avatarAssetId, null);
  assert.equal((await fetch(origin + oldUrl)).status, 200); checks.push(scenario);
  scenario = '取消选择释放Blob对象URL'; await page.getByRole('button', { name: '更换头像', exact: true }).click(); await choose();
  await page.getByRole('img', { name: '待确认的图片预览', exact: true }).waitFor();
  await page.getByRole('button', { name: /^取\s*消$/ }).click();
  assert.ok(await page.evaluate(() => window.__imageUrls.created.length > 0 && window.__imageUrls.created.every(url => window.__imageUrls.revoked.includes(url)))); checks.push(scenario);
  scenario = '私有Blob JSON404显示安全错误，手动重试，401退出当前顾客'; await page.getByRole('button', { name: '更换头像', exact: true }).click();
  await page.route('**/api/v1/files/*/content', route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'FILE_NOT_FOUND', message: '测试图片不可读', requestId }) }));
  await choose(); await page.getByText('测试图片不可读', { exact: true }).waitFor(); await page.getByText(`请求编号：${requestId}`, { exact: true }).waitFor();
  await page.unroute('**/api/v1/files/*/content'); await page.getByRole('button', { name: '重新读取图片', exact: true }).click();
  await page.getByRole('img', { name: '待确认的图片预览', exact: true }).waitFor(); await page.getByRole('button', { name: /^取\s*消$/ }).click();
  await page.getByRole('button', { name: '更换头像', exact: true }).click();
  await page.route('**/api/v1/files', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'SESSION_REVOKED', message: '测试会话失效', requestId }) }));
  await choose(); await page.waitForURL(origin + '/login'); assert.equal(await page.evaluate(() => localStorage.getItem('self-ecom.customer.session')), null); checks.push(scenario);
  assert.deepEqual(errors, []); report = { timestamp: new Date().toISOString(), browser: await browser.version(), checks, pageErrors: errors, requests };
} catch (error) {
  await page?.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
  console.error(JSON.stringify({ scenario, error: error.name, message: String(error.message).replaceAll(phone, '[测试手机号]').replaceAll(password, '[测试密码]'),
    at: error.stack?.split('\n').find(line => line.includes('verify-avatar-browser.mjs:')),
    buttons: await page?.getByRole('button').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, label: node.getAttribute('aria-label'), disabled: node.hasAttribute('disabled') }))) })); process.exitCode = 1;
} finally {
  await browser?.close(); await vite?.close();
  if (customerId) {
    await prisma.customer.update({ where: { id: customerId }, data: { avatarAssetId: null } });
    const files = await prisma.fileAsset.findMany({ where: { uploaderCustomerId: customerId }, select: { id: true } });
    await prisma.fileReference.deleteMany({ where: { fileAssetId: { in: files.map(row => row.id) } } }); await prisma.fileAsset.deleteMany({ where: { uploaderCustomerId: customerId } });
    await prisma.auditLog.deleteMany({ where: { actorCustomerId: customerId } }); await prisma.authSession.deleteMany({ where: { customerId } }); await prisma.customer.delete({ where: { id: customerId } });
  }
  await app.close();
  if (path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep) && directory.includes('self-ecom-avatar-browser-')) await rm(directory, { recursive: true, force: true });
  if (report) { await writeFile(path.join(artifacts, 'result.json'), JSON.stringify({ ...report, fixtureCleaned: true }, null, 2) + '\n'); console.log(JSON.stringify({ passed: checks.length, pageErrors: errors.length, fixtureCleaned: true })); }
}
