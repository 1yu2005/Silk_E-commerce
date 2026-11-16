// 作用：恢复后用原账号正式重新登录，读取原订单/售后历史并验证私图字节和岗位鉴权；不输出凭据或token。
import { createHash } from 'node:crypto';
import path from 'node:path';
import { requireCondition } from '../scripts/module15-ops-snapshot.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');

export async function verifyRestoredBusiness({ browser, accounts, sourceProject, fixture, origin, storeOrigin, output }) {
  requireCondition(browser && Array.isArray(accounts), 'RESTORED_BROWSER_AND_ACCOUNT_LEDGER_REQUIRED');
  requireCondition(fixture?.completedRefundedOrderId && fixture.completedAfterSaleId && fixture.customerId && fixture.orderNo, 'RESTORED_ORIGINAL_FIXTURE_REQUIRED');
  requireCondition(fixture.recoveryPrivateFiles?.length === 3 && fixture.recoveryPrivateFiles.every(file => /^[a-f0-9]{64}$/.test(file.sha256 ?? '') && Number.isSafeInteger(file.size) && file.size > 0), 'RESTORED_REAL_PRIVATE_FILES_REQUIRED');
  const selected = Object.fromEntries(['admin', 'warehouse', 'customer'].map(role => {
    const matches = accounts.filter(account => account.key === 'reporting:' + role && account.project === sourceProject && account.valid === true);
    requireCondition(matches.length === 1 && typeof matches[0].currentPassword === 'string' && matches[0].currentPassword.length > 0, 'RESTORED_ORIGINAL_ACCOUNT_MISSING');
    return [role, matches[0]];
  }));
  requireCondition(selected.customer.id === fixture.customerId, 'RESTORED_CUSTOMER_LEDGER_MISMATCH');
  requireCondition(selected.admin.subjectType === 'EMPLOYEE' && selected.admin.role === 'SUPER_ADMIN' && selected.warehouse.role === 'MERCH_WAREHOUSE' && selected.customer.subjectType === 'CUSTOMER', 'RESTORED_ACCOUNT_ROLES_MISMATCH');
  const result = { status: 'IN_PROGRESS', startedAt: new Date().toISOString(), requests: [], pageErrors: [], files: [], screenshots: [],
    sourceProject, accountLedgerBoundToFixture: true, loginMeaning: 'Original restored passwords are used for new formal sessions; this does not claim a source token expired during the drill.' };
  async function json(site, url, { token, body, status = 200, role = 'anonymous' } = {}) {
    const response = await fetch(site + '/api/v1' + url, {
      method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(20000),
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json();
    result.requests.push({ role, method: body === undefined ? 'GET' : 'POST', path: url, status: response.status, requestId: payload.requestId });
    requireCondition(response.status === status && payload.requestId && payload.requestId === response.headers.get('x-request-id'), 'RESTORED_BUSINESS_HTTP_FAILED');
    return payload.data;
  }
  const tokens = {};
  for (const role of ['admin', 'warehouse', 'customer']) {
    const account = selected[role], customer = role === 'customer', url = customer ? '/store/auth/login' : '/admin/auth/login';
    const body = { ...(customer ? { phone: account.phone } : { username: account.username }), password: account.currentPassword };
    const login = await json(customer ? storeOrigin : origin, url, { body, role });
    requireCondition(typeof login.accessToken === 'string' && login.accessToken.length > 0, 'RESTORED_NEW_LOGIN_FAILED'); tokens[role] = login.accessToken;
  }
  const owned = (url, role = 'customer') => json(role === 'customer' ? storeOrigin : origin, url, { token: tokens[role], role });
  requireCondition((await owned('/store/me')).id === fixture.customerId, 'RESTORED_ORIGINAL_CUSTOMER_NOT_READABLE');
  const orderId = fixture.completedRefundedOrderId, saleId = fixture.completedAfterSaleId;
  const originalOrder = await owned('/store/orders/' + orderId);
  requireCondition(originalOrder.id === orderId && originalOrder.number === fixture.orderNo && originalOrder.status === 'REFUNDED' && Number.isFinite(Date.parse(originalOrder.receipt?.completedAt)) && originalOrder.history.length > 0, 'RESTORED_ORIGINAL_ORDER_NOT_READABLE');
  const paymentHistory = await owned('/admin/orders/' + orderId + '/history?page=1&pageSize=100&kind=PAYMENT', 'admin');
  requireCondition(paymentHistory.items.length === 1 && paymentHistory.items.every(row => row.kind === 'PAYMENT'), 'RESTORED_PAYMENT_HISTORY_CHANGED');
  const refundHistory = await owned('/admin/after-sales/' + saleId + '/history?page=1&pageSize=100&kind=REFUND_ATTEMPT', 'admin');
  requireCondition(refundHistory.items.length === 1 && refundHistory.items[0].kind === 'REFUND_ATTEMPT' && refundHistory.items[0].afterStatus === 'SUCCEEDED', 'RESTORED_REFUND_ATTEMPT_HISTORY_CHANGED');
  result.originalCompletedThenRefundedOrder = { orderId, status: originalOrder.status, receiptCompletedAt: originalOrder.receipt.completedAt, paymentHistoryCount: paymentHistory.items.length, successfulRefundAttemptCount: refundHistory.items.length };
  for (const file of fixture.recoveryPrivateFiles) {
    const sale = await owned('/store/after-sales/' + file.afterSaleId);
    requireCondition(sale.id === file.afterSaleId && sale.orderId === file.orderId && sale.materialVersions.some(version => version.evidence.some(row => row.id === file.fileId)), 'RESTORED_PRIVATE_FILE_LOST_ORIGINAL_MATERIAL_REFERENCE');
    const checks = {};
    for (const role of ['customer', 'anonymous', 'warehouse']) {
      const response = await fetch((role === 'customer' ? storeOrigin : origin) + '/api/v1/files/' + file.fileId + '/content', {
        signal: AbortSignal.timeout(20000), headers: role === 'anonymous' ? {} : { Authorization: 'Bearer ' + tokens[role] },
      });
      requireCondition(response.status === (role === 'customer' ? 200 : 404), 'RESTORED_PRIVATE_FILE_AUTHORIZATION_FAILED');
      if (role === 'customer') {
        const bytes = Buffer.from(await response.arrayBuffer());
        requireCondition(bytes.length === file.size && digest(bytes) === file.sha256, 'RESTORED_PRIVATE_FILE_BYTES_CHANGED'); checks.sha256 = digest(bytes); checks.bytes = bytes.length;
      } else await response.arrayBuffer();
      checks[role + 'Status'] = response.status;
    }
    result.files.push({ fileId: file.fileId, orderId: file.orderId, afterSaleId: file.afterSaleId, originalMaterialReferenceKept: true, ...checks });
  }
  result.httpOriginalBusinessReadable = true;
  const pages = [];
  const capture = page => {
    pages.push(page); page.on('pageerror', error => result.pageErrors.push(error.name));
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.pathname.startsWith('/api/v1/')) result.requests.push({ source: 'browser', method: response.request().method(), path: url.pathname + url.search, status: response.status() });
    });
    return page;
  };
  const screenshot = async (page, name) => {
    const file = path.join(output, name + '.png'), bytes = await page.screenshot({ path: file, fullPage: true });
    result.screenshots.push({ name: name + '.png', privatePath: file, size: bytes.length, sha256: digest(bytes), privateEvidenceRetained: true });
  };
  const read = async (page, target, pathname) => {
    const [response] = await Promise.all([page.waitForResponse(value => value.request().method() === 'GET' && new URL(value.url()).pathname === '/api/v1' + pathname), page.goto(target)]);
    requireCondition(response.status() === 200, 'RESTORED_BROWSER_BUSINESS_NOT_READABLE'); return (await response.json()).data;
  };
  const filterHistory = async (page, pathname, kind, original, label) => {
    const timeline = page.locator('section[aria-label="业务历史"]');
    const [response] = await Promise.all([
      page.waitForResponse(value => value.request().method() === 'GET' && new URL(value.url()).pathname === '/api/v1' + pathname && new URL(value.url()).searchParams.get('kind') === kind),
      timeline.getByLabel('历史事件类型', { exact: true }).selectOption(kind),
    ]);
    const payload = await response.json(), history = payload.data;
    requireCondition(response.status() === 200 && payload.requestId && payload.requestId === response.headers()['x-request-id'], 'RESTORED_BROWSER_HISTORY_FILTER_FAILED');
    requireCondition(history.total === 1 && history.items.length === 1 && history.items[0].id === original.id && history.items[0].kind === kind && history.items[0].afterStatus === original.afterStatus, 'RESTORED_BROWSER_FILTERED_HISTORY_CHANGED');
    const row = timeline.locator('.history-timeline > li.catalog-card').filter({ hasText: '记录编号 ' + original.id });
    await row.getByText('记录编号 ' + original.id, { exact: true }).waitFor();
    await row.getByText(label, { exact: true }).waitFor();
    requireCondition(await timeline.locator('.history-timeline > li.catalog-card').count() === history.items.length, 'RESTORED_BROWSER_FILTERED_HISTORY_NOT_RENDERED');
    (result.browserHistoryFilters ??= []).push({ kind, page: history.page, pageSize: history.pageSize, total: history.total, recordId: original.id, afterStatus: history.items[0].afterStatus, requestId: payload.requestId, originalRecordVisible: true });
    return history;
  };
  try {
    const adminPage = capture(await browser.newPage({ viewport: { width: 1366, height: 768 } }));
    await adminPage.goto(origin + '/login');
    await adminPage.getByLabel('员工账号', { exact: true }).fill(selected.admin.username);
    await adminPage.getByLabel('密码', { exact: true }).fill(selected.admin.currentPassword);
    await adminPage.locator('form button[type=submit]').click(); await adminPage.waitForURL(origin + '/');
    await read(adminPage, origin + '/orders/' + orderId, '/admin/orders/' + orderId + '/history');
    const staffOrderHistory = await filterHistory(adminPage, '/admin/orders/' + orderId + '/history', 'PAYMENT', paymentHistory.items[0], '模拟付款');
    requireCondition(staffOrderHistory.items.some(row => row.kind === 'PAYMENT'), 'RESTORED_BROWSER_PAYMENT_HISTORY_MISSING');
    await adminPage.locator('section[aria-label="业务历史"]').waitFor(); await screenshot(adminPage, 'restored-admin-original-order-history');
    await read(adminPage, origin + '/after-sales/' + saleId, '/admin/after-sales/' + saleId + '/history');
    const staffSaleHistory = await filterHistory(adminPage, '/admin/after-sales/' + saleId + '/history', 'REFUND_ATTEMPT', refundHistory.items[0], '退款尝试');
    requireCondition(staffSaleHistory.items.some(row => row.kind === 'REFUND_ATTEMPT' && row.afterStatus === 'SUCCEEDED'), 'RESTORED_BROWSER_REFUND_HISTORY_MISSING');
    await adminPage.locator('section[aria-label="业务历史"]').waitFor(); await screenshot(adminPage, 'restored-admin-original-refund-history');
    const customerPage = capture(await browser.newPage({ viewport: { width: 1366, height: 768 } }));
    await customerPage.goto(storeOrigin + '/login');
    await customerPage.getByLabel('手机号', { exact: true }).fill(selected.customer.phone);
    await customerPage.getByLabel('密码', { exact: true }).fill(selected.customer.currentPassword);
    await customerPage.locator('form button[type=submit]').click(); await customerPage.waitForURL(storeOrigin + '/account');
    const customerOrder = await read(customerPage, storeOrigin + '/orders/' + orderId, '/store/orders/' + orderId);
    requireCondition(customerOrder.id === orderId && customerOrder.number === fixture.orderNo && customerOrder.status === 'REFUNDED' && customerOrder.receipt?.completedAt === originalOrder.receipt.completedAt, 'RESTORED_BROWSER_ORIGINAL_ORDER_CHANGED');
    await customerPage.getByRole('heading', { name: '订单详情', exact: true }).waitFor(); await screenshot(customerPage, 'restored-customer-original-order');
    const file = fixture.recoveryPrivateFiles.find(row => row.afterSaleId === saleId);
    requireCondition(file, 'RESTORED_ORIGINAL_REFUNDED_MATERIAL_FILE_REQUIRED');
    const [imageResponse] = await Promise.all([
      customerPage.waitForResponse(value => new URL(value.url()).pathname === '/api/v1/files/' + file.fileId + '/content'),
      read(customerPage, storeOrigin + '/after-sales/' + saleId, '/store/after-sales/' + saleId),
    ]);
    requireCondition(imageResponse.status() === 200 && digest(await imageResponse.body()) === file.sha256, 'RESTORED_BROWSER_PRIVATE_IMAGE_CHANGED');
    await customerPage.getByRole('heading', { name: '售后详情', exact: true }).waitFor();
    await customerPage.getByRole('heading', { name: '处理时间线', exact: true }).waitFor();
    await customerPage.getByText('整单全额模拟退款成功', { exact: true }).waitFor();
    const renderedImage = customerPage.getByRole('img', { name: '售后凭证', exact: true }).first();
    await renderedImage.waitFor(); await renderedImage.evaluate(element => element.decode());
    await screenshot(customerPage, 'restored-customer-original-material-and-refund');
    requireCondition(result.pageErrors.length === 0, 'RESTORED_BROWSER_PAGE_ERRORS');
    result.browserOriginalBusinessReadable = true; result.formalNewLoginRoles = ['admin', 'warehouse', 'customer'];
    result.status = 'PASSED'; result.finishedAt = new Date().toISOString(); return result;
  } finally { for (const page of pages) await page.close().catch(() => undefined); }
}
