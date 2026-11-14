// 作用：集中维护图片用途资格、引用类型限制及安全元数据投影，权限沿用已有业务目录。
import type { FileAsset, FilePurpose, FileOwnerType } from '@prisma/client';
import { AccessDeniedError } from '../auth/access-denied.error.js';
import type { CurrentIdentity } from '../auth/current-identity.service.js';
import { FileError } from './file.errors.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const purposePermissions = {
  CUSTOMER_AVATAR: [], PRODUCT_IMAGE: ['product.manage'], AFTER_SALE_EVIDENCE: ['customer.frozen.proxy'],
  INVENTORY_EVIDENCE: ['inventory.adjustment.create', 'inventory.source.manage', 'inventory.order-exception.manage'],
  FULFILLMENT_EVIDENCE: ['shipment.exception.manage', 'order.physical.check', 'shipment.handover', 'shipment.history.correct', 'shipment.tracking.correct', 'shipment.customer-confirm'],
  INSPECTION_EVIDENCE: ['after-sale.inspection.confirm', 'after-sale.receipt.record'],
  COMMUNICATION_EVIDENCE: ['communication.service.write', 'offline-case.manage'],
} as const;
export function checkedPurpose(value: unknown): FilePurpose {
  if (typeof value !== 'string' || !Object.hasOwn(purposePermissions, value)) throw new FileError('FILE_INVALID_UPLOAD');
  return value as FilePurpose;
}
export function assertUploadPurpose(actor: CurrentIdentity, purpose: FilePurpose): void {
  if (actor.subjectType === 'CUSTOMER') {
    if (!['CUSTOMER_AVATAR', 'AFTER_SALE_EVIDENCE'].includes(purpose)) throw new AccessDeniedError('FORBIDDEN');
    return;
  }
  if (actor.mustChangePassword) throw new AccessDeniedError('PASSWORD_CHANGE_REQUIRED');
  const required: readonly string[] = purposePermissions[purpose];
  if (!required.length || !required.some(code => actor.effectivePermissions.includes(code))) throw new AccessDeniedError('FORBIDDEN');
}
export function uploadedBy(asset: Pick<FileAsset, 'uploaderType' | 'uploaderCustomerId' | 'uploaderEmployeeId'>, actor: CurrentIdentity) {
  return asset.uploaderType === actor.subjectType && (actor.subjectType === 'CUSTOMER'
    ? asset.uploaderCustomerId : asset.uploaderEmployeeId) === actor.subjectId;
}
export const ownerPolicies: Record<FileOwnerType, { purpose: FilePurpose; slots: readonly string[]; max: number; public: boolean }> = {
  ORDER_ITEM: { purpose: 'PRODUCT_IMAGE', slots: ['snapshot'], max: 1, public: true },
  STOCK_INCIDENT: { purpose: 'INVENTORY_EVIDENCE', slots: ['evidence'], max: 5, public: false },
  HANDOVER_VERIFICATION: { purpose: 'FULFILLMENT_EVIDENCE', slots: ['evidence'], max: 5, public: false },
  SHIPMENT_EXCEPTION: { purpose: 'FULFILLMENT_EVIDENCE', slots: ['evidence'], max: 5, public: false },
  SHIPMENT_EXCEPTION_DECISION: { purpose: 'FULFILLMENT_EVIDENCE', slots: ['evidence'], max: 5, public: false },
  SHIPMENT_TRACKING_REVISION: { purpose: 'FULFILLMENT_EVIDENCE', slots: ['evidence'], max: 5, public: false },
  CUSTOMER_AVATAR: { purpose: 'CUSTOMER_AVATAR', slots: ['avatar'], max: 1, public: true },
  PRODUCT: { purpose: 'PRODUCT_IMAGE', slots: ['main', 'gallery'], max: 10, public: true },
  AFTER_SALE_MATERIAL: { purpose: 'AFTER_SALE_EVIDENCE', slots: ['evidence'], max: 5, public: false },
  AFTER_SALE_RETURN_LOGISTICS: {purpose:'AFTER_SALE_EVIDENCE',slots:['evidence'],max:5,public:false},
  AFTER_SALE_RETURN_VERIFICATION: {purpose:'COMMUNICATION_EVIDENCE',slots:['evidence'],max:5,public:false},
  INVENTORY_ADJUSTMENT: { purpose: 'INVENTORY_EVIDENCE', slots: ['evidence'], max: 5, public: false },
  INVENTORY_SOURCE: { purpose: 'INVENTORY_EVIDENCE', slots: ['evidence'], max: 5, public: false },
  FULFILLMENT_CHECK: { purpose: 'FULFILLMENT_EVIDENCE', slots: ['evidence'], max: 5, public: false },
  RETURN_RECEIPT: { purpose: 'INSPECTION_EVIDENCE', slots: ['evidence'], max: 5, public: false },
  RETURN_INSPECTION: { purpose: 'INSPECTION_EVIDENCE', slots: ['evidence'], max: 5, public: false },
  COMMUNICATION: { purpose: 'COMMUNICATION_EVIDENCE', slots: ['evidence'], max: 5, public: false },
  OFFLINE_CASE: { purpose: 'COMMUNICATION_EVIDENCE', slots: ['evidence'], max: 5, public: false },
};
export function fileMetadata(asset: FileAsset) {
  return { id: asset.id, purpose: asset.purpose, state: asset.state, visibility: asset.visibility,
    mimeType: asset.mimeType, byteSize: asset.byteSize, width: asset.width, height: asset.height,
    expiresAt: asset.expiresAt?.toISOString() ?? null, contentUrl: `/api/v1/files/${asset.id}/content` };
}
