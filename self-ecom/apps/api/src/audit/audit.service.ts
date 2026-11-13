// 作用：校验操作者、动作与差异字段白名单并追加最小审计，禁止保存密码和令牌。
import { Injectable } from '@nestjs/common';
import { Prisma, TaskBusinessType, TaskStage, TaskStatus, type AuditActorType } from '@prisma/client';

const policies = {
  'category.change': { target: 'Category', fields: ['catalogVersion','catalogAction','affectedCount','catalogChanges'], reason: false },
  'product.change': { target: 'Product', fields: ['catalogVersion','catalogAction','affectedCount','catalogChanges'], reason: false },
  'employee.create': { target: 'Employee', fields: ['username', 'displayName', 'role', 'status', 'mustChangePassword'], reason: true },
  'employee.profile.update': { target: 'Employee', fields: ['displayName'], reason: true },
  'employee.disable': { target: 'Employee', fields: ['status'], reason: true },
  'employee.enable': { target: 'Employee', fields: ['status'], reason: true },
  'employee.password.reset': { target: 'Employee', fields: ['passwordChanged', 'mustChangePassword'], reason: true },
  'employee.role.change': { target: 'Employee', fields: ['role', 'extraPermissions'], reason: true },
  'employee.permission.replace': { target: 'Employee', fields: ['extraPermissions'], reason: true },
  'employee.password.change': { target: 'Employee', fields: ['passwordChanged', 'mustChangePassword'], reason: false },
  'customer.register': { target: 'Customer', fields: ['status'], reason: false },
  'customer.profile.update': { target: 'Customer', fields: ['nickname'], reason: false },
  'customer.password.change': { target: 'Customer', fields: ['passwordChanged'], reason: false },
  'customer.avatar.change': { target: 'Customer', fields: ['avatarAssetId'], reason: false },
  'file.upload': { target: 'FileAsset', fields: ['purpose', 'mimeType', 'byteSize', 'width', 'height', 'sha256', 'state'], reason: false },
  'communication.append': { target: 'Communication', fields: ['scopeType', 'scopeId', 'channel', 'hasPublicText'], reason: false },
  'communication.correct': { target: 'Communication', fields: ['scopeType', 'scopeId', 'channel', 'hasPublicText', 'correctsId'], reason: true },
  'auth.logout': { target: 'AuthSession', fields: ['loggedOut'], reason: false },
  'store.setting.update': { target: 'StoreSettingVersion', fields: ['versionNumber', 'settingVersionId', 'changedFields'], reason: true },
  'task.create': { target: 'Task', fields: ['businessType', 'businessId', 'stage', 'round', 'taskStatus', 'dueAt', 'settingsVersionId'], reason: true },
  'task.stage.complete': { target: 'Task', fields: ['taskStatus', 'assigneeId', 'round'], reason: true },
  'task.stage.cancel': { target: 'Task', fields: ['taskStatus', 'assigneeId', 'round'], reason: true },
  'task.overdue.record': { target: 'Task', fields: ['dueAt', 'firstOverdueAt'], reason: false },
  'task.claim': { target: 'Task', fields: ['taskStatus', 'assigneeId', 'round', 'taskVersion'], reason: false },
  'task.release': { target: 'Task', fields: ['taskStatus', 'assigneeId', 'round', 'taskVersion'], reason: true },
  'task.transfer': { target: 'Task', fields: ['taskStatus', 'assigneeId', 'round', 'taskVersion', 'reassignNeeded'], reason: true },
  'task.qualification.lost': { target: 'Task', fields: ['taskStatus', 'assigneeId', 'round', 'taskVersion', 'reassignNeeded'], reason: true },
  'task.deadline.extend': { target: 'Task', fields: ['dueAt', 'taskStatus', 'round', 'taskVersion'], reason: true },
  'task.stage.suspend': { target: 'Task', fields: ['taskStatus', 'assigneeId', 'round'], reason: true },
  'task.stage.resume': { target: 'Task', fields: ['taskStatus', 'assigneeId', 'round'], reason: true },
  'task.source.add': { target: 'Task', fields: ['sourceType', 'sourceId', 'sourceStatus'], reason: true },
  'task.source.resolve': { target: 'Task', fields: ['sourceType', 'sourceId', 'sourceStatus'], reason: true },
  'task.source.cancel': { target: 'Task', fields: ['sourceType', 'sourceId', 'sourceStatus'], reason: true },
  'order.timer.block.add': { target: 'Order', fields: ['dueAt', 'timerState', 'cycleNo', 'remainingMs'], reason: true },
  'order.timer.block.release': { target: 'Order', fields: ['dueAt', 'timerState', 'cycleNo', 'remainingMs'], reason: true },
  'order.timer.handover.record': { target: 'Order', fields: ['dueAt', 'timerState', 'cycleNo', 'remainingMs'], reason: true },
  'order.timer.finish': { target: 'Order', fields: ['dueAt', 'timerState', 'cycleNo', 'remainingMs'], reason: true },
} as const;

