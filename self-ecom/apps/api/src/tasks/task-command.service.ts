// 作用：按完整锁序领取/安全释放任务；版本、任务历史和审计同事务，不修改轮次或期限。
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, Task } from '@prisma/client';
import type { CurrentIdentity } from '../auth/current-identity.service.js';
import { runAuthTransaction } from '../auth/auth-transaction.js';
import { AccessDeniedError } from '../auth/access-denied.error.js';
import { checkedId } from '../auth/session-support.js';
import { Clock } from '../common/time/clock.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PermissionService } from '../permissions/permission.service.js';
import { canReassign, hasTaskPermissions, isTaskEligible, TaskAccessService } from './task-access.service.js';
import { TaskBusinessAdapters } from './task-business-adapters.js';
import { TaskLockService } from './task-lock.service.js';
import { TaskError } from './task.errors.js';
import type { ClaimTaskDto, ReleaseTaskDto, TransferTaskDto } from './task.dto.js';

@Injectable()
export class TaskCommandService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(TaskAccessService) private readonly access: TaskAccessService,
    @Inject(TaskLockService) private readonly locks: TaskLockService, @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock, @Inject(TaskBusinessAdapters) private readonly adapters: TaskBusinessAdapters,
    @Inject(PermissionService) private readonly permissions: PermissionService) {}
  claim(actor: CurrentIdentity, token: string, id: string, input: ClaimTaskDto, requestId: string,
    verifyBusiness?: (tx: Prisma.TransactionClient, task: Task) => Promise<void>) {
    return this.execute('claim', actor, token, id, input, requestId, verifyBusiness);
  }
  release(actor: CurrentIdentity, token: string, id: string, input: ReleaseTaskDto, requestId: string) {
    return this.execute('release', actor, token, id, input, requestId);
  }
  transfer(actor: CurrentIdentity, token: string, id: string, input: TransferTaskDto, requestId: string) {
    id = checkedId(id); requestId = checkedId(requestId); const targetId = checkedId(input.targetEmployeeId); const reason = input.reason?.trim();
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion > 2147483647
      || typeof reason !== 'string' || !reason || [...reason].length > 500) throw new TaskError('TASK_INPUT_INVALID');
    return runAuthTransaction(this.prisma, async tx => {
      let current = await this.access.authenticate(tx, actor, token);
      if (!canReassign(current)) throw new AccessDeniedError('FORBIDDEN');
      const candidate = await tx.task.findUnique({ where: { id } }); if (!candidate) throw new TaskError('TASK_NOT_FOUND');
      await this.access.requireVisible(tx, current, candidate);
      const employees = await this.locks.acquire(tx, [candidate], [current.subjectId, targetId], [], targetId);
      await tx.$queryRaw`SELECT id FROM task_stage_cursor WHERE id=${candidate.cursorId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM task WHERE id=${id}::uuid FOR UPDATE`;
      const task = await tx.task.findUniqueOrThrow({ where: { id } });
      if (task.businessType !== candidate.businessType || task.businessId !== candidate.businessId || task.cursorId !== candidate.cursorId
        || (task.assigneeId && !employees.has(task.assigneeId))) throw new TaskError('TASK_LOCK_PLAN_CHANGED');
      current = await this.access.authenticate(tx, actor, token); await this.access.requireVisible(tx, current, task);
      if (!canReassign(current)) throw new AccessDeniedError('FORBIDDEN');
      const target = await tx.employee.findUnique({ where: { id: targetId }, select: { id: true, role: true, status: true, mustChangePassword: true,
        extraPermissions: { select: { permissionCode: true } } } });
      if (!target || target.status !== 'ACTIVE' || target.mustChangePassword) throw new TaskError('TARGET_NOT_ELIGIBLE');
      const assignee = { id: target.id, role: target.role,
        effectivePermissions: this.permissions.effectivePermissions(target.role, target.extraPermissions.map(item => item.permissionCode)) };
      if (!hasTaskPermissions(assignee.effectivePermissions, task)) throw new TaskError('TARGET_NOT_ELIGIBLE');
      const commandKey = `transfer:${input.expectedVersion}`;
      if (task.version === input.expectedVersion + 1 && task.status === 'CLAIMED' && task.assigneeId === targetId) {
        const prior = await tx.taskHistory.findUnique({ where: { taskId_action_commandKey: { taskId: id, action: 'TRANSFERRED', commandKey } } });
        if (prior?.actorEmployeeId === current.subjectId && prior.toAssigneeId === targetId && prior.reason === reason) {
          return { changed: false, task: await this.access.present(tx, current, task, this.clock.now()) };
        }
      }
      if (task.version !== input.expectedVersion) throw new TaskError('VERSION_CONFLICT');
      if (!['OPEN', 'CLAIMED'].includes(task.status) || task.assigneeId === targetId) throw new TaskError('TASK_TRANSFER_BLOCKED');
      if (task.version >= 2147483647) throw new TaskError('TASK_VERSION_EXHAUSTED');
      await this.adapters.requireHandoff(task.businessType).transfer(tx, current, assignee, task, input.physicalHandoff?{...input.physicalHandoff,requestId,now:this.clock.now()}:undefined);
      // 领域交接仍在当前事务；等待期间凭证到期也必须连同领域写入一起回滚。
      current = await this.access.authenticate(tx, actor, token); await this.access.requireVisible(tx, current, task);
      if (!canReassign(current)) throw new AccessDeniedError('FORBIDDEN');
      const now = this.clock.now();
      const updated = await tx.task.update({ where: { id }, data: { status: 'CLAIMED', assigneeId: targetId, reassignNeeded: false,
        version: { increment: 1 }, updatedAt: now } });
      await tx.taskHistory.create({ data: { taskId: id, action: 'TRANSFERRED', actorType: 'EMPLOYEE', actorEmployeeId: current.subjectId,
        fromAssigneeId: task.assigneeId, toAssigneeId: targetId, beforeStatus: task.status, afterStatus: 'CLAIMED', reason, commandKey, requestId, createdAt: now } });
      await this.audit.appendAudit(tx, { actor: { type: 'EMPLOYEE', id: current.subjectId }, action: 'task.transfer', targetId: id, requestId, reason,
        before: { taskStatus: task.status, assigneeId: task.assigneeId, round: task.round, taskVersion: task.version, reassignNeeded: task.reassignNeeded },
        after: { taskStatus: 'CLAIMED', assigneeId: targetId, round: task.round, taskVersion: updated.version, reassignNeeded: false } });
      return { changed: true, task: await this.access.present(tx, current, updated, now) };
    }, error => error instanceof TaskError && error.code === 'TASK_LOCK_PLAN_CHANGED');
  }
  private execute(action: 'claim' | 'release', actor: CurrentIdentity, token: string, id: string, input: ClaimTaskDto | ReleaseTaskDto, requestId: string,
    verifyBusiness?: (tx: Prisma.TransactionClient, task: Task) => Promise<void>) {
    id = checkedId(id); requestId = checkedId(requestId);
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion > 2147483647) throw new TaskError('TASK_INPUT_INVALID');
    const reason = action === 'release' && 'reason' in input ? input.reason?.trim() : undefined;
    if (action === 'release' && (typeof reason !== 'string' || !reason || [...reason].length > 500)) throw new TaskError('TASK_INPUT_INVALID');
    return runAuthTransaction(this.prisma, async tx => {
      let current = await this.access.authenticate(tx, actor, token);
      const candidate = await tx.task.findUnique({ where: { id } }); if (!candidate) throw new TaskError('TASK_NOT_FOUND');
      await this.access.requireVisible(tx, current, candidate);
      const lockedEmployees = await this.locks.acquire(tx, [candidate], [current.subjectId]);
      await tx.$queryRaw`SELECT id FROM task_stage_cursor WHERE id=${candidate.cursorId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM task WHERE id=${id}::uuid FOR UPDATE`;
      const task = await tx.task.findUniqueOrThrow({ where: { id } });
      if (task.businessType !== candidate.businessType || task.businessId !== candidate.businessId || task.cursorId !== candidate.cursorId
        || (task.assigneeId && !lockedEmployees.has(task.assigneeId))) throw new TaskError('TASK_LOCK_PLAN_CHANGED');
      current = await this.access.authenticate(tx, actor, token); await this.access.requireVisible(tx, current, task);
      const adapter = this.access.requireBusinessAccess(task.businessType);
      // 领域版本检查复用本次完整锁事务，不在领取后另开事务验证。
      if (verifyBusiness) await verifyBusiness(tx, task);
      const commandKey = `${action}:${input.expectedVersion}`;
      if (action === 'claim' && !isTaskEligible(current, task)) throw new AccessDeniedError('FORBIDDEN');
      // 只重放“同主体、同旧版本、同参数”的最后一次动作；经历释放/再领取后旧请求不能误报成功。
      if (task.version === input.expectedVersion + 1 && ((action === 'claim' && task.status === 'CLAIMED' && task.assigneeId === current.subjectId)
        || (action === 'release' && task.status === 'OPEN' && task.assigneeId === null))) {
        const prior = await tx.taskHistory.findUnique({ where: { taskId_action_commandKey: { taskId: id,
          action: action === 'claim' ? 'CLAIMED' : 'RELEASED', commandKey } } });
        if (prior?.actorEmployeeId === current.subjectId && (action === 'claim' || prior.reason === reason)) {
          return { changed: false, task: await this.access.present(tx, current, task, this.clock.now()) };
        }
      }
      if (action === 'claim' && task.status === 'CLAIMED' && task.assigneeId !== current.subjectId) throw new TaskError('TASK_ALREADY_CLAIMED');
      if (task.version !== input.expectedVersion) throw new TaskError('VERSION_CONFLICT');
      if (action === 'claim' && task.status !== 'OPEN') throw new TaskError('TASK_NOT_OPEN');
      if (action === 'release' && (task.status !== 'CLAIMED' || task.assigneeId !== current.subjectId)) throw new TaskError('TASK_NOT_ASSIGNEE');
      if (task.version >= 2147483647) throw new TaskError('TASK_VERSION_EXHAUSTED');
      if (action === 'claim') await adapter.assertClaim(tx, current, task); else await adapter.assertRelease(tx, current, task);
      // 领域校验可能等待；写入前再次复核凭证、当前权限和业务读取范围。
      current = await this.access.authenticate(tx, actor, token); await this.access.requireVisible(tx, current, task);
      if (action === 'claim' && !isTaskEligible(current, task)) throw new AccessDeniedError('FORBIDDEN');
      const afterStatus = action === 'claim' ? 'CLAIMED' as const : 'OPEN' as const; const assigneeId = action === 'claim' ? current.subjectId : null;
      const now = this.clock.now();
      const updated = await tx.task.update({ where: { id }, data: { status: afterStatus, assigneeId, version: { increment: 1 },
        ...(action === 'claim' ? { reassignNeeded: false } : {}), updatedAt: now } });
      if (action === 'claim') await adapter.claimed?.(tx, current, updated, requestId, now);
      await tx.taskHistory.create({ data: { taskId: id, action: action === 'claim' ? 'CLAIMED' : 'RELEASED', actorType: 'EMPLOYEE', actorEmployeeId: current.subjectId,
        fromAssigneeId: task.assigneeId, toAssigneeId: assigneeId, beforeStatus: task.status, afterStatus, reason: reason ?? null, commandKey, requestId, createdAt: now } });
      await this.audit.appendAudit(tx, { actor: { type: 'EMPLOYEE', id: current.subjectId }, action: action === 'claim' ? 'task.claim' : 'task.release',
        targetId: id, requestId, ...(reason ? { reason } : {}), before: { taskStatus: task.status, assigneeId: task.assigneeId, round: task.round, taskVersion: task.version },
        after: { taskStatus: afterStatus, assigneeId, round: task.round, taskVersion: updated.version } });
      return { changed: true, task: await this.access.present(tx, current, updated, now) };
    }, error => error instanceof TaskError && error.code === 'TASK_LOCK_PLAN_CHANGED');
  }
}
