/** 文件作用：从生成契约派生设置表单类型，严格转换元/分并集中说明期限单位。 */
import type { ApiOperations, EmployeePermissions } from '@shop/api-client';

export type SettingsInput = ApiOperations['updateStoreSettings']['requestBody']['content']['application/json'];
export type CurrentSettings = ApiOperations['getStoreSettings']['responses'][200]['content']['application/json']['data'];
export type SettingsVersion = ApiOperations['getStoreSettingVersion']['responses'][200]['content']['application/json']['data'];
export type SettingsHistory = ApiOperations['listStoreSettingVersions']['responses'][200]['content']['application/json']['data'];
type DeadlineKey = keyof SettingsInput['deadlines'];
export type SettingsFormValues = Omit<SettingsInput, 'expectedVersion' | 'shippingFeeCents' | 'freeShippingThresholdCents' | 'deadlines' | 'serviceContact'> & {
  shippingFeeYuan: string; freeShippingThresholdYuan: string;
  deadlines: Record<DeadlineKey, string>;
  serviceContact: { phone: string; serviceHours: string };
};

export const deadlineFields = [
  { key: 'paymentMinutes', label: '付款期限', unit: '分钟', max: 1440, initial: 30, hint: '从下单时起算' },
  { key: 'autoReceiptDays', label: '自动收货', unit: '自然日', max: 365, initial: 10, hint: '从实际交运时起算' },
  { key: 'afterSaleWindowDays', label: '售后申请窗口', unit: '自然日', max: 365, initial: 7, hint: '从订单完成时起算' },
  { key: 'reviewWorkdays', label: '售后审核', unit: '工作日', max: 30, initial: 2, hint: '每轮审核分别起算' },
  { key: 'supplementDays', label: '补充材料', unit: '自然日', max: 90, initial: 7, hint: '每轮要求补材料时起算' },
  { key: 'returnShipDays', label: '顾客寄回', unit: '自然日', max: 90, initial: 7, hint: '从同意寄回阶段起算' },
  { key: 'inspectionWorkdays', label: '退货验收', unit: '工作日', max: 30, initial: 2, hint: '从实际收到包裹时起算' },
  { key: 'refundWorkdays', label: '退款处理', unit: '工作日', max: 30, initial: 1, hint: '退款条件满足后起算' },
] as const satisfies readonly { key: DeadlineKey; label: string; unit: string; max: number; initial: number; hint: string }[];

export function canManageSettings(permissions: EmployeePermissions | null): boolean {
  return permissions?.effectivePermissions.includes('store.setting.manage') ?? false;
}

/** 按十进制字符串拆分，不用浮点数乘100或四舍五入接受多余小数位。 */
export function yuanToCents(value: unknown, maximum: number): number | null {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ''] = value.trim().split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= maximum ? cents : null;
}

export function centsToYuan(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError('金额必须是非负整数分');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function textIssue(value: unknown, label: string, max: number, optional = false): string | null {
  if (optional && (value == null || value === '')) return null;
  if (typeof value !== 'string' || (!optional && !value.trim())) return `请填写${label}`;
  return [...value.trim()].length > max ? `${label}最多${max}个字符` : null;
}

export function phoneIssue(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\+?[0-9][0-9 -]*$/.test(value.trim())) return '电话仅支持数字、可选国际前缀、空格和连字符';
  const input = value.trim(); const normalized = input.replace(/[ -]/g, '');
  return input.length < 3 || input.length > 30 || normalized.length < 3 || normalized.length > 30 ? '电话规范化前后均须为3～30个字符' : null;
}

export function deadlineNumber(value: unknown, max: number): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  const number = Number(value.trim());
  return Number.isInteger(number) && number >= 1 && number <= max ? number : null;
}

export function settingsFormValues(setting: CurrentSettings['currentSetting']): SettingsFormValues {
  const deadlines = Object.fromEntries(deadlineFields.map(field => [field.key, String(setting?.deadlines[field.key] ?? field.initial)])) as SettingsFormValues['deadlines'];
  return { shippingFeeYuan: centsToYuan(setting?.shippingFeeCents ?? 1000), freeShippingEnabled: setting?.freeShippingEnabled ?? true,
    freeShippingThresholdYuan: centsToYuan(setting?.freeShippingThresholdCents ?? 9900),
    returnAddress: setting ? { ...setting.returnAddress } : { receiver: '', phone: '', province: '', city: '', district: '', detail: '' },
    serviceContact: { phone: setting?.serviceContact.phone ?? '', serviceHours: setting?.serviceContact.serviceHours ?? '' }, deadlines, reason: '' };
}

export function settingsInput(form: SettingsFormValues, expectedVersion: number): SettingsInput {
  const shippingFeeCents = yuanToCents(form.shippingFeeYuan, 1_000_000);
  const freeShippingThresholdCents = yuanToCents(form.freeShippingThresholdYuan, 100_000_000);
  const deadlines = {} as SettingsInput['deadlines'];
  for (const field of deadlineFields) {
    const value = deadlineNumber(form.deadlines[field.key], field.max);
    if (value === null) throw new RangeError('期限须为范围内的正整数');
    deadlines[field.key] = value;
  }
  if (shippingFeeCents === null || freeShippingThresholdCents === null) throw new RangeError('金额须在范围内且最多两位小数');
  const address = form.returnAddress;
  return { expectedVersion, reason: form.reason.trim(), shippingFeeCents, freeShippingEnabled: form.freeShippingEnabled, freeShippingThresholdCents,
    returnAddress: { receiver: address.receiver.trim(), phone: address.phone.trim(), province: address.province.trim(), city: address.city.trim(), district: address.district.trim(), detail: address.detail.trim() },
    serviceContact: { phone: form.serviceContact.phone.trim(), serviceHours: form.serviceContact.serviceHours.trim() || null }, deadlines };
}

const beijingFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
export function beijingTime(iso: string): string { return beijingFormat.format(new Date(iso)); }
