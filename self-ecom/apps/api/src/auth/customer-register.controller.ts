// 作用：提供公开顾客注册接口并接入独立注册限流与契约说明。
import { Body, Controller, Header, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiCreatedResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { RequestWithId } from '../common/http/request-context.js';
import { requestIdHeader } from '../health/health.openapi.js';
import { CustomerRegisterDto } from './customer-register.dto.js';
import { customerRegisterBodySchema, customerRegisterSuccessSchema } from './customer-register.openapi.js';
import { CustomerRegisterService } from './customer-register.service.js';
import { authErrorSchema } from './employee-auth.openapi.js';
import { RegistrationRateGuard } from './registration-rate.guard.js';

@Controller('store/auth')
@ApiTags('CustomerAuth')
export class CustomerRegisterController {
  constructor(@Inject(CustomerRegisterService) private readonly customers: CustomerRegisterService) {}

  @Post('register')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @UseGuards(RegistrationRateGuard)
  @ApiOperation({ operationId: 'registerCustomer', summary: '顾客注册',
    description: '公开接口；每实际来源IP每分钟5次，格式错误也计数，超限429及Retry-After。手机号唯一，注册不自动登录、不发送短信、不代表已验证手机号所有权。顾客与最小审计同事务，失败全部回滚。响应丢失先尝试登录核实，不覆盖已有账号。' })
  @ApiBody({ schema: customerRegisterBodySchema })
  @ApiCreatedResponse({ headers: requestIdHeader, schema: customerRegisterSuccessSchema })
  @ApiBadRequestResponse({ headers: requestIdHeader, schema: authErrorSchema(['VALIDATION_FAILED']) })
  @ApiConflictResponse({ headers: requestIdHeader, schema: authErrorSchema(['PHONE_EXISTS']) })
  @ApiResponse({ status: 429, headers: { ...requestIdHeader, 'Retry-After': { description: '等待秒数', schema: { type: 'integer', minimum: 1 } } },
    schema: authErrorSchema(['AUTH_RATE_LIMITED']) })
  register(@Body() input: CustomerRegisterDto, @Req() request: RequestWithId) {
    return this.customers.register(input, request.requestId);
  }
}
