// 作用：在员工变更原事务中先合并全部业务锁，再同步回池失去资格的已领任务；失败整体回滚。
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, Task } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { AccessDeniedError } from '../auth/access-denied.error.js';
import type { CurrentIdentity } from '../auth/current-identity.service.js';
import { checkedId, requireSessionTransaction } from '../auth/session-support.js';
import { Clock } from '../common/time/clock.js';
import { hasTaskPermissions, TaskAccessService } from './task-access.service.js';
import { businessKey, TaskBusinessAdapters } from './task-business-adapters.js';
import { TaskError } from './task.errors.js';
import { TaskLockService } from './task-lock.service.js';

export interface EmployeeTaskChange {
  readonly actor: CurrentIdentity; readonly token: string; readonly requestId: string; readonly reason: string;
  readonly permission: 'employee.status.manage' | 'employee.role.change' | 'employee.permission.manage';
}
export interface TaskEligibilityContext { readonly employeeId: string }
interface Prepared { tx: Prisma.TransactionClient; employeeId: string; tasks: Task[]; permissions: readonly string[]; change: EmployeeTaskChange }
const signature = (tasks: readonly Task[]) => JSON.stringify(tasks.map(task => [task.id, task.version, task.businessType, task.businessId, task.cursorId]));

@Injectable()
export class TaskEligibilityService {
  private readonly contexts = new WeakMap<TaskEligibilityContext, Prepared>();
  constructor(@Inject(TaskLockService) private readonly locks: TaskLockService, @Inject(TaskBusinessAdapters) private readonly adapters: TaskBusinessAdapters,
    @Inject(TaskAccessService) private readonly access: TaskAccessService, @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock) {}

  /** 调用前已锁操作者/目标员工，且尚未写员工；目标锁阻止新的领取或转入，不能另补员工锁。 */
  async prepare(tx: Prisma.TransactionClient, employeeId: string, newEffective: readonly string[], change: EmployeeTaskChange): Promise<TaskEligibilityContext> {
    requireSessionTransaction(tx); employeeId = checkedId(employeeId); checkedId(change.requestId);
    const candidates = await tx.task.findMany({ where: { assigneeId: employeeId, status: 'CLAIMED' }, orderBy: { id: 'asc' } });
    const lost = candidates.filter(task => !hasTaskPermissions(newEffective, task));
    const refs = [...new Map(lost.map(task => [businessKey(task), task])).values()];
    if (refs.length) await this.locks.acquireBusiness(tx, refs);
    // 必须先锁完全部Cursor，再锁全部Task；不能逐任务完整取锁后再倒退到下一业务。
    for (const id of [...new Set(lost.map(task => task.cursorId))].sort()) {
      await tx.$queryRaw`SELECT id FROM task_stage_cursor WHERE id=${id}::uuid FOR UPDATE`;
    }
    for (const task of lost) await tx.$queryRaw`SELECT id FROM task WHERE id=${task.id}::uuid FOR UPDATE`;
    const confirmed = await tx.task.findMany({ where: { assigneeId: employeeId, status: 'CLAIMED' }, orderBy: { id: 'asc' } });
    if (signature(candidates) !== signature(confirmed)) throw new TaskError('TASK_LOCK_PLAN_CHANGED');
    // 等待业务锁后再次确认操作者；放在员工写入前，合法自降权/停用才不会被自己的新状态误拒绝。
    const current = await this.access.authenticate(tx, change.actor, change.token);
    if (!current.effectivePermissions.includes(change.permission)) throw new AccessDeniedError('FORBIDDEN');
    const context = Object.freeze({ employeeId });
    this.contexts.set(context, { tx, employeeId, tasks: lost, permissions: [...newEffective], change: { ...change, actor: current } });
    return context;
  }

  async apply(tx: Prisma.TransactionClient, employeeId: string, newEffective: readonly string[], context: TaskEligibilityContext): Promise<void> {
    const prepared = this.contexts.get(context); this.contexts.delete(context);
    if (!prepared || prepared.tx !== tx || prepared.employeeId !== employeeId
      || JSON.stringify(prepared.permissions) !== JSON.stringify(newEffective)) throw new TaskError('TASK_CONTEXT_INVALID');
    const { change, tasks } = prepared; const actorId = change.actor.subjectId; const reason = change.reason.trim();
    if (!reason || [...reason].length > 500) throw new TaskError('TASK_INPUT_INVALID');
    const now = this.clock.now();
    for (const task of tasks) {
      if (task.version >= 2147483647) throw new TaskError('TASK_VERSION_EXHAUSTED');
      // 不调用本人assertRelease；真实领域保留交运未决等状态，只同步解除经办。
      await this.adapters.requireHandoff(task.businessType).qualificationLost(tx, actorId, task, reason);
      const updated = await tx.task.update({ where: { id: task.id }, data: { status: 'OPEN', assigneeId: null,
        reassignNeeded: true, version: { increment: 1 }, updatedAt: now } });
      await tx.taskHistory.create({ data: { taskId: task.id, action: 'QUALIFICATION_LOST', actorType: 'EMPLOYEE', actorEmployeeId: actorId,
        fromAssigneeId: employeeId, toAssigneeId: null, beforeStatus: 'CLAIMED', afterStatus: 'OPEN', reason,
        commandKey: `qualification-lost:${task.version}`, requestId: change.requestId, createdAt: now } });
      await this.audit.appendAudit(tx, { actor: { type: 'EMPLOYEE', id: actorId }, action: 'task.qualification.lost', targetId: task.id,
        requestId: change.requestId, reason,
        before: { taskStatus: 'CLAIMED', assigneeId: employeeId, round: task.round, taskVersion: task.version, reassignNeeded: task.reassignNeeded },
        after: { taskStatus: 'OPEN', assigneeId: null, round: task.round, taskVersion: updated.version, reassignNeeded: true } });
    }
  }
}
