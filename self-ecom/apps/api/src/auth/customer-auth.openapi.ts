// 作用：定义顾客登录和本人资料接口的 Swagger 请求与响应结构。
import type { OpenAPIObject } from '@nestjs/swagger';

type Schema = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string];
export const customerSummarySchema: Schema = { type: 'object', additionalProperties: false,
  required: ['id', 'phone', 'nickname', 'avatarUrl', 'status', 'createdAt'], properties: {
    id: { type: 'string', format: 'uuid' }, phone: { type: 'string' }, nickname: { type: 'string' },
    avatarUrl: { type: 'string', nullable: true, enum: [null], description: '本板块固定null，文件头像在板块3接入' },
    status: { type: 'string', enum: ['NORMAL', 'TRADE_RESTRICTED'] }, createdAt: { type: 'string', format: 'date-time' },
  } };
export const customerLoginBodySchema: Schema = { type: 'object', additionalProperties: false, required: ['phone', 'password'], properties: {
  phone: { type: 'string', pattern: '^1[3-9][0-9]{9}$', minLength: 11, maxLength: 11, description: '去首尾空白后的大陆11位手机号', example: '13800138001' },
  password: { type: 'string', format: 'password', writeOnly: true, minLength: 8, maxLength: 64,
    description: '8～64个Unicode码点且UTF-8最多72字节，保留空格，不截断或归一化', example: 'ShopDemo#2026' },
} };
export const customerProfileBodySchema: Schema = { type: 'object', additionalProperties: false, required: ['nickname'], properties: {
  nickname: { type: 'string', minLength: 1, maxLength: 40, description: '去首尾空白后1～40个Unicode字符', example: '顾客甲' },
} };
export function customerAuthSuccessSchema(login: boolean): Schema {
  return { type: 'object', additionalProperties: false, required: ['data', 'requestId'], properties: {
    requestId: { type: 'string', format: 'uuid' }, data: login ? { type: 'object', additionalProperties: false,
      required: ['accessToken', 'tokenType', 'expiresAt', 'customer'], properties: {
        accessToken: { type: 'string', description: '仅登录成功返回的JWT，Authorize输入token本体' }, tokenType: { type: 'string', enum: ['Bearer'] },
        expiresAt: { type: 'string', format: 'date-time' }, customer: customerSummarySchema,
      } } : customerSummarySchema,
  } };
}
