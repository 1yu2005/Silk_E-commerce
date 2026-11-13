// 作用：在专属测试库接入真实SQL读取范围与安全交接状态，不在生产模块注册测试业务。
import type { Prisma, Task, TaskBusinessType } from '@prisma/client';
import { TaskError } from '../../src/tasks/task.errors.js';
import type { TaskBusinessAccess, TaskEmployee } from '../../src/tasks/task-business-adapters.js';
import { FixtureTaskAdapters, installFixtureTables, readFixture } from './task-entry-business.js';
export async function installAccessFixture(tx: Prisma.TransactionClient) {
  await installFixtureTables(tx);
  await tx.$executeRawUnsafe(`ALTER TABLE task_entry_fixture ADD COLUMN reader_employee_id uuid,
    ADD COLUMN claim_allowed boolean NOT NULL DEFAULT true,ADD COLUMN safe_release boolean NOT NULL DEFAULT true,
    ADD COLUMN hidden_reason boolean NOT NULL DEFAULT false`);
}
export class FixtureAccessAdapters extends FixtureTaskAdapters {
  onScope?: () => Promise<void>; onClaim?: () => Promise<void>; onRelease?: () => Promise<void>;
  constructor() {
    super();
    for (const type of ['ORDER', 'AFTER_SALE', 'INVENTORY_ADJUSTMENT', 'OFFLINE_CASE'] as const) this.registerAccess(type, this.accessFor(type));
  }
  private accessFor(type: TaskBusinessType): TaskBusinessAccess {
    return {
      visibleBusinessIds: async (tx, actor) => {
        const required = type === 'AFTER_SALE' ? ['after-sale.service.read', 'after-sale.inspection.read'] : type === 'INVENTORY_ADJUSTMENT' ? ['inventory.read']
          : type === 'ORDER' ? ['order.service.read', 'order.fulfillment.read'] : ['offline-case.manage'];
        if (!required.some(code => actor.effectivePermissions.includes(code))) return [];
        const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM task_entry_fixture WHERE business_type=${type}
          AND (reader_employee_id IS NULL OR reader_employee_id=${actor.subjectId}::uuid)`;
        await this.onScope?.(); return rows.map(row => row.id);
      },
      describe: async (tx, _actor, task) => {
        const [state] = await tx.$queryRaw<{ claim_allowed: boolean; safe_release: boolean; hidden_reason: boolean }[]>`
          SELECT claim_allowed,safe_release,hidden_reason FROM task_entry_fixture WHERE id=${task.businessId}::uuid`;
        if (!state) throw new TaskError('TASK_NOT_FOUND');
        return { number: `ISOLATED-${task.businessId}`, label: '隔离服装业务任务', detailPath: null,
          canClaim: state.claim_allowed, canRelease: state.safe_release, canReadHistoryReasons: !state.hidden_reason };
      },
      assertClaim: (tx, actor, task) => this.handoff(tx, actor, task, 'claim'),
      assertRelease: (tx, actor, task) => this.handoff(tx, actor, task, 'release'),
    };
  }
  private async handoff(tx: Prisma.TransactionClient, _actor: TaskEmployee, task: Task, action: 'claim' | 'release') {
    await readFixture(tx, task.businessId);
    if (action === 'claim') await this.onClaim?.(); else await this.onRelease?.();
    const [row] = await tx.$queryRaw<{ claim_allowed: boolean; safe_release: boolean }[]>`SELECT claim_allowed,safe_release FROM task_entry_fixture WHERE id=${task.businessId}::uuid`;
    if (action === 'claim' && !row?.claim_allowed) throw new TaskError('TASK_ENTRY_BLOCKED');
    if (action === 'release' && !row?.safe_release) throw new TaskError('TASK_RELEASE_BLOCKED');
    // 模拟真实领域在相同事务的交接记录，不在事务外补写；用于验证后续审计故障连同领域写入回滚。
    await tx.$executeRaw`UPDATE task_entry_fixture SET progress=progress+1 WHERE id=${task.businessId}::uuid`;
  }
}
