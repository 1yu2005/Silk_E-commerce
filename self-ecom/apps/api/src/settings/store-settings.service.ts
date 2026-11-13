// 作用：提供完整设置快照、版本化写入与裁剪后的公开联系方式，复用身份复核和同事务审计。
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type StoreSettingVersion } from '@prisma/client';
import { paginationWindow } from '@shop/shared';
import { AuditService } from '../audit/audit.service.js';
import { AccessDeniedError } from '../auth/access-denied.error.js';
import { runAuthTransaction } from '../auth/auth-transaction.js';
import { CurrentIdentityService, type CurrentIdentity } from '../auth/current-identity.service.js';
import { TokenValidationError } from '../auth/jwt-token.service.js';
import { Clock } from '../common/time/clock.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingVersionsQueryDto, UpdateStoreSettingsDto } from './store-settings.dto.js';
import { StoreSettingsError } from './store-settings.errors.js';

type ContentRow = Omit<StoreSettingVersion, 'id' | 'versionNumber' | 'createdByEmployeeId' | 'reason' | 'createdAt'>;
function content(row: ContentRow) {
  return { shippingFeeCents: row.shippingFeeCents, freeShippingEnabled: row.freeShippingEnabled,
    freeShippingThresholdCents: row.freeShippingThresholdCents,
    returnAddress: { receiver: row.returnReceiver, phone: row.returnPhone, province: row.returnProvince,
      city: row.returnCity, district: row.returnDistrict, detail: row.returnDetail },
    serviceContact: { phone: row.servicePhone, serviceHours: row.serviceHours },
    deadlines: { paymentMinutes: row.paymentMinutes, autoReceiptDays: row.autoReceiptDays,
      afterSaleWindowDays: row.afterSaleWindowDays, reviewWorkdays: row.reviewWorkdays, supplementDays: row.supplementDays,
      returnShipDays: row.returnShipDays, inspectionWorkdays: row.inspectionWorkdays, refundWorkdays: row.refundWorkdays } };
}
function versionView(row: StoreSettingVersion) {
  return { id: row.id, versionNumber: row.versionNumber, createdByEmployeeId: row.createdByEmployeeId,
    createdAt: row.createdAt, reason: row.reason, ...content(row) };
}
const readOptions = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 5000 };

