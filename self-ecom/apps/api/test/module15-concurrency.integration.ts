// Real PostgreSQL barriers and business side-effect assertions for Module15.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { TaskCommandService } from '../src/tasks/task-command.service.js';
import { OrderCommands } from '../src/orders/order-command.service.js';
import { module15Evidence, module15Harness, transactionBarrier, type Module15Harness } from './fixtures/module15-business.js';

let h: Module15Harness;
const evidence: Record<string, unknown>[] = [];
function selectedIt(name: string, run: () => Promise<void>, timeout: number) {
  const pattern = process.env.MODULE15_TEST_NAME_PATTERN;
  return it.skipIf(Boolean(pattern) && !new RegExp(pattern!).test(name))(name, run, timeout);
}
beforeAll(async () => {
  h = await module15Harness(140);
  const rows = await h.db.$queryRaw<{ max: string }[]>`SELECT current_setting('max_connections') AS max`;
  expect(Number(rows[0]!.max), '100 real simultaneous transactions require an isolated PostgreSQL with at least 160 connections').toBeGreaterThanOrEqual(160);
}, 60000);
afterEach(() => { h.audit.failOnce = undefined; h.audit.checkpoint = undefined; h.simulator.mode = 'SUCCESS'; h.clock.fixed = undefined; });
afterAll(async () => { await module15Evidence('concurrency', { kind: 'real-postgresql-business-concurrency', cases: evidence }); await h?.close(); });

selectedIt('IT01: 100 independent customers cross one database barrier for A=10/R=0; every rejected customer keeps cart and has no half state', async () => {
  const p = await h.product(10), requests: Awaited<ReturnType<Module15Harness['quote']>>[] = [];
  for (let index = 0; index < 100; index++) requests.push(await h.quote(p.skuId));
  // Prewarm actual physical connections before the production command's short lock timeout starts.
  await Promise.all(Array.from({ length: 100 }, () => h.db.$transaction(tx => tx.$queryRaw`SELECT pg_sleep(0.08)::text`)));
  const started = Date.now();
  const barrier = await transactionBarrier(h, `SELECT id FROM sku WHERE id='${p.skuId}'::uuid FOR UPDATE`, requests.map(q => () => h.orders.create(q.c, q.input, q.key)));
  const originalInProgress = barrier.results.filter(r => r.status === 'rejected' && r.reason.code === 'REQUEST_IN_PROGRESS').length;
  // The short production lock timeout can return an explicit in-progress result. Recover at most twice using the original complete command and key.
  for (let attempt = 2; attempt <= 3; attempt++) {
    const recover = barrier.results.flatMap((r, index) => r.status === 'rejected' && r.reason.code === 'REQUEST_IN_PROGRESS' ? [index] : []);
    for (const index of recover) {
      const q = requests[index]!;
      try { barrier.results[index] = { status: 'fulfilled', value: await h.orders.create(q.c, q.input, q.key) }; }
      catch (reason) { barrier.results[index] = { status: 'rejected', reason }; }
    }
  }
  const winners = barrier.results.flatMap((r, index) => r.status === 'fulfilled' ? [{ index, value: r.value }] : []);
  expect(winners).toHaveLength(10);
  const losers = barrier.results.flatMap((r, index) => r.status === 'rejected' ? [{ index, code: r.reason.code as string }] : []);
  expect(losers.map(r => r.code)).toEqual(Array(90).fill('STOCK_INSUFFICIENT'));
  expect(await h.db.inventoryBalance.findUnique({ where: { skuId: p.skuId } })).toMatchObject({ available: 0, reserved: 10 });
  for (const rejected of losers) {
    const q = requests[rejected.index]!;
    expect(await h.db.cartItem.findUnique({ where: { id: q.cart.id } })).toEqual(q.cart);
    expect(await h.db.order.count({ where: { customerId: q.c.actor.subjectId } })).toBe(0);
    expect(await h.db.idempotencyRecord.count({ where: { customerId: q.c.actor.subjectId } })).toBe(0);
    expect(await h.db.inventoryAction.count({ where: { actorCustomerId: q.c.actor.subjectId } })).toBe(0);
    expect(await h.db.inventoryLedger.count({ where: { actorCustomerId: q.c.actor.subjectId } })).toBe(0);
    expect(await h.db.auditLog.count({ where: { actorCustomerId: q.c.actor.subjectId, action: 'order.create' } })).toBe(0);
  }
  expect(await h.db.inventoryAction.count({ where: { businessId: { in: winners.map(w => w.value.orderId) }, actionType: 'RESERVE' } })).toBe(10);
  expect(await h.db.inventoryLedger.count({ where: { skuId: p.skuId, eventType: 'RESERVE' } })).toBe(10);
  expect(await h.db.idempotencyRecord.count({ where: { customerId: { in: requests.map(q => q.c.actor.subjectId) }, status: 'PENDING' } })).toBe(0);
  evidence.push({ id: 'IT01', contenders: 100, observedDatabaseWaiters: barrier.observed, originalInProgress, maximumCompleteCommandAttempts: 3, successful: 10, stockRejected: 90, technicalRejected: 0, everyLoserCartUnchanged: true, everyLoserOrderActionLedgerAuditAbsent: true, elapsedMs: Date.now() - started });
}, 180000);

