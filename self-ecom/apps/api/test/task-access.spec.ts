// 作用：验证任务当前完整资格、严格DTO、审计主体和有限重试；真实授权/锁/回滚另由集成测试验证。
import { randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Prisma, Task } from '@prisma/client';
import { expect, it, vi } from 'vitest';
import { runAuthTransaction } from '../src/auth/auth-transaction.js';
import { AuditService } from '../src/audit/audit.service.js';
import { PermissionService } from '../src/permissions/permission.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { isTaskEligible } from '../src/tasks/task-access.service.js';
import type { TaskEmployee } from '../src/tasks/task-business-adapters.js';
import { ClaimTaskDto, ReleaseTaskDto, TransferTaskDto, TaskQueryDto } from '../src/tasks/task.dto.js';
import { TaskError } from '../src/tasks/task.errors.js';
const actor = { subjectType: 'EMPLOYEE', subjectId: randomUUID(), role: 'MERCH_WAREHOUSE',
  effectivePermissions: new PermissionService().effectivePermissions('MERCH_WAREHOUSE', []) } as TaskEmployee;
it('完整资格同时要求目录与快照，不能用删减快照或未知权限放行', () => {
  const task = { businessType: 'ORDER', stage: 'SHIPMENT_PROCESS', requiredPermissions: ['order.fulfillment.read', 'shipment.claim', 'shipment.pack', 'shipment.handover'] } as Task;
  expect(isTaskEligible(actor, task)).toBe(true);
  expect(isTaskEligible({ ...actor, effectivePermissions: ['order.fulfillment.read', 'shipment.claim'] }, { ...task, requiredPermissions: ['shipment.claim'] })).toBe(false);
  expect(isTaskEligible(actor, { ...task, requiredPermissions: [...task.requiredPermissions as string[], 'unknown.permission'] })).toBe(false);
});
it.each([{ expectedVersion: '1' }, { expectedVersion: true }, { expectedVersion: -1 }, { expectedVersion: 1.1 }, { expectedVersion: 2147483648 }, {}])('领取严格拒绝非法版本%s', async input => {
  expect(await validate(plainToInstance(ClaimTaskDto, input))).not.toHaveLength(0);
});
it('查询复用严格布尔/分页，释放Unicode规范化长度与HTTP一致', async () => {
  const query = plainToInstance(TaskQueryDto, { overdue: 'false', page: '2' }); expect(query.overdue).toBe(false); expect(query.page).toBe(2); expect(await validate(query)).toHaveLength(0);
  expect(await validate(plainToInstance(TaskQueryDto, { overdue: '0' }))).not.toHaveLength(0);
  expect(await validate(plainToInstance(ReleaseTaskDto, { expectedVersion: 0, reason: ` ${'😀'.repeat(500)} ` }))).toHaveLength(0);
  expect(await validate(plainToInstance(ReleaseTaskDto, { expectedVersion: 0, reason: '😀'.repeat(501) }))).not.toHaveLength(0);
});
it('补充锁集合变化重试与数据库冲突共用总共三次上限，普通业务拒绝仍不重试', async () => {
  const error = new TaskError('TASK_LOCK_PLAN_CHANGED'); const transaction = vi.fn().mockRejectedValue(error); const retry = (value: unknown) => value instanceof TaskError && value.code === 'TASK_LOCK_PLAN_CHANGED';
  await expect(runAuthTransaction({ $transaction: transaction } as unknown as PrismaService, vi.fn(), retry)).rejects.toBe(error); expect(transaction).toHaveBeenCalledTimes(3);
  transaction.mockReset().mockRejectedValue(new TaskError('TASK_ALREADY_CLAIMED'));
  await expect(runAuthTransaction({ $transaction: transaction } as unknown as PrismaService, vi.fn(), retry)).rejects.toMatchObject({ code: 'TASK_ALREADY_CLAIMED' }); expect(transaction).toHaveBeenCalledTimes(1);
});
it.each(['SYSTEM', 'CUSTOMER'] as const)('领取/释放审计不能使用%s主体', async type => {
  const create = vi.fn(); const tx = { auditLog: { create } } as unknown as Prisma.TransactionClient;
  for (const action of ['task.claim', 'task.release', 'task.transfer', 'task.qualification.lost'] as const) await expect(new AuditService().appendAudit(tx, { actor: type === 'SYSTEM' ? { type } : { type, id: randomUUID() },
    action, targetId: randomUUID(), requestId: randomUUID(), reason: '交班', after: { taskStatus: 'OPEN', assigneeId: null, round: 1, taskVersion: 1 } })).rejects.toThrow();
  expect(create).not.toHaveBeenCalled();
});
it('转交DTO目标必填且严格校验UUID，原因规范化并复用版本限制', async () => {
  const id = randomUUID(); const input = plainToInstance(TransferTaskDto, { targetEmployeeId: id.toUpperCase(), expectedVersion: 0, reason: ' 服装任务交接 ' });
  expect(await validate(input)).toHaveLength(0); expect(input.targetEmployeeId).toBe(id); expect(input.reason).toBe('服装任务交接');
  for (const targetEmployeeId of [undefined, null, 1, '../employee', '']) expect(await validate(plainToInstance(TransferTaskDto,
    { targetEmployeeId, expectedVersion: 0, reason: '交接' }))).not.toHaveLength(0);
});
