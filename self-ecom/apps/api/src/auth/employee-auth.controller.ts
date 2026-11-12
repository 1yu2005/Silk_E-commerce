// 作用：提供员工登录、本人身份、本人权限及强制改密接口。
import { Body, Controller, Get, Header, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { requestIdHeader } from '../health/health.openapi.js';
import { EmployeeAccess } from './auth.decorators.js';
import { CurrentActor, readBearerToken, type AuthHttpRequest } from './auth-request-context.js';
import type { CurrentIdentity } from './current-identity.service.js';
import { TokenValidationError } from './jwt-token.service.js';
import { EmployeeAuthService } from './employee-auth.service.js';
import { EmployeeLoginDto } from './employee-login.dto.js';
import { LoginRateGuard, loginSourceIp } from './login-rate.guard.js';
import { authErrorSchema, employeeAuthSuccessSchema, employeeLoginBodySchema, changePasswordBodySchema, changePasswordSuccessSchema, employeePermissionsSuccessSchema } from './employee-auth.openapi.js';
import { ChangePasswordDto } from './change-password.dto.js';
import { EmployeePasswordService } from './employee-password.service.js';
import { roleTemplates } from '../permissions/permission-catalog.js';

@Controller('admin')
@ApiTags('EmployeeAuth')
export class EmployeeAuthController {
  constructor(@Inject(EmployeeAuthService) private readonly auth: EmployeeAuthService,
    @Inject(EmployeePasswordService) private readonly passwords: EmployeePasswordService) {}

  @Post('auth/login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(LoginRateGuard)
  @ApiOperation({ operationId: 'loginEmployee', summary: '员工登录', description: '公开接口；账号规范化，密码保留原文。每IP每分钟30次，同账号与IP五分钟最多5次失败；在途验证预留名额，超限返回Retry-After秒数。' })
  @ApiBody({ schema: employeeLoginBodySchema })
  @ApiOkResponse({ headers: requestIdHeader, schema: employeeAuthSuccessSchema(true) })
  @ApiBadRequestResponse({ headers: requestIdHeader, schema: authErrorSchema(['VALIDATION_FAILED']) })
  @ApiUnauthorizedResponse({ headers: requestIdHeader, schema: authErrorSchema(['INVALID_CREDENTIALS', 'ACCOUNT_UNAVAILABLE']) })
  @ApiResponse({ status: 429, headers: { ...requestIdHeader, 'Retry-After': { description: '等待秒数', schema: { type: 'integer', minimum: 1 } } },
    schema: authErrorSchema(['AUTH_RATE_LIMITED']) })
  login(@Body() input: EmployeeLoginDto, @Req() request: IncomingMessage) {
    return this.auth.login(input, loginSourceIp(request));
  }

  @Post('auth/change-password')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @EmployeeAccess()
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({ operationId: 'changeEmployeePassword', summary: '员工本人改密',
    description: '强制改密员工可访问。验证旧密码，新密码须不同；成功后撤销本人全部会话并要求重新登录，不返回新token。密码、会话和审计在同一事务提交。' })
  @ApiBody({ schema: changePasswordBodySchema })
  @ApiOkResponse({ headers: requestIdHeader, schema: changePasswordSuccessSchema })
  @ApiBadRequestResponse({ headers: requestIdHeader, schema: authErrorSchema(['VALIDATION_FAILED']) })
  @ApiUnauthorizedResponse({ headers: requestIdHeader, schema: authErrorSchema([
    'INVALID_CREDENTIALS', 'TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_SUBJECT_MISMATCH', 'SESSION_REVOKED', 'ACCOUNT_UNAVAILABLE',
  ]) })
  changePassword(@Body() input: ChangePasswordDto, @CurrentActor() actor: CurrentIdentity, @Req() request: AuthHttpRequest) {
    return this.passwords.changePassword(actor, readBearerToken(request), input, request.requestId);
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  @EmployeeAccess()
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({ operationId: 'getEmployeeMe', summary: '读取当前员工', description: '使用当前数据库身份快照；强制改密员工可访问。只返回白名单摘要，不返回token、密码、版本或额外授权。' })
  @ApiOkResponse({ headers: requestIdHeader, schema: employeeAuthSuccessSchema(false) })
  @ApiUnauthorizedResponse({ headers: requestIdHeader,
    schema: authErrorSchema(['TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_SUBJECT_MISMATCH', 'SESSION_REVOKED', 'ACCOUNT_UNAVAILABLE']) })
  me(@CurrentActor() identity: CurrentIdentity) {
    if (identity.subjectType !== 'EMPLOYEE') throw new TokenValidationError('TOKEN_SUBJECT_MISMATCH');
    return { id: identity.subjectId, username: identity.username, displayName: identity.displayName,
      role: identity.role, status: identity.status, mustChangePassword: identity.mustChangePassword };
  }

  @Get('me/permissions')
  @Header('Cache-Control', 'no-store')
  @EmployeeAccess()
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({ operationId: 'getEmployeeMePermissions', summary: '读取本人当前权限',
    description: '员工完成改密后可用，无需管理员权限。按同一当前身份快照返回岗位默认、个人额外和最终权限；不从token或客户端读取权限，不自动补发依赖，不修改授权或会话。' })
  @ApiOkResponse({ headers: requestIdHeader, schema: employeePermissionsSuccessSchema })
  @ApiUnauthorizedResponse({ headers: requestIdHeader, schema: authErrorSchema([
    'TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_SUBJECT_MISMATCH', 'SESSION_REVOKED', 'ACCOUNT_UNAVAILABLE',
  ]) })
  @ApiForbiddenResponse({ headers: requestIdHeader, schema: authErrorSchema(['PASSWORD_CHANGE_REQUIRED']) })
  permissions(@CurrentActor() identity: CurrentIdentity) {
    if (identity.subjectType !== 'EMPLOYEE') throw new TokenValidationError('TOKEN_SUBJECT_MISMATCH');
    // 默认模板与授权均来自本次已验证身份；不再查库，也不调用会补齐依赖的写入解析算法。
    return { role: identity.role, permissionVersion: identity.permissionVersion,
      defaultPermissions: [...roleTemplates[identity.role]].sort(), extraPermissions: [...identity.extraPermissions].sort(),
      effectivePermissions: [...identity.effectivePermissions] };
  }
}