@Injectable()
export class StoreSettingsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CurrentIdentityService) private readonly identities: CurrentIdentityService,
    @Inject(AuditService) private readonly audit: AuditService, @Inject(Clock) private readonly clock: Clock) {}

  async current() {
    return this.prisma.$transaction(async tx => {
      const head = await tx.storeSettingHead.findUniqueOrThrow({ where: { id: 1 }, include: { currentVersion: true } });
      return { configured: head.currentVersion !== null, version: head.version,
        currentSetting: head.currentVersion ? versionView(head.currentVersion) : null };
    }, readOptions);
  }

  async contact() {
    return this.prisma.$transaction(async tx => {
      // 只读取公开列，不把完整设置、退货地址或修改人带入公开返回对象。
      const head = await tx.storeSettingHead.findUniqueOrThrow({ where: { id: 1 }, select: { version: true,
        currentVersion: { select: { servicePhone: true, serviceHours: true } } } });
      return { configured: head.currentVersion !== null, servicePhone: head.currentVersion?.servicePhone ?? null,
        serviceHours: head.currentVersion?.serviceHours ?? null, settingsVersion: head.version };
    }, readOptions);
  }

  /** 供后续领域在自身事务中读取并固化快照；不另开事务，不为未配置环境补造默认地址。 */
  async requireCurrent(tx: Prisma.TransactionClient): Promise<StoreSettingVersion> {
    const head = await tx.storeSettingHead.findUniqueOrThrow({ where: { id: 1 }, include: { currentVersion: true } });
    if (!head.currentVersion) throw new StoreSettingsError('STORE_NOT_CONFIGURED');
    return head.currentVersion;
  }

  async versions(query: SettingVersionsQueryDto) {
    return this.prisma.$transaction(async tx => {
      const total = await tx.storeSettingVersion.count(); const window = paginationWindow(query, total);
      const items = window.skip === null ? [] : await tx.storeSettingVersion.findMany({
        select: { id: true, versionNumber: true, createdByEmployeeId: true, createdAt: true, reason: true },
        orderBy: { versionNumber: 'desc' }, skip: window.skip, take: window.take });
      return { items, total, page: query.page, pageSize: query.pageSize };
    }, readOptions);
  }

  async version(id: string) {
    const row = await this.prisma.storeSettingVersion.findUnique({ where: { id } });
    if (!row) throw new StoreSettingsError('SETTING_VERSION_NOT_FOUND');
    return versionView(row);
  }

  async update(actor: CurrentIdentity, token: string, input: UpdateStoreSettingsDto, requestId: string) {
    if (actor.subjectType !== 'EMPLOYEE') throw new TokenValidationError('TOKEN_SUBJECT_MISMATCH');
    return runAuthTransaction(this.prisma, async tx => {
      // 设置不改变管理员集合；遵循员工→设置锁序，不持Head反向取员工锁。
      await tx.$queryRaw`SELECT id FROM employee WHERE id=${actor.subjectId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM store_setting_head WHERE id=1 FOR UPDATE`;
      const current = await this.identities.authenticate(tx, token, 'EMPLOYEE');
      if (current.subjectId !== actor.subjectId || current.sessionId !== actor.sessionId) throw new TokenValidationError('TOKEN_INVALID');
      if (current.subjectType !== 'EMPLOYEE') throw new TokenValidationError('TOKEN_SUBJECT_MISMATCH');
      if (current.mustChangePassword) throw new AccessDeniedError('PASSWORD_CHANGE_REQUIRED');
      if (current.role !== 'SUPER_ADMIN' || !current.effectivePermissions.includes('store.setting.manage')) throw new AccessDeniedError('FORBIDDEN');
      const head = await tx.storeSettingHead.findUniqueOrThrow({ where: { id: 1 }, include: { currentVersion: true } });
      // 先检查版本再判断同内容，旧版本提交始终冲突，不悄悄覆盖或当作成功。
      if (head.version !== input.expectedVersion) throw new StoreSettingsError('VERSION_CONFLICT');
      const data = { shippingFeeCents: input.shippingFeeCents, freeShippingEnabled: input.freeShippingEnabled,
        freeShippingThresholdCents: input.freeShippingThresholdCents,
        returnReceiver: input.returnAddress.receiver, returnPhone: input.returnAddress.phone,
        returnProvince: input.returnAddress.province, returnCity: input.returnAddress.city,
        returnDistrict: input.returnAddress.district, returnDetail: input.returnAddress.detail,
        servicePhone: input.serviceContact.phone, serviceHours: input.serviceContact.serviceHours || null,
        ...input.deadlines };
      const fields = ['shippingFeeCents', 'freeShippingEnabled', 'freeShippingThresholdCents', 'returnAddress', 'serviceContact', 'deadlines'] as const;
      const previous = head.currentVersion ? content(head.currentVersion) : null;
      const next = content(data);
      const changedFields = fields.filter(field => !previous || JSON.stringify(previous[field]) !== JSON.stringify(next[field]));
      if (changedFields.length === 0 && head.currentVersion) return { version: head.version,
        settingVersionId: head.currentVersion.id, changed: false, currentSetting: versionView(head.currentVersion) };
      const setting = await tx.storeSettingVersion.create({ data: { ...data, versionNumber: head.version + 1,
        createdByEmployeeId: current.subjectId, reason: input.reason, createdAt: this.clock.now() } });
      await tx.storeSettingHead.update({ where: { id: 1 }, data: { currentVersionId: setting.id, version: setting.versionNumber } });
      await this.audit.appendAudit(tx, { actor: { type: 'EMPLOYEE', id: current.subjectId }, action: 'store.setting.update',
        targetId: setting.id, requestId, reason: input.reason,
        before: head.currentVersion ? { versionNumber: head.version, settingVersionId: head.currentVersion.id } : undefined,
        after: { versionNumber: setting.versionNumber, settingVersionId: setting.id, changedFields } });
      return { version: setting.versionNumber, settingVersionId: setting.id, changed: true, currentSetting: versionView(setting) };
    });
  }
}
