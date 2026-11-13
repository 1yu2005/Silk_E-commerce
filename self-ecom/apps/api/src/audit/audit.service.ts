// 作用：校验操作者、动作与差异字段白名单并追加最小审计，禁止保存密码和令牌。
import { Injectable } from '@nestjs/common';
import { Prisma, type AuditActorType } from '@prisma/client';

const policies = {
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
    if (field === 'passwordChanged' || field === 'loggedOut') valid = item === true;
    else if (field === 'mustChangePassword') valid = typeof item === 'boolean';
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
    // SYSTEM仅用于初始化管理员；普通员工管理必须由员工主体留痕。
    if (actor.type === 'SYSTEM' && payload.action !== 'employee.create') invalid();
    if (payload.action.startsWith('employee.') && actor.type === 'CUSTOMER') invalid();
    if (payload.action.startsWith('customer.') && actor.type !== 'CUSTOMER') invalid();
    if (payload.action.startsWith('communication.') && actor.type !== 'EMPLOYEE') invalid();
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
