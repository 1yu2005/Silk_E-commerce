// 作用：定义真实业务的锁计划、授权和进入条件端口；生产注册表默认空，测试适配器不进入AppModule。
import { Injectable } from '@nestjs/common';
import type { Prisma, Task, TaskBusinessType, TaskStage } from '@prisma/client';
import { checkedId, requireSessionTransaction } from '../auth/session-support.js';
import type { CurrentIdentity } from '../auth/current-identity.service.js';
import { TaskError } from './task.errors.js';
import type { TaskTransition } from './task-lifecycle.service.js';
import type { TaskBusinessSources } from './task-source.contract.js';

export interface TaskBusinessLifecycle {
  /** 真实领域核对状态、权限、经办和动作语义；重放只读验证，不能冒充完成领域动作。 */
  assertTransition(tx: Prisma.TransactionClient, actor: TaskCommandActor, task: Task, action: TaskTransition, replay: boolean): Promise<void>;
  /** 同步真实领域状态/经办，失败必须传播；生命周期服务只更改Task，不替代领域状态机。 */
  applyTransition(tx: Prisma.TransactionClient, actor: TaskCommandActor, task: Task, action: TaskTransition): Promise<void>;
}

export interface TaskBusinessReference { readonly businessType: TaskBusinessType; readonly businessId: string }
export type TaskCommandActor = CurrentIdentity | { readonly subjectType: 'SYSTEM' };
export type TaskEmployee = Extract<CurrentIdentity, { subjectType: 'EMPLOYEE' }>;
export interface TaskAssignee { readonly id: string; readonly role: TaskEmployee['role']; readonly effectivePermissions: readonly string[] }
export interface TaskBusinessView {
  readonly number: string; readonly label: string; readonly detailPath: string | null;
  readonly canClaim: boolean; readonly canRelease: boolean; readonly canReadHistoryReasons: boolean;
  readonly canTransfer?: boolean;
  readonly canExtendDeadline?: boolean;
}
/** 只同步人工处理/跟进截止；不能改付款、售后申请窗口、自动收货基础计时或交运事实。 */
export interface TaskBusinessDeadline {
  // 只读校验真实阶段及管理员业务范围；幂等重放也要检查，不能顺便写领域状态。
  assertCanExtend(tx: Prisma.TransactionClient, actor: TaskEmployee, task: Task): Promise<void>;
  // 在同一已锁事务同步真实业务截止，外部等待阶段必须更新其真实领域字段；不支持的阶段明确拒绝。
  extend(tx: Prisma.TransactionClient, actor: TaskEmployee, task: Task, newDueAt: Date): Promise<void>;
}
/** 真实领域必须同事务同步经办信息；回池只解除经办，不得把交运未知等事实改成普通待处理。 */
export interface TaskBusinessHandoff {
  transfer(tx: Prisma.TransactionClient, actor: TaskEmployee, target: TaskAssignee, task: Task): Promise<void>;
  qualificationLost(tx: Prisma.TransactionClient, actorId: string, task: Task, reason: string): Promise<void>;
}
/** 独立于阶段进入的读取/交接端口；缺失时不展示任务，也不允许领取或释放。 */
export interface TaskBusinessAccess {
  // 返回经过真实业务读取权限裁剪且确实存在的业务ID；小店首期按此集合分页，不接受浏览器提供范围。
  visibleBusinessIds(tx: Prisma.TransactionClient, actor: TaskEmployee): Promise<readonly string[]>;
  describe(tx: Prisma.TransactionClient, actor: TaskEmployee, task: Task): Promise<TaskBusinessView>;
  assertClaim(tx: Prisma.TransactionClient, actor: TaskEmployee, task: Task): Promise<void>;
  assertRelease(tx: Prisma.TransactionClient, actor: TaskEmployee, task: Task): Promise<void>;
}
// SKU与其库存余额作为同一锁资源，由真实库存模块按既有顺序取锁，不另造通用库存表。
export const TASK_LOCK_ORDER = Object.freeze(['CUSTOMER', 'CATEGORY_TREE', 'ORDER', 'PRODUCT', 'SKU_STOCK', 'INVENTORY_SOURCE',
  'INVENTORY_ADJUSTMENT', 'AFTER_SALE', 'OFFLINE_CASE', 'CUSTODY_ARRANGEMENT'] as const);
