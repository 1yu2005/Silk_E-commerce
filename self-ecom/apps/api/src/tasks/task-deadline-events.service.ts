// 作用：在已锁定任务的调用方事务中补记真实旧截止逾期；供延期、阶段结束及后续扫描共用。
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, Task } from '@prisma/client';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { checkedId, requireSessionTransaction } from '../auth/session-support.js';
import { isDeadlineReached } from '../common/time/deadline.js';
import { isTaskActive } from './task-access.service.js';

@Injectable()
export class TaskDeadlineEventsService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}
  /** 不另开事务、不自行逆序补锁；调用方须持完整业务、Cursor和Task锁并传入锁后的当前快照。 */
  async recordOverdue(tx: Prisma.TransactionClient, task: Task, actor: AuditActor, requestId: string, now: Date): Promise<boolean> {
    requireSessionTransaction(tx); requestId = checkedId(requestId);
    if (!isTaskActive(task) || !task.dueAt || !isDeadlineReached(now, task.dueAt)) return false;
    const inserted = await tx.deadlineEvent.createMany({ data: [{ taskId: task.id, eventType: 'OVERDUE', deadlineAt: task.dueAt,
      occurredAt: task.dueAt, detectedAt: now, actorType: actor.type === 'EMPLOYEE' ? 'EMPLOYEE' : 'SYSTEM',
      actorEmployeeId: actor.type === 'EMPLOYEE' ? actor.id : null, commandKey: `overdue:${task.dueAt.toISOString()}`, requestId }], skipDuplicates: true });
    const first = task.firstOverdueAt && task.firstOverdueAt < task.dueAt ? task.firstOverdueAt : task.dueAt;
    await tx.task.update({ where: { id: task.id }, data: { everOverdue: true, firstOverdueAt: first, updatedAt: now } });
    if (inserted.count) await this.audit.appendAudit(tx, { actor, action: 'task.overdue.record', targetId: task.id, requestId,
      after: { dueAt: task.dueAt.toISOString(), firstOverdueAt: first.toISOString() } });
    return inserted.count === 1;
  }
}
