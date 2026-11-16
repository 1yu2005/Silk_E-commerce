// Two independent OS API processes share only a fresh isolated PostgreSQL database.
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { calculateDeadline, isDeadlineReached } from '../src/common/time/deadline.js';
import { StockIncidents } from '../src/orders/stock-incident.service.js';
import { AfterSaleService } from '../src/after-sales/after-sale.service.js';
import { module15Evidence, module15Harness, type Module15Harness } from './fixtures/module15-business.js';
import { startModule15Process, type Module15Process } from './fixtures/module15-process-host.mjs';

let h: Module15Harness, processes: Module15Process[] = [];
const evidence: Record<string, unknown>[] = [];
function selectedIt(name: string, run: () => Promise<void>, timeout: number) {
  const pattern = process.env.MODULE15_TEST_NAME_PATTERN;
  return it.skipIf(Boolean(pattern) && !new RegExp(pattern!).test(name))(name, run, timeout);
}
async function pair(now?: Date) {
  const env = { ...process.env, ...(now ? { MODULE15_NOW: now.toISOString() } : {}) };
  const a = await startModule15Process({ env }); processes.push(a);
  const b = await startModule15Process({ env }); processes.push(b);
  expect(a.pid).not.toBe(b.pid); expect(a.instanceId).not.toBe(b.instanceId);
  return [a, b] as const;
}
async function stopAll() { for (const process of processes) await process.stop(); processes = []; }
beforeAll(async () => { h = await module15Harness(); }, 60000);
afterEach(async () => { await stopAll(); h.clock.fixed = undefined; h.audit.failOnce = undefined; });
afterAll(async () => { await module15Evidence('scheduler', { kind: 'two-independent-os-processes', cases: evidence }); await h?.close(); });

selectedIt('Proxy expiry isolates a failed first item, continues across pages, retries in the other OS process, and never recreates a Task', async () => {
  const f = await h.paid(), contexts = [];
  for (let index = 0; index < 3; index++) contexts.push(await h.proxy(f));
  const ids = contexts.map(c => c.proxyContextId).sort(), at = new Date(Math.max(...contexts.map(c => +new Date(c.expiresAt))) + 1);
  const [a, b] = await pair(at);
  await a.rpc('audit.failOnce', { action: 'coordination.change', targetId: ids[0], phase: 'after' });
  let changed: unknown, threw = false;
  try { changed = await a.rpc('scan', { kind: 'proxy', batchSize: 2 }); } catch { threw = true; }
  const rows = await h.db.proxyContext.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' }, select: { status: true } });
  const observation = { id: 'proxy-single-item-failure', osProcessCount: 2, batchSize: 2, candidates: 3, threw, scan: changed ?? null, statuses: rows.map(r => r.status) };
  evidence.push(observation); await module15Evidence('proxy-single-failure-observation', observation);
  // Retain this assertion: a thrown failure here is the original production defect, not a reason to weaken acceptance.
  expect(threw, 'One failed ProxyContext must roll back only itself and must not starve later pages').toBe(false);
  expect(rows.map(r => r.status)).toEqual(['VERIFIED', 'INVALIDATED', 'INVALIDATED']);
  const firstRun = await h.db.schedulerRun.findFirstOrThrow({ where: { jobName: 'proxy-context-expiry' }, orderBy: { startedAt: 'desc' } });
  expect(firstRun).toMatchObject({ status: 'PARTIAL_FAILED', scannedCount: 3, changedCount: 2, failedCount: 1 });
  const failures = await h.db.schedulerFailure.findMany({ where: { runId: firstRun.id } });
  expect(failures).toHaveLength(1); expect(failures[0]!.errorCode).toBe('PROXY_EXPIRY_FAILED');
  expect(JSON.stringify(failures)).not.toMatch(/postgres(?:ql)?:\/\/|eyJ[A-Za-z0-9_-]{10,}|password|secret/i);
  evidence.push({ id: 'proxy-single-item-failure-run', status: firstRun.status, scannedCount: firstRun.scannedCount, changedCount: firstRun.changedCount, failedCount: firstRun.failedCount, safeFailureRecords: failures.length });
  expect(await b.rpc('scan', { kind: 'proxy', batchSize: 2 })).toMatchObject({ changed: 1 });
  expect(await a.rpc('scan', { kind: 'proxy', batchSize: 2 })).toMatchObject({ changed: 0 });
  expect(await h.db.task.count({ where: { businessId: f.id, stage: 'PROXY_INPUT' } })).toBe(1);
  expect(await h.db.taskBusinessSource.count({ where: { sourceType: 'PROXY_CONTEXT', sourceId: { in: ids }, status: 'ACTIVE' } })).toBe(0);
}, 180000);