export type TaskLockKind = typeof TASK_LOCK_ORDER[number];
export interface TaskLockResource { readonly kind: TaskLockKind; readonly id: string }
export interface TaskStageEntry extends TaskBusinessReference { readonly stage: TaskStage; readonly entryKey: string; readonly reason: string }
export interface TaskEntryDecision {
  /** 必须取真实业务阶段起算时刻；不可直接照收浏览器时间或默认改成记录时间。 */
  readonly startedAt: Date;
  /** 只有领域已确认旧轮结束，才允许替换；未指定时不能悄悄取消现存任务。 */
  readonly replaces?: { readonly taskId: string; readonly expectedVersion: number; readonly outcome: 'COMPLETED' | 'CANCELLED' };
}
export interface TaskBusinessAdapter {
  /** 只读定位所有上游锁；本方法禁止取行锁、写入或发外部请求。 */
  planLocks(tx: Prisma.TransactionClient, reference: TaskBusinessReference): Promise<readonly TaskLockResource[]>;
  /** 持有完整锁计划后核对真实实体、归属与当前主体；幂等重放也必须授权。 */
  authorize(tx: Prisma.TransactionClient, reference: TaskBusinessReference, actor: TaskCommandActor): Promise<void>;
  /** 首次动作须检查真实领域前提及动作键；返回受信任起算和被替代的任务，不接收客户端资格/截止。 */
  resolveEntry(tx: Prisma.TransactionClient, entry: TaskStageEntry, actor: TaskCommandActor, active: Task | null): Promise<TaskEntryDecision>;
}
type Locker = (tx: Prisma.TransactionClient, id: string) => Promise<void>;
const kinds = new Set<string>(TASK_LOCK_ORDER);
const businessTypes = new Set(['INVENTORY_ADJUSTMENT', 'ORDER', 'AFTER_SALE', 'OFFLINE_CASE', 'CUSTODY_ARRANGEMENT']);

