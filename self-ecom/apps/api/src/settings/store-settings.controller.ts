// 作用：提供管理员设置读写/历史和独立公开联系方式路由，沿用认证、requestId与统一响应。
import { Body, Controller, Get, Header, Inject, Param, Put, Query, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { EmployeeAccess } from '../auth/auth.decorators.js';
import { CurrentActor, readBearerToken, type AuthHttpRequest } from '../auth/auth-request-context.js';
import type { CurrentIdentity } from '../auth/current-identity.service.js';
import { authErrorSchema } from '../auth/employee-auth.openapi.js';
import { requestIdHeader } from '../health/health.openapi.js';
import { SettingVersionParamsDto, SettingVersionsQueryDto, UpdateStoreSettingsDto } from './store-settings.dto.js';
import { currentSettingsSchema, settingVersionSchema, settingVersionsSchema, storeContactSchema, updateSettingsBodySchema, updateSettingsSchema } from './store-settings.openapi.js';
import { StoreSettingsService } from './store-settings.service.js';

@Controller('admin/settings')
@EmployeeAccess('store.setting.manage')
@ApiTags('StoreSettings')
@ApiBearerAuth('bearerAuth')
@ApiUnauthorizedResponse({ headers: requestIdHeader, schema: authErrorSchema([
  'TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_SUBJECT_MISMATCH', 'SESSION_REVOKED', 'ACCOUNT_UNAVAILABLE',
]) })
@ApiForbiddenResponse({ headers: requestIdHeader, schema: authErrorSchema(['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED']) })
export class StoreSettingsController {
  constructor(@Inject(StoreSettingsService) private readonly settings: StoreSettingsService) {}

  @Get() @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'getStoreSettings', summary: '查询当前全店设置',
    description: '仅管理员store.setting.manage可用；未配置时configured=false、version=0、currentSetting=null。完整配置包含地址和内部期限，不向普通员工或顾客开放。' })
  @ApiOkResponse({ headers: requestIdHeader, schema: currentSettingsSchema })
  current() { return this.settings.current(); }

  @Put() @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'updateStoreSettings', summary: '完整替换全店设置并追加版本',
    description: '金额为整数分，期限为正整数且单位固定；严格boolean与嵌套字段白名单。文本去首尾空白，电话移除空格和连字符。先锁员工再锁Head，锁内复核身份和管理员权限。expectedVersion过期始终409；同内容且版本匹配changed=false、不新增版本/审计；变化时版本、指针和审计同事务提交。仅影响之后新阶段，旧版本和已固化期限不回写。' })
  @ApiBody({ required: true, schema: updateSettingsBodySchema })
  @ApiOkResponse({ headers: requestIdHeader, schema: updateSettingsSchema })
  @ApiBadRequestResponse({ headers: requestIdHeader, schema: authErrorSchema(['VALIDATION_FAILED']) })
  @ApiConflictResponse({ headers: requestIdHeader, schema: authErrorSchema(['VERSION_CONFLICT']) })
  update(@Body() input: UpdateStoreSettingsDto, @CurrentActor() actor: CurrentIdentity, @Req() request: AuthHttpRequest) {
    return this.settings.update(actor, readBearerToken(request), input, request.requestId);
  }

  @Get('versions') @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'listStoreSettingVersions', summary: '分页查询全店设置版本摘要',
    description: '版本编号倒序；总数和本页使用一致快照。只返回ID、编号、修改人ID、时间和原因；完整配置由详情接口读取。' })
  @ApiQuery({ name: 'page', required: false, schema: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER, default: 1 } })
  @ApiQuery({ name: 'pageSize', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } })
  @ApiOkResponse({ headers: requestIdHeader, schema: settingVersionsSchema })
  @ApiBadRequestResponse({ headers: requestIdHeader, schema: authErrorSchema(['VALIDATION_FAILED']) })
  versions(@Query() query: SettingVersionsQueryDto) { return this.settings.versions(query); }

  @Get('versions/:id') @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'getStoreSettingVersion', summary: '查询全店设置历史版本',
    description: '仅管理员可查完整历史与修改原因；不存在版本404。已保存的旧配置不随现值变化。' })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({ headers: requestIdHeader, schema: settingVersionSchema })
  @ApiBadRequestResponse({ headers: requestIdHeader, schema: authErrorSchema(['VALIDATION_FAILED']) })
  @ApiNotFoundResponse({ headers: requestIdHeader, schema: authErrorSchema(['SETTING_VERSION_NOT_FOUND']) })
  version(@Param() params: SettingVersionParamsDto) { return this.settings.version(params.id); }
}

@Controller('store/contact')
@ApiTags('StoreSettings')
export class StoreContactController {
  constructor(@Inject(StoreSettingsService) private readonly settings: StoreSettingsService) {}
  @Get() @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'getStoreContact', summary: '公开查询店铺服务联系方式',
    description: '无需登录。仅返回configured、servicePhone、serviceHours和settingsVersion；未配置时联系方式为null、版本0。不返回退货地址、内部期限、运费、修改人或原因。' })
  @ApiOkResponse({ headers: requestIdHeader, schema: storeContactSchema })
  contact() { return this.settings.contact(); }
}
