// 作用：提供顾客登录、本人资料、昵称修改和本人改密接口。
import { Body, Controller, Get, Header, HttpCode, Inject, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { IncomingMessage } from 'node:http';
import { requestIdHeader } from '../health/health.openapi.js';
import { CustomerAccess } from './auth.decorators.js';
import { CurrentActor, readBearerToken, type AuthHttpRequest } from './auth-request-context.js';
import type { CurrentIdentity } from './current-identity.service.js';
import { customerAuthSuccessSchema, customerLoginBodySchema, customerProfileBodySchema } from './customer-auth.openapi.js';
import { CustomerAuthService } from './customer-auth.service.js';
import { CustomerLoginRateGuard } from './customer-login-rate.guard.js';
import { CustomerLoginDto } from './customer-login.dto.js';
import { authErrorSchema, changePasswordBodySchema, changePasswordSuccessSchema } from './employee-auth.openapi.js';
import { loginSourceIp } from './login-rate.guard.js';
import { ChangePasswordDto } from './change-password.dto.js';
import { CustomerProfileDto } from './customer-profile.dto.js';
import { CustomerProfileService } from './customer-profile.service.js';
import { CustomerPasswordService } from './customer-password.service.js';

@Controller('store')
@ApiTags('CustomerAuth')
export class CustomerAuthController {
  constructor(@Inject(CustomerAuthService) private readonly customers: CustomerAuthService,
    @Inject(CustomerProfileService) private readonly profiles: CustomerProfileService,
    @Inject(CustomerPasswordService) private readonly passwords: CustomerPasswordService) {}

  @Post('auth/login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(CustomerLoginRateGuard)
  @ApiOperation({ operationId: 'loginCustomer', summary: '顾客登录',
    description: '公开；每实际来源IP每分钟30次，同规范化手机号及IP每5分钟最多5次失败，在途请求预留名额。正确密码后锁顾客复核哈希/版本/状态，同事务创建会话与更新登录时间。NORMAL和TRADE_RESTRICTED可登录；LOGIN_FROZEN拒绝。' })
  @ApiBody({ schema: customerLoginBodySchema })
  @ApiOkResponse({ headers: requestIdHeader, schema: customerAuthSuccessSchema(true) })
  @ApiBadRequestResponse({ headers: requestIdHeader, schema: authErrorSchema(['VALIDATION_FAILED']) })
  @ApiUnauthorizedResponse({ headers: requestIdHeader, schema: authErrorSchema(['INVALID_CREDENTIALS', 'ACCOUNT_UNAVAILABLE']) })
  @ApiResponse({ status: 429, headers: { ...requestIdHeader, 'Retry-After': { description: '等待秒数', schema: { type: 'integer', minimum: 1 } } },
    schema: authErrorSchema(['AUTH_RATE_LIMITED']) })
  login(@Body() input: CustomerLoginDto, @Req() request: IncomingMessage) { return this.customers.login(input, loginSourceIp(request)); }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  @CustomerAccess()
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({ operationId: 'getCustomerMe', summary: '读取当前顾客资料',
    description: '仅凭当前顾客会话查询本人；忽略客户端自报ID。NORMAL和TRADE_RESTRICTED可读取，冻结/撤销/到期会话拒绝。返回白名单资料及真实头像URL，无头像为null，不返回密码、内部版本或员工权限。' })
  @ApiOkResponse({ headers: requestIdHeader, schema: customerAuthSuccessSchema(false) })
  @ApiUnauthorizedResponse({ headers: requestIdHeader, schema: authErrorSchema([
    'TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_SUBJECT_MISMATCH', 'SESSION_REVOKED', 'ACCOUNT_UNAVAILABLE',
  ]) })
  me(@CurrentActor() identity: CurrentIdentity) { return this.customers.me(identity); }

  @Patch('me')
  @Header('Cache-Control', 'no-store')
  @CustomerAccess()
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({ operationId: 'updateCustomerMe', summary: '顾客本人修改昵称',
    description: '仅接受nickname，去首尾空白后1～40字符；NORMAL和TRADE_RESTRICTED可用。锁本人并重新认证，昵称和审计同事务；同名不重复更新或写审计。无客户端目标ID/版本；并发合法修改按主体锁顺序提交，响应保留当前真实头像。' })
  @ApiBody({ schema: customerProfileBodySchema })
  @ApiOkResponse({ headers: requestIdHeader, schema: customerAuthSuccessSchema(false) })
  @ApiBadRequestResponse({ headers: requestIdHeader, schema: authErrorSchema(['VALIDATION_FAILED']) })
  @ApiUnauthorizedResponse({ headers: requestIdHeader, schema: authErrorSchema([
    'TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_SUBJECT_MISMATCH', 'SESSION_REVOKED', 'ACCOUNT_UNAVAILABLE',
  ]) })
  update(@Body() input: CustomerProfileDto, @CurrentActor() actor: CurrentIdentity, @Req() request: AuthHttpRequest) {
    return this.profiles.update(actor, readBearerToken(request), input, request.requestId);
  }

  @Post('auth/change-password')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @CustomerAccess()
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({ operationId: 'changeCustomerPassword', summary: '顾客本人改密',
    description: '验证旧密码，新密码须不同且保留原文；NORMAL和TRADE_RESTRICTED可用。锁本人后重验会话和密码快照，密码/令牌版本/全部会话撤销/审计同事务，成功须重新登录，不返回token。' })
  @ApiBody({ schema: changePasswordBodySchema })
  @ApiOkResponse({ headers: requestIdHeader, schema: changePasswordSuccessSchema })
  @ApiBadRequestResponse({ headers: requestIdHeader, schema: authErrorSchema(['VALIDATION_FAILED']) })
  @ApiUnauthorizedResponse({ headers: requestIdHeader, schema: authErrorSchema([
    'INVALID_CREDENTIALS', 'TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_SUBJECT_MISMATCH', 'SESSION_REVOKED', 'ACCOUNT_UNAVAILABLE',
  ]) })
  changePassword(@Body() input: ChangePasswordDto, @CurrentActor() actor: CurrentIdentity, @Req() request: AuthHttpRequest) {
    return this.passwords.changePassword(actor, readBearerToken(request), input, request.requestId);
  }
}
