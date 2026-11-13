// 作用：验证业务字段变化、主体/命令隔离及瞬时HTTP上下文不参与指纹，不冒充真实订单幂等事务。
import { expect, it } from 'vitest';
import { canonicalSet } from '@shop/shared';
import { commandFingerprint, commandNamespace, type FingerprintCommand } from '../src/common/command-fingerprint.js';
const command: FingerprintCommand = { command: 'order.create', version: 1, actor: { type: 'CUSTOMER', id: 'customer-1' },
  payload: { quoteId: 'quote-1', address: { city: '上海', detail: '测试路' }, items: [{ skuId: 'style-red-M', quantity: 2 }], fileIds: ['main', 'detail'] } };
it('对象字段不同次序语义相同，SHA-256为固定64位；瞬时requestId/token不同仍相同', () => {
  const first = { ...command, requestId: 'a', token: 'token-a' }; const second = { ...command, token: 'token-b', requestId: 'b' };
  expect(commandFingerprint(first)).toMatch(/^[a-f0-9]{64}$/); expect(commandFingerprint(first)).toBe(commandFingerprint(second));
  expect(commandFingerprint({ ...command, payload: { b: 2, a: 1 } })).toBe(commandFingerprint({ ...command, payload: { a: 1, b: 2 } }));
});
it.each([
  { quoteId: 'quote-2' }, { address: { city: '北京', detail: '另一地址' } }, { items: [{ skuId: 'style-red-M', quantity: 3 }] }, { fileIds: ['detail', 'main'] },
])('quote/地址/数量/图片语义顺序变化不能复用摘要：%j', patch => {
  expect(commandFingerprint({ ...command, payload: { ...command.payload as object, ...patch } })).not.toBe(commandFingerprint(command));
});
it('主体类型、主体ID、动作及版本隔离；集合语义由命令显式声明', () => {
  for (const input of [{ ...command, actor: { type: 'EMPLOYEE' as const, id: 'customer-1' } }, { ...command, actor: { ...command.actor, id: 'customer-2' } },
    { ...command, command: 'order.cancel' }, { ...command, version: 2 }]) {
    expect(commandNamespace(input)).not.toBe(commandNamespace(command)); expect(commandFingerprint(input)).not.toBe(commandFingerprint(command));
  }
  expect(commandFingerprint({ ...command, payload: canonicalSet(['b', 'a']) })).toBe(commandFingerprint({ ...command, payload: canonicalSet(['a', 'b']) }));
});
it('非法命令/版本/主体及凭据字段拒绝', () => {
  for (const input of [{ ...command, command: '../order' }, { ...command, version: 0 }, { ...command, actor: null }, { ...command, payload: { accessToken: 'secret' } }]) {
    expect(() => commandFingerprint(input as FingerprintCommand)).toThrow();
  }
});
