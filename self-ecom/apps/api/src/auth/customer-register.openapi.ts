// 作用：定义顾客注册接口的 Swagger 输入规则及公开响应结构。
import type { OpenAPIObject } from '@nestjs/swagger';

type Schema = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string];
export const customerRegisterBodySchema: Schema = { type: 'object', additionalProperties: false, required: ['phone', 'password'], properties: {
  phone: { type: 'string', pattern: '^1[3-9][0-9]{9}$', minLength: 11, maxLength: 11, description: '去首尾空白后的大陆11位手机号；不代表实名或短信所有权验证', example: '13800138001' },
  password: { type: 'string', format: 'password', writeOnly: true, minLength: 8, maxLength: 64,
    description: '8～64个Unicode码点且UTF-8最多72字节，保留首尾空格，不截断或归一化', example: 'ShopDemo#2026' },
  nickname: { type: 'string', minLength: 1, maxLength: 40, description: '可省略，默认“新顾客”；提交时去首尾空白后1～40字符，不接受null或空白', example: '顾客甲' },
} };
export const customerRegisterSuccessSchema: Schema = { type: 'object', additionalProperties: false, required: ['data', 'requestId'], properties: {
  requestId: { type: 'string', format: 'uuid' }, data: { type: 'object', additionalProperties: false,
    required: ['id', 'phone', 'nickname', 'status', 'createdAt'], properties: {
      id: { type: 'string', format: 'uuid' }, phone: { type: 'string' }, nickname: { type: 'string' },
      status: { type: 'string', enum: ['NORMAL'] }, createdAt: { type: 'string', format: 'date-time' },
    } },
} };