export type AuditAction = keyof typeof policies;
export type AuditActor =
  | { type: 'EMPLOYEE'; id: string }
  | { type: 'CUSTOMER'; id: string }
  | { type: 'SYSTEM' };

export interface AuditPayload {
  actor: AuditActor;
  action: AuditAction;
  targetId: string;
  requestId: string;
  reason?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const roles = new Set(['SUPER_ADMIN', 'MERCH_WAREHOUSE', 'CUSTOMER_SERVICE']);

function invalid(): never {
  // 不附带输入值，避免校验失败时通过异常泄漏秘密。
  throw new Error('审计载荷不符合动作白名单');
}

function snapshot(value: Record<string, unknown> | undefined, fields: readonly string[]) {
  if (value === undefined) return Prisma.DbNull;
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) invalid();
  const result: Record<string, Prisma.InputJsonValue> = {};
  for (const [field, item] of Object.entries(value)) {
    if (!fields.includes(field)) invalid();
    let valid = false;
    if (field === 'catalogVersion' || field === 'affectedCount') valid = Number.isInteger(item) && (item as number)>=0 && (item as number)<=2147483647;
    else if (field === 'catalogAction') valid = typeof item==='string' && /^[a-z.-]{1,60}$/.test(item);
    else if (field === 'catalogChanges') valid = Array.isArray(item) && item.length<=1000 && item.every(change => {
      if (!change || typeof change!=='object' || Array.isArray(change)) return false;
      const row=change as Record<string,unknown>;
      return Object.keys(row).every(k=>['id','field','before','after'].includes(k))
        && typeof row.id==='string' && uuid.test(row.id) && typeof row.field==='string'
        && ['name','parentId','pathIds','categoryId','status','archivedAt','code','priceCents','costCents','enabled','retiredAt','images','dimensions','quantity','sortOrder','iconKey','brand','description'].includes(row.field)
        && [row.before,row.after].every(v=>v===null || typeof v==='boolean' || (typeof v==='number' && Number.isSafeInteger(v)) || (typeof v==='string' && v.length<=30000));
    });
    else if (field === 'passwordChanged' || field === 'loggedOut') valid = item === true;
    else if (field === 'mustChangePassword' || field === 'reassignNeeded') valid = typeof item === 'boolean';
    else if (field === 'role') valid = typeof item === 'string' && roles.has(item);
    else if (field === 'status') valid = typeof item === 'string'
      && ['ACTIVE', 'DISABLED', 'NORMAL', 'TRADE_RESTRICTED', 'LOGIN_FROZEN'].includes(item);
    else if (field === 'extraPermissions') valid = Array.isArray(item) && item.length <= 200
      && item.every(code => typeof code === 'string' && /^[a-z][a-z0-9.-]{0,99}$/.test(code));
    else if (field === 'username') valid = typeof item === 'string' && /^[a-z][a-z0-9_]{3,31}$/.test(item);
    else if (field === 'displayName' || field === 'nickname') valid = typeof item === 'string'
      && item.trim().length > 0 && [...item].length <= 40;
    else if (field === 'avatarAssetId') valid = item === null || (typeof item === 'string' && uuid.test(item));
    else if (field === 'scopeId' || field === 'correctsId') valid = typeof item === 'string' && uuid.test(item);
    else if (field === 'hasPublicText') valid = typeof item === 'boolean';
    else if (field === 'scopeType') valid = item === 'ORDER' || item === 'AFTER_SALE';
    else if (field === 'channel') valid = typeof item === 'string' && ['PHONE', 'EXTERNAL_MESSAGE', 'IN_PERSON', 'OTHER'].includes(item);
    else if (field === 'purpose') valid = typeof item === 'string' && ['CUSTOMER_AVATAR', 'PRODUCT_IMAGE', 'AFTER_SALE_EVIDENCE',
      'INVENTORY_EVIDENCE', 'FULFILLMENT_EVIDENCE', 'INSPECTION_EVIDENCE', 'COMMUNICATION_EVIDENCE'].includes(item);
    else if (field === 'mimeType') valid = typeof item === 'string' && ['image/jpeg', 'image/png', 'image/webp'].includes(item);
    else if (field === 'byteSize') valid = Number.isInteger(item) && (item as number) >= 1 && (item as number) <= 5242880;
    else if (field === 'width' || field === 'height') valid = Number.isInteger(item) && (item as number) >= 1 && (item as number) <= 10000;
    else if (field === 'sha256') valid = typeof item === 'string' && /^[0-9a-f]{64}$/.test(item);
    else if (field === 'state') valid = item === 'STAGED';
    else if (field === 'versionNumber') valid = Number.isInteger(item) && (item as number) >= 1 && (item as number) <= 2147483647;
    else if (field === 'settingVersionId') valid = typeof item === 'string' && uuid.test(item);
    else if (field === 'changedFields') valid = Array.isArray(item) && item.length >= 1 && item.length <= 6
      && new Set(item).size === item.length && item.every(key => ['shippingFeeCents', 'freeShippingEnabled',
        'freeShippingThresholdCents', 'returnAddress', 'serviceContact', 'deadlines'].includes(key));
    else if (field === 'businessType') valid = typeof item === 'string' && Object.hasOwn(TaskBusinessType, item);
    else if (field === 'businessId') valid = typeof item === 'string' && uuid.test(item);
    else if (field === 'stage') valid = typeof item === 'string' && Object.hasOwn(TaskStage, item);
    else if (field === 'taskStatus') valid = typeof item === 'string' && Object.hasOwn(TaskStatus, item);
    else if (field === 'sourceType') valid = typeof item === 'string' && ['AFTER_SALE', 'SHIPMENT_EXCEPTION', 'STOCK_EXCEPTION', 'HANDOVER_UNCERTAIN', 'ADDRESS_REQUEST'].includes(item);
    else if (field === 'sourceId') valid = typeof item === 'string' && uuid.test(item);
    else if (field === 'sourceStatus') valid = typeof item === 'string' && ['ACTIVE', 'RESOLVED', 'CANCELLED'].includes(item);
    else if (field === 'timerState') valid = typeof item === 'string' && ['UNSHIPPED', 'HANDOVER_UNKNOWN', 'SHIPPED', 'COMPLETED', 'REFUNDED'].includes(item);
    else if (field === 'cycleNo') valid = Number.isInteger(item) && (item as number) >= 0 && (item as number) <= 2147483647;
    else if (field === 'remainingMs') valid = item === null || (Number.isSafeInteger(item) && (item as number) >= 0);
    else if (field === 'round') valid = Number.isInteger(item) && (item as number) >= 1 && (item as number) <= 2147483647;
    else if (field === 'taskVersion') valid = Number.isInteger(item) && (item as number) >= 0 && (item as number) <= 2147483647;
    else if (field === 'assigneeId' || field === 'settingsVersionId') valid = item === null || (typeof item === 'string' && uuid.test(item));
    else if (field === 'dueAt' || field === 'firstOverdueAt') valid = item === null || (typeof item === 'string'
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(item) && Number.isFinite(Date.parse(item)) && new Date(item).toISOString() === item);
    if (!valid) invalid();
    result[field] = item as Prisma.InputJsonValue;
  }
  return result;
}