selectedIt('payment timeout crosses 100, preserves unknown loss, rolls back one failed close, and catches up after both processes stop', async () => {
  const p = await h.product(110), orders = [];
  for (let index = 0; index < 102; index++) orders.push(await h.ordered(p, 1));
  const ordered = await h.db.order.findMany({ where: { id: { in: orders.map(o => o.id) } }, orderBy: [{ paymentDeadline: 'asc' }, { id: 'asc' }] });
  const unknown = orders.find(o => o.id === ordered[0]!.id)!, item = await h.db.orderItem.findFirstOrThrow({ where: { orderId: unknown.id } });
  await h.app.get(StockIncidents).create(h.context(h.warehouse), { incidentKey: randomUUID(), skuId: p.skuId, reason: '实际损耗仍未知，不得盲目回池', evidenceNote: '隔离损耗待核实', items: [{ orderItemId: item.id }] });
  const firstPair = await pair(); const oldPids = firstPair.map(process => process.pid); await stopAll();
  const at = new Date(Math.max(...ordered.map(o => +o.paymentDeadline)) + 60000), [a, b] = await pair(at);
  await a.rpc('audit.failOnce', { action: 'order.close', targetId: ordered[1]!.id, phase: 'after' });
  const first = await a.rpc('scan', { kind: 'payment', batchSize: 100 });
  expect(first).toMatchObject({ changedCount: 100, failedCount: 1, blockedCount: 1 });
  expect(await h.db.order.findUnique({ where: { id: unknown.id } })).toMatchObject({ status: 'WAIT_PAYMENT' });
  expect(await h.db.order.findUnique({ where: { id: ordered[1]!.id } })).toMatchObject({ status: 'WAIT_PAYMENT' });
  const concurrent = await Promise.all([a.rpc('scan', { kind: 'payment', batchSize: 100 }), b.rpc('scan', { kind: 'payment', batchSize: 100 })]);
  expect(await h.db.order.count({ where: { id: { in: orders.map(o => o.id) }, status: 'CLOSED' } })).toBe(101);
  expect(await h.db.inventoryBalance.findUnique({ where: { skuId: p.skuId } })).toMatchObject({ available: 109, reserved: 1 });
  expect(await h.db.inventoryLedger.count({ where: { skuId: p.skuId, eventType: 'CLOSE' } })).toBe(101);
  expect(await h.db.auditLog.count({ where: { targetId: { in: orders.map(o => o.id) }, action: 'order.close' } })).toBe(101);
  const runs = await h.db.schedulerRun.findMany({ where: { jobName: 'order-payment-timeout' } });
  expect(new Set(runs.map(run => run.instanceId)).size).toBeGreaterThanOrEqual(2);
  evidence.push({ id: 'payment-two-process-catchup', candidates: 102, batchSize: 100, stoppedProcessIds: oldPids, restartedProcessIds: [a.pid, b.pid], first, concurrent, closed: 101, unknownLossHeld: 1, uniqueCloseLedgersAndAudits: 101 });
}, 360000);

