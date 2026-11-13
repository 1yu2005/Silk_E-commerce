// 作用：定义上传与元数据的白名单契约，不将Prisma实体或存储信息带入Swagger。
import type { OpenAPIObject } from '@nestjs/swagger';
type SchemaObject = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string];
import { purposePermissions } from './file-policy.js';
export const fileSuccessSchema: SchemaObject = { type: 'object', additionalProperties: false, required: ['data', 'requestId'], properties: {
  requestId: { type: 'string', format: 'uuid' }, data: { type: 'object', additionalProperties: false,
    required: ['id', 'purpose', 'state', 'visibility', 'mimeType', 'byteSize', 'width', 'height', 'expiresAt', 'contentUrl'], properties: {
      id: { type: 'string', format: 'uuid' }, purpose: { type: 'string', enum: Object.keys(purposePermissions) },
      state: { type: 'string', enum: ['STAGED', 'RETAINED'] }, visibility: { type: 'string', enum: ['PRIVATE', 'PUBLIC'] },
      mimeType: { type: 'string', enum: ['image/jpeg', 'image/png', 'image/webp'] }, byteSize: { type: 'integer', minimum: 1, maximum: 5242880 },
      width: { type: 'integer', minimum: 1, maximum: 10000 }, height: { type: 'integer', minimum: 1, maximum: 10000 },
      expiresAt: { type: 'string', format: 'date-time', nullable: true }, contentUrl: { type: 'string', example: '/api/v1/files/f7ca2e71-40a4-4f09-afad-45241a7a27da/content' },
    } },
} };
