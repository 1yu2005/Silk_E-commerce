// 作用：集中选择并投影本人资料，头像只输出服务端受控URL，不暴露内部文件关系。
import type { Prisma } from '@prisma/client';
export const customerSummarySelect = { id: true, phone: true, nickname: true, status: true, createdAt: true,
  avatarAsset: { select: { id: true, purpose: true, state: true, visibility: true, uploaderCustomerId: true } },
} satisfies Prisma.CustomerSelect;
type Summary = Prisma.CustomerGetPayload<{ select: typeof customerSummarySelect }>;
export function customerSummary(customer: Summary) {
  const { avatarAsset, ...profile } = customer;
  const valid = avatarAsset?.purpose === 'CUSTOMER_AVATAR' && avatarAsset.state === 'RETAINED'
    && avatarAsset.visibility === 'PUBLIC' && avatarAsset.uploaderCustomerId === customer.id;
  return { ...profile, avatarUrl: valid ? `/api/v1/files/${avatarAsset.id}/content` : null };
}
