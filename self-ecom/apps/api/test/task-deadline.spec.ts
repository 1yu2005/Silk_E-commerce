// 作用：验证延期UTC输入、DTO、默认拒绝和审计白名单；实际授权、并发及回滚另由真实数据库验证。
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { expect, it, vi } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { TaskBusinessAdapters } from '../src/tasks/task-business-adapters.js';
import { parseTaskDueAt } from '../src/tasks/task-deadline-input.js';
import { ExtendTaskDeadlineDto } from '../src/tasks/task.dto.js';
it.each(['2026-11-20T02:00:00Z', '2026-11-20T02:00:00.0Z', '2026-11-20T02:00:00.00Z', '2026-11-20T02:00:00.000Z'])('UTC输入%s规范化为同一毫秒时刻', async newDueAt => {
  expect(parseTaskDueAt(newDueAt)?.toISOString()).toBe('2026-11-20T02:00:00.000Z');
  const value = plainToInstance(ExtendTaskDeadlineDto, { newDueAt, expectedVersion: 0, reason: ' 进一步核实 ' });
  expect(await validate(value)).toHaveLength(0); expect(value.reason).toBe('进一步核实');
});
it.each([null, undefined, true, 123, {}, [], '', '2026-11-20', '2026-11-20T02:00:00', '2026-11-20T10:00:00+08:00',
  '2026-11-20T02:00:00.0000Z', '2026-02-30T02:00:00Z', '2026-11-20T24:00:00Z', '2026-11-20T02:60:00Z',
  '2026-11-20T02:00:60Z', '2026-11-20t02:00:00z', ' 2026-11-20T02:00:00Z ', '+010000-11-20T02:00:00Z'])('严格拒绝非法日期/本地时区/额外精度%s', async newDueAt => {
  expect(parseTaskDueAt(newDueAt)).toBeNull(); expect(await validate(plainToInstance(ExtendTaskDeadlineDto, { newDueAt, expectedVersion: 0, reason: '核实' }))).not.toHaveLength(0);
});
it('期限适配器无默认成功，必须完整注册且禁止重复', () => {
  const registry = new TaskBusinessAdapters(); expect(() => registry.requireDeadline('ORDER')).toThrow();
  const port = { assertCanExtend: vi.fn(), extend: vi.fn() }; expect(() => registry.registerDeadline('ORDER', port)).toThrow();
  registry.registerBusiness('ORDER', { planLocks: vi.fn(), authorize: vi.fn(), resolveEntry: vi.fn() });
  expect(() => registry.registerDeadline('ORDER', { assertCanExtend: vi.fn() } as unknown as typeof port)).toThrow();
  registry.registerDeadline('ORDER', port); expect(registry.requireDeadline('ORDER')).toBe(port); expect(() => registry.registerDeadline('ORDER', port)).toThrow();
});
it.each(['SYSTEM', 'CUSTOMER'] as const)('延期审计拒绝%s冒名，SYSTEM旧白名单不扩张', async type => {
  const create = vi.fn(); const tx = { auditLog: { create } } as unknown as Prisma.TransactionClient;
  await expect(new AuditService().appendAudit(tx, { actor: type === 'SYSTEM' ? { type } : { type, id: randomUUID() }, action: 'task.deadline.extend',
    targetId: randomUUID(), requestId: randomUUID(), reason: '延期', after: { dueAt: '2026-11-20T02:00:00.000Z', round: 1, taskStatus: 'OPEN', taskVersion: 1 } })).rejects.toThrow();
  expect(create).not.toHaveBeenCalled();
});
it('延期审计只保存截止和状态/版本，原因必填，不接收完整领域状态或凭证', async () => {
  const create = vi.fn().mockResolvedValue({}); const tx = { auditLog: { create } } as unknown as Prisma.TransactionClient;
  const payload = { actor: { type: 'EMPLOYEE' as const, id: randomUUID() }, action: 'task.deadline.extend' as const, targetId: randomUUID(), requestId: randomUUID(), reason: '延期核实',
    before: { dueAt: null, taskStatus: 'OPEN', round: 1, taskVersion: 0 }, after: { dueAt: '2026-11-20T02:00:00.000Z', taskStatus: 'OPEN', round: 1, taskVersion: 1 } };
  await new AuditService().appendAudit(tx, payload); expect(create).toHaveBeenCalledOnce();
  for (const patch of [{ reason: ' ' }, { after: { ...payload.after, password: '不应保存' } }, { after: { ...payload.after, dueAt: '2026-02-30T00:00:00.000Z' } }]) {
    await expect(new AuditService().appendAudit(tx, { ...payload, ...patch })).rejects.toThrow();
  }
  expect(create).toHaveBeenCalledOnce();
});
