// 作用：仅在专属隔离库验证真实SQL经办同步与交运未决事实；生产不注册本适配器。
import type { Prisma, TaskBusinessType } from '@prisma/client';
import type { TaskBusinessAccess, TaskBusinessHandoff } from '../../src/tasks/task-business-adapters.js';
import { TaskError } from '../../src/tasks/task.errors.js';
import { FixtureAccessAdapters, installAccessFixture } from './task-access-business.js';
export async function installReassignFixture(tx: Prisma.TransactionClient) {
  await installAccessFixture(tx);
  await tx.$executeRawUnsafe(`CREATE TABLE task_handoff_fixture(task_id uuid PRIMARY KEY REFERENCES task(id),
    assignee_id uuid REFERENCES employee(id),domain_state text NOT NULL DEFAULT 'HANDOVER_UNKNOWN',changes integer NOT NULL DEFAULT 0)`);
}
export class FixtureReassignAdapters extends FixtureAccessAdapters {
  onTransfer?: () => Promise<void>; onRepool?: () => Promise<void>;
  constructor() {
    super();
    const port: TaskBusinessHandoff = {
      transfer: async (tx, _actor, target, task) => {
        const [root] = await tx.$queryRaw<{ safe_release: boolean; claim_allowed: boolean; reader_employee_id: string | null }[]>`
          SELECT safe_release,claim_allowed,reader_employee_id FROM task_entry_fixture WHERE id=${task.businessId}::uuid`;
        if (!root?.safe_release || !root.claim_allowed) throw new TaskError('TASK_TRANSFER_BLOCKED');
        if (root.reader_employee_id && root.reader_employee_id !== target.id) throw new TaskError('TARGET_NOT_ELIGIBLE');
        await tx.$executeRaw`INSERT INTO task_handoff_fixture(task_id,assignee_id,changes) VALUES(${task.id}::uuid,${target.id}::uuid,1)
          ON CONFLICT(task_id) DO UPDATE SET assignee_id=${target.id}::uuid,changes=task_handoff_fixture.changes+1`;
        await this.onTransfer?.();
      },
      qualificationLost: async (tx, _actorId, task) => {
        await tx.$executeRaw`INSERT INTO task_handoff_fixture(task_id,assignee_id,changes) VALUES(${task.id}::uuid,NULL,1)
          ON CONFLICT(task_id) DO UPDATE SET assignee_id=NULL,changes=task_handoff_fixture.changes+1`;
        await this.onRepool?.();
      },
    };
    for (const type of ['ORDER', 'AFTER_SALE', 'INVENTORY_ADJUSTMENT', 'OFFLINE_CASE'] as const) this.registerHandoff(type, port);
  }
  override access(type: TaskBusinessType): TaskBusinessAccess | undefined {
    const access = super.access(type); if (!access) return;
    return { ...access, describe: async (tx, actor, task) => { const view = await access.describe(tx, actor, task); return { ...view, canTransfer: view.canRelease }; },
      assertClaim: async (tx, actor, task) => {
        await access.assertClaim(tx, actor, task);
        await tx.$executeRaw`INSERT INTO task_handoff_fixture(task_id,assignee_id) VALUES(${task.id}::uuid,${actor.subjectId}::uuid)
          ON CONFLICT(task_id) DO UPDATE SET assignee_id=${actor.subjectId}::uuid`;
      },
      assertRelease: async (tx, actor, task) => { await access.assertRelease(tx, actor, task);
        await tx.$executeRaw`UPDATE task_handoff_fixture SET assignee_id=NULL WHERE task_id=${task.id}::uuid`; },
    };
  }
}
