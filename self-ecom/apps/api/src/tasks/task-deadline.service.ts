// 作用：管理员在原子事务中延期/首次指定人工任务截止，并同步领域期限、补记旧逾期和保存历史审计。
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AccessDeniedError } from '../auth/access-denied.error.js';
import { runAuthTransaction } from '../auth/auth-transaction.js';
import type { CurrentIdentity } from '../auth/current-identity.service.js';
import { checkedId } from '../auth/session-support.js';
import { Clock } from '../common/time/clock.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { canExtendDeadline, isTaskActive, TaskAccessService } from './task-access.service.js';
import { TaskBusinessAdapters } from './task-business-adapters.js';
import { TaskDeadlineEventsService } from './task-deadline-events.service.js';
import { parseTaskDueAt } from './task-deadline-input.js';
import type { ExtendTaskDeadlineDto } from './task.dto.js';
import { TaskError } from './task.errors.js';
import { TaskLockService } from './task-lock.service.js';

@Injectable()
export class TaskDeadlineService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(TaskAccessService) private readonly access: TaskAccessService,
    @Inject(TaskLockService) private readonly locks: TaskLockService, @Inject(TaskBusinessAdapters) private readonly adapters: TaskBusinessAdapters,
    @Inject(TaskDeadlineEventsService) private readonly events: TaskDeadlineEventsService, @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock) {}

  extend(actor: CurrentIdentity, token: string, id: string, input: ExtendTaskDeadlineDto, requestId: string) {
    id = checkedId(id); requestId = checkedId(requestId); const newDueAt = parseTaskDueAt(input.newDueAt); const reason = input.reason?.trim();
    if (!newDueAt || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion > 2147483647
      || typeof reason !== 'string' || !reason || [...reason].length > 500) throw new TaskError('TASK_INPUT_INVALID');
    return runAuthTransaction(this.prisma, async tx => {
      let current = await this.access.authenticate(tx, actor, token);
      if (!canExtendDeadline(current)) throw new AccessDeniedError('FORBIDDEN');
      const candidate = await tx.task.findUnique({ where: { id } }); if (!candidate) throw new TaskError('TASK_NOT_FOUND');
      await this.access.requireVisible(tx, current, candidate);
      const employees = await this.locks.acquire(tx, [candidate], [current.subjectId]);
      await tx.$queryRaw`SELECT id FROM task_stage_cursor WHERE id=${candidate.cursorId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM task WHERE id=${id}::uuid FOR UPDATE`;
      const task = await tx.task.findUniqueOrThrow({ where: { id } });
      if (task.businessType !== candidate.businessType || task.businessId !== candidate.businessId || task.cursorId !== candidate.cursorId
        || (task.assigneeId && !employees.has(task.assigneeId))) throw new TaskError('TASK_LOCK_PLAN_CHANGED');
      current = await this.access.authenticate(tx, actor, token); await this.access.requireVisible(tx, current, task);
      if (!canExtendDeadline(current)) throw new AccessDeniedError('FORBIDDEN');
      if (!isTaskActive(task)) throw new TaskError('TASK_DEADLINE_BLOCKED');
      const adapter = this.adapters.requireDeadline(task.businessType);
      await adapter.assertCanExtend(tx, current, task);
      current = await this.access.authenticate(tx, actor, token); await this.access.requireVisible(tx, current, task);
      if (!canExtendDeadline(current)) throw new AccessDeniedError('FORBIDDEN');
      const commandKey = `deadline:${input.expectedVersion}`;
      // 只重放同操作者/旧版本/原因/规范化截止的最后结果；不能把更新后的任务当成另一次延期成功。
      if (task.version === input.expectedVersion + 1 && task.dueAt?.getTime() === newDueAt.getTime()) {
        const prior = await tx.deadlineEvent.findFirst({ where: { taskId: id, eventType: { in: ['EXTENDED', 'DEADLINE_ASSIGNED'] }, commandKey } });
        if (prior?.actorEmployeeId === current.subjectId && prior.reason === reason && prior.newDueAt?.getTime() === newDueAt.getTime()) {
          return { changed: false, task: await this.access.present(tx, current, task, this.clock.now()) };
        }
      }
      if (task.version !== input.expectedVersion) throw new TaskError('VERSION_CONFLICT');
      if (task.version >= 2147483647) throw new TaskError('TASK_VERSION_EXHAUSTED');
      const requireLater = (now: Date) => {
        if (!Number.isFinite(now.getTime())) throw new Error('服务器时钟不合法');
        if (newDueAt <= now || (task.dueAt && newDueAt <= task.dueAt)) throw new TaskError('TASK_DEADLINE_NOT_LATER');
      };
      requireLater(this.clock.now());
      await adapter.extend(tx, current, task, new Date(newDueAt));
      // 领域同步可能等待；最终写任务前再认证和读时钟，不能提交已过期的新截止或失效凭证。
      current = await this.access.authenticate(tx, actor, token); await this.access.requireVisible(tx, current, task);
      if (!canExtendDeadline(current)) throw new AccessDeniedError('FORBIDDEN');
      const now = this.clock.now(); requireLater(now);
      const auditActor = { type: 'EMPLOYEE' as const, id: current.subjectId };
      await this.events.recordOverdue(tx, task, auditActor, requestId, now);
      const updated = await tx.task.update({ where: { id }, data: { dueAt: newDueAt, version: { increment: 1 }, updatedAt: now } });
      await tx.deadlineEvent.create({ data: { taskId: id, eventType: task.dueAt ? 'EXTENDED' : 'DEADLINE_ASSIGNED',
        deadlineAt: task.dueAt ?? newDueAt, newDueAt, occurredAt: now, detectedAt: now, actorType: 'EMPLOYEE', actorEmployeeId: current.subjectId,
        reason, commandKey, requestId } });
      await tx.taskHistory.create({ data: { taskId: id, action: 'DEADLINE_CHANGED', actorType: 'EMPLOYEE', actorEmployeeId: current.subjectId,
        fromAssigneeId: task.assigneeId, toAssigneeId: task.assigneeId, beforeStatus: task.status, afterStatus: task.status,
        reason, commandKey, requestId, createdAt: now } });
      await this.audit.appendAudit(tx, { actor: auditActor, action: 'task.deadline.extend', targetId: id, requestId, reason,
        before: { dueAt: task.dueAt?.toISOString() ?? null, taskStatus: task.status, round: task.round, taskVersion: task.version },
        after: { dueAt: newDueAt.toISOString(), taskStatus: updated.status, round: updated.round, taskVersion: updated.version } });
      return { changed: true, task: await this.access.present(tx, current, updated, now) };
    }, error => error instanceof TaskError && error.code === 'TASK_LOCK_PLAN_CHANGED');
  }
}
