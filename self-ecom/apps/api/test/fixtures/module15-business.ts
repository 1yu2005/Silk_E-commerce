// Module15 isolated real-service fixtures; every positive stock balance comes from a posted receipt.
import 'reflect-metadata';
import { randomInt, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient, type Prisma, type TaskStage } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import { Client } from 'pg';
import { AppModule } from '../../src/app.module.js';
import { APP_CONFIG, loadConfiguration } from '../../src/config/environment.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { Clock } from '../../src/common/time/clock.js';
import { AuditService, type AuditPayload } from '../../src/audit/audit.service.js';
import { RefundSimulator, RefundService } from '../../src/after-sales/refund.service.js';
import { configureApp } from '../../src/common/configure-app.js';
import { FILE_CONFIG } from '../../src/files/file-configuration.js';
import { AuthSessionService } from '../../src/auth/auth-session.service.js';
import { CurrentIdentityService } from '../../src/auth/current-identity.service.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { seedPermissionCatalog } from '../../src/permissions/permission-seed.js';
import { StoreSettingsService } from '../../src/settings/store-settings.service.js';
import type { CustomerContext } from '../../src/customers/customer-access.service.js';
import { AddressService } from '../../src/customers/address.service.js';
import { CartService } from '../../src/customers/cart.service.js';
import { CustomerService } from '../../src/customers/customer.service.js';
import { ProductCommands } from '../../src/catalog/product-command.service.js';
import { CategoryService } from '../../src/catalog/category.service.js';
import { InventorySources } from '../../src/inventory/inventory-source.service.js';
import { InventoryAdjustments } from '../../src/inventory/inventory-adjustment.service.js';
import { OrderService } from '../../src/orders/order.service.js';
import { OrderCommands } from '../../src/orders/order-command.service.js';
import { FulfillmentService } from '../../src/orders/fulfillment.service.js';
import { FulfillmentQueries } from '../../src/orders/fulfillment-query.service.js';
import { TaskCommandService } from '../../src/tasks/task-command.service.js';
import { AfterSaleService } from '../../src/after-sales/after-sale.service.js';
import { UnshippedPhysicalService } from '../../src/after-sales/unshipped-physical.service.js';
import { ReturnInspectionService } from '../../src/after-sales/return-inspection.service.js';
import { ProxyInputService } from '../../src/coordination/proxy-input.service.js';
import { CommunicationService } from '../../src/records/communication.service.js';

