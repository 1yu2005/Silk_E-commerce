// 作用：验证新增审计动作只接受最小元数据，拒绝自由文本、凭据、存储路径及主体冒用。
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { expect, it, vi } from 'vitest';
import { AuditService, type AuditPayload } from '../src/audit/audit.service.js';

function fixture() {
  const create = vi.fn().mockResolvedValue({});
  const tx = { auditLog: { create } } as unknown as Prisma.TransactionClient;
  const payload: AuditPayload = { actor: { type: 'EMPLOYEE', id: randomUUID() }, action: 'communication.append',
    targetId: randomUUID(), requestId: randomUUID(), after: { scopeType: 'ORDER', scopeId: randomUUID(), channel: 'PHONE', hasPublicText: false } };
  return { create, tx, payload, audit: new AuditService() };
}

it('沟通审计仅保存对象、渠道、是否公开；公开内容及内部正文由沟通表保存', async () => {
  const f = fixture(); await f.audit.appendAudit(f.tx, f.payload);
  expect(f.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'communication.append', targetType: 'Communication', afterData: f.payload.after }) });
});
it.each(['result', 'nextStep', 'publicText', 'phone', 'password', 'passwordHash', 'token', 'storageKey', 'originalName'])('沟通审计拒绝%s且不回显输入', async field => {
  const f = fixture(); const secret = '不应出现在错误或审计中的文字';
  await expect(f.audit.appendAudit(f.tx, { ...f.payload, after: { ...f.payload.after, [field]: secret } }))
    .rejects.toThrow('审计载荷不符合动作白名单');
  expect(f.create).not.toHaveBeenCalled();
});
it('公开更正审计记录关联及原因；缺少原因不写入', async () => {
  const f = fixture(); const payload = { ...f.payload, action: 'communication.correct' as const,
    after: { ...f.payload.after, correctsId: randomUUID(), hasPublicText: true } };
  await expect(f.audit.appendAudit(f.tx, payload)).rejects.toThrow('审计载荷不符合动作白名单');
  await f.audit.appendAudit(f.tx, { ...payload, reason: '补充说明' });
  expect(f.create).toHaveBeenCalledTimes(1);
});
it.each(['CUSTOMER', 'SYSTEM'] as const)('拒绝%s主体伪造员工沟通审计', async type => {
  const f = fixture();
  await expect(f.audit.appendAudit(f.tx, { ...f.payload, actor: type === 'SYSTEM' ? { type } : { type, id: randomUUID() } }))
    .rejects.toThrow('审计载荷不符合动作白名单');
  expect(f.create).not.toHaveBeenCalled();
});
it('头像设置和清除允许UUID/NULL，其他主体或任意地址被拒绝', async () => {
  const f = fixture(); const actor = { type: 'CUSTOMER' as const, id: randomUUID() };
  const payload: AuditPayload = { ...f.payload, actor, action: 'customer.avatar.change', before: { avatarAssetId: null }, after: { avatarAssetId: randomUUID() } };
  await f.audit.appendAudit(f.tx, payload);
  await f.audit.appendAudit(f.tx, { ...payload, before: payload.after, after: { avatarAssetId: null } });
  await expect(f.audit.appendAudit(f.tx, { ...payload, actor: f.payload.actor })).rejects.toThrow();
  await expect(f.audit.appendAudit(f.tx, { ...payload, after: { avatarAssetId: 'https://example.com/arbitrary.png' } })).rejects.toThrow();
  expect(f.create).toHaveBeenCalledTimes(2);
});
it('文件上传审计保存受控元数据，拒绝路径、内部状态和超限值', async () => {
  const f = fixture(); const payload: AuditPayload = { ...f.payload, action: 'file.upload', after: {
    purpose: 'PRODUCT_IMAGE', mimeType: 'image/webp', byteSize: 5242880, width: 10000, height: 4000, sha256: 'a'.repeat(64), state: 'STAGED',
  } };
  await f.audit.appendAudit(f.tx, payload);
  for (const extra of [{ storageKey: 'private/path.webp' }, { byteSize: 5242881 }, { state: 'RETAINED' }, { sha256: 'invalid' }]) {
    await expect(f.audit.appendAudit(f.tx, { ...payload, after: { ...payload.after, ...extra } })).rejects.toThrow();
  }
  expect(f.create).toHaveBeenCalledTimes(1);
});