export function checkedBusiness(reference: TaskBusinessReference): TaskBusinessReference {
  if (!reference || !businessTypes.has(reference.businessType)) throw new TaskError('TASK_INPUT_INVALID');
  return Object.freeze({ businessType: reference.businessType, businessId: checkedId(reference.businessId) });
}
export function businessKey(reference: TaskBusinessReference): string { return `${reference.businessType}:${reference.businessId}`; }
export function mergeTaskLocks(plans: readonly (readonly TaskLockResource[])[]): readonly TaskLockResource[] {
  const result = new Map<string, TaskLockResource>();
  for (const plan of plans) for (const resource of plan) {
    if (!resource || !kinds.has(resource.kind)) throw new TaskError('TASK_INPUT_INVALID');
    const id = checkedId(resource.id); result.set(`${resource.kind}:${id}`, Object.freeze({ kind: resource.kind, id }));
  }
  return Object.freeze([...result.values()].sort((a, b) => TASK_LOCK_ORDER.indexOf(a.kind) - TASK_LOCK_ORDER.indexOf(b.kind)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}

@Injectable()
export class TaskBusinessAdapters {
  private readonly businesses = new Map<TaskBusinessType, TaskBusinessAdapter>();
  private readonly lockers = new Map<TaskLockKind, Locker>();
  private readonly accessors = new Map<TaskBusinessType, TaskBusinessAccess>();
  private readonly handoffs = new Map<TaskBusinessType, TaskBusinessHandoff>();
  private readonly deadlines = new Map<TaskBusinessType, TaskBusinessDeadline>();
  private readonly lifecycles = new Map<TaskBusinessType, TaskBusinessLifecycle>();
  private readonly sources = new Map<TaskBusinessType, TaskBusinessSources>();
  registerLifecycle(type: TaskBusinessType, port: TaskBusinessLifecycle): void {
    this.require(type);
    if (this.lifecycles.has(type) || !port || typeof port.assertTransition !== 'function' || typeof port.applyTransition !== 'function') throw new Error('任务生命周期端口不完整或重复');
    this.lifecycles.set(type, port);
  }
  requireLifecycle(type: TaskBusinessType): TaskBusinessLifecycle {
    const port = this.lifecycles.get(type); if (!port) throw new TaskError('BUSINESS_MODULE_NOT_READY'); return port;
  }
  registerSources(type: TaskBusinessType, port: TaskBusinessSources): void {
    this.require(type);
    if (this.sources.has(type) || !port || !['assertSource', 'find', 'listActive', 'add', 'finish'].every(key => typeof port[key as keyof TaskBusinessSources] === 'function')) throw new Error('任务来源端口不完整或重复');
    this.sources.set(type, port);
  }
  getSources(type: TaskBusinessType): TaskBusinessSources | undefined { return this.sources.get(type); }
  requireSources(type: TaskBusinessType): TaskBusinessSources {
    const port = this.getSources(type); if (!port) throw new TaskError('BUSINESS_MODULE_NOT_READY'); return port;
  }
  registerDeadline(type: TaskBusinessType, deadline: TaskBusinessDeadline): void {
    this.require(type);
    if (this.deadlines.has(type) || !deadline || typeof deadline.assertCanExtend !== 'function' || typeof deadline.extend !== 'function') {
      throw new Error('任务领域期限适配器注册不合法或重复');
    }
    this.deadlines.set(type, deadline);
  }
  getDeadline(type: TaskBusinessType): TaskBusinessDeadline | undefined { return this.deadlines.get(type); }
  requireDeadline(type: TaskBusinessType): TaskBusinessDeadline {
    const deadline = this.getDeadline(type); if (!deadline) throw new TaskError('BUSINESS_MODULE_NOT_READY'); return deadline;
  }
  registerHandoff(type: TaskBusinessType, handoff: TaskBusinessHandoff): void {
    this.require(type);
    if (this.handoffs.has(type) || !handoff || typeof handoff.transfer !== 'function' || typeof handoff.qualificationLost !== 'function') {
      throw new Error('任务业务交接适配器注册不合法或重复');
    }
    this.handoffs.set(type, handoff);
  }
  getHandoff(type: TaskBusinessType): TaskBusinessHandoff | undefined { return this.handoffs.get(type); }
  requireHandoff(type: TaskBusinessType): TaskBusinessHandoff {
    const handoff = this.getHandoff(type); if (!handoff) throw new TaskError('BUSINESS_MODULE_NOT_READY'); return handoff;
  }
  registerAccess(type: TaskBusinessType, access: TaskBusinessAccess): void {
    this.require(type);
    if (this.accessors.has(type) || !access || !['visibleBusinessIds', 'describe', 'assertClaim', 'assertRelease']
      .every(method => typeof access[method as keyof TaskBusinessAccess] === 'function')) throw new Error('任务读取/交接适配器注册不合法或重复');
    this.accessors.set(type, access);
  }
  access(type: TaskBusinessType): TaskBusinessAccess | undefined { return this.accessors.get(type); }
  accessEntries(): readonly (readonly [TaskBusinessType, TaskBusinessAccess])[] { return [...this.accessors.entries()]; }
  /** 仅供真实领域模块启动时注册，不是HTTP入口；同类型重复注册直接失败。 */
  registerBusiness(type: TaskBusinessType, adapter: TaskBusinessAdapter): void {
    if (!businessTypes.has(type) || this.businesses.has(type) || !adapter
      || !['planLocks', 'authorize', 'resolveEntry'].every(method => typeof adapter[method as keyof TaskBusinessAdapter] === 'function')) throw new Error('任务业务适配器注册不合法或重复');
    this.businesses.set(type, adapter);
  }
  registerLocker(kind: TaskLockKind, locker: Locker): void {
    if (!kinds.has(kind) || this.lockers.has(kind) || typeof locker !== 'function' || kind === 'CUSTOMER') throw new Error('任务业务锁处理器注册不合法或重复');
    this.lockers.set(kind, locker);
  }
  require(type: TaskBusinessType): TaskBusinessAdapter {
    const adapter = this.businesses.get(type); if (!adapter) throw new TaskError('BUSINESS_MODULE_NOT_READY'); return adapter;
  }
  async plan(tx: Prisma.TransactionClient, references: readonly TaskBusinessReference[]) {
    requireSessionTransaction(tx); const plans: (readonly TaskLockResource[])[] = [];
    for (const reference of references) {
      const plan = await this.require(reference.businessType).planLocks(tx, reference);
      // 每个业务至少锁住其稳定父记录；不能拿一个空计划宣称已锁定真实订单/售后。
      if (!plan.some(resource => resource.kind === reference.businessType && resource.id.toLowerCase() === reference.businessId)) throw new TaskError('TASK_INPUT_INVALID');
      plans.push(plan);
    }
    return mergeTaskLocks(plans);
  }
  async acquire(tx: Prisma.TransactionClient, plan: readonly TaskLockResource[]): Promise<void> {
    requireSessionTransaction(tx);
    for (const resource of plan) {
      if (resource.kind === 'CUSTOMER') {
        const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM customer WHERE id=${resource.id}::uuid FOR UPDATE`;
        if (!rows.length) throw new TaskError('TASK_ENTRY_BLOCKED');
      } else {
        const lock = this.lockers.get(resource.kind); if (!lock) throw new TaskError('BUSINESS_MODULE_NOT_READY');
        await lock(tx, resource.id);
      }
    }
  }
}
