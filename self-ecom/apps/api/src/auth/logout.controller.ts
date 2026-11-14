// 作用：提供双登录域共用的当前会话注销接口，严格拒绝非空请求字段。
import { Body, Controller, Header, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { EmptyBodyPipe } from '../common/http/empty-body.pipe.js';
import { requestIdHeader } from '../health/health.openapi.js';
import { readBearerToken, type AuthHttpRequest } from './auth-request-context.js';
import { authErrorSchema } from './employee-auth.openapi.js';
import { LogoutService } from './logout.service.js';
import { LogoutTokenGuard } from './logout-token.guard.js';

@Controller('auth')
@ApiTags('Auth')
export class LogoutController {
  constructor(@Inject(LogoutService) private readonly logoutService: LogoutService) {}

  @Post('logout')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(LogoutTokenGuard)
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({ operationId: 'logoutCurrentSession', summary: '注销当前设备',
    description: '员工和顾客共用，强制改密员工可用。仅撤销当前sid；签名、归属、会话版本和期限仍须有效，已撤销sid幂等返回成功并保留原事实。首次撤销与审计同事务，其它设备不受影响；不返回token。' })
  @ApiBody({ required: false, schema: { type: 'object', additionalProperties: false, maxProperties: 0 } })
  @ApiOkResponse({ headers: requestIdHeader, schema: { type: 'object', additionalProperties: false, required: ['data', 'requestId'],
    properties: { requestId: { type: 'string', format: 'uuid' }, data: { type: 'object', additionalProperties: false,
      required: ['loggedOut'], properties: { loggedOut: { type: 'boolean', enum: [true] } } } } } })
  @ApiBadRequestResponse({ headers: requestIdHeader, schema: authErrorSchema(['VALIDATION_FAILED']) })
  @ApiUnauthorizedResponse({ headers: requestIdHeader, schema: authErrorSchema([
    'TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_SUBJECT_MISMATCH', 'SESSION_REVOKED', 'ACCOUNT_UNAVAILABLE',
  ]) })
  logout(@Body(new EmptyBodyPipe()) _body: unknown, @Req() request: AuthHttpRequest) {
    return this.logoutService.logout(readBearerToken(request), request.requestId);
  }
}
