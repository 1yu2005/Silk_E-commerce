// Test-only process control. No control route is registered in the production HTTP application.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(new URL('../../package.json', import.meta.url));
require('reflect-metadata');
const { Test } = require('@nestjs/testing');
const { AppModule } = require('./dist/app.module.js');
const { APP_CONFIG, loadConfiguration } = require('./dist/config/environment.js');
const { Clock } = require('./dist/common/time/clock.js');
const { AuditService } = require('./dist/audit/audit.service.js');
const { RefundSimulator } = require('./dist/after-sales/refund.service.js');
const { configureApp } = require('./dist/common/configure-app.js');
const { OrderScanner } = require('./dist/orders/order-scanner.service.js');
const { FulfillmentScanner } = require('./dist/orders/fulfillment-scanner.service.js');
const { TaskOverdueScanService } = require('./dist/tasks/task-overdue-scan.service.js');
const { ProxyInputService } = require('./dist/coordination/proxy-input.service.js');
const { PrismaService } = require('./dist/prisma/prisma.service.js');

if (!process.send || process.env.NODE_ENV !== 'test') throw new Error('Module15 requires a test-only IPC process');
const database = new URL(process.env.DATABASE_URL ?? '');
const development = new URL(process.env.DEVELOPMENT_DATABASE_URL ?? '');
if (!/^\/[a-z][a-z0-9_]*_test$/.test(database.pathname) || database.pathname === development.pathname) {
  throw new Error('Module15 requires a distinct isolated test database');
}
const send = value => { if (process.connected) process.send(value); };
class ControlledClock extends Clock {
  fixed = process.env.MODULE15_NOW ? new Date(process.env.MODULE15_NOW) : undefined;
  now() { return this.fixed ? new Date(this.fixed) : new Date(); }
  set(value) { const at = new Date(value); if (!Number.isFinite(+at)) throw new Error('Invalid test clock'); this.fixed = at; return at.toISOString(); }
}
class ControlledSimulator extends RefundSimulator {
  mode = 'SUCCESS';
  execute({ committedAttempts }) {
    return Promise.resolve(this.mode === 'ALWAYS_FAIL' || this.mode === 'FAIL_ONCE' && committedAttempts === 0 ? 'FAILED' : 'SUCCEEDED');
  }
}
class ControlledAudit extends AuditService {
  fault; gate; releases = new Map();
  matches(rule, payload, phase) { return rule && rule.action === payload.action && (!rule.targetId || rule.targetId === payload.targetId) && (rule.phase ?? 'after') === phase; }
  async checkpoint(tx, payload, phase) {
    if (this.matches(this.fault, payload, phase)) { this.fault = undefined; throw new Error('Module15 injected transaction failure'); }
    if (this.matches(this.gate, payload, phase)) {
      const gate = this.gate; this.gate = undefined;
      const [{ pid }] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');
      const waiting = new Promise(resolve => this.releases.set(gate.gateId, resolve));
      send({ event: 'audit.blocked', gateId: gate.gateId, action: payload.action, targetId: payload.targetId, pid, phase });
      await waiting; this.releases.delete(gate.gateId);
    }
  }
  async appendAudit(tx, payload) { await this.checkpoint(tx, payload, 'before'); await super.appendAudit(tx, payload); await this.checkpoint(tx, payload, 'after'); }
}
const clock = new ControlledClock(), audit = new ControlledAudit(), simulator = new ControlledSimulator();
const uploadDir = process.env.MODULE15_UPLOAD_DIR ?? await mkdtemp(join(tmpdir(), 'module15-api-'));
const config = { ...loadConfiguration(), nodeEnv: 'test', uploadDir, logLevel: 'silent' };
const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(APP_CONFIG).useValue(config)
  .overrideProvider(Clock).useValue(clock).overrideProvider(AuditService).useValue(audit).overrideProvider(RefundSimulator).useValue(simulator).compile();
const app = module.createNestApplication({ logger: false });
configureApp(app);
await app.listen(0, process.env.MODULE15_LISTEN_HOST === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1');
const instanceId = randomUUID();
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return; shuttingDown = true;
  for (const release of audit.releases.values()) release();
  await app.close();
}
async function control(op, payload = {}) {
  if (op === 'clock.set') return { now: clock.set(payload.now) };
  if (op === 'clock.advance') {
    if (!Number.isSafeInteger(payload.ms)) throw new Error('Clock advance requires integer milliseconds');
    return { now: clock.set(+clock.now() + payload.ms) };
  }
  if (op === 'clock.wall') { clock.fixed = undefined; return { now: clock.now().toISOString() }; }
  if (op === 'refund.mode') {
    if (!['SUCCESS', 'FAIL_ONCE', 'ALWAYS_FAIL'].includes(payload.mode)) throw new Error('Unsupported refund mode');
    simulator.mode = payload.mode; return { mode: simulator.mode };
  }
  if (op === 'audit.failOnce' || op === 'audit.blockOnce') {
    if (typeof payload.action !== 'string' || !['before', 'after'].includes(payload.phase ?? 'after')) throw new Error('Invalid audit checkpoint');
    if (op === 'audit.failOnce') { audit.fault = payload; return { armed: true }; }
    const gateId = randomUUID(); audit.gate = { ...payload, gateId }; return { gateId };
  }
  if (op === 'audit.release') { const release = audit.releases.get(payload.gateId); if (!release) throw new Error('Audit gate is not blocked'); release(); return { released: true }; }
  if (op === 'audit.clear') { audit.fault = undefined; audit.gate = undefined; return { cleared: true }; }
  if (op === 'probe') {
    const [{ pid: databasePid }] = await app.get(PrismaService).$queryRawUnsafe('SELECT pg_backend_pid() AS pid');
    return { pid: process.pid, databasePid, instanceId, now: clock.now().toISOString() };
  }
  if (op === 'scan') {
    const batch = payload.batchSize ?? 100;
    if (payload.kind === 'payment') return app.get(OrderScanner).scan(batch);
    if (payload.kind === 'receipt' || payload.kind === 'handover') return app.get(FulfillmentScanner).scan(payload.kind, batch);
    if (payload.kind === 'overdue') return app.get(TaskOverdueScanService).scan(batch);
    if (payload.kind === 'proxy') return app.get(ProxyInputService).expire(batch);
    throw new Error('Unsupported scan kind');
  }
  if (op === 'shutdown') { await shutdown(); return { stopped: true }; }
  throw new Error('Unsupported Module15 IPC operation');
}
process.on('message', message => {
  if (!message || typeof message.id !== 'string' || typeof message.op !== 'string') return;
  void control(message.op, message.payload).then(result => {
    send({ id: message.id, ok: true, result });
    if (message.op === 'shutdown') process.disconnect();
  }, error => send({ id: message.id, ok: false, error: { code: error?.code ?? 'MODULE15_CONTROL_FAILED', message: 'Test-only operation failed; inspect isolated evidence' } }));
});
process.on('disconnect', () => { void shutdown().then(() => process.exit(0)); });
const publishedUrl = new URL(await app.getUrl()); publishedUrl.hostname = '127.0.0.1';
send({ event: 'ready', pid: process.pid, baseUrl: publishedUrl.toString().replace(/\/$/, ''), instanceId });
