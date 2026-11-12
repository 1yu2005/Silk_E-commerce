// 作用：定义健康检查和公共请求编号响应头的 Swagger 结构。
import type { OpenAPIObject } from '@nestjs/swagger';

type SchemaObject = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string];

const requestId: SchemaObject = { type: 'string', format: 'uuid',
  example: '9bc421ac-5987-493e-a6cf-73fe46082272' };
const timestamp: SchemaObject = { type: 'string', format: 'date-time',
  description: '服务器UTC时间', example: '2026-11-11T02:00:00.000Z' };

export const requestIdHeader = { 'X-Request-Id': {
  description: '服务器生成的请求编号，与响应体requestId一致', schema: requestId,
} };

export function healthSuccessSchema(ready: boolean): SchemaObject {
  return {
    type: 'object', required: ['data', 'requestId'],
    properties: {
      requestId,
      data: {
        type: 'object', required: ready ? ['status', 'checks', 'timestamp'] : ['status', 'service', 'timestamp'],
        properties: {
          status: { type: 'string', enum: [ready ? 'ready' : 'ok'] },
          ...(ready ? { checks: { type: 'object' as const, required: ['database'],
            properties: { database: { type: 'string' as const, enum: ['up'] } } } }
            : { service: { type: 'string' as const, enum: ['shop-api'] } }),
          timestamp,
        },
      },
    },
  };
}

export const notReadySchema: SchemaObject = {
  type: 'object', required: ['code', 'message', 'details', 'requestId'],
  properties: {
    code: { type: 'string', enum: ['SERVICE_NOT_READY'] },
    message: { type: 'string', example: '服务暂未就绪' },
    details: { type: 'object', required: ['database'], properties: {
      database: { type: 'string', enum: ['unavailable'] },
    } },
    requestId,
  },
};
