// 作用：仅在本轮隔离库创建真实锁行和领域状态，替代尚不存在的订单/售后模型；不注册生产业务或造数接口。
import { randomUUID } from 'node:crypto';
import type { Prisma, Task, TaskBusinessType } from '@prisma/client';
import { AccessDeniedError } from '../../src/auth/access-denied.error.js';
import { TaskBusinessAdapters, type TaskBusinessAdapter, type TaskBusinessReference, type TaskCommandActor,
  type TaskEntryDecision, type TaskLockResource, type TaskStageEntry } from '../../src/tasks/task-business-adapters.js';
import { TaskError } from '../../src/tasks/task.errors.js';

export interface FixtureBusiness {
  id: string; businessType: TaskBusinessType; customerId: string; orderId: string | null;
  startedAt: Date; allowedStage: string; progress: number; blocked: boolean; allowSystem: boolean;
  replaceActive: boolean; outcome: 'COMPLETED' | 'CANCELLED'; expectedTaskId: string | null; expectedVersion: number | null;
  extraLocks: TaskLockResource[];
}
const select = `SELECT id,business_type AS "businessType", customer_id AS "customerId", order_id AS "orderId", started_at AS "startedAt",
  allowed_stage AS "allowedStage", progress, blocked, allow_system AS "allowSystem", replace_active AS "replaceActive", outcome,
  expected_task_id AS "expectedTaskId", expected_version AS "expectedVersion", extra_locks AS "extraLocks" FROM task_entry_fixture`;
export async function readFixture(tx: Prisma.TransactionClient, id: string): Promise<FixtureBusiness> {
  const rows = await tx.$queryRawUnsafe<FixtureBusiness[]>(`${select} WHERE id=$1::uuid`, id);
  if (!rows[0]) throw new TaskError('TASK_ENTRY_BLOCKED'); return rows[0];
}
export async function createFixture(tx: Prisma.TransactionClient, customerId: string, patch: Partial<FixtureBusiness> = {}) {
  const row: FixtureBusiness = { id: randomUUID(), customerId, businessType: 'AFTER_SALE', orderId: null, startedAt: new Date('2026-11-13T02:00:00Z'),
    allowedStage: 'AFTER_SALE_REVIEW', progress: 0, blocked: false, allowSystem: true, replaceActive: false, outcome: 'CANCELLED',
    expectedTaskId: null, expectedVersion: null, extraLocks: [], ...patch };
  await tx.$executeRaw`INSERT INTO task_entry_fixture(id,business_type,customer_id,order_id,started_at,allowed_stage,progress,blocked,allow_system,
    replace_active,outcome,expected_task_id,expected_version,extra_locks) VALUES(${row.id}::uuid,${row.businessType},${row.customerId}::uuid,
    ${row.orderId}::uuid,${row.startedAt},${row.allowedStage},${row.progress},${row.blocked},${row.allowSystem},${row.replaceActive},${row.outcome},
    ${row.expectedTaskId}::uuid,${row.expectedVersion},${JSON.stringify(row.extraLocks)}::jsonb)`;
  return row;
}
export async function installFixtureTables(tx: Prisma.TransactionClient) {
  await tx.$executeRawUnsafe(`CREATE TABLE task_entry_fixture(id uuid PRIMARY KEY,business_type text NOT NULL,
    customer_id uuid NOT NULL REFERENCES customer(id),order_id uuid REFERENCES task_entry_fixture(id),started_at timestamptz NOT NULL,
    allowed_stage text NOT NULL,progress integer NOT NULL DEFAULT 0,blocked boolean NOT NULL DEFAULT false,allow_system boolean NOT NULL DEFAULT true,
    replace_active boolean NOT NULL DEFAULT false,outcome text NOT NULL,expected_task_id uuid,expected_version integer,extra_locks jsonb NOT NULL)`);
  await tx.$executeRawUnsafe('CREATE TABLE task_entry_fixture_resource(id uuid PRIMARY KEY,kind text NOT NULL)');
}