selectedIt('IT02: 20 eligible employees claim one real order Task at its initial version; exactly one history and audit commit', async () => {
  const f = await h.paid(), t = await h.db.task.findFirstOrThrow({ where: { businessType: 'ORDER', businessId: f.id, stage: 'SHIPMENT_PROCESS', status: 'OPEN' } });
  const people = [];
  for (let index = 0; index < 20; index++) people.push(await h.employee());
  const barrier = await transactionBarrier(h, `SELECT id FROM "order" WHERE id='${f.id}'::uuid FOR UPDATE`, people.map(person => () => h.app.get(TaskCommandService).claim(person.actor, person.token, t.id, { expectedVersion: t.version }, randomUUID())));
  expect(barrier.results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(barrier.results.flatMap(r => r.status === 'rejected' ? [r.reason.code] : [])).toEqual(Array(19).fill('TASK_ALREADY_CLAIMED'));
  expect(await h.db.taskHistory.count({ where: { taskId: t.id, action: 'CLAIMED' } })).toBe(1);
  expect(await h.db.auditLog.count({ where: { targetId: t.id, action: 'task.claim' } })).toBe(1);
  expect(await h.db.task.findUnique({ where: { id: t.id } })).toMatchObject({ status: 'CLAIMED', version: t.version + 1 });
  evidence.push({ id: 'IT02', contenders: 20, observedDatabaseWaiters: barrier.observed, successful: 1, legalConflicts: 19, uniqueClaimHistoryAudit: true });
}, 90000);

for (const route of ['UNSHIPPED', 'SHIPPED_ONLY', 'RETURN'] as const) {
  for (const keys of ['SAME', 'DIFFERENT'] as const) {
    selectedIt(`IT03: ${route} refund route, 100 ${keys.toLowerCase()} command keys at one version; one attempt, retained failed keys and one later success`, async () => {
      const f = await h.refundReady(route), body = await h.refundBody(f.afterSaleId), initial = await h.db.inventoryBalance.findUniqueOrThrow({ where: { skuId: f.skuId } });
      h.simulator.mode = 'FAIL_ONCE';
      const bodies = Array.from({ length: 100 }, () => ({ ...body, commandKey: keys === 'SAME' ? body.commandKey : randomUUID() }));
      const barrier = await transactionBarrier(h, `SELECT id FROM "order" WHERE id='${f.id}'::uuid FOR UPDATE`, bodies.map(b => () => h.refunds.execute(h.context(h.support), f.afterSaleId, b)));
      const initialErrorCounts: Record<string, number> = {};
      for (const result of barrier.results) if (result.status === 'rejected') initialErrorCounts[result.reason.code ?? 'UNCLASSIFIED'] = (initialErrorCounts[result.reason.code ?? 'UNCLASSIFIED'] ?? 0) + 1;
      const originalInProgress = initialErrorCounts.REQUEST_IN_PROGRESS ?? 0;
      const successful = barrier.results.flatMap((r, index) => r.status === 'fulfilled' ? [{ index, value: r.value }] : []);
      expect(successful.length).toBeGreaterThanOrEqual(1);
      if (keys === 'DIFFERENT') expect(successful).toHaveLength(1);
      for (const rejected of barrier.results.flatMap(r => r.status === 'rejected' ? [r.reason.code as string] : [])) {
        if (keys === 'SAME') expect(rejected).toBe('REQUEST_IN_PROGRESS');
        else if (rejected !== 'REQUEST_IN_PROGRESS') expect(rejected).toBe('VERSION_CONFLICT');
      }
      const first = successful[0]!, refundId = first.value.refundId!;
      expect(first.value).toMatchObject({ attemptOutcome: 'FAILED', refundStatus: 'FAILED' });
      expect(await h.db.refund.count({ where: { orderId: f.id } })).toBe(1);
      expect(await h.db.refundAttempt.count({ where: { refundId } })).toBe(1);
      expect(await h.db.inventoryBalance.findUniqueOrThrow({ where: { skuId: f.skuId } })).toEqual(initial);
      if (keys === 'DIFFERENT') {
        // Recover only bounded contention, using the complete original key, versions and references.
        // A stale different key must end in VERSION_CONFLICT, never create another refund attempt.
        for (const [index, pending] of barrier.results.entries()) {
          if (pending.status !== 'rejected' || pending.reason.code !== 'REQUEST_IN_PROGRESS') continue;
          for (let attempt = 2; attempt <= 3; attempt++) {
            try { barrier.results[index] = { status: 'fulfilled', value: await h.refunds.execute(h.context(h.support), f.afterSaleId, bodies[index]!, false) }; }
            catch (reason) { barrier.results[index] = { status: 'rejected', reason }; }
            const recovered = barrier.results[index]!;
            if (recovered.status !== 'rejected' || recovered.reason.code !== 'REQUEST_IN_PROGRESS') break;
          }
        }
        expect(barrier.results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
        expect(barrier.results.flatMap(r => r.status === 'rejected' ? [r.reason.code] : [])).toEqual(Array(99).fill('VERSION_CONFLICT'));
        expect(await h.db.refund.count({ where: { orderId: f.id } })).toBe(1);
        expect(await h.db.refundAttempt.count({ where: { refundId } })).toBe(1);
        expect(await h.db.inventoryBalance.findUniqueOrThrow({ where: { skuId: f.skuId } })).toEqual(initial);
      }
      const failedKey = bodies[first.index]!;
      if (keys === 'SAME') {
        // Each in-progress caller recovers its original command after the winner commits.
        const replayed = await Promise.all(bodies.map(b => h.refunds.execute(h.context(h.support), f.afterSaleId, b)));
        expect(new Set(replayed.map(r => r.attemptId)).size).toBe(1);
      }
      await h.task(f.afterSaleId, 'REFUND_PROCESS', h.support, 'AFTER_SALE');
      const result = await h.refunds.execute(h.context(h.support), f.afterSaleId, { ...await h.refundBody(f.afterSaleId), refundId, expectedRefundVersion: first.value.refundVersion! }, true);
      expect(result.attemptOutcome).toBe('SUCCEEDED');
      expect(await h.refunds.execute(h.context(h.support), f.afterSaleId, failedKey)).toMatchObject({ attemptOutcome: 'FAILED', refundStatus: 'SUCCEEDED', replayed: true });
      expect(await h.db.refundAttempt.count({ where: { refundId } })).toBe(2);
      expect(await h.db.refundAttempt.count({ where: { refundId, outcome: 'SUCCEEDED' } })).toBe(1);
      const final = await h.db.inventoryBalance.findUniqueOrThrow({ where: { skuId: f.skuId } });
      expect(final.available).toBe(route === 'UNSHIPPED' ? 10 : initial.available); expect(final.reserved).toBe(0);
      expect(await h.db.inventoryAction.count({ where: { actionKey: 'RESTOCK_UNSHIPPED_REFUND:' + refundId } })).toBe(route === 'UNSHIPPED' ? 1 : 0);
      expect(await h.db.inventoryAction.count({ where: { actionKey: 'RESTOCK_FINAL_INSPECTION:' + f.afterSaleId } })).toBe(route === 'RETURN' ? 1 : 0);
      evidence.push({ id: 'IT03', route, keys, contenders: 100, observedDatabaseWaiters: barrier.observed, initialErrorCounts, originalInProgress, maximumCompleteCommandAttempts: keys === 'DIFFERENT' ? 3 : 2, unrecoveredTechnicalFailures: 0, initialBusinessAttempts: 1, initialFailedAttemptRetained: true, finalSuccessfulAttempts: 1, totalAttempts: 2, stockReturnedExactlyOnce: true });
    }, 180000);
  }
}

for (const keys of ['SAME_BUSINESS', 'DIFFERENT_BUSINESS'] as const) {
  selectedIt(`IT03: 100 manual inventory posts with ${keys.toLowerCase()} keys preserve source consumption, unique action, ledger and completed Task`, async () => {
    const p = await h.product(1), first = await h.receipt(p.skuId, 1, 'same-source-batch'), rows = [first];
    if (keys === 'DIFFERENT_BUSINESS') for (let index = 1; index < 100; index++) rows.push(await h.receipt(p.skuId, 1, 'same-source-batch', first.sourceLineId, await h.employee()));
    const commands = Array.from({ length: 100 }, (_, index) => { const row = keys === 'SAME_BUSINESS' ? first : rows[index]!; return () => h.inventory.post(h.context(row.actor), row.id, row.body); });
    // The shared employee is the first lock in the complete business lock plan.
    const barrier = await transactionBarrier(h, `SELECT id FROM employee WHERE id='${h.warehouse.actor.subjectId}'::uuid FOR UPDATE`, commands);
    const initialErrorCounts: Record<string, number> = {};
    for (const result of barrier.results) if (result.status === 'rejected') initialErrorCounts[result.reason.code ?? 'UNCLASSIFIED'] = (initialErrorCounts[result.reason.code ?? 'UNCLASSIFIED'] ?? 0) + 1;
    // Expired interactive transactions are technical failures, recorded separately. Re-run only the complete original
    // posting command, at most twice, with the same business action key and versions; never treat P2028 as a source rejection.
    for (let attempt = 2; attempt <= 3; attempt++) {
      for (const [index, result] of barrier.results.entries()) {
        if (result.status !== 'rejected' || result.reason.code !== 'P2028') continue;
        try { barrier.results[index] = { status: 'fulfilled', value: await commands[index]!() }; }
        catch (reason) { barrier.results[index] = { status: 'rejected', reason }; }
      }
    }
    const successes = barrier.results.filter(r => r.status === 'fulfilled');
    if (keys === 'SAME_BUSINESS') expect(successes).toHaveLength(100); else expect(successes).toHaveLength(1);
    for (const failure of barrier.results.flatMap(r => r.status === 'rejected' ? [r.reason.code] : [])) expect(['SOURCE_BATCH_ALREADY_POSTED', 'SOURCE_QUANTITY_EXCEEDED']).toContain(failure);
    expect(await h.db.inventoryBalance.findUnique({ where: { skuId: p.skuId } })).toMatchObject({ available: 2, reserved: 0 });
    expect(await h.db.inventoryAction.count({ where: { adjustmentId: { in: rows.map(r => r.id) } } })).toBe(1);
    expect(await h.db.inventoryLedger.count({ where: { skuId: p.skuId, businessId: { in: rows.map(r => r.id) } } })).toBe(1);
    expect(await h.db.inventorySourceLine.findUnique({ where: { id: first.sourceLineId } })).toMatchObject({ netPostedQuantity: 1 });
    expect(await h.db.task.count({ where: { businessType: 'INVENTORY_ADJUSTMENT', businessId: { in: rows.map(r => r.id) }, stage: 'INVENTORY_POST', status: 'COMPLETED' } })).toBe(1);
    evidence.push({ id: 'IT03.inventory', keys, contenders: 100, actors: new Set(rows.map(row => row.actor.actor.subjectId)).size, observedDatabaseWaiters: barrier.observed, initialErrorCounts, maximumCompleteCommandAttempts: 3, unrecoveredTechnicalFailures: 0, successfulBusinessActions: 1, stockDelta: 1, sourceConsumedOnce: true, ledgerRows: 1 });
  }, 180000);
}

selectedIt('IT04: pay/cancel/timeout commit orders preserve one payment, one reserve consumption or one net close and never deduct A twice', async () => {
  const outcomes = [];
  for (const first of ['PAY', 'CANCEL', 'TIMEOUT'] as const) {
    const f = await h.ordered(), o = await h.db.order.findUniqueOrThrow({ where: { id: f.id } }), commands = h.app.get(OrderCommands);
    const at = first === 'TIMEOUT' ? o.paymentDeadline : new Date(+o.paymentDeadline - 1); h.clock.set(at);
    const calls = {
      PAY: () => commands.pay(h.context(f.c), f.id),
      CANCEL: () => commands.cancel(h.context(f.c), f.id),
      TIMEOUT: () => commands.timeout(f.id),
    };
    const initial = await Promise.allSettled([calls[first]()]); expect(initial[0]!.status).toBe('fulfilled');
    const rest = (['PAY', 'CANCEL', 'TIMEOUT'] as const).filter(kind => kind !== first);
    if (first !== 'TIMEOUT') h.clock.set(o.paymentDeadline);
    await transactionBarrier<unknown>(h, `SELECT id FROM "order" WHERE id='${f.id}'::uuid FOR UPDATE`, rest.map(kind => calls[kind]));
    const final = await h.db.order.findUniqueOrThrow({ where: { id: f.id } }), payments = await h.db.payment.findMany({ where: { orderId: f.id }, select: { id: true } });
    const ledger = await h.db.inventoryLedger.findMany({ where: { businessId: { in: [f.id, ...payments.map(payment => payment.id)] } } });
    expect(final.status).toBe(first === 'PAY' ? 'WAIT_SHIPMENT' : 'CLOSED');
    expect(await h.db.payment.count({ where: { orderId: f.id } })).toBe(first === 'PAY' ? 1 : 0);
    expect(ledger.filter(row => row.eventType === 'RESERVE')).toHaveLength(1);
    expect(ledger.filter(row => row.eventType === 'PAY')).toHaveLength(first === 'PAY' ? 1 : 0);
    expect(ledger.filter(row => row.eventType === 'CLOSE')).toHaveLength(first === 'PAY' ? 0 : 1);
    expect(ledger.reduce((sum, row) => sum + row.deltaA, 0)).toBe(first === 'PAY' ? -2 : 0);
    expect(await h.db.inventoryBalance.findUnique({ where: { skuId: f.skuId } })).toMatchObject({ available: first === 'PAY' ? 8 : 10, reserved: 0 });
    outcomes.push({ first, finalStatus: final.status, paymentCount: first === 'PAY' ? 1 : 0, closeCount: first === 'PAY' ? 0 : 1, aDeductedAtMostOnce: true }); h.clock.fixed = undefined;
  }
  evidence.push({ id: 'IT04.pay-cancel-timeout', allowedCommitOrders: outcomes });
}, 180000);

async function customerFacts(customerId: string) {
  const orders = await h.db.order.findMany({ where: { customerId }, orderBy: { id: 'asc' } }), ids = orders.map(row => row.id);
  const tasks = await h.db.task.findMany({ where: { businessType: 'ORDER', businessId: { in: ids } }, orderBy: { id: 'asc' } });
  return {
    orders,
    items: await h.db.orderItem.findMany({ where: { orderId: { in: ids } }, orderBy: { id: 'asc' } }),
    carts: await h.db.cartItem.findMany({ where: { customerId }, orderBy: { id: 'asc' } }),
    keys: await h.db.idempotencyRecord.findMany({ where: { customerId }, orderBy: { id: 'asc' } }),
    payments: await h.db.payment.findMany({ where: { orderId: { in: ids } }, orderBy: { id: 'asc' } }),
    tasks,
    histories: await h.db.taskHistory.findMany({ where: { taskId: { in: tasks.map(task => task.id) } }, orderBy: { id: 'asc' } }),
    actions: await h.db.inventoryAction.findMany({ where: { OR: [{ actorCustomerId: customerId }, { businessId: { in: ids } }] }, orderBy: { id: 'asc' } }),
    ledgers: await h.db.inventoryLedger.findMany({ where: { OR: [{ actorCustomerId: customerId }, { businessId: { in: ids } }] }, orderBy: { id: 'asc' } }),
    states: await h.db.businessStateHistory.findMany({ where: { aggregateId: { in: ids } }, orderBy: { id: 'asc' } }),
    audits: await h.db.auditLog.findMany({ where: { OR: [{ actorCustomerId: customerId }, { targetId: { in: [...ids, ...tasks.map(task => task.id)] } }] }, orderBy: { id: 'asc' } }),
  };
}
for (const checkpoint of [
  { command: 'CREATE', action: 'inventory.action', phase: 'after' },
  { command: 'CREATE', action: 'order.create', phase: 'before' },
  { command: 'CREATE', action: 'order.create', phase: 'after' },
  { command: 'PAY', action: 'task.create', phase: 'after' },
  { command: 'PAY', action: 'order.pay', phase: 'after' },
] as const) {
  selectedIt(`IT06: ${checkpoint.command} fault ${checkpoint.phase} ${checkpoint.action} rolls back every order/stock/task/audit/result side effect`, async () => {
    const p = await h.product(), q = await h.quote(p.skuId, 2);
    const f = checkpoint.command === 'PAY' ? await h.orders.create(q.c, q.input, q.key) : undefined;
    const before = await customerFacts(q.c.actor.subjectId), balance = await h.db.inventoryBalance.findUniqueOrThrow({ where: { skuId: p.skuId } });
    h.audit.failOnce = { action: checkpoint.action, phase: checkpoint.phase };
    const run = () => checkpoint.command === 'CREATE' ? h.orders.create(h.context(q.c), q.input, q.key) : h.app.get(OrderCommands).pay(h.context(q.c), f!.orderId);
    await expect(run()).rejects.toThrow('Module15');
    expect(h.audit.failOnce).toBeUndefined();
    expect(await customerFacts(q.c.actor.subjectId)).toEqual(before);
    expect(await h.db.inventoryBalance.findUniqueOrThrow({ where: { skuId: p.skuId } })).toEqual(balance);
    await run();
    expect(await h.db.idempotencyRecord.count({ where: { customerId: q.c.actor.subjectId, status: 'PENDING' } })).toBe(0);
    evidence.push({ id: 'IT06', ...checkpoint, allBusinessFactsEqualBeforeAfterFailure: true, originalCommandRecovered: true });
  }, 120000);
}
