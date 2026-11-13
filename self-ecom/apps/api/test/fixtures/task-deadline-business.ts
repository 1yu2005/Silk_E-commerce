// 作用：仅在专属隔离库用真实SQL验证人工/外部等待截止同步，固定业务计时和交运事实不可被延期改动。
import type { Prisma, Task, TaskBusinessType } from '@prisma/client';
import type { TaskBusinessAccess, TaskBusinessDeadline } from '../../src/tasks/task-business-adapters.js';
import { TaskError } from '../../src/tasks/task.errors.js';
import { FixtureReassignAdapters, installReassignFixture } from './task-reassign-business.js';
export async function installDeadlineFixture(tx: Prisma.TransactionClient) {
  await installReassignFixture(tx);
  await tx.$executeRawUnsafe(`CREATE TABLE task_deadline_fixture(task_id uuid PRIMARY KEY REFERENCES task(id),due_at timestamptz,
    allow_extend boolean NOT NULL DEFAULT true,allow_when_suspended boolean NOT NULL DEFAULT false,
    timer_kind text NOT NULL DEFAULT 'MANUAL' CHECK(timer_kind IN ('MANUAL','EXTERNAL_WAIT','PAYMENT','APPLICATION_WINDOW','AUTO_RECEIPT')),
    extension_count integer NOT NULL DEFAULT 0,payment_due_at timestamptz NOT NULL,application_window_at timestamptz NOT NULL,
    receipt_base_due_at timestamptz NOT NULL,actual_handover_at timestamptz NOT NULL)`);
}
interface State { allow_extend: boolean; allow_when_suspended: boolean; timer_kind: string }
const supports = (row: State | undefined, task: Task) => !!row?.allow_extend && ['MANUAL', 'EXTERNAL_WAIT'].includes(row.timer_kind)
  && (task.status !== 'SUSPENDED' || row.allow_when_suspended);
async function readState(tx: Prisma.TransactionClient, task: Task) {
  return (await tx.$queryRaw<State[]>`SELECT allow_extend,allow_when_suspended,timer_kind FROM task_deadline_fixture WHERE task_id=${task.id}::uuid`)[0];
}
export class FixtureDeadlineAdapters extends FixtureReassignAdapters {
  onDeadlineCheck?: (tx: Prisma.TransactionClient, task: Task) => Promise<void>;
  onExtend?: (tx: Prisma.TransactionClient, task: Task) => Promise<void>;
  constructor() {
    super();
    const deadline: TaskBusinessDeadline = {
      assertCanExtend: async (tx, _actor, task) => { await this.onDeadlineCheck?.(tx, task);
        if (!supports(await readState(tx, task), task)) throw new TaskError('TASK_DEADLINE_BLOCKED'); },
      extend: async (tx, _actor, task, newDueAt) => {
        if (!supports(await readState(tx, task), task)) throw new TaskError('TASK_DEADLINE_BLOCKED');
        await tx.$executeRaw`UPDATE task_deadline_fixture SET due_at=${newDueAt},extension_count=extension_count+1 WHERE task_id=${task.id}::uuid`;
        await this.onExtend?.(tx, task);
      },
    };
    for (const type of ['ORDER', 'AFTER_SALE', 'INVENTORY_ADJUSTMENT', 'OFFLINE_CASE'] as const) this.registerDeadline(type, deadline);
  }
  override access(type: TaskBusinessType): TaskBusinessAccess | undefined {
    const access = super.access(type); if (!access) return;
    return { ...access, describe: async (tx, actor, task) => ({ ...await access.describe(tx, actor, task), canExtendDeadline: supports(await readState(tx, task), task) }) };
  }
}
