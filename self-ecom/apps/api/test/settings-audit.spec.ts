// 作用：验证设置审计仅接收版本标识及变化字段，不保存完整地址、电话或冒用主体。
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { expect, it, vi } from 'vitest';
import { AuditService, type AuditPayload } from '../src/audit/audit.service.js';
function fixture() {
  const create = vi.fn().mockResolvedValue({}); const id = randomUUID();
  const tx = { auditLog: { create } } as unknown as Prisma.TransactionClient;
  const payload: AuditPayload = { actor: { type: 'EMPLOYEE', id }, action: 'store.setting.update', targetId: randomUUID(),
    requestId: randomUUID(), reason: '隔离测试设置修改', after: { versionNumber: 1, settingVersionId: randomUUID(), changedFields: ['deadlines'] } };
  return { create, tx, payload, audit: new AuditService() };
}
it('设置审计保存新旧版本标识、变化类别与原因', async () => {
  const f = fixture(); await f.audit.appendAudit(f.tx, f.payload);
  expect(f.create).toHaveBeenCalledWith({ data: expect.objectContaining({ targetType: 'StoreSettingVersion',
    action: 'store.setting.update', afterData: f.payload.after, reason: f.payload.reason }) });
});
it.each([{ versionNumber: 0 }, { versionNumber: 1.5 }, { versionNumber: 2147483648 },
  { settingVersionId: 'not-uuid' }, { changedFields: [] }, { changedFields: ['deadlines', 'deadlines'] },
  { changedFields: ['password'] }, { changedFields: [12] }, { servicePhone: '不应保存' },
  { returnAddress: { detail: '不应保存' } }, { passwordHash: '不应保存' }])('设置审计拒绝越界或多余快照%s', async patch => {
  const f = fixture(); await expect(f.audit.appendAudit(f.tx, { ...f.payload, after: { ...f.payload.after, ...patch } })).rejects.toThrow();
  expect(f.create).not.toHaveBeenCalled();
});
it.each(['SYSTEM', 'CUSTOMER'] as const)('设置审计拒绝%s冒充管理员命令', async type => {
  const f = fixture(); await expect(f.audit.appendAudit(f.tx, { ...f.payload,
    actor: type === 'SYSTEM' ? { type } : { type, id: randomUUID() } })).rejects.toThrow();
  expect(f.create).not.toHaveBeenCalled();
});
it('设置修改必须填写原因，空原因不落库', async () => {
  const f = fixture(); await expect(f.audit.appendAudit(f.tx, { ...f.payload, reason: ' ' })).rejects.toThrow();
  expect(f.create).not.toHaveBeenCalled();
});