selectedIt('automatic receipt catches up 102 real shipped orders, continues past a failed first item and records processing time at equality', async () => {
  const p = await h.product(110), orders = [];
  for (let index = 0; index < 102; index++) orders.push(await h.shipped(await h.paid(p, 1)));
  const rows = await h.db.order.findMany({ where: { id: { in: orders.map(o => o.id) } }, orderBy: { id: 'asc' } });
  const [oldA, oldB] = await pair(); const stopped = [oldA.pid, oldB.pid]; await stopAll();
  const at = new Date(Math.max(...rows.map(row => +row.autoReceiptDueAt!))), [a, b] = await pair(at);
  await a.rpc('audit.failOnce', { action: 'order.receipt', targetId: rows[0]!.id, phase: 'after' });
  const first = await a.rpc('scan', { kind: 'receipt', batchSize: 100 });
  expect(first).toMatchObject({ changedCount: 101, failedCount: 1 });
  expect(await h.db.order.findUnique({ where: { id: rows[0]!.id } })).toMatchObject({ status: 'SHIPPED', completedAt: null });
  const concurrent = await Promise.all([a.rpc('scan', { kind: 'receipt', batchSize: 100 }), b.rpc('scan', { kind: 'receipt', batchSize: 100 })]);
  const completed = await h.db.order.findMany({ where: { id: { in: orders.map(o => o.id) } } });
  expect(completed.every(row => row.status === 'COMPLETED' && +row.completedAt! === +at)).toBe(true);
  expect(await h.db.auditLog.count({ where: { targetId: { in: orders.map(o => o.id) }, action: 'order.receipt' } })).toBe(102);
  expect(await a.rpc('scan', { kind: 'receipt' })).toMatchObject({ changedCount: 0 });
  const final = await h.db.order.findUniqueOrThrow({ where: { id: rows[0]!.id } });
  await a.rpc('clock.advance', { ms: 30 * 86400000 }); await a.rpc('scan', { kind: 'receipt' });
  expect(await h.db.order.findUnique({ where: { id: final.id } })).toEqual(final);
  evidence.push({ id: 'receipt-two-process-catchup', candidates: 102, batchSize: 100, stoppedProcessIds: stopped, restartedProcessIds: [a.pid, b.pid], first, concurrent, exactlyOneReceiptEach: true, completedAtEqualsProcessingTime: at.toISOString(), completedNeverDowngraded: true });
}, 600000);

selectedIt('handover recovery crosses 100 after downtime, continues after one transactional fault, and preserves UNKNOWN as investigation', async () => {
  const p = await h.product(110), orders = [];
  for (let index = 0; index < 102; index++) orders.push(await h.start(await h.paid(p, 1)));
  const attempts = await h.db.handoverAttempt.findMany({ where: { orderId: { in: orders.map(o => o.id) } }, orderBy: { orderId: 'asc' } });
  await pair(); await stopAll();
  const at = new Date(Math.max(...attempts.map(attempt => +attempt.uncertainAfter))), [a, b] = await pair(at);
  await a.rpc('audit.failOnce', { action: 'order.fulfillment', targetId: attempts[0]!.orderId, phase: 'after' });
  const first = await a.rpc('scan', { kind: 'handover', batchSize: 100 }); expect(first).toMatchObject({ changedCount: 101, failedCount: 1 });
  const concurrent = await Promise.all([a.rpc('scan', { kind: 'handover' }), b.rpc('scan', { kind: 'handover' })]);
  expect(await h.db.handoverAttempt.count({ where: { orderId: { in: orders.map(o => o.id) }, status: 'UNCERTAIN' } })).toBe(102);
  expect(await h.db.order.count({ where: { id: { in: orders.map(o => o.id) }, status: 'WAIT_SHIPMENT', actualHandoverAt: null } })).toBe(102);
  expect(await h.db.task.count({ where: { businessId: { in: orders.map(o => o.id) }, stage: 'HANDOVER_VERIFY' } })).toBe(102);
  expect(await h.db.handoverVerification.count({ where: { orderId: { in: orders.map(o => o.id) }, conclusion: 'NOT_HANDED_OVER' } })).toBe(0);
  expect(await a.rpc('scan', { kind: 'handover' })).toMatchObject({ changedCount: 0 });
  evidence.push({ id: 'handover-two-process-catchup', candidates: 102, batchSize: 100, first, concurrent, exactlyOneInvestigationTaskEach: true, unknownNeverAssumedNotHanded: true });
}, 600000);

