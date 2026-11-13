// 作用：发布单图上传、安全元数据与图片内容接口；绑定保留为内部能力，不允许浏览器任意指定业务ID。
import { Controller, Get, Header, Inject, Param, Post, Req, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { ServerResponse } from 'node:http';
import { AnyAccountAccess } from '../auth/auth.decorators.js';
import { CurrentActor, readBearerToken, type AuthHttpRequest } from '../auth/auth-request-context.js';
import type { CurrentIdentity } from '../auth/current-identity.service.js';
import { FilesService } from './files.service.js';
import { purposePermissions } from './file-policy.js';
import { requestIdHeader } from '../health/health.openapi.js';
import { authErrorSchema } from '../auth/employee-auth.openapi.js';
import { fileSuccessSchema } from './files.openapi.js';

@Controller('files')
@ApiTags('Files')
export class FilesController {
  constructor(@Inject(FilesService) private readonly files: FilesService) {}
  @Post()
  @AnyAccountAccess()
  @Header('Cache-Control', 'no-store')
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({ operationId: 'uploadImage', summary: '上传一张受控图片',
    description: 'multipart先添加purpose再添加file；其它字段、多文件拒绝。JPEG/PNG/WebP单图最大5MiB，宽高各≤10000、总像素≤4000万，不接受动画。真实解码重编码并去除元数据。用途决定业务权限；每主体默认20次/分钟、100张未绑定配额。STAGED固定私有，24小时到期，上传不等于绑定业务。' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', additionalProperties: false, required: ['purpose', 'file'], properties: {
    purpose: { type: 'string', enum: Object.keys(purposePermissions) }, file: { type: 'string', format: 'binary' },
  } } })
  @ApiResponse({ status: 201, headers: requestIdHeader, schema: fileSuccessSchema })
  @ApiResponse({ status: 400, headers: requestIdHeader, schema: authErrorSchema(['FILE_INVALID_UPLOAD', 'FILE_TYPE_NOT_ALLOWED', 'FILE_INVALID_IMAGE', 'FILE_ANIMATION_NOT_ALLOWED', 'FILE_DIMENSIONS_EXCEEDED']) })
  @ApiResponse({ status: 401, headers: requestIdHeader, schema: authErrorSchema(['TOKEN_INVALID', 'SESSION_REVOKED', 'ACCOUNT_UNAVAILABLE']) })
  @ApiResponse({ status: 403, headers: requestIdHeader, schema: authErrorSchema(['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED']) })
  @ApiResponse({ status: 413, headers: requestIdHeader, schema: authErrorSchema(['FILE_TOO_LARGE']) })
  @ApiResponse({ status: 429, headers: { ...requestIdHeader, 'Retry-After': { schema: { type: 'integer', minimum: 1 } } }, schema: authErrorSchema(['FILE_RATE_LIMITED', 'FILE_QUOTA_EXCEEDED']) })
  upload(@CurrentActor() identity: CurrentIdentity, @Req() request: AuthHttpRequest) {
    return this.files.upload(request, { identity, token: readBearerToken(request) }, request.requestId);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiBearerAuth('bearerAuth')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ operationId: 'getFileMetadata', summary: '读取有权访问的安全图片元数据', description: '始终需要有效会话和文件权限；不公开storageKey、上传者、摘要或原文件名。无权与不存在均404。' })
  @ApiResponse({ status: 200, headers: requestIdHeader, schema: fileSuccessSchema })
  @ApiResponse({ status: 404, headers: requestIdHeader, schema: authErrorSchema(['FILE_NOT_FOUND']) })
  metadata(@Param('id') id: string, @Req() request: AuthHttpRequest) {
    return this.files.metadata(id, request.headers.authorization === undefined ? undefined : readBearerToken(request));
  }

  @Get(':id/content')
  @Header('Cache-Control', 'private, no-store')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ operationId: 'getFileContent', summary: '读取图片内容', security: [{ bearerAuth: [] }, {}], description: '仅已有效公开的头像或商品图允许匿名；私有图需Bearer且按当前业务授权，上传者不永久放行。私有响应private,no-store；无权404，有权但磁盘丢失503。URL不得携带token。' })
  @ApiResponse({ status: 200, headers: { ...requestIdHeader, 'X-Content-Type-Options': { schema: { type: 'string', enum: ['nosniff'] } }, 'Cache-Control': { schema: { type: 'string' } } },
    content: Object.fromEntries(['image/jpeg', 'image/png', 'image/webp'].map(type => [type, { schema: { type: 'string', format: 'binary' } }])) })
  @ApiResponse({ status: 404, headers: requestIdHeader, schema: authErrorSchema(['FILE_NOT_FOUND']) })
  @ApiResponse({ status: 503, headers: requestIdHeader, schema: authErrorSchema(['FILE_STORAGE_UNAVAILABLE']) })
  async content(@Param('id') id: string, @Req() request: AuthHttpRequest, @Res({ passthrough: true }) response: ServerResponse) {
    const result = await this.files.content(id, request.headers.authorization === undefined ? undefined : readBearerToken(request));
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', result.publicContent ? 'public, max-age=86400, immutable' : 'private, no-store');
    response.setHeader('Vary', 'Authorization');
    return new StreamableFile(result.data, { type: result.asset.mimeType, length: result.data.length, disposition: 'inline; filename="image"' });
  }
}
