// 作用：验证新端口默认拒绝、注册完整性、扫描错误脱敏及受限审计；业务成功与竞争留真实数据库验证。
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { expect, it, vi } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { OrderTimerRepositories } from '../src/tasks/order-timer.service.js';
import { TaskBusinessAdapters } from '../src/tasks/task-business-adapters.js';
import { scanFailure } from '../src/tasks/task-overdue-scan.service.js';
import { TaskError } from '../src/tasks/task.errors.js';
import { TaskSchedulerService } from '../src/tasks/task-scheduler.service.js';
import type { TaskOverdueScanService } from '../src/tasks/task-overdue-scan.service.js';
import type { EnvironmentConfig } from '../src/config/environment.js';
it('生产来源/生命周期/计时仓储默认拒绝，注册不完整端口失败', () => {
  const adapters = new TaskBusinessAdapters(); expect(() => adapters.requireLifecycle('ORDER')).toThrowError(expect.objectContaining({ code: 'BUSINESS_MODULE_NOT_READY' }));
  expect(() => adapters.requireSources('ORDER')).toThrow(); expect(adapters.getSources('ORDER')).toBeUndefined();
  const repos = new OrderTimerRepositories(); expect(() => repos.require()).toThrow();
  expect(() => repos.register({} as never)).toThrow(); expect(() => adapters.registerLifecycle('ORDER', {} as never)).toThrow();
});
it('注册先要求真实业务，拒绝重复端口', () => {
  const a = new TaskBusinessAdapters(); a.registerBusiness('ORDER', { planLocks: vi.fn(), authorize: vi.fn(), resolveEntry: vi.fn() });
  const life = { assertTransition: vi.fn(), applyTransition: vi.fn() }; a.registerLifecycle('ORDER', life); expect(a.requireLifecycle('ORDER')).toBe(life); expect(() => a.registerLifecycle('ORDER', life)).toThrow();
  const sources = { assertSource: vi.fn(), find: vi.fn(), listActive: vi.fn(), add: vi.fn(), finish: vi.fn() }; a.registerSources('ORDER', sources); expect(a.requireSources('ORDER')).toBe(sources); expect(() => a.registerSources('ORDER', sources)).toThrow();
  const repos = new OrderTimerRepositories(); const port = { assertAllowed: vi.fn(), load: vi.fn(), save: vi.fn() }; repos.register(port); expect(repos.require()).toBe(port); expect(() => repos.register(port)).toThrow();
});
it('扫描错误只记录固定摘要，异常中的连接串/密码/令牌及未知code不能进入诊断', () => {
  const error = Object.assign(new Error('postgres://secret:password@localhost Bearer private-token'), { code: 'leak-secret' });
  expect(scanFailure(error)).toEqual({ errorCode: 'TASK_SCAN_FAILED', sanitizedMessage: '任务超期扫描失败，事务已回滚；按运行编号排查并等待重扫' });
  expect(scanFailure(new TaskError('BUSINESS_MODULE_NOT_READY')).errorCode).toBe('BUSINESS_MODULE_NOT_READY');
});
it.each(['task.stage.suspend', 'task.stage.resume', 'task.source.add', 'order.timer.block.add'] as const)('新受限审计动作%s允许SYSTEM，禁止夹带敏感字段', async action => {
  const create = vi.fn(); const tx = { auditLog: { create } } as unknown as Prisma.TransactionClient;
  const payload = { action, actor: { type: 'SYSTEM' as const }, targetId: randomUUID(), requestId: randomUUID(), reason: '隔离内核审计' };
  await new AuditService().appendAudit(tx, payload); expect(create).toHaveBeenCalledOnce();
  await expect(new AuditService().appendAudit(tx, { ...payload, after: { password: 'forbidden' } })).rejects.toThrow();
});
it('SYSTEM仍不能执行员工延期/转交等旧受限动作', async () => {
  const tx = { auditLog: { create: vi.fn() } } as unknown as Prisma.TransactionClient;
  await expect(new AuditService().appendAudit(tx, { actor: { type: 'SYSTEM' }, action: 'task.deadline.extend', targetId: randomUUID(), requestId: randomUUID(), reason: '禁止冒名' })).rejects.toThrow();
});
it('调度启动补扫、每分钟触发、本地在途不重叠、重复bootstrap不重复注册，停止后不再触发', async () => {
  vi.useFakeTimers(); let release!: () => void; const held = new Promise<void>(yes => { release = yes; });
  const scan = vi.fn().mockReturnValueOnce(held).mockResolvedValue({});
  const service = new TaskSchedulerService({ scan } as unknown as TaskOverdueScanService, { nodeEnv: 'development' } as EnvironmentConfig);
  try {
    service.onApplicationBootstrap(); service.onApplicationBootstrap(); expect(scan).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(180_000); expect(scan).toHaveBeenCalledTimes(1); release(); await held; await vi.advanceTimersByTimeAsync(60_000); expect(scan).toHaveBeenCalledTimes(2);
    await service.onApplicationShutdown(); await vi.advanceTimersByTimeAsync(60_000); expect(scan).toHaveBeenCalledTimes(2);
  } finally { release(); await service.onApplicationShutdown(); vi.useRealTimers(); }
});
it('test环境不自动启动调度，避免测试进程自行写库', async () => {
  const scan = vi.fn(); const service = new TaskSchedulerService({ scan } as unknown as TaskOverdueScanService, { nodeEnv: 'test' } as EnvironmentConfig);
  service.onApplicationBootstrap(); await service.onApplicationShutdown(); expect(scan).not.toHaveBeenCalled();
});