export class Module15Clock extends Clock {
  fixed?: Date;
  now() { return this.fixed ? new Date(this.fixed) : new Date(); }
  set(value: Date | string | number) { this.fixed = new Date(value); return this.fixed; }
}
export class Module15Audit extends AuditService {
  failOnce?: { action: string; targetId?: string; phase?: 'before' | 'after' };
  checkpoint?: (tx: Prisma.TransactionClient, payload: AuditPayload) => Promise<void>;
  override async appendAudit(tx: Prisma.TransactionClient, payload: AuditPayload) {
    const matches = this.failOnce?.action === payload.action && (!this.failOnce.targetId || this.failOnce.targetId === payload.targetId);
    if (matches && this.failOnce?.phase === 'before') { this.failOnce = undefined; throw new Error('Module15 pre-audit fault'); }
    await super.appendAudit(tx, payload);
    await this.checkpoint?.(tx, payload);
    if (matches) { this.failOnce = undefined; throw new Error('Module15 post-audit fault'); }
  }
}
export class Module15Simulator extends RefundSimulator {
  mode: 'SUCCESS' | 'FAIL_ONCE' | 'ALWAYS_FAIL' = 'SUCCESS';
  override execute(facts: { committedAttempts: number }) {
    return Promise.resolve(this.mode === 'ALWAYS_FAIL' || this.mode === 'FAIL_ONCE' && facts.committedAttempts === 0 ? 'FAILED' as const : 'SUCCEEDED' as const);
  }
}
export const module15Address = { receiver: '板块15隔离收件人', phone: '01000000000', province: '测试省', city: '测试市', district: '测试区', detail: '验收隔离资料' };
export async function module15Harness(poolMax = 20) {
  if (process.env.NODE_ENV !== 'test' || !/^\/m415_[a-f0-9]{32}_test$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error('Module15 only accepts its fresh isolated test database');
  const config = { ...loadConfiguration(), nodeEnv: 'test' as const, uploadDir: await mkdtemp(join(tmpdir(), 'module15-')), logLevel: 'silent' as const };
  const clock = new Module15Clock(), audit = new Module15Audit(), simulator = new Module15Simulator();
  // A larger pool is test-only: it lets the barrier prove 100 distinct database transactions are actually waiting.
  const client = new PrismaClient({ errorFormat: 'minimal', adapter: new PrismaPg({ connectionString: config.databaseUrl, max: poolMax, connectionTimeoutMillis: 15000, statement_timeout: 15000, options: '-c timezone=UTC' }) });
  const db = client as PrismaService;
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(APP_CONFIG).useValue(config)
    .overrideProvider(PrismaService).useValue(db).overrideProvider(Clock).useValue(clock).overrideProvider(AuditService).useValue(audit)
    .overrideProvider(RefundSimulator).useValue(simulator).overrideProvider(FILE_CONFIG).useValue({ stagedQuota: 1000, uploadsPerMinute: 100, cleanupIntervalSeconds: 86400 }).compile();
  const app = module.createNestApplication({ logger: false }); configureApp(app); await app.listen(0, '127.0.0.1');
  await seedPermissionCatalog(db);
  const hash = await app.get(PasswordService).hash(randomUUID() + '-Aa9');
  const context = (who: CustomerContext) => ({ ...who, requestId: randomUUID() });
  async function session(type: 'EMPLOYEE' | 'CUSTOMER', id: string): Promise<CustomerContext> {
    const row = type === 'EMPLOYEE' ? await db.employee.findUniqueOrThrow({ where: { id } }) : await db.customer.findUniqueOrThrow({ where: { id } });
    const token = await db.$transaction(tx => app.get(AuthSessionService).createAfterPasswordVerified(tx, { subjectType: type, subjectId: id, expectedPasswordHash: row.passwordHash, expectedTokenVersion: row.tokenVersion }));
    return { actor: await app.get(CurrentIdentityService).authenticate(db, token.accessToken, type), token: token.accessToken, requestId: randomUUID() };
  }
  async function employee(role: 'SUPER_ADMIN' | 'MERCH_WAREHOUSE' | 'CUSTOMER_SERVICE' = 'MERCH_WAREHOUSE') {
    const row = await db.employee.create({ data: { username: 'm15_' + randomUUID().replaceAll('-', '').slice(0, 24), displayName: '板块15隔离员工', role, passwordHash: hash, mustChangePassword: false } });
    return session('EMPLOYEE', row.id);
  }
  async function customer() {
    const row = await db.customer.create({ data: { phone: '139' + String(randomInt(100000000)).padStart(8, '0'), nickname: '板块15隔离顾客', passwordHash: hash } });
    return session('CUSTOMER', row.id);
  }
  const admin = await employee('SUPER_ADMIN'), warehouse = await employee(), support = await employee('CUSTOMER_SERVICE');
  const setting = app.get(StoreSettingsService), current = await setting.current();
  await setting.update(admin.actor, admin.token, { expectedVersion: current.version, reason: '板块15隔离验收', shippingFeeCents: 800, freeShippingEnabled: true, freeShippingThresholdCents: 20000,
    returnAddress: module15Address, serviceContact: { phone: '01000000000', serviceHours: '隔离验收' }, deadlines: { paymentMinutes: 30, autoReceiptDays: 10, afterSaleWindowDays: 7, reviewWorkdays: 3, supplementDays: 7, returnShipDays: 7, inspectionWorkdays: 3, refundWorkdays: 3 } }, randomUUID());
  const products = app.get(ProductCommands), inventory = app.get(InventoryAdjustments), sources = app.get(InventorySources), orders = app.get(OrderService), fulfillment = app.get(FulfillmentService);
  const category = await app.get(CategoryService).write(admin.actor, admin.token, randomUUID(), null, { name: '板块15分类' }, 'create');
  async function inventoryVersions(id: string) {
    const a = await db.inventoryAdjustment.findUniqueOrThrow({ where: { id } });
    const t = await db.task.findFirstOrThrow({ where: { businessType: 'INVENTORY_ADJUSTMENT', businessId: id, stage: a.checkRequired ? 'INVENTORY_RECONCILE' : 'INVENTORY_POST', status: { in: ['OPEN', 'CLAIMED'] } } });
    return { expectedVersion: a.version, expectedTaskVersion: t.version };
  }
  async function receipt(skuId: string, quantity: number, batchKey: string = randomUUID(), sourceLineId?: string, actor = warehouse) {
    if (!sourceLineId) {
      const source = await sources.create(context(warehouse), { sourceType: 'RECEIPT', namespace: 'module15', reference: randomUUID(), note: '正式来源核实', lines: [{ lineKey: '1', skuId, verifiedQuantity: quantity }] });
      sourceLineId = (await db.inventorySourceLine.findFirstOrThrow({ where: { sourceId: source.id } })).id;
    }
    const adjustment = await inventory.create(context(actor), { type: 'ARRIVAL', reason: '正式到货入账', evidenceNote: '隔离库核实来源', lines: [{ skuId, sourceLineId, quantity, batchKey }] });
    await inventory.claim(context(actor), adjustment.id, await inventoryVersions(adjustment.id));
    return { id: adjustment.id, sourceLineId, body: await inventoryVersions(adjustment.id), actor };
  }
  async function product(quantity = 10) {
    let p = await products.create(context(admin), { name: '板块15商品 ' + randomUUID().slice(0, 8), categoryId: category.id });
    const skuId = p.skus[0]!.id;
    p = await products.prices(context(admin), p.id, { expectedVersion: p.version!, skuIds: [skuId], priceCents: 9900, costCents: 4000 });
    const png = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#345678' } }).png().toBuffer();
    const form = new FormData(); form.append('purpose', 'PRODUCT_IMAGE'); form.append('file', new Blob([new Uint8Array(png)]), 'module15.png');
    const uploaded = await fetch((await app.getUrl()) + '/api/v1/files', { method: 'POST', headers: { Authorization: 'Bearer ' + admin.token }, body: form });
    if (uploaded.status !== 201) throw new Error('Module15 fixture image upload failed');
    const image = (await uploaded.json()).data.id as string;
    p = await products.images(context(admin), p.id, { expectedVersion: p.version!, mainImageId: image, galleryImageIds: [] });
    const pending = await receipt(skuId, quantity); await inventory.post(context(warehouse), pending.id, pending.body);
    p = await products.status(context(admin), p.id, { expectedVersion: p.version!, reason: '完成正式入账后上架' }, 'publish');
    return { id: p.id, skuId, quantity };
  }
  async function quote(skuId: string, quantity = 1, c?: CustomerContext) {
    c ??= await customer(); const address = await app.get(AddressService).create(c, module15Address);
    const cart = await app.get(CartService).add(c, { skuId, quantity });
    const input = { addressId: address.address.id, items: [{ cartItemId: cart.item.id, skuId, quantity }] };
    const q = await orders.preview(c, input);
    return { c, cart: await db.cartItem.findUniqueOrThrow({ where: { id: cart.item.id } }), input: { ...input, quoteId: q.quoteId }, key: randomUUID() };
  }
  async function ordered(p?: Awaited<ReturnType<typeof product>>, quantity = 2) {
    p ??= await product(); const q = await quote(p.skuId, quantity);
    const o = await orders.create(q.c, q.input, q.key); return { id: o.orderId, c: q.c, skuId: p.skuId, productId: p.id, quantity };
  }
  async function paid(p?: Awaited<ReturnType<typeof product>>, quantity = 2) { const f = await ordered(p, quantity); await app.get(OrderCommands).pay(f.c, f.id); return f; }
  async function task(id: string, stage: TaskStage, actor = warehouse, businessType: 'ORDER' | 'AFTER_SALE' = 'ORDER') {
    let t = await db.task.findFirstOrThrow({ where: { businessType, businessId: id, stage, status: { in: ['OPEN', 'CLAIMED'] } }, orderBy: { round: 'desc' } });
    if (t.status === 'OPEN') { await app.get(TaskCommandService).claim(actor.actor, actor.token, t.id, { expectedVersion: t.version }, randomUUID()); t = await db.task.findUniqueOrThrow({ where: { id: t.id } }); }
    return t;
  }
  async function orderBody(id: string) { const o = await db.order.findUniqueOrThrow({ where: { id } }), t = await db.task.findFirstOrThrow({ where: { businessType: 'ORDER', businessId: id, stage: 'SHIPMENT_PROCESS', status: { in: ['OPEN', 'CLAIMED', 'SUSPENDED'] } } }); return { commandKey: randomUUID(), expectedOrderVersion: o.version, expectedTaskVersion: t.version, reason: '板块15实际核对' }; }
  async function ready(f?: Awaited<ReturnType<typeof paid>>) {
    f ??= await paid(); await task(f.id, 'SHIPMENT_PROCESS'); const o = await db.order.findUniqueOrThrow({ where: { id: f.id } }), items = await db.orderItem.findMany({ where: { orderId: f.id } });
    await fulfillment.pack(warehouse, f.id, { ...await orderBody(f.id), items: items.map(i => ({ orderItemId: i.id, checkedQuantity: i.quantity })), goodsLocation: '板块15货架', expectedPhysicalVersion: o.stockPhysicalVersion });
    await fulfillment.prepare(warehouse, f.id, { ...await orderBody(f.id), carrierName: '隔离承运人', trackingNumber: 'M15-' + randomUUID() }); return f;
  }
  async function start(f?: Awaited<ReturnType<typeof paid>>) {
    f = await ready(f); const q = await app.get(FulfillmentQueries).detail(warehouse, f.id);
    const attempt = await fulfillment.start(warehouse, f.id, { ...await orderBody(f.id), shipmentId: q.shipment!.id, packingCheckId: q.packingCheck!.id, expectedPhysicalVersion: q.physicalVersion }); return { ...f, attempt };
  }
  async function shipped(f?: Awaited<ReturnType<typeof paid>>) { const s = await start(f); await fulfillment.confirm(warehouse, s.id, { ...await orderBody(s.id), attemptId: s.attempt.attemptId!, expectedAttemptVersion: s.attempt.attemptVersion!, actualHandoverAt: clock.now().toISOString() }); return s; }
  async function saleBody(id: string, stage: TaskStage) { const a = await db.afterSale.findUniqueOrThrow({ where: { id } }), t = await db.task.findFirstOrThrow({ where: { businessType: 'AFTER_SALE', businessId: id, stage, status: { in: ['OPEN', 'CLAIMED', 'SUSPENDED'] } }, orderBy: { round: 'desc' } }); return { commandKey: randomUUID(), expectedAfterSaleVersion: a.version, expectedTaskVersion: t.version, reason: '板块15核对' }; }
  async function refundReady(route: 'UNSHIPPED' | 'SHIPPED_ONLY' | 'RETURN') {
    const f = route === 'UNSHIPPED' ? await paid() : await shipped();
    const sales = app.get(AfterSaleService), a = await sales.apply(f.c, { orderId: f.id, type: route === 'RETURN' ? 'RETURN_REFUND' : 'REFUND_ONLY', reasonCode: 'QUALITY', description: '板块15真实退款路线', evidenceFileIds: [], commandKey: randomUUID() });
    const id = a.afterSaleId; await task(id, 'AFTER_SALE_REVIEW', support, 'AFTER_SALE');
    await sales.review(support, id, { ...await saleBody(id, 'AFTER_SALE_REVIEW'), decision: 'APPROVE', publicExplanation: '已核对板块15材料' });
    if (route === 'UNSHIPPED') {
      const t = await task(f.id, 'PHYSICAL_VERIFY'), sale = await db.afterSale.findUniqueOrThrow({ where: { id } }), o = await db.order.findUniqueOrThrow({ where: { id: f.id } }), items = await db.orderItem.findMany({ where: { orderId: f.id } });
      await app.get(UnshippedPhysicalService).check(warehouse, id, { commandKey: randomUUID(), expectedAfterSaleVersion: sale.version, expectedTaskVersion: t.version, expectedPhysicalVersion: o.stockPhysicalVersion, reason: '已停止作业、实际在仓', stoppedAt: clock.now().toISOString(), goodsLocation: '板块15货架', evidenceFileIds: [], items: items.map(i => ({ orderItemId: i.id, sellableQty: i.quantity, damagedQty: 0, incidentItemIds: [] })) });
    } else if (route === 'RETURN') {
      const inspection = app.get(ReturnInspectionService), p = await inspection.prepare(warehouse, id, { commandKey: randomUUID(), expectedAfterSaleVersion: (await db.afterSale.findUniqueOrThrow({ where: { id } })).version, reason: '实际收包准备', sourceNamespace: 'module15', sourceReference: randomUUID() });
      await task(id, 'RETURN_RECEIVE', warehouse, 'AFTER_SALE');
      const r = await inspection.receive(warehouse, id, { ...await saleBody(id, 'RETURN_RECEIVE'), parcelId: p.parcelId!, receivedAt: clock.now().toISOString(), goodsLocation: '板块15暂存架', sourceNote: '实际收到完整包裹', evidenceFileIds: [] });
      await task(id, 'RETURN_INSPECT', warehouse, 'AFTER_SALE');
      const receipt = await db.returnReceipt.findUniqueOrThrow({ where: { id: r.receiptId! } }), items = await db.orderItem.findMany({ where: { orderId: f.id } });
      await inspection.draft(warehouse, id, { ...await saleBody(id, 'RETURN_INSPECT'), receiptId: receipt.id, expectedReceiptVersion: receipt.version, expectedReturnPhysicalVersion: (await db.afterSale.findUniqueOrThrow({ where: { id } })).returnPhysicalVersion, inspectionComplete: true, evidenceFileIds: [], unmatchedItems: [], items: items.map(i => ({ orderItemId: i.id, matchedReceivedQty: i.quantity, sellableQty: i.quantity, unsellableQty: 0, conditionNote: '实收全部可售' })) });
      const receipts = await db.returnReceipt.findMany({ where: { afterSaleId: id } });
      await inspection.final(warehouse, id, { ...await saleBody(id, 'RETURN_INSPECT'), expectedReturnPhysicalVersion: (await db.afterSale.findUniqueOrThrow({ where: { id } })).returnPhysicalVersion, currentRevisionRefs: receipts.flatMap(row => row.currentInspectionRevisionId ? [row.currentInspectionRevisionId] : []) });
    }
    await task(id, 'REFUND_PROCESS', support, 'AFTER_SALE');
    return { ...f, afterSaleId: id, route };
  }
  async function refundBody(id: string) { const a = await db.afterSale.findUniqueOrThrow({ where: { id } }), o = await db.order.findUniqueOrThrow({ where: { id: a.orderId } }); return { ...await saleBody(id, 'REFUND_PROCESS'), ...(a.activeUnshippedCheckId ? { physicalCheckId: a.activeUnshippedCheckId, expectedPhysicalVersion: o.stockPhysicalVersion } : {}), ...(a.finalInspectionId ? { expectedFinalInspectionId: a.finalInspectionId } : {}) }; }
  async function proxy(f: Awaited<ReturnType<typeof paid>>) {
    const c = await db.customer.findUniqueOrThrow({ where: { id: f.c.actor.subjectId } });
    await app.get(CustomerService).change(context(admin), c.id, 'LOGIN_FROZEN', { expectedVersion: c.statusVersion, reason: '板块15代理核实' });
    const comm = await db.$transaction(tx => app.get(CommunicationService).appendCommunication(tx, { identity: support.actor, token: support.token }, { scopeType: 'ORDER', scopeId: f.id, channel: 'PHONE', occurredAt: clock.now(), result: '线下回拨核对，顾客要求售后', publicText: '已核对本次诉求', requestId: randomUUID() }));
    const latest = await db.customer.findUniqueOrThrow({ where: { id: c.id } }), o = await db.order.findUniqueOrThrow({ where: { id: f.id } });
    return app.get(ProxyInputService).create(support, c.id, { orderId: f.id, action: 'APPLY_AFTER_SALE', method: 'PHONE_CALLBACK', verificationSummary: '板块15隔离核实摘要', sourceCommunicationId: comm.id, expectedCustomerStatusVersion: latest.statusVersion, expectedOrderVersion: o.version, commandKey: randomUUID(), reason: '顾客明确提出本次诉求' });
  }
  return { app, db, config, clock, audit, simulator, admin, warehouse, support, context, employee, customer, session, product, receipt, inventoryVersions, quote, ordered, paid, task, orderBody, ready, start, shipped, saleBody, refundReady, refundBody, proxy,
    orders, inventory, refunds: app.get(RefundService), fulfillment, async close() { await app.close(); await db.$disconnect(); } };
}
export type Module15Harness = Awaited<ReturnType<typeof module15Harness>>;

export async function transactionBarrier<T>(h: Module15Harness, lockSql: string, commands: (() => Promise<T>)[], expectedWaiters = commands.length) {
  const holder = new Client({ connectionString: h.config.databaseUrl }), observer = new Client({ connectionString: h.config.databaseUrl });
  await holder.connect(); await observer.connect();
  let work: Promise<PromiseSettledResult<T>[]> | undefined, observed: number;
  const originalTransaction = h.db.$transaction, gateKey = 'module15-barrier:' + randomUUID();
  let entriesRemaining = commands.length;
  try {
    await holder.query('BEGIN'); const { rows } = await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'); const holderPid = rows[0]!.pid;
    await holder.query(lockSql);
    await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text', [gateKey]);
    // Gate before the callback starts its production lock timeout. All commands already own distinct real
    // PostgreSQL transactions when released; the original callback, lock plan and retry policy are unchanged.
    h.db.$transaction = ((callback: unknown, ...args: unknown[]) => {
      if (typeof callback !== 'function' || entriesRemaining <= 0) return Reflect.apply(originalTransaction, h.db, [callback, ...args]);
      entriesRemaining--;
      return Reflect.apply(originalTransaction, h.db, [async (tx: Prisma.TransactionClient) => {
        await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text', gateKey);
        return callback(tx);
      }, ...args]);
    }) as typeof h.db.$transaction;
    work = Promise.allSettled(commands.map(command => command()));
    const deadline = Date.now() + 4000;
    do {
      const count = await observer.query<{ count: number }>('WITH RECURSIVE waiting(pid) AS (SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid=ANY(pg_blocking_pids(a.pid))) SELECT count(DISTINCT pid)::int AS count FROM waiting', [holderPid]);
      observed = count.rows[0]!.count;
      if (observed >= expectedWaiters) break;
      await new Promise(resolveWait => setTimeout(resolveWait, 2));
    } while (Date.now() < deadline);
    await holder.query('COMMIT'); const pending = await work;
    if (observed < expectedWaiters) throw new Error(`Module15 barrier observed ${observed}/${expectedWaiters} real blocked transactions`);
    return { results: pending, observed };
  } finally { h.db.$transaction = originalTransaction; await holder.query('ROLLBACK').catch(() => {}); if (work) await work; await holder.end(); await observer.end(); }
}
export async function module15Evidence(name: string, value: unknown) {
  const directory = resolve('../../docs/verification/evidence/M4-15'); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${name}-${Date.now()}.json`), JSON.stringify(value, null, 2) + '\n');
}
