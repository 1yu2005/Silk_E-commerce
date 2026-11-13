// 作用：发布顾客本人头像设置和移除命令，复用顾客会话守卫及统一错误响应。
import { Body, Controller, Delete, Header, Inject, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import type { CurrentIdentity } from './current-identity.service.js';
import { CustomerAccess } from './auth.decorators.js';
import { CurrentActor, readBearerToken, type AuthHttpRequest } from './auth-request-context.js';
import { CustomerAvatarDto } from './customer-avatar.dto.js';
import { CustomerAvatarService } from './customer-avatar.service.js';
import { requestIdHeader } from '../health/health.openapi.js';
import { authErrorSchema } from './employee-auth.openapi.js';
import { DtoValidationException } from '../common/http/dto-validation.js';

type Schema = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string];
const success: Schema = { type: 'object', required: ['data', 'requestId'], additionalProperties: false, properties: {
  requestId: { type: 'string', format: 'uuid' }, data: { type: 'object', additionalProperties: false,
    required: ['avatarAssetId', 'avatarUrl', 'changed'], properties: { avatarAssetId: { type: 'string', format: 'uuid', nullable: true },
      avatarUrl: { type: 'string', nullable: true }, changed: { type: 'boolean' } } },
} };
@Controller('store/me/avatar')
@ApiTags('CustomerAvatar')
@ApiBearerAuth('bearerAuth')
@CustomerAccess()
@ApiResponse({ status: 200, headers: requestIdHeader, schema: success })
@ApiResponse({ status: 400, headers: requestIdHeader, schema: authErrorSchema(['VALIDATION_FAILED']) })
@ApiResponse({ status: 401, headers: requestIdHeader, schema: authErrorSchema(['TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_SUBJECT_MISMATCH', 'SESSION_REVOKED', 'ACCOUNT_UNAVAILABLE']) })
export class CustomerAvatarController {
  constructor(@Inject(CustomerAvatarService) private readonly avatars: CustomerAvatarService) {}
  @Put()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'setCustomerAvatar', summary: '设置本人头像', description: '只接受本人上传且用途CUSTOMER_AVATAR的可绑定文件；顾客、引用、文件状态、审计同事务。相同头像changed=false；替换保留历史图片及公开URL。' })
  @ApiBody({ schema: { type: 'object', additionalProperties: false, required: ['fileId'], properties: { fileId: { type: 'string', format: 'uuid' } } } })
  @ApiResponse({ status: 404, headers: requestIdHeader, schema: authErrorSchema(['FILE_NOT_FOUND']) })
  @ApiResponse({ status: 409, headers: requestIdHeader, schema: authErrorSchema(['FILE_PURPOSE_MISMATCH', 'FILE_NOT_BINDABLE']) })
  set(@Body() input: CustomerAvatarDto, @CurrentActor() identity: CurrentIdentity, @Req() request: AuthHttpRequest) {
    return this.avatars.change({ identity, token: readBearerToken(request) }, input.fileId, request.requestId);
  }
  @Delete()
  @Header('Cache-Control', 'no-store')
  @ApiResponse({ status: 200, headers: requestIdHeader, schema: success })
  @ApiOperation({ operationId: 'removeCustomerAvatar', summary: '移除本人当前头像', description: '无业务请求体；重复移除changed=false。只清当前指针，不删除历史引用或已公开的旧图片。' })
  remove(@Body() body: unknown, @CurrentActor() identity: CurrentIdentity, @Req() request: AuthHttpRequest) {
    if (body != null && (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)) {
      throw new DtoValidationException([{ field: 'body', message: '移除头像不接受业务字段' }]);
    }
    return this.avatars.change({ identity, token: readBearerToken(request) }, null, request.requestId);
  }
}
