// 作用：管理员只读审计入口；静态筛选路由先注册，授权先于参数与目标存在性检查。
import {Controller,Get,Header,Inject,Param,Query,Req} from '@nestjs/common';
import {ApiBadRequestResponse,ApiBearerAuth,ApiForbiddenResponse,ApiNotFoundResponse,ApiOkResponse,ApiOperation,ApiParam,ApiQuery,ApiTags,ApiUnauthorizedResponse} from '@nestjs/swagger';
import {EmployeeAccess} from '../auth/auth.decorators.js';
import {CurrentActor,readBearerToken,type AuthHttpRequest} from '../auth/auth-request-context.js';
import type {CurrentIdentity} from '../auth/current-identity.service.js';
import {authErrorSchema} from '../auth/employee-auth.openapi.js';
import {requestIdHeader} from '../health/health.openapi.js';
import {AuditFilterOptionsDto,AuditIdDto,AuditListQueryDto} from './audit-query.dto.js';
import {auditDetailSchema,auditListSchema,auditOptionsSchema} from './audit-query.openapi.js';
import {auditActionNames,auditActorTypes,auditBusinessTypes,auditTargetTypes} from './audit-query.policy.js';
import {AuditQueryService} from './audit-query.service.js';
const context=(actor:CurrentIdentity,request:AuthHttpRequest)=>({actor,token:readBearerToken(request),requestId:request.requestId!});
@Controller('admin/audit-logs')
@EmployeeAccess('audit.read')
@ApiTags('Audit')
@ApiBearerAuth('bearerAuth')
@ApiUnauthorizedResponse({headers:requestIdHeader,schema:authErrorSchema(['TOKEN_INVALID','TOKEN_EXPIRED','SESSION_REVOKED','ACCOUNT_UNAVAILABLE'])})
@ApiForbiddenResponse({headers:requestIdHeader,schema:authErrorSchema(['FORBIDDEN','PASSWORD_CHANGE_REQUIRED'])})
@ApiBadRequestResponse({headers:requestIdHeader,schema:authErrorSchema(['VALIDATION_FAILED','QUERY_RANGE_TOO_LARGE'])})
export class AuditQueryController {
  constructor(@Inject(AuditQueryService) private readonly audit:AuditQueryService){}
  @Get('filter-options') @Header('Cache-Control','no-store')
  @ApiOperation({operationId:'getAuditFilterOptions',summary:'查询审计筛选选项',description:'仅管理员audit.read。员工候选包含停用员工，只返回受控工作账号、稳定编号及停用标记；显示名为安全工作标识，不返回自由显示名或员工权限/电话。'})
  @ApiQuery({name:'actorKeyword',required:false,schema:{type:'string',maxLength:50}})
  @ApiQuery({name:'limit',required:false,schema:{type:'integer',minimum:1,maximum:100,default:20}})
  @ApiOkResponse({headers:requestIdHeader,schema:auditOptionsSchema})
  filterOptions(@CurrentActor() actor:CurrentIdentity,@Req() request:AuthHttpRequest,@Query() query:AuditFilterOptionsDto){return this.audit.filterOptions(context(actor,request),query);}
  @Get() @Header('Cache-Control','no-store')
  @ApiOperation({operationId:'listAuditLogs',summary:'分页检索全店安全审计',description:'默认最近7个北京日期到本次asOf，from包含/to不含且不读未来事实。显式时间须带时区，范围最多366天，page×pageSize≤10000。仅精确白名单筛选，按createdAt/id倒序；count/items同一REPEATABLE READ只读快照，业务号用存在性引用避免重复。未知动作仅安全元数据；自由文本原因、显示名与任意历史payload不会返回。业务号只覆盖已建立确定引用的历史，不推断缺失关系。'})
  @ApiQuery({name:'page',required:false,schema:{type:'integer',minimum:1,maximum:10000,default:1}})
  @ApiQuery({name:'pageSize',required:false,schema:{type:'integer',minimum:1,maximum:100,default:20}})
  @ApiQuery({name:'actorType',required:false,enum:auditActorTypes})
  @ApiQuery({name:'actorEmployeeId',required:false,schema:{type:'string',format:'uuid'}})
  @ApiQuery({name:'actorCustomerId',required:false,schema:{type:'string',format:'uuid'}})
  @ApiQuery({name:'action',required:false,enum:auditActionNames})
  @ApiQuery({name:'targetType',required:false,enum:auditTargetTypes})
  @ApiQuery({name:'targetId',required:false,schema:{type:'string',minLength:1,maxLength:100}})
  @ApiQuery({name:'businessType',required:false,enum:auditBusinessTypes})
  @ApiQuery({name:'businessNo',required:false,schema:{type:'string',minLength:1,maxLength:100}})
  @ApiQuery({name:'requestId',required:false,schema:{type:'string',minLength:1,maxLength:64}})
  @ApiQuery({name:'from',required:false,schema:{type:'string',format:'date-time'}})
  @ApiQuery({name:'to',required:false,schema:{type:'string',format:'date-time'}})
  @ApiOkResponse({headers:requestIdHeader,schema:auditListSchema})
  list(@CurrentActor() actor:CurrentIdentity,@Req() request:AuthHttpRequest,@Query() query:AuditListQueryDto){return this.audit.list(context(actor,request),query);}
  @Get(':id') @Header('Cache-Control','no-store')
  @ApiOperation({operationId:'getAuditLog',summary:'查询一条安全审计详情',description:'仅audit.read；已知动作按字段和值白名单展示必要差异，未知动作只给安全元数据和提示。不提供原始JSON/文件路径/令牌或编辑删除接口；附件仍经原业务授权。'})
  @ApiParam({name:'id',schema:{type:'string',format:'uuid'}})
  @ApiOkResponse({headers:requestIdHeader,schema:auditDetailSchema})
  @ApiNotFoundResponse({headers:requestIdHeader,schema:authErrorSchema(['AUDIT_LOG_NOT_FOUND'])})
  detail(@CurrentActor() actor:CurrentIdentity,@Req() request:AuthHttpRequest,@Param() params:AuditIdDto){return this.audit.detail(context(actor,request),params.id);}
}
