// 作用：冻结同阶段多来源的事务仓储契约；真实表随订单板块迁移，当前没有生产默认仓储。
import type { Prisma, Task } from '@prisma/client';
import type { TaskCommandActor } from './task-business-adapters.js';
export const TASK_SOURCE_TYPES = ['AFTER_SALE', 'SHIPMENT_EXCEPTION', 'STOCK_EXCEPTION', 'HANDOVER_UNCERTAIN', 'ADDRESS_REQUEST'] as const;
export type TaskSourceType = typeof TASK_SOURCE_TYPES[number];
export interface TaskSourceReference { readonly sourceType: TaskSourceType; readonly sourceId: string }
export interface TaskSourceMetadata {
  readonly commandKey: string; readonly reason: string; readonly requestId: string; readonly now: Date; readonly actor: TaskCommandActor;
  readonly outcome?: 'COMPLETED' | 'CANCELLED';
}
export interface TaskSourceRecord extends TaskSourceReference {
  readonly taskId: string; readonly status: 'ACTIVE' | 'RESOLVED' | 'CANCELLED';
  readonly addCommandKey: string; readonly addReason: string; readonly addActorKey: string;
  readonly resolutionCommandKey: string | null; readonly resolutionReason: string | null; readonly resolutionActorKey: string | null;
  readonly resolutionOutcome: 'COMPLETED' | 'CANCELLED' | null;
}
export const taskActorKey = (actor: TaskCommandActor) => actor.subjectType === 'SYSTEM' ? 'SYSTEM' : `${actor.subjectType}:${actor.subjectId}`;
export interface TaskBusinessSources {
  /** 必须解析真实来源，验证同业务父对象及操作资格；不能只验证UUID格式。 */
  assertSource(tx: Prisma.TransactionClient, actor: TaskCommandActor, task: Task, source: TaskSourceReference): Promise<void>;
  find(tx: Prisma.TransactionClient, task: Task, source: TaskSourceReference): Promise<TaskSourceRecord | null>;
  listActive(tx: Prisma.TransactionClient, task: Task): Promise<readonly TaskSourceRecord[]>;
  /** 仓储须按Task之后的稳定顺序持来源锁，写来源及只追加的来源历史，禁止另开事务。 */
  add(tx: Prisma.TransactionClient, task: Task, source: TaskSourceReference, metadata: TaskSourceMetadata): Promise<TaskSourceRecord>;
  finish(tx: Prisma.TransactionClient, task: Task, source: TaskSourceRecord, status: 'RESOLVED' | 'CANCELLED', metadata: TaskSourceMetadata): Promise<TaskSourceRecord>;
}
