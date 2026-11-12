// 作用：定义重置其他员工密码的 Swagger 请求规则、成功结构及错误响应。
import type { OpenAPIObject } from '@nestjs/swagger';

type Schema = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string];
export const employeePasswordResetBodySchema: Schema = { type: 'object', additionalProperties: false,
  required: ['temporaryPassword', 'expectedVersion', 'reason'], properties: {
    expectedVersion: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: '使用刚查询到的version，必须为JSON数字', example: 0 },
    reason: { type: 'string', minLength: 1, maxLength: 500, description: '去首尾空白，重置原因必填', example: '员工忘记密码' },
    temporaryPassword: { type: 'string', format: 'password', writeOnly: true, minLength: 8, maxLength: 64,
      description: '8～64个Unicode码点且UTF-8最多72字节，保留空格，不截断；不得与当前密码相同', example: 'ResetDemo#2026' },
  } };
export const employeePasswordResetSuccessSchema: Schema = { type: 'object', additionalProperties: false,
  required: ['data', 'requestId'], properties: { requestId: { type: 'string', format: 'uuid' }, data: {
    type: 'object', additionalProperties: false, required: ['id', 'mustChangePassword', 'version'], properties: {
      id: { type: 'string', format: 'uuid' }, mustChangePassword: { type: 'boolean', enum: [true] }, version: { type: 'integer', minimum: 0 },
    },
  } } };
