// 作用：复用员工→完整上游业务的统一锁序；阶段进入与领取/释放都在调用方事务中使用。
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { checkedId, lockSessionSubject, requireSessionTransaction } from '../auth/session-support.js';
import { mergeTaskLocks, TaskBusinessAdapters, type TaskBusinessReference, type TaskLockResource } from './task-business-adapters.js';
import { TaskError } from './task.errors.js';

@Injectable()
export class TaskLockService {
  constructor(@Inject(TaskBusinessAdapters) private readonly adapters: TaskBusinessAdapters) {}
  /** 员工命令已按序锁操作者和目标；只处理目标自己的任务，禁止在领域锁后反向补锁其它员工。 */
  async acquireBusiness(tx: Prisma.TransactionClient, references: readonly TaskBusinessReference[]) {
    requireSessionTransaction(tx);
    const plan = await this.adapters.plan(tx, references);
    await this.adapters.acquire(tx, plan);
    if (JSON.stringify(plan) !== JSON.stringify(await this.adapters.plan(tx, references))) throw new TaskError('TASK_LOCK_PLAN_CHANGED');
  }
  async acquire(tx: Prisma.TransactionClient, references: readonly TaskBusinessReference[], employees: readonly string[], extra: readonly TaskLockResource[] = [], assignmentTargetId?: string) {
    requireSessionTransaction(tx);
    const plan = mergeTaskLocks([await this.adapters.plan(tx, references), extra]);
    const where = { OR: references.map(ref => ({ businessType: ref.businessType, businessId: ref.businessId })), status: 'CLAIMED' as const };
    const candidates = await tx.task.findMany({ where, select: { assigneeId: true } });
    const ids = new Set([...employees.map(checkedId), ...candidates.flatMap(row => row.assigneeId ? [row.assigneeId] : [])]);
    for (const id of [...ids].sort()) {
      if (id === assignmentTargetId) {
        const target = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM employee WHERE id=${id}::uuid FOR UPDATE`;
        if (target.length !== 1) throw new TaskError('TARGET_NOT_ELIGIBLE');
      } else await lockSessionSubject(tx, { subjectType: 'EMPLOYEE', subjectId: id });
    }
    await this.adapters.acquire(tx, plan);
    const confirmed = mergeTaskLocks([await this.adapters.plan(tx, references), extra]);
    if (JSON.stringify(plan) !== JSON.stringify(confirmed)) throw new TaskError('TASK_LOCK_PLAN_CHANGED');
    const claimed = await tx.task.findMany({ where, select: { assigneeId: true } });
    if (claimed.some(row => row.assigneeId && !ids.has(row.assigneeId))) throw new TaskError('TASK_LOCK_PLAN_CHANGED');
    return ids;
  }
}