export class FixtureTaskAdapters extends TaskBusinessAdapters implements TaskBusinessAdapter {
  onPlan: (() => Promise<void>) | undefined;
  onResolve: (() => Promise<void>) | undefined;
  constructor() {
    super();
    for (const type of ['ORDER', 'AFTER_SALE', 'INVENTORY_ADJUSTMENT', 'OFFLINE_CASE'] as const) {
      this.registerBusiness(type, this);
      this.registerLocker(type, async (tx, id) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM task_entry_fixture WHERE id=${id}::uuid AND business_type=${type} FOR UPDATE`;
        if (rows.length !== 1) throw new TaskError('TASK_ENTRY_BLOCKED');
      });
    }
    this.registerLocker('SKU_STOCK', async (tx, id) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM task_entry_fixture_resource WHERE id=${id}::uuid AND kind='SKU_STOCK' FOR UPDATE`;
      if (rows.length !== 1) throw new TaskError('TASK_ENTRY_BLOCKED');
    });
  }
  async planLocks(tx: Prisma.TransactionClient, reference: TaskBusinessReference) {
    const root = await readFixture(tx, reference.businessId);
    if (root.businessType !== reference.businessType) throw new TaskError('TASK_ENTRY_BLOCKED');
    await this.onPlan?.();
    return [{ kind: 'CUSTOMER' as const, id: root.customerId }, ...(root.orderId ? [{ kind: 'ORDER' as const, id: root.orderId }] : []),
      { kind: root.businessType, id: root.id }, ...root.extraLocks];
  }
  async authorize(tx: Prisma.TransactionClient, reference: TaskBusinessReference, actor: TaskCommandActor) {
    const root = await readFixture(tx, reference.businessId);
    if (actor.subjectType === 'SYSTEM') { if (!root.allowSystem) throw new TaskError('TASK_ENTRY_BLOCKED'); return; }
    if (actor.subjectType === 'CUSTOMER') { if (actor.subjectId !== root.customerId) throw new AccessDeniedError('FORBIDDEN'); return; }
    const permission = reference.businessType === 'AFTER_SALE' ? 'after-sale.service.read' : reference.businessType === 'INVENTORY_ADJUSTMENT' ? 'inventory.read' : 'order.service.read';
    if (!actor.effectivePermissions.includes(permission)) throw new AccessDeniedError('FORBIDDEN');
  }
  async resolveEntry(tx: Prisma.TransactionClient, entry: TaskStageEntry, _actor: TaskCommandActor, active: Task | null): Promise<TaskEntryDecision> {
    const root = await readFixture(tx, entry.businessId); await this.onResolve?.();
    if (root.blocked || root.allowedStage !== entry.stage) throw new TaskError('TASK_ENTRY_BLOCKED');
    return { startedAt: root.startedAt, ...(root.replaceActive ? { replaces: {
      taskId: root.expectedTaskId ?? active?.id ?? randomUUID(), expectedVersion: root.expectedVersion ?? active?.version ?? 0, outcome: root.outcome,
    } } : {}) };
  }
}

export interface LockObservation { table: string; ids: string[] }
/** 只观察实际FOR UPDATE调用并原样转发到同一个真实tx，不Mock锁或SQL结果。 */
export function observeLocks(tx: Prisma.TransactionClient, trace: LockObservation[]): Prisma.TransactionClient {
  return new Proxy(tx, { get(target, property) {
    const value = Reflect.get(target, property);
    if (property !== '$queryRaw' || typeof value !== 'function') return value;
    return (...args: unknown[]) => {
      const query = args[0] as { strings?: readonly string[]; values?: unknown[] } | readonly string[];
      const sql = Array.isArray(query) ? query.join('?') : (query as { strings?: readonly string[] }).strings?.join('?') ?? '';
      const values = Array.isArray(query) ? args.slice(1) : (query as { values?: unknown[] }).values ?? [];
      if (/FOR UPDATE/i.test(sql)) trace.push({ table: /FROM\s+([a-z_]+)/i.exec(sql)?.[1] ?? 'unknown',
        ids: values.filter((item): item is string => typeof item === 'string' && /^[0-9a-f-]{36}$/i.test(item)) });
      return Reflect.apply(value, target, args);
    };
  } });
}
