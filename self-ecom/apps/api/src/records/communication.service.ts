// 作用：在调用方事务内复核当前身份及业务归属，追加沟通/更正，并以数据库白名单投影公开说明。
import { Inject, Injectable } from '@nestjs/common';
import type { CommunicationChannel, CommunicationScopeType, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { AccessDeniedError } from '../auth/access-denied.error.js';
import { CurrentIdentityService, type CurrentIdentity } from '../auth/current-identity.service.js';
import { TokenValidationError } from '../auth/jwt-token.service.js';
import { lockSessionSubject } from '../auth/session-support.js';
import { BusinessRecordAdapters, type CommunicationAccessMode } from './business-record-adapters.js';
import { optionalRecordText, recordId, RecordInputError, recordObject, recordPage, recordText, requireRecordTransaction, type RecordPage } from './record-support.js';
import { FileBindingService } from '../files/file-binding.service.js';

export interface CommunicationAccess { identity: CurrentIdentity; token: string }
export interface CommunicationScope { scopeType: CommunicationScopeType; scopeId: string }
export interface CommunicationInput extends CommunicationScope {
  channel: CommunicationChannel;
  occurredAt: Date;
  result: string;
  nextStep?: string | null;
  publicText?: string | null;
  correctsId?: string | null;
  correctionReason?: string | null;
  requestId: string;
  attachments?: { fileId: string; audience: 'INTERNAL' | 'CUSTOMER_VISIBLE' }[];
}

function scope(input: CommunicationScope): CommunicationScope {
  if (!input || !['ORDER', 'AFTER_SALE'].includes(input.scopeType)) throw new RecordInputError();
  return { scopeType: input.scopeType, scopeId: recordId(input.scopeId) };
}

@Injectable()
export class CommunicationService {
  constructor(@Inject(CurrentIdentityService) private readonly identities: CurrentIdentityService,
    @Inject(BusinessRecordAdapters) private readonly adapters: BusinessRecordAdapters,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(FileBindingService) private readonly files?: FileBindingService) {}

  private async authorize(tx: Prisma.TransactionClient, access: CommunicationAccess, target: CommunicationScope, mode: CommunicationAccessMode) {
    recordObject(access, ['identity', 'token']);
    const supplied = access.identity;
    const subjectType = mode === 'PUBLIC_READ' ? 'CUSTOMER' : 'EMPLOYEE';
    if (!supplied || supplied.subjectType !== subjectType) throw new AccessDeniedError('FORBIDDEN');
    const subjectId = recordId(supplied.subjectId);
    // 先锁主体并重新读取会话/权限，业务适配器随后按员工→顾客→订单→附属记录的顺序加锁。
    await lockSessionSubject(tx, { subjectType, subjectId });
    const current = await this.identities.authenticate(tx, access.token, subjectType);
    if (current.subjectId !== subjectId || current.sessionId !== supplied.sessionId) throw new TokenValidationError('TOKEN_INVALID');
    if (current.subjectType === 'EMPLOYEE') {
      if (current.mustChangePassword) throw new AccessDeniedError('PASSWORD_CHANGE_REQUIRED');
      const required = mode === 'WRITE' ? 'communication.service.write' : 'order.service.read';
      if (!current.effectivePermissions.includes(required)
        || (target.scopeType === 'AFTER_SALE' && !current.effectivePermissions.includes('after-sale.service.read'))) {
        throw new AccessDeniedError('FORBIDDEN');
      }
    }
    await this.adapters.communication(target.scopeType).lockAndAuthorize(tx, current, target.scopeId, mode);
    return current;
  }

  async appendCommunication(tx: Prisma.TransactionClient, access: CommunicationAccess, input: CommunicationInput) {
    requireRecordTransaction(tx);
    recordObject(input, ['scopeType', 'scopeId', 'channel', 'occurredAt', 'result', 'nextStep', 'publicText', 'correctsId', 'correctionReason', 'requestId', 'attachments']);
    const target = scope(input);
    if (!['PHONE', 'EXTERNAL_MESSAGE', 'IN_PERSON', 'OTHER'].includes(input.channel)
      || !(input.occurredAt instanceof Date) || !Number.isFinite(input.occurredAt.getTime())) throw new RecordInputError();
    const occurredAt = new Date(input.occurredAt.getTime());
    const result = recordText(input.result, 4000); const nextStep = optionalRecordText(input.nextStep, 1000);
    const publicText = optionalRecordText(input.publicText, 2000); const requestId = recordId(input.requestId);
    const attachments = input.attachments ?? [];
    if (!Array.isArray(attachments) || attachments.length > 5) throw new RecordInputError('沟通附件最多5张');
    for (const attachment of attachments) {
      recordObject(attachment, ['fileId', 'audience']); recordId(attachment.fileId);
      if (!['INTERNAL', 'CUSTOMER_VISIBLE'].includes(attachment.audience)
        || (attachment.audience === 'CUSTOMER_VISIBLE' && publicText === null)) throw new RecordInputError('顾客可见附件须有公开说明');
    }
    if (new Set(attachments.map(item => item.fileId.toLowerCase())).size !== attachments.length) throw new RecordInputError('附件不得重复');
    const correctsId = input.correctsId == null ? null : recordId(input.correctsId);
    const correctionReason = optionalRecordText(input.correctionReason, 500);
    if (Boolean(correctsId) !== Boolean(correctionReason)) throw new RecordInputError('更正对象和原因必须同时填写');
    const actor = await this.authorize(tx, access, target, 'WRITE');
    if (actor.subjectType !== 'EMPLOYEE') throw new AccessDeniedError('FORBIDDEN');
    if (correctsId) {
      const original = await tx.communication.findUnique({ where: { id: correctsId }, select: { scopeType: true, scopeId: true, publicText: true } });
      if (!original || original.scopeType !== target.scopeType || original.scopeId !== target.scopeId) {
        throw new RecordInputError('更正对象必须为同一业务下的已有沟通记录');
      }
      if (original.publicText !== null && publicText === null) throw new RecordInputError('公开记录更正须填写公开说明');
    }
    // 与数据库CHECK使用同一事务时刻，兼容宿主机与数据库毫秒级偏差。
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP(3) AS now`;
    const now = clock?.now;
    if (!now || occurredAt.getTime() > now.getTime() + 300000) throw new RecordInputError('沟通时间不能超前服务端五分钟');
    const record = await tx.communication.create({ data: { ...target, authorEmployeeId: actor.subjectId, channel: input.channel,
      occurredAt, result, nextStep, publicText, correctsId, correctionReason, requestId, createdAt: now },
    select: { id: true, createdAt: true, correctsId: true } });
    // 按ID顺序逐个绑定；任一附件或审计失败由上层事务整体回滚。
    for (const attachment of [...attachments].sort((a, b) => a.fileId.localeCompare(b.fileId))) {
      if (!this.files) throw new RecordInputError('文件绑定服务未接入');
      await this.files.bindFiles(tx, access, { ownerType: 'COMMUNICATION', ownerId: record.id, slot: 'evidence',
        audience: attachment.audience, fileIds: [attachment.fileId], commandKey: requestId });
    }
    // 审计只记录元数据和是否公开，不复制内部结果、下一步或自由文本。
    await this.audit.appendAudit(tx, { actor: { type: 'EMPLOYEE', id: actor.subjectId },
      action: correctsId ? 'communication.correct' : 'communication.append', targetId: record.id, requestId,
      ...(correctionReason ? { reason: correctionReason } : {}), after: { ...target, channel: input.channel,
        hasPublicText: publicText !== null, ...(correctsId ? { correctsId } : {}) } });
    return { ...record, createdAt: record.createdAt.toISOString() };
  }

  async readPublicCommunication(tx: Prisma.TransactionClient, access: CommunicationAccess, input: CommunicationScope, pagination: RecordPage = {}) {
    requireRecordTransaction(tx); recordObject(input, ['scopeType', 'scopeId']);
    const target = scope(input); const page = recordPage(pagination);
    await this.authorize(tx, access, target, 'PUBLIC_READ');
    const where = { ...target, publicText: { not: null } };
    const total = await tx.communication.count({ where });
    const rows = await tx.communication.findMany({ where, skip: page.skip, take: page.pageSize,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, publicText: true, occurredAt: true, createdAt: true, correctsId: true,
        _count: { select: { corrections: { where } } } } });
    // 私有原记录的ID不通过公开更正关系泄漏；公开原记录即使被更正也保留展示。
    const parentIds = rows.flatMap(row => row.correctsId ? [row.correctsId] : []);
    const visibleParents = parentIds.length ? await tx.communication.findMany({
      where: { ...where, id: { in: parentIds } }, select: { id: true },
    }) : [];
    const visibleIds = new Set(visibleParents.map(row => row.id));
    const attachments = await tx.fileReference.findMany({ where: { ownerType: 'COMMUNICATION', ownerId: { in: rows.map(row => row.id) },
      audience: 'CUSTOMER_VISIBLE' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { ownerId: true, fileAssetId: true } });
    return { items: rows.map(row => ({ id: row.id, publicText: row.publicText!, occurredAt: row.occurredAt.toISOString(),
      createdAt: row.createdAt.toISOString(), correctsId: row.correctsId && visibleIds.has(row.correctsId) ? row.correctsId : null,
      isCorrected: row._count.corrections > 0, attachments: attachments.filter(item => item.ownerId === row.id)
        .map(item => ({ fileId: item.fileAssetId, contentUrl: `/api/v1/files/${item.fileAssetId}/content` })) })), total, page: page.page, pageSize: page.pageSize };
  }

  async readInternalCommunication(tx: Prisma.TransactionClient, access: CommunicationAccess, input: CommunicationScope, pagination: RecordPage = {}) {
    requireRecordTransaction(tx); recordObject(input, ['scopeType', 'scopeId']);
    const target = scope(input); const page = recordPage(pagination);
    await this.authorize(tx, access, target, 'INTERNAL_READ');
    const total = await tx.communication.count({ where: target });
    const items = await tx.communication.findMany({ where: target, skip: page.skip, take: page.pageSize,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, authorEmployeeId: true, channel: true,
        occurredAt: true, result: true, nextStep: true, publicText: true, correctsId: true, correctionReason: true, createdAt: true } });
    const attachments = await tx.fileReference.findMany({ where: { ownerType: 'COMMUNICATION', ownerId: { in: items.map(row => row.id) } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { ownerId: true, fileAssetId: true, audience: true } });
    return { items: items.map(row => ({ ...row, attachments: attachments.filter(item => item.ownerId === row.id)
      .map(item => ({ fileId: item.fileAssetId, audience: item.audience, contentUrl: `/api/v1/files/${item.fileAssetId}/content` })) })), total, page: page.page, pageSize: page.pageSize };
  }
}
