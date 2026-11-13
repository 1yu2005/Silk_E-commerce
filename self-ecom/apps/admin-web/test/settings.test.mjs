/** 文件作用：验证表单十进制换算、期限与文本边界，防止元/分或自然日/工作日混用。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beijingTime, canManageSettings, centsToYuan, deadlineFields, deadlineNumber, phoneIssue,
  settingsFormValues, settingsInput, textIssue, yuanToCents } from '../src/settings/model.ts';

test('金额按十进制精确换算，0和最大金额均可往返', () => {
  for (const [yuan, cents] of [['0', 0], ['0.01', 1], ['0.29', 29], ['1.1', 110], [' 10.05 ', 1005], ['00099.00', 9900], ['10000.00', 1_000_000]]) {
    assert.equal(yuanToCents(yuan, 1_000_000), cents);
    assert.equal(yuanToCents(centsToYuan(cents), 1_000_000), cents);
  }
  assert.equal(yuanToCents('1000000.00', 100_000_000), 100_000_000);
  assert.equal(centsToYuan(100_000_000), '1000000.00');
});
test('金额不接受符号、指数、额外小数位、逗号、空值或越界，不四舍五入', () => {
  for (const value of [undefined, null, 1, '', ' ', '-1', '+1', '1e2', '1.001', '0.290', '.5', '5.', '1,000', '10000.01', 'Infinity', 'NaN', '９.９', '9'.repeat(400)]) {
    assert.equal(yuanToCents(value, 1_000_000), null, String(value));
  }
  for (const value of [-1, 1.1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => centsToYuan(value));
});
test('八项期限的单位和上限固定，拒绝0、小数、指数及越界', () => {
  assert.deepEqual(deadlineFields.map(field => [field.key, field.unit, field.max]), [
    ['paymentMinutes', '分钟', 1440], ['autoReceiptDays', '自然日', 365], ['afterSaleWindowDays', '自然日', 365],
    ['reviewWorkdays', '工作日', 30], ['supplementDays', '自然日', 90], ['returnShipDays', '自然日', 90], ['inspectionWorkdays', '工作日', 30], ['refundWorkdays', '工作日', 30],
  ]);
  for (const field of deadlineFields) {
    assert.equal(deadlineNumber(' 1 ', field.max), 1); assert.equal(deadlineNumber(String(field.max), field.max), field.max);
    for (const value of ['', '0', '-1', '1.5', '1e1', String(field.max + 1), null, 2]) assert.equal(deadlineNumber(value, field.max), null);
  }
});
test('未配置只有建议金额和期限，电话地址原因保持空白；不修改输入快照', () => {
  const form = settingsFormValues(null);
  assert.equal(form.shippingFeeYuan, '10.00'); assert.equal(form.freeShippingThresholdYuan, '99.00');
  assert.ok(Object.values(form.returnAddress).every(value => value === '')); assert.deepEqual(form.serviceContact, { phone: '', serviceHours: '' }); assert.equal(form.reason, '');
  assert.deepEqual(form.deadlines, { paymentMinutes: '30', autoReceiptDays: '10', afterSaleWindowDays: '7', reviewWorkdays: '2', supplementDays: '7', returnShipDays: '7', inspectionWorkdays: '2', refundWorkdays: '1' });
});
test('请求只发送契约字段，关闭包邮仍发送门槛，空服务时间清除，原因不复用', () => {
  const form = settingsFormValues(null);
  Object.assign(form, { shippingFeeYuan: '0.29', freeShippingEnabled: false, freeShippingThresholdYuan: '99.01', reason: ' 核实后调整 ', expectedVersion: 999, internal: true });
  form.returnAddress = { receiver: ' 仓库 ', phone: '010-00000000', province: ' 省 ', city: ' 市 ', district: ' 区 ', detail: ' 地址 ' };
  form.serviceContact = { phone: ' 010-00000000 ', serviceHours: ' \n ' };
  const input = settingsInput(form, 3);
  assert.equal(input.expectedVersion, 3); assert.equal(input.shippingFeeCents, 29); assert.equal(input.freeShippingThresholdCents, 9901);
  assert.equal(input.freeShippingEnabled, false); assert.equal(input.serviceContact.serviceHours, null); assert.equal(input.reason, '核实后调整');
  assert.equal(input.returnAddress.receiver, '仓库'); assert.equal(typeof input.deadlines.reviewWorkdays, 'number');
  assert.ok(!('internal' in input)); assert.ok(!('shippingFeeYuan' in input));
  const saved = { ...input, id: 'test', versionNumber: 4, createdByEmployeeId: null, createdAt: '2026-11-13T02:00:00Z' };
  const next = settingsFormValues(saved); next.returnAddress.receiver = '不会回写历史';
  assert.equal(saved.returnAddress.receiver, '仓库'); assert.equal(next.reason, ''); assert.equal(next.serviceContact.serviceHours, '');
  assert.equal(next.shippingFeeYuan, '0.29'); assert.equal(next.freeShippingThresholdYuan, '99.01');
  form.shippingFeeYuan = '0.001'; assert.throws(() => settingsInput(form, 3));
});
test('文本按Unicode码点验证，电话规范化前后长度和字符限制与接口一致', () => {
  assert.equal(textIssue(' ' + '😀'.repeat(40) + ' ', '收件人', 40), null); assert.ok(textIssue('😀'.repeat(41), '收件人', 40));
  assert.ok(textIssue(' \n ', '修改原因', 500)); assert.equal(textIssue(' \n ', '服务时间', 100, true), null);
  for (const phone of ['010-00000000', ' +86 010 0000 0000 ', '123']) assert.equal(phoneIssue(phone), null);
  for (const phone of ['', '1', '1- ', '123#', '123abc', '123\n456', '+ 123', '1'.repeat(31), '1' + ' '.repeat(29) + '2']) assert.ok(phoneIssue(phone));
});
test('菜单只按有效设置权限开放，显示时间固定北京时间', () => {
  assert.equal(canManageSettings(null), false); assert.equal(canManageSettings({ effectivePermissions: ['employee.read'] }), false);
  assert.equal(canManageSettings({ effectivePermissions: ['store.setting.manage'] }), true);
  assert.match(beijingTime('2026-11-13T02:00:00Z'), /2026.*11.*13.*10:00:00/);
});
