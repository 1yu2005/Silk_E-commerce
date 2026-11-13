/** 文件作用：定义受控图片与头像命令的公开契约；不暴露存储键、摘要或上传者。 */
export type FilePurpose = 'CUSTOMER_AVATAR' | 'PRODUCT_IMAGE' | 'AFTER_SALE_EVIDENCE' | 'INVENTORY_EVIDENCE'
  | 'FULFILLMENT_EVIDENCE' | 'INSPECTION_EVIDENCE' | 'COMMUNICATION_EVIDENCE';
export interface FileMetadata {
  id: string; purpose: FilePurpose; state: 'STAGED' | 'RETAINED'; visibility: 'PRIVATE' | 'PUBLIC';
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; byteSize: number; width: number; height: number;
  expiresAt: string | null; contentUrl: string;
}
export interface CustomerAvatarData { avatarAssetId: string | null; avatarUrl: string | null; changed: boolean }
