// Real business commands and real file bytes validate the isolated read-only reconciliation.
import { createHash } from 'node:crypto';
import { readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { OrderCommands } from '../src/orders/order-command.service.js';
import { module15Evidence, module15Harness, type Module15Harness } from './fixtures/module15-business.js';

interface ReconcileCheck {
  code: string;
  passed: boolean;
  violationCount: string;
  sampleBusinessIds: string[];
}
interface ReconcileReport {
  status: 'passed' | 'failed';
  readOnly: boolean;
  isolation: string;
  fileAssetsChecked: number;
  checks: ReconcileCheck[];
}
interface DatabaseSnapshot {
  summary: { tables: { count: string }[] };
}
interface ReconcileModule {
  runReconcile(options: { client: Client; uploadsRoot: string; scope: { target: string; database: string } }): Promise<ReconcileReport>;
}
interface SnapshotModule {
  captureDatabase(client: Client): Promise<DatabaseSnapshot>;
}

let h: Module15Harness;
let runReconcile: ReconcileModule['runReconcile'];
let captureDatabase: SnapshotModule['captureDatabase'];
const evidence: Record<string, unknown>[] = [];

beforeAll(async () => {
  h = await module15Harness();
  const reconcileScript = pathToFileURL(resolve(__dirname, '../../../scripts/reconcile.mjs')).href;
  const snapshotScript = pathToFileURL(resolve(__dirname, '../../../scripts/module15-ops-snapshot.mjs')).href;
  // Use Vitest's supported import callback; the scripts' CLI guards still see the Vitest entrypoint.
  ({ runReconcile } = await import(reconcileScript) as ReconcileModule);
  ({ captureDatabase } = await import(snapshotScript) as SnapshotModule);
}, 60000);
afterEach(() => { h.simulator.mode = 'SUCCESS'; h.clock.fixed = undefined; });
afterAll(async () => {
  await module15Evidence('reconcile', { kind: 'real-business-and-files-read-only-reconciliation', cases: evidence });
  await h?.close();
});

async function reconcile(name: string) {
  const client = new Client({ connectionString: h.config.databaseUrl, application_name: 'm415-reconcile-integration', connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    const before = await captureDatabase(client);
    const report = await runReconcile({ client, uploadsRoot: h.config.uploadDir, scope: { target: 'test', database: new URL(h.config.databaseUrl).pathname.slice(1) } });
    const after = await captureDatabase(client);
    // All columns of all tables, sequences, migrations and schema must remain identical, including technical rows and timestamps.
    expect(after.summary).toEqual(before.summary);
    expect(report.readOnly).toBe(true);
    expect(report.isolation).toBe('REPEATABLE READ');
    expect(report.checks.length).toBeGreaterThan(25);
    const fingerprint = (snapshot: DatabaseSnapshot) => createHash('sha256').update(JSON.stringify(snapshot.summary)).digest('hex');
    evidence.push({ case: name, status: report.status, checks: report.checks, fileAssetsChecked: report.fileAssetsChecked,
      beforeDatabaseSha256: fingerprint(before), afterDatabaseSha256: fingerprint(after), allDatabaseFactsUnchanged: true,
      tablesChecked: before.summary.tables.length, rowsChecked: before.summary.tables.reduce((sum, table) => sum + BigInt(table.count), 0n).toString() });
    return report;
  } finally { await client.end(); }
}

function expectPassed(report: ReconcileReport) {
  expect(report.checks.filter(check => !check.passed), 'every stock, payment, task and real file invariant must pass').toEqual([]);
  expect(report.checks.every(check => check.violationCount === '0')).toBe(true);
  expect(report.status).toBe('passed');
  expect(report.fileAssetsChecked).toBeGreaterThan(0);
}

it('IT15-RECONCILE: posted receipt, actual image snapshots, unpaid reservation, customer cancellation and payment all reconcile without writes', async () => {
  const p = await h.product(10);
  const unpaid = await h.ordered(p, 2), cancelled = await h.ordered(p, 1), paid = await h.ordered(p, 3);
  const commands = h.app.get(OrderCommands);
  await commands.cancel(h.context(cancelled.c), cancelled.id, '顾客主动取消隔离验收订单');
  await commands.pay(h.context(paid.c), paid.id);

  expect(await h.db.inventoryBalance.findUniqueOrThrow({ where: { skuId: p.skuId } })).toMatchObject({ available: 5, reserved: 2 });
  expect(await h.db.inventorySourceLine.findMany({ where: { skuId: p.skuId } })).toMatchObject([{ netPostedQuantity: 10, verifiedQuantity: 10 }]);
  expect(await h.db.order.findUniqueOrThrow({ where: { id: unpaid.id } })).toMatchObject({ status: 'WAIT_PAYMENT' });
  expect(await h.db.order.findUniqueOrThrow({ where: { id: cancelled.id } })).toMatchObject({ status: 'CLOSED' });
  expect(await h.db.payment.count({ where: { orderId: paid.id, status: 'SUCCEEDED' } })).toBe(1);
  expect(await h.db.product.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ paidSalesCount: 3n });
  const items = await h.db.orderItem.findMany({ where: { orderId: { in: [unpaid.id, cancelled.id, paid.id] } } });
  expect(items).toHaveLength(3);
  for (const item of items) {
    expect(item.imageAssetId).not.toBeNull();
    expect(await h.db.fileReference.count({ where: { ownerType: 'ORDER_ITEM', ownerId: item.id, fileAssetId: item.imageAssetId!, slot: 'snapshot', audience: 'PUBLIC' } })).toBe(1);
  }
  expectPassed(await reconcile('formal-receipt-unpaid-cancel-pay-and-image-snapshots'));
}, 120000);

for (const route of ['UNSHIPPED', 'SHIPPED_ONLY', 'RETURN'] as const) {
  it(`IT15-RECONCILE: ${route} retains the failed channel attempt and reconciles again after one successful retry`, async () => {
    const f = await h.refundReady(route);
    const initial = await h.db.inventoryBalance.findUniqueOrThrow({ where: { skuId: f.skuId } });
    const beforeOrder = await h.db.order.findUniqueOrThrow({ where: { id: f.id } });
    h.simulator.mode = 'FAIL_ONCE';
    const failed = await h.refunds.execute(h.context(h.support), f.afterSaleId, await h.refundBody(f.afterSaleId));
    expect(failed).toMatchObject({ attemptOutcome: 'FAILED', refundStatus: 'FAILED' });
    expect(await h.db.inventoryBalance.findUniqueOrThrow({ where: { skuId: f.skuId } })).toEqual(initial);
    expect(await h.db.order.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({ status: beforeOrder.status });
    expect(await h.db.refundAttempt.count({ where: { refundId: failed.refundId!, outcome: 'FAILED' } })).toBe(1);
    expectPassed(await reconcile(route + '-failed-refund-attempt'));

    await h.task(f.afterSaleId, 'REFUND_PROCESS', h.support, 'AFTER_SALE');
    const succeeded = await h.refunds.execute(h.context(h.support), f.afterSaleId, {
      ...await h.refundBody(f.afterSaleId), refundId: failed.refundId!, expectedRefundVersion: failed.refundVersion!,
    }, true);
    expect(succeeded).toMatchObject({ attemptOutcome: 'SUCCEEDED', refundStatus: 'SUCCEEDED', refundId: failed.refundId });
    expect(await h.db.refundAttempt.count({ where: { refundId: failed.refundId! } })).toBe(2);
    expect(await h.db.refundAttempt.count({ where: { refundId: failed.refundId!, outcome: 'SUCCEEDED' } })).toBe(1);
    expect(await h.db.refundAttempt.count({ where: { refundId: failed.refundId!, outcome: 'FAILED' } })).toBe(1);
    expect(await h.db.order.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({ status: 'REFUNDED' });
    expect(await h.db.afterSale.findUniqueOrThrow({ where: { id: f.afterSaleId } })).toMatchObject({ status: 'SUCCEEDED' });
    const final = await h.db.inventoryBalance.findUniqueOrThrow({ where: { skuId: f.skuId } });
    expect(final).toMatchObject({ available: route === 'UNSHIPPED' ? 10 : initial.available, reserved: 0 });
    expect(await h.db.inventoryAction.count({ where: { actionKey: 'RESTOCK_UNSHIPPED_REFUND:' + failed.refundId } })).toBe(route === 'UNSHIPPED' ? 1 : 0);
    expect(await h.db.inventoryAction.count({ where: { actionKey: 'RESTOCK_FINAL_INSPECTION:' + f.afterSaleId } })).toBe(route === 'RETURN' ? 1 : 0);
    expectPassed(await reconcile(route + '-successful-refund-retry'));
  }, 180000);
}

it('IT15-RECONCILE: all retained and staged files use actual bytes; equal-length corruption fails only file content checks and never repairs data', async () => {
  const p = await h.product(1);
  const mainImage = await h.db.productImage.findFirstOrThrow({ where: { productId: p.id, slot: 'MAIN' } });
  const retained = await h.db.fileAsset.findUniqueOrThrow({ where: { id: mainImage.assetId } });
  const image = await readFile(resolve(h.config.uploadDir, retained.storageKey));
  const form = new FormData();
  form.append('purpose', 'PRODUCT_IMAGE');
  form.append('file', new Blob([new Uint8Array(image)]), 'module15-staged.png');
  const uploaded = await fetch((await h.app.getUrl()) + '/api/v1/files', { method: 'POST', headers: { Authorization: 'Bearer ' + h.admin.token }, body: form });
  expect(uploaded.status).toBe(201);
  const uploadedBody = await uploaded.json() as { data: { id: string } };
  const staged = await h.db.fileAsset.findUniqueOrThrow({ where: { id: uploadedBody.data.id } });
  expect(retained.state).toBe('RETAINED'); expect(staged.state).toBe('STAGED');
  expect(await h.db.fileReference.count({ where: { fileAssetId: staged.id } })).toBe(0);
  expectPassed(await reconcile('valid-retained-and-unbound-staged-files'));

  for (const asset of [retained, staged]) {
    const file = resolve(h.config.uploadDir, asset.storageKey), original = await readFile(file), metadata = await stat(file);
    const corrupted = Buffer.from(original); corrupted[0] = corrupted[0]! ^ 1;
    try {
      await writeFile(file, corrupted);
      const report = await reconcile(asset.state.toLowerCase() + '-equal-length-file-corruption');
      expect(report.status).toBe('failed');
      expect(report.checks.filter(check => !check.passed)).toEqual([expect.objectContaining({ code: 'file-retained-and-staged-content', violationCount: '1', sampleBusinessIds: [asset.id] })]);
      expect(await readFile(file)).toEqual(corrupted);
    } finally {
      // Restore this one explicit test file; preserve its original timestamps and retain every artifact.
      await writeFile(file, original); await utimes(file, metadata.atime, metadata.mtime);
    }
  }
  expectPassed(await reconcile('original-file-bytes-restored-after-negative-cases'));
}, 180000);