selectedIt('overdue scanning records all 102 real Tasks after downtime, keeps occurredAt=old due and detectedAt=discovery, and never duplicates', async () => {
  const p = await h.product(110), sales = [];
  for (let index = 0; index < 102; index++) {
    const f = await h.paid(p, 1);
    sales.push(await h.app.get(AfterSaleService).apply(f.c, { orderId: f.id, type: 'REFUND_ONLY', reasonCode: 'QUALITY', description: '真实审核任务超期样本', evidenceFileIds: [], commandKey: randomUUID() }));
  }
  const tasks = await h.db.task.findMany({ where: { businessType: 'AFTER_SALE', businessId: { in: sales.map(sale => sale.afterSaleId) }, stage: 'AFTER_SALE_REVIEW' }, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }] });
  expect(tasks.every(task => task.dueAt !== null)).toBe(true);
  await pair(); await stopAll(); const at = new Date(Math.max(...tasks.map(task => +task.dueAt!)) + 2 * 86400000), [a, b] = await pair(at);
  await a.rpc('audit.failOnce', { action: 'task.overdue.record', targetId: tasks[0]!.id, phase: 'after' });
  const first = await a.rpc('scan', { kind: 'overdue', batchSize: 100 });
  expect((first.changedCount as number)).toBeGreaterThanOrEqual(101); expect(first.failedCount).toBe(1);
  const concurrent = await Promise.all([a.rpc('scan', { kind: 'overdue' }), b.rpc('scan', { kind: 'overdue' })]);
  const events = await h.db.deadlineEvent.findMany({ where: { taskId: { in: tasks.map(task => task.id) }, eventType: 'OVERDUE' } });
  expect(events).toHaveLength(102);
  for (const event of events) { const task = tasks.find(row => row.id === event.taskId)!; expect(+event.occurredAt).toBe(+task.dueAt!); expect(+event.detectedAt).toBe(+at); }
  expect(await a.rpc('scan', { kind: 'overdue' })).toMatchObject({ changedCount: 0 });
  evidence.push({ id: 'overdue-two-process-catchup', candidates: 102, batchSize: 100, first, concurrent, uniqueOverdueEvents: 102, occurredAtUsesOldDeadline: true, detectedAt: at.toISOString() });
}, 360000);

selectedIt('ProxyContext expiry catches up 102 sources across the default 100 page after downtime; concurrent processes invalidate each source once', async () => {
  const f = await h.paid(), contexts = [];
  for (let index = 0; index < 102; index++) contexts.push(await h.proxy(f));
  await pair(); await stopAll(); const at = new Date(Math.max(...contexts.map(context => +new Date(context.expiresAt)))), [a, b] = await pair(at);
  const concurrent = await Promise.all([a.rpc('scan', { kind: 'proxy', batchSize: 100 }), b.rpc('scan', { kind: 'proxy', batchSize: 100 })]);
  const ids = contexts.map(context => context.proxyContextId);
  expect(await h.db.proxyContext.count({ where: { id: { in: ids }, status: 'INVALIDATED' } })).toBe(102);
  expect(await h.db.auditLog.count({ where: { targetId: { in: ids }, action: 'coordination.change', afterData: { path: ['coordinationAction'], equals: 'proxy-context-invalidated' } } })).toBe(102);
  expect(await h.db.task.count({ where: { businessId: f.id, stage: 'PROXY_INPUT' } })).toBe(1);
  expect(await a.rpc('scan', { kind: 'proxy' })).toMatchObject({ changed: 0 });
  evidence.push({ id: 'proxy-two-process-catchup', candidates: 102, batchSize: 100, concurrent, uniqueInvalidationAudits: 102, singleTaskRound: true });
}, 360000);

