// 作用：声明设置输入、版本历史与公开联系方式契约；由现有工具生成客户端类型和调用器。
import type { OpenAPIObject } from '@nestjs/swagger';
type Schema = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string];
const integer = (maximum: number, minimum = 1): Schema => ({ type: 'integer', minimum, maximum });
const text = (maxLength: number): Schema => ({ type: 'string', minLength: 1, maxLength });
function object(properties: Record<string, Schema>, required = Object.keys(properties)): Schema {
  return { type: 'object', additionalProperties: false, required, properties };
}
function envelope(data: Schema): Schema {
  return object({ data, requestId: { type: 'string', format: 'uuid' } });
}
const phone: Schema = { ...text(30), minLength: 3, pattern: '^\\+?[0-9]+$',
  description: '规范化后保存的电话；仅保留可选国际前缀和数字' };
const inputPhone: Schema = { ...phone, pattern: '^\\+?[0-9][0-9 -]*$',
  description: '去首尾空白后的输入与规范化结果长度均须3～30；允许国际前缀、数字、空格/连字符，移除分隔符后保存' };
const addressFields = { receiver: text(40), phone, province: text(50), city: text(50), district: text(50), detail: text(200) };
const address = object(addressFields);
const serviceHours: Schema = { type: 'string', maxLength: 100, nullable: true, description: '省略、null或空白表示未设置服务时间；完整替换时清除旧值' };
const contact = object({ phone, serviceHours }, ['phone']);
const deadlines = object({ paymentMinutes: { ...integer(1440), description: '分钟；建单时固化付款期限' },
  autoReceiptDays: { ...integer(365), description: '自然日；实际交运起算' },
  afterSaleWindowDays: { ...integer(365), description: '自然日；订单完成起算' },
  reviewWorkdays: { ...integer(30), description: '工作日；每轮审核起算' },
  supplementDays: { ...integer(90), description: '自然日；每轮要求补材料起算' },
  returnShipDays: { ...integer(90), description: '自然日；同意寄回阶段起算' },
  inspectionWorkdays: { ...integer(30), description: '工作日；实际到货起算' },
  refundWorkdays: { ...integer(30), description: '工作日；退款条件满足起算' } });
const content = { shippingFeeCents: integer(1000000, 0), freeShippingEnabled: { type: 'boolean' } as Schema,
  freeShippingThresholdCents: integer(100000000, 0), returnAddress: address, serviceContact: contact, deadlines };
const summary = { id: { type: 'string', format: 'uuid' } as Schema, versionNumber: integer(2147483647),
  createdByEmployeeId: { type: 'string', format: 'uuid', nullable: true } as Schema,
  createdAt: { type: 'string', format: 'date-time' } as Schema, reason: text(500) };
const version = object({ ...summary, ...content, serviceContact: object({ phone, serviceHours }) });
export const updateSettingsBodySchema = object({ expectedVersion: integer(Number.MAX_SAFE_INTEGER, 0), reason: text(500), ...content,
  returnAddress: object({ ...addressFields, phone: inputPhone }), serviceContact: object({ phone: inputPhone, serviceHours }, ['phone']) });
export const currentSettingsSchema = envelope(object({ configured: { type: 'boolean' }, version: integer(2147483647, 0),
  currentSetting: { ...version, nullable: true } }));
export const updateSettingsSchema = envelope(object({ version: integer(2147483647), settingVersionId: summary.id,
  changed: { type: 'boolean' }, currentSetting: version }));
export const settingVersionSchema = envelope(version);
export const settingVersionsSchema = envelope(object({ items: { type: 'array', maxItems: 100, items: object(summary) },
  total: integer(Number.MAX_SAFE_INTEGER, 0), page: integer(Number.MAX_SAFE_INTEGER), pageSize: integer(100) }));
export const storeContactSchema = envelope(object({ configured: { type: 'boolean' },
  servicePhone: { type: 'string', nullable: true }, serviceHours: { type: 'string', nullable: true }, settingsVersion: integer(2147483647, 0) }));
