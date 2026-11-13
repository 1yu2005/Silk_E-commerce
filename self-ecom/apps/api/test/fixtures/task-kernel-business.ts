// 作用：仅在独占库建立真实来源/周期/历史表，验证尚未接入的订单端口；不导入生产模块或新增生产迁移。
import { randomUUID } from 'node:crypto';
import type { Prisma, Task } from '@prisma/client';
import type { TaskBusinessLifecycle, TaskBusinessReference, TaskCommandActor } from '../../src/tasks/task-business-adapters.js';
import type { TaskSourceMetadata, TaskSourceRecord, TaskSourceReference, TaskBusinessSources } from '../../src/tasks/task-source.contract.js';
import { taskActorKey } from '../../src/tasks/task-source.contract.js';
import type { OrderTimerRepository } from '../../src/tasks/order-timer.service.js';
import type { OrderTimerCommand, OrderTimerState } from '../../src/tasks/order-timer.rules.js';
import { TaskError } from '../../src/tasks/task.errors.js';
import { FixtureDeadlineAdapters, installDeadlineFixture } from './task-deadline-business.js';
import { readFixture } from './task-entry-business.js';
export async function installKernelFixture(tx: Prisma.TransactionClient) {
  await installDeadlineFixture(tx);
  await tx.$executeRawUnsafe(`CREATE TABLE kernel_domain_source(id uuid PRIMARY KEY,order_id uuid NOT NULL REFERENCES task_entry_fixture(id),source_type text NOT NULL)`);
  await tx.$executeRawUnsafe(`CREATE TABLE kernel_task_source(task_id uuid NOT NULL REFERENCES task(id),source_type text NOT NULL,source_id uuid NOT NULL REFERENCES kernel_domain_source(id),
    status text NOT NULL CHECK(status IN ('ACTIVE','RESOLVED','CANCELLED')),data jsonb NOT NULL,PRIMARY KEY(task_id,source_type,source_id))`);
  await tx.$executeRawUnsafe(`CREATE TABLE kernel_source_history(id uuid PRIMARY KEY,task_id uuid NOT NULL REFERENCES task(id),source_id uuid NOT NULL REFERENCES kernel_domain_source(id),
    action text NOT NULL,command_key text NOT NULL,request_id uuid NOT NULL,data jsonb NOT NULL,UNIQUE(task_id,source_id,action,command_key))`);
  await tx.$executeRawUnsafe(`CREATE TABLE kernel_timer_order(order_id uuid PRIMARY KEY REFERENCES task_entry_fixture(id),version integer NOT NULL CHECK(version>=0),data jsonb NOT NULL)`);
  await tx.$executeRawUnsafe(`CREATE TABLE kernel_timer_block(order_id uuid NOT NULL REFERENCES kernel_timer_order(order_id),source_type text NOT NULL,source_id uuid NOT NULL REFERENCES kernel_domain_source(id),
    active boolean NOT NULL,released_at timestamptz,PRIMARY KEY(order_id,source_type,source_id),CHECK(active=(released_at IS NULL)))`);
  await tx.$executeRawUnsafe(`CREATE TABLE kernel_timer_pause(order_id uuid NOT NULL REFERENCES kernel_timer_order(order_id),cycle_no integer NOT NULL CHECK(cycle_no>0),
    status text NOT NULL CHECK(status IN ('ACTIVE','RESUMED','TERMINATED')),data jsonb NOT NULL,PRIMARY KEY(order_id,cycle_no))`);
  await tx.$executeRawUnsafe(`CREATE UNIQUE INDEX kernel_timer_one_active ON kernel_timer_pause(order_id) WHERE status='ACTIVE'`);
  await tx.$executeRawUnsafe(`CREATE TABLE kernel_timer_command(order_id uuid NOT NULL REFERENCES kernel_timer_order(order_id),command_key text NOT NULL,signature text NOT NULL,PRIMARY KEY(order_id,command_key))`);
  await tx.$executeRawUnsafe(`CREATE TABLE kernel_timer_history(id uuid PRIMARY KEY,order_id uuid NOT NULL REFERENCES kernel_timer_order(order_id),command_key text NOT NULL,request_id uuid NOT NULL,data jsonb NOT NULL,UNIQUE(order_id,command_key))`);
}
export function reviveTimer(value: OrderTimerState): OrderTimerState {
  const date = (v: Date | null) => v === null ? null : new Date(v);
  return { ...value, updatedAt: new Date(value.updatedAt), actualHandoverAt: date(value.actualHandoverAt), baseDueAt: date(value.baseDueAt), dueAt: date(value.dueAt),
    blocks: value.blocks.map(row => ({ ...row, createdAt: new Date(row.createdAt), releasedAt: date(row.releasedAt) })),
    pauses: value.pauses.map(row => ({ ...row, pausedAt: new Date(row.pausedAt), baseDueAt: new Date(row.baseDueAt), resumedAt: date(row.resumedAt), newDueAt: date(row.newDueAt) })) };
}
async function assertSource(tx: Prisma.TransactionClient, orderId: string, source: TaskSourceReference) {
  const [row] = await tx.$queryRaw<{ order_id: string; source_type: string }[]>`SELECT order_id,source_type FROM kernel_domain_source WHERE id=${source.sourceId}::uuid`;
  if (!row || row.order_id !== orderId || row.source_type !== source.sourceType) throw new TaskError('TASK_SOURCE_CONFLICT');
}
async function sourceHistory(tx: Prisma.TransactionClient, task: Task, source: TaskSourceRecord, metadata: TaskSourceMetadata) {
  await tx.$executeRaw`INSERT INTO kernel_source_history(id,task_id,source_id,action,command_key,request_id,data)
    VALUES(${randomUUID()}::uuid,${task.id}::uuid,${source.sourceId}::uuid,${source.status},${metadata.commandKey},${metadata.requestId}::uuid,${JSON.stringify({ reason: metadata.reason, actor: taskActorKey(metadata.actor), now: metadata.now })}::jsonb)`;
}
export class FixtureKernelAdapters extends FixtureDeadlineAdapters {
  onTransitionCheck?: (tx: Prisma.TransactionClient, task: Task) => Promise<void>;
  onTransitionWrite?: (tx: Prisma.TransactionClient, task: Task) => Promise<void>;
  onSourceWrite?: (tx: Prisma.TransactionClient, task: Task) => Promise<void>;
  onTimerWrite?: (tx: Prisma.TransactionClient, state: OrderTimerState) => Promise<void>;
  onAuthorize?: (tx: Prisma.TransactionClient, reference: TaskBusinessReference, actor: TaskCommandActor) => Promise<void>;
  override async authorize(tx: Prisma.TransactionClient, reference: TaskBusinessReference, actor: TaskCommandActor) {
    await this.onAuthorize?.(tx, reference, actor);
    if (actor.subjectType === 'EMPLOYEE' && reference.businessType === 'ORDER' && actor.effectivePermissions.includes('order.fulfillment.read')) {
      await readFixture(tx, reference.businessId); return;
    }
    return super.authorize(tx, reference, actor);
  }
  constructor() {
    super();
    const lifecycle: TaskBusinessLifecycle = {
      assertTransition: async (tx, _actor, task) => {
        await this.onTransitionCheck?.(tx, task); if ((await readFixture(tx, task.businessId)).blocked) throw new TaskError('TASK_TRANSITION_BLOCKED');
      },
      applyTransition: async (tx, _actor, task, action) => {
        await tx.$executeRaw`UPDATE task_entry_fixture SET progress=progress+1 WHERE id=${task.businessId}::uuid`;
        await tx.$executeRaw`INSERT INTO task_handoff_fixture(task_id,assignee_id,domain_state,changes) VALUES(${task.id}::uuid,NULL,${action},1)
          ON CONFLICT(task_id) DO UPDATE SET assignee_id=NULL,domain_state=${action},changes=task_handoff_fixture.changes+1`;
        await this.onTransitionWrite?.(tx, task);
      },
    };
    const sources: TaskBusinessSources = {
      assertSource: (tx, _actor, task, source) => assertSource(tx, task.businessId, source),
      find: async (tx, task, source) => (await tx.$queryRaw<{ data: TaskSourceRecord }[]>`SELECT data FROM kernel_task_source WHERE task_id=${task.id}::uuid AND source_type=${source.sourceType} AND source_id=${source.sourceId}::uuid`)[0]?.data ?? null,
      listActive: async (tx, task) => (await tx.$queryRaw<{ data: TaskSourceRecord }[]>`SELECT data FROM kernel_task_source WHERE task_id=${task.id}::uuid AND status='ACTIVE' ORDER BY source_type,source_id`).map(row => row.data),
      add: async (tx, task, source, meta) => {
        const record: TaskSourceRecord = { ...source, taskId: task.id, status: 'ACTIVE', addCommandKey: meta.commandKey, addReason: meta.reason, addActorKey: taskActorKey(meta.actor),
          resolutionCommandKey: null, resolutionReason: null, resolutionActorKey: null, resolutionOutcome: null };
        await tx.$executeRaw`INSERT INTO kernel_task_source(task_id,source_type,source_id,status,data) VALUES(${task.id}::uuid,${source.sourceType},${source.sourceId}::uuid,'ACTIVE',${JSON.stringify(record)}::jsonb)`;
        await sourceHistory(tx, task, record, meta); await this.onSourceWrite?.(tx, task); return record;
      },
      finish: async (tx, task, source, status, meta) => {
        await tx.$queryRaw`SELECT source_id FROM kernel_task_source WHERE task_id=${task.id}::uuid ORDER BY source_type,source_id FOR UPDATE`;
        const record: TaskSourceRecord = { ...source, status, resolutionCommandKey: meta.commandKey, resolutionReason: meta.reason,
          resolutionActorKey: taskActorKey(meta.actor), resolutionOutcome: meta.outcome ?? null };
        await tx.$executeRaw`UPDATE kernel_task_source SET status=${status},data=${JSON.stringify(record)}::jsonb WHERE task_id=${task.id}::uuid AND source_type=${source.sourceType} AND source_id=${source.sourceId}::uuid`;
        await sourceHistory(tx, task, record, meta); await this.onSourceWrite?.(tx, task); return record;
      },
    };
    for (const type of ['ORDER', 'AFTER_SALE', 'INVENTORY_ADJUSTMENT', 'OFFLINE_CASE'] as const) { this.registerLifecycle(type, lifecycle); this.registerSources(type, sources); }
  }
  readonly timerRepository: OrderTimerRepository = {
    assertAllowed: async (tx, _actor, id, command) => {
      if ((await readFixture(tx, id)).blocked) throw new TaskError('ORDER_TIMER_BLOCKED');
      if (command.action === 'ADD_BLOCK' || command.action === 'RELEASE_BLOCK') await assertSource(tx, id, command.source);
    },
    load: async (tx, id) => {
      const [row] = await tx.$queryRaw<{ data: OrderTimerState }[]>`SELECT data FROM kernel_timer_order WHERE order_id=${id}::uuid`;
      if (!row) throw new TaskError('ORDER_TIMER_STATE_INVALID'); return reviveTimer(row.data);
    },
    save: async (tx, state, expectedVersion, command: OrderTimerCommand, actor: TaskCommandActor, requestId) => {
      if (await tx.$executeRaw`UPDATE kernel_timer_order SET version=${state.version},data=${JSON.stringify(state)}::jsonb WHERE order_id=${state.orderId}::uuid AND version=${expectedVersion}` !== 1) throw new TaskError('VERSION_CONFLICT');
      for (const row of state.blocks) await tx.$executeRaw`INSERT INTO kernel_timer_block(order_id,source_type,source_id,active,released_at) VALUES(${state.orderId}::uuid,${row.sourceType},${row.sourceId}::uuid,${row.active},${row.releasedAt})
        ON CONFLICT(order_id,source_type,source_id) DO UPDATE SET active=EXCLUDED.active,released_at=EXCLUDED.released_at`;
      for (const row of state.pauses) await tx.$executeRaw`INSERT INTO kernel_timer_pause(order_id,cycle_no,status,data) VALUES(${state.orderId}::uuid,${row.cycleNo},${row.status},${JSON.stringify(row)}::jsonb)
        ON CONFLICT(order_id,cycle_no) DO UPDATE SET status=EXCLUDED.status,data=EXCLUDED.data`;
      for (const row of state.commandReceipts) await tx.$executeRaw`INSERT INTO kernel_timer_command(order_id,command_key,signature) VALUES(${state.orderId}::uuid,${row.key},${row.signature}) ON CONFLICT DO NOTHING`;
      await tx.$executeRaw`INSERT INTO kernel_timer_history(id,order_id,command_key,request_id,data) VALUES(${randomUUID()}::uuid,${state.orderId}::uuid,${command.commandKey},${requestId}::uuid,${JSON.stringify({ action: command.action, actor: taskActorKey(actor), version: state.version })}::jsonb)`;
      await this.onTimerWrite?.(tx, state);
    },
  };
}