selectedIt('Clock calendar covers exact equality, Friday+2 workdays, Saturday+1 workday and Beijing midnight without changing the host clock', async () => {
  const friday = new Date('2026-11-13T16:00:00+08:00'), saturday = new Date('2026-11-14T09:30:00+08:00');
  expect(calculateDeadline(friday, { unit: 'WORKDAY', amount: 2 }).toISOString()).toBe('2026-11-17T08:00:00.000Z');
  expect(calculateDeadline(saturday, { unit: 'WORKDAY', amount: 1 }).toISOString()).toBe('2026-11-16T01:30:00.000Z');
  expect(calculateDeadline(new Date('2026-11-14T15:59:59.999Z'), { unit: 'MINUTE', amount: 1 }).toISOString()).toBe('2026-11-14T16:00:59.999Z');
  const due = new Date('2026-11-14T16:00:00.000Z'); expect(isDeadlineReached(due, due)).toBe(true); expect(isDeadlineReached(new Date(+due - 1), due)).toBe(false);
  const f = await h.ordered(), order = await h.db.order.findUniqueOrThrow({ where: { id: f.id } }), [a, b] = await pair(new Date(+order.paymentDeadline - 1));
  expect(await a.rpc('scan', { kind: 'payment' })).toMatchObject({ changedCount: 0 });
  await b.rpc('clock.set', { now: order.paymentDeadline.toISOString() }); await b.rpc('scan', { kind: 'payment' });
  expect(await h.db.order.findUnique({ where: { id: f.id } })).toMatchObject({ status: 'CLOSED' });
  evidence.push({ id: 'clock-boundaries', exactDeadlineReached: true, beforeDeadlineUnchanged: true, fridayPlusTwoTuesday: true, saturdayPlusOneMonday: true, beijingMidnight: true });
}, 120000);

selectedIt('test-only audit barrier terminates a real pre-commit confirm transaction; original key recovers without inventing a not-handed fact', async () => {
  const f = await h.start(), body = { ...await h.orderBody(f.id), attemptId: f.attempt.attemptId!, expectedAttemptVersion: f.attempt.attemptVersion!, actualHandoverAt: h.clock.now().toISOString() }, [a] = await pair();
  const gate = await a.rpc<{ gateId: string }>('audit.blockOnce', { action: 'order.fulfillment', targetId: f.id, phase: 'after' });
  const blocked = a.waitFor<{ gateId: string; pid: number }>('audit.blocked', event => event.gateId === gate.gateId);
  const response = fetch(a.baseUrl + '/api/v1/admin/orders/' + f.id + '/fulfillment/confirm-handover', { method: 'POST', headers: { Authorization: 'Bearer ' + h.warehouse.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const checkpoint = await blocked, killer = new Client({ connectionString: h.config.databaseUrl }); await killer.connect();
  try { await killer.query('SELECT pg_terminate_backend($1)', [checkpoint.pid]); } finally { await killer.end(); }
  await a.rpc('audit.release', { gateId: gate.gateId }); const failed = await response; expect(failed.status).toBeGreaterThanOrEqual(400);
  expect(await h.db.order.findUnique({ where: { id: f.id } })).toMatchObject({ status: 'WAIT_SHIPMENT', actualHandoverAt: null });
  expect(await h.db.handoverAttempt.findUnique({ where: { id: f.attempt.attemptId! } })).toMatchObject({ status: 'IN_PROGRESS' });
  expect(await h.db.handoverVerification.count({ where: { orderId: f.id } })).toBe(0);
  const success = await h.fulfillment.confirm(h.context(h.warehouse), f.id, body); expect(success.orderStatus).toBe('SHIPPED');
  expect(await h.db.handoverVerification.count({ where: { orderId: f.id, conclusion: 'HANDED_OVER' } })).toBe(1);
  expect(await h.fulfillment.confirm(h.context(h.warehouse), f.id, body)).toMatchObject({ replayed: true });
  evidence.push({ id: 'precommit-confirm-disconnect', actualTransactionTerminated: true, rollbackVerified: true, attemptRemainedPending: true, originalKeyRecoveredOnce: true });
}, 120000);