@Injectable()
export class AuditService {
  /** 必须传入调用方的事务客户端；失败向上传播，由调用方回滚整个命令。 */
  async appendAudit(tx: Prisma.TransactionClient, payload: AuditPayload): Promise<void> {
    // Prisma 7事务支持嵌套$transaction，但移除了$connect；据此拒绝根客户端误传。
    if (typeof (tx as { $connect?: unknown }).$connect === 'function') throw new Error('审计写入必须使用事务客户端');
    if (!Object.hasOwn(policies, payload.action)) invalid();
    const policy = policies[payload.action];
    if (!uuid.test(payload.targetId) || !uuid.test(payload.requestId)) invalid();
    const actor = payload.actor;
    if (!actor || !['EMPLOYEE', 'CUSTOMER', 'SYSTEM'].includes(actor.type)) invalid();
    if (actor.type !== 'SYSTEM' && !uuid.test(actor.id)) invalid();
    // 系统只允许初始化及已明确实现的任务动作，不能冒用系统绕过员工管理主体约束。
    if (actor.type === 'SYSTEM' && !['employee.create', 'task.create', 'task.stage.complete', 'task.stage.cancel', 'task.overdue.record',
      'task.stage.suspend', 'task.stage.resume', 'task.source.add', 'task.source.resolve', 'task.source.cancel',
      'order.timer.block.add', 'order.timer.block.release', 'order.timer.handover.record', 'order.timer.finish'].includes(payload.action)) invalid();
    if (['task.claim', 'task.release', 'task.transfer', 'task.qualification.lost', 'task.deadline.extend'].includes(payload.action) && actor.type !== 'EMPLOYEE') invalid();
    if (payload.action.startsWith('employee.') && actor.type === 'CUSTOMER') invalid();
    if (payload.action.startsWith('customer.') && actor.type !== 'CUSTOMER') invalid();
    if (payload.action.startsWith('communication.') && actor.type !== 'EMPLOYEE') invalid();
    if ((payload.action === 'store.setting.update' || payload.action === 'category.change' || payload.action === 'product.change') && actor.type !== 'EMPLOYEE') invalid();
    const reason = payload.reason?.trim();
    if ((policy.reason && !reason) || (reason !== undefined && [...reason].length > 500)) invalid();
    const beforeData = snapshot(payload.before, policy.fields);
    const afterData = snapshot(payload.after, policy.fields);
    await tx.auditLog.create({ data: {
      actorType: actor.type as AuditActorType,
      actorEmployeeId: actor.type === 'EMPLOYEE' ? actor.id : null,
      actorCustomerId: actor.type === 'CUSTOMER' ? actor.id : null,
      action: payload.action,
      targetType: policy.target,
      targetId: payload.targetId,
      requestId: payload.requestId,
      reason: reason ?? null,
      beforeData,
      afterData,
    } });
  }
}
