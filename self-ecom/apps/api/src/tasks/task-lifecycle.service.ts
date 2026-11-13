// 作用：真实领域在已锁定事务中结束、取消或暂停/恢复任务；不提供通用改状态HTTP。
import { Inject, Injectable } from '@nestjs/common';
import type { Task } from '@prisma/client';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { AccessDeniedError } from '../auth/access-denied.error.js';
import { checkedId } from '../auth/session-support.js';
import { Clock } from '../common/time/clock.js';
import { TaskBusinessAdapters, type TaskBusinessReference, type TaskCommandActor } from './task-business-adapters.js';
import { TaskDeadlineEventsService } from './task-deadline-events.service.js';
import { TaskEntryService, type TaskEntryContext, type TaskTransactionScope } from './task-entry.service.js';
import { TaskError } from './task.errors.js';
import { isTaskEligible } from './task-access.service.js';

export type TaskTransition = 'COMPLETED' | 'CANCELLED' | 'SUSPENDED' | 'RESUMED';
const transitionAudits = { COMPLETED: 'task.stage.complete', CANCELLED: 'task.stage.cancel', SUSPENDED: 'task.stage.suspend', RESUMED: 'task.stage.resume' } as const;
export interface TaskTransitionInput extends TaskBusinessReference {
  readonly taskId: string; readonly expectedVersion: number; readonly action: TaskTransition; readonly commandKey: string; readonly reason: string;
}
export const taskAuditActor = (actor: TaskCommandActor): AuditActor => actor.subjectType === 'SYSTEM' ? { type: 'SYSTEM' } : { type: actor.subjectType, id: actor.subjectId };
export function taskText(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > max) throw new TaskError('TASK_INPUT_INVALID'); return value.trim();
}
export function taskVersion(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 2147483647) throw new TaskError('TASK_INPUT_INVALID');
}
export async function lockedContextTask(scope: TaskTransactionScope, reference: TaskBusinessReference, id: string): Promise<Task> {
  id = checkedId(id); const before = await scope.tx.task.findUnique({ where: { id } });
  if (!before || before.businessType !== reference.businessType || before.businessId !== reference.businessId) throw new TaskError('TASK_NOT_FOUND');
  await scope.tx.$queryRaw`SELECT id FROM task_stage_cursor WHERE id=${before.cursorId}::uuid FOR UPDATE`;
  await scope.tx.$queryRaw`SELECT id FROM task WHERE id=${id}::uuid FOR UPDATE`;
  const task = await scope.tx.task.findUniqueOrThrow({ where: { id } });
  if (task.assigneeId && !scope.employees.has(task.assigneeId)) throw new TaskError('TASK_LOCK_PLAN_CHANGED'); return task;
}

@Injectable()
export class TaskLifecycleService {
  constructor(@Inject(TaskEntryService) private readonly entry: TaskEntryService, @Inject(TaskBusinessAdapters) private readonly adapters: TaskBusinessAdapters,
    @Inject(TaskDeadlineEventsService) private readonly events: TaskDeadlineEventsService, @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock) {}
  transition(context: TaskEntryContext, input: TaskTransitionInput) {
    const commandKey = taskText(input.commandKey, 150); const reason = taskText(input.reason, 500); taskVersion(input.expectedVersion);
    if (!['COMPLETED', 'CANCELLED', 'SUSPENDED', 'RESUMED'].includes(input.action)) throw new TaskError('TASK_INPUT_INVALID');
    return this.entry.inContext(context, input, async scope => {
      const { tx, requestId } = scope; const task = await lockedContextTask(scope, input, input.taskId);
      const port = this.adapters.requireLifecycle(task.businessType); const target = input.action === 'RESUMED' ? 'OPEN' : input.action;
      const prior = await tx.taskHistory.findUnique({ where: { taskId_action_commandKey: { taskId: task.id, action: input.action, commandKey } } });
      const replay = !!prior && task.version === input.expectedVersion + 1 && task.status === target && prior.reason === reason
        && prior.actorType === (scope.actor.subjectType === 'EMPLOYEE' ? 'EMPLOYEE' : 'SYSTEM')
        && prior.actorEmployeeId === (scope.actor.subjectType === 'EMPLOYEE' ? scope.actor.subjectId : null)
        && (scope.actor.subjectType === 'EMPLOYEE' || await tx.auditLog.count({ where: { requestId: prior.requestId, targetId: task.id,
          action: transitionAudits[input.action], actorType: scope.actor.subjectType, actorCustomerId: scope.actor.subjectType === 'CUSTOMER' ? scope.actor.subjectId : null } }) > 0);
      const assertActor = (actor: TaskCommandActor) => {
        if (input.action !== 'COMPLETED' || actor.subjectType !== 'EMPLOYEE') return;
        if (!isTaskEligible(actor, task)) throw new AccessDeniedError('FORBIDDEN');
        if (!replay && (task.status !== 'CLAIMED' || task.assigneeId !== actor.subjectId)) throw new TaskError('TASK_NOT_ASSIGNEE');
      };
      assertActor(scope.actor);
      await port.assertTransition(tx, scope.actor, task, input.action, replay);
      let actor = await scope.revalidate();
      assertActor(actor);
      if (replay) return { changed: false, task };
      if (prior || task.version !== input.expectedVersion) throw new TaskError('VERSION_CONFLICT');
      if (task.version >= 2147483647) throw new TaskError('TASK_VERSION_EXHAUSTED');
      if (['COMPLETED', 'CANCELLED'].includes(task.status)
        || (input.action === 'COMPLETED' && task.status === 'SUSPENDED')
        || (input.action === 'SUSPENDED' && task.status === 'SUSPENDED')
        || (input.action === 'RESUMED' && task.status !== 'SUSPENDED')) throw new TaskError('TASK_TRANSITION_BLOCKED');
      // 已注册来源仓储时，完成/取消前必须先逐个结束来源；不能取消共享任务掩盖其它来源。
      const sources = this.adapters.getSources(task.businessType);
      if (['COMPLETED', 'CANCELLED'].includes(input.action) && sources && (await sources.listActive(tx, task)).length) throw new TaskError('TASK_SOURCE_ACTIVE');
      await port.applyTransition(tx, actor, task, input.action);
      actor = await scope.revalidate(); assertActor(actor); const now = this.clock.now();
      await this.events.recordOverdue(tx, task, taskAuditActor(actor), requestId, now);
      const updated = await tx.task.update({ where: { id: task.id }, data: { status: target, assigneeId: null,
        closedAt: ['COMPLETED', 'CANCELLED'].includes(target) ? now : null, reassignNeeded: false, version: { increment: 1 }, updatedAt: now } });
      await tx.taskHistory.create({ data: { taskId: task.id, action: input.action, actorType: actor.subjectType === 'EMPLOYEE' ? 'EMPLOYEE' : 'SYSTEM',
        actorEmployeeId: actor.subjectType === 'EMPLOYEE' ? actor.subjectId : null, fromAssigneeId: task.assigneeId, toAssigneeId: null,
        beforeStatus: task.status, afterStatus: updated.status, reason, commandKey, requestId, createdAt: now } });
      const action = transitionAudits[input.action];
      await this.audit.appendAudit(tx, { actor: taskAuditActor(actor), action, targetId: task.id, requestId, reason,
        before: { taskStatus: task.status, assigneeId: task.assigneeId, round: task.round }, after: { taskStatus: updated.status, assigneeId: null, round: task.round } });
      return { changed: true, task: updated };
    });
  }
}
