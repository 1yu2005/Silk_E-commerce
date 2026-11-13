// 作用：提供员工任务查询、领取和本人安全释放；不开放任意建任务、完成、取消或状态修改。
import { Body, Controller, Get, Header, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { EmployeeAccess } from '../auth/auth.decorators.js';
import { CurrentActor, readBearerToken, type AuthHttpRequest } from '../auth/auth-request-context.js';
import type { CurrentIdentity } from '../auth/current-identity.service.js';
import { authErrorSchema } from '../auth/employee-auth.openapi.js';
import { PaginationDto } from '../common/http/pagination.dto.js';
import { requestIdHeader } from '../health/health.openapi.js';
import { TaskCommandService } from './task-command.service.js';
import { ClaimTaskDto, ReleaseTaskDto, TransferTaskDto, ExtendTaskDeadlineDto, TaskParamsDto, TaskQueryDto } from './task.dto.js';
import { TaskQueryService } from './task-query.service.js';
import { TaskDeadlineService } from './task-deadline.service.js';
import { claimTaskBody, releaseTaskBody, transferTaskBody, extendTaskDeadlineBody, taskCommandSchema, taskDetailSchema, taskHistorySchema, taskListSchema, taskSummarySchema, taskQueryParameters, pageParameters } from './tasks.openapi.js';

@Controller('admin/tasks') @EmployeeAccess() @ApiTags('Tasks') @ApiBearerAuth('bearerAuth')
@ApiUnauthorizedResponse({ headers: requestIdHeader, schema: authErrorSchema(['TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_SUBJECT_MISMATCH', 'SESSION_REVOKED', 'ACCOUNT_UNAVAILABLE']) })
@ApiForbiddenResponse({ headers: requestIdHeader, schema: authErrorSchema(['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED']) })
@ApiBadRequestResponse({ headers: requestIdHeader, schema: authErrorSchema(['VALIDATION_FAILED']) })
export class TasksController {
  constructor(@Inject(TaskQueryService) private readonly queries: TaskQueryService, @Inject(TaskCommandService) private readonly commands: TaskCommandService,
    @Inject(TaskDeadlineService) private readonly deadlines: TaskDeadlineService) {}
  @Get() @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'listTasks', summary: '分页查询本人任务、合资格岗位池或管理员待安排', description: '默认mine，仅当前本人经办；pool仅当前完整资格且OPEN；reassign须管理员task.transfer。所有范围还需真实业务读取权。按截止升序、无截止在后、创建时间/ID稳定排序；overdue为当前未终结任务是否到期。' })
  @ApiQuery(taskQueryParameters[0]!) @ApiQuery(taskQueryParameters[1]!) @ApiQuery(taskQueryParameters[2]!) @ApiQuery(taskQueryParameters[3]!)
  @ApiQuery(taskQueryParameters[4]!) @ApiQuery(taskQueryParameters[5]!) @ApiQuery(pageParameters[0]!) @ApiQuery(pageParameters[1]!)
  @ApiOkResponse({ headers: requestIdHeader, schema: taskListSchema })
  list(@CurrentActor() actor: CurrentIdentity, @Req() request: AuthHttpRequest, @Query() query: TaskQueryDto) {
    return this.queries.list(actor, readBearerToken(request), query);
  }
  @Get('summary') @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'getTaskSummary', summary: '查询本人待办、岗位池及逾期摘要', description: '各卡片可重叠。逾期仅统计本人可读任务：当前逾期为未终结且now>=dueAt；历史曾逾期含持久事实或当前已到期。普通员工待安排数为null；无真实业务范围时返回真实零值。' })
  @ApiOkResponse({ headers: requestIdHeader, schema: taskSummarySchema })
  summary(@CurrentActor() actor: CurrentIdentity, @Req() request: AuthHttpRequest) { return this.queries.summary(actor, readBearerToken(request)); }
  @Get(':id') @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'getTaskDetail', summary: '查询任务、期限快照及裁剪后的业务摘要', description: '业务读取权并满足当前资格/当前或历史经办/管理员范围；不可查看与不存在均404。allowedActions仅提示，提交仍重新检查当前权限、任务版本和真实业务允许条件。' })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiNotFoundResponse({ headers: requestIdHeader, schema: authErrorSchema(['TASK_NOT_FOUND']) }) @ApiOkResponse({ headers: requestIdHeader, schema: taskDetailSchema })
  detail(@CurrentActor() actor: CurrentIdentity, @Req() request: AuthHttpRequest, @Param() params: TaskParamsDto) { return this.queries.detail(actor, readBearerToken(request), params.id); }
  @Get(':id/history') @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'getTaskHistory', summary: '分页查询任务动作与期限事件统一时间线', description: '与详情使用同一业务读取范围，旧经办不替代当前业务读取权。occurredAt降序、kind/id升序稳定分页；原因按业务权限隐藏，响应不包含全店审计、员工账号或凭证。' })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } }) @ApiQuery(pageParameters[0]!) @ApiQuery(pageParameters[1]!)
  @ApiNotFoundResponse({ headers: requestIdHeader, schema: authErrorSchema(['TASK_NOT_FOUND']) }) @ApiOkResponse({ headers: requestIdHeader, schema: taskHistorySchema })
  history(@CurrentActor() actor: CurrentIdentity, @Req() request: AuthHttpRequest, @Param() params: TaskParamsDto, @Query() query: PaginationDto) {
    return this.queries.history(actor, readBearerToken(request), params.id, query);
  }
  @Post(':id/claim') @HttpCode(200) @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'claimTask', summary: '原子领取本人任务', description: '锁员工、完整业务、游标和任务后复核当前身份、全部资格、业务允许条件和版本。重复原expectedVersion仅在当前仍为该主体最后一次领取结果时changed=false；释放或再领取后旧请求冲突。' })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } }) @ApiBody({ required: true, schema: claimTaskBody })
  @ApiNotFoundResponse({ headers: requestIdHeader, schema: authErrorSchema(['TASK_NOT_FOUND']) })
  @ApiConflictResponse({ headers: requestIdHeader, schema: authErrorSchema(['VERSION_CONFLICT', 'TASK_ALREADY_CLAIMED', 'TASK_NOT_OPEN', 'TASK_ENTRY_BLOCKED', 'BUSINESS_MODULE_NOT_READY', 'TASK_LOCK_PLAN_CHANGED', 'TASK_VERSION_EXHAUSTED']) })
  @ApiOkResponse({ headers: requestIdHeader, schema: taskCommandSchema })
  claim(@CurrentActor() actor: CurrentIdentity, @Req() request: AuthHttpRequest, @Param() params: TaskParamsDto, @Body() input: ClaimTaskDto) {
    return this.commands.claim(actor, readBearerToken(request), params.id, input, request.requestId);
  }
  @Post(':id/release') @HttpCode(200) @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'releaseTask', summary: '本人安全释放任务并保留轮次和期限', description: '当前经办且真实业务确认可安全交接才释放，原因必填。同主体、同expectedVersion、同规范化原因的最后一次成功释放可以重放；不借释放恢复暂停任务。' })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } }) @ApiBody({ required: true, schema: releaseTaskBody })
  @ApiNotFoundResponse({ headers: requestIdHeader, schema: authErrorSchema(['TASK_NOT_FOUND']) })
  @ApiConflictResponse({ headers: requestIdHeader, schema: authErrorSchema(['VERSION_CONFLICT', 'TASK_NOT_ASSIGNEE', 'TASK_RELEASE_BLOCKED', 'BUSINESS_MODULE_NOT_READY', 'TASK_LOCK_PLAN_CHANGED', 'TASK_VERSION_EXHAUSTED']) })
  @ApiOkResponse({ headers: requestIdHeader, schema: taskCommandSchema })
  release(@CurrentActor() actor: CurrentIdentity, @Req() request: AuthHttpRequest, @Param() params: TaskParamsDto, @Body() input: ReleaseTaskDto) {
    return this.commands.release(actor, readBearerToken(request), params.id, input, request.requestId);
  }
  @Post(':id/transfer') @HttpCode(200) @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'transferTask', summary: '管理员显式指派或安全转交任务', description: '仅SUPER_ADMIN且task.transfer；目标须启用、已改密且满足完整资格。OPEN可指派，CLAIMED可转交，暂停/终结不可转交。按完整锁序复核并与真实领域交接、历史、审计同事务；保留轮次与期限。同主体/旧版本/目标/原因的最后成功结果可幂等重放。' })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } }) @ApiBody({ required: true, schema: transferTaskBody })
  @ApiNotFoundResponse({ headers: requestIdHeader, schema: authErrorSchema(['TASK_NOT_FOUND']) })
  @ApiConflictResponse({ headers: requestIdHeader, schema: authErrorSchema(['VERSION_CONFLICT', 'TARGET_NOT_ELIGIBLE', 'TASK_TRANSFER_BLOCKED', 'BUSINESS_MODULE_NOT_READY', 'TASK_LOCK_PLAN_CHANGED', 'TASK_VERSION_EXHAUSTED']) })
  @ApiOkResponse({ headers: requestIdHeader, schema: taskCommandSchema })
  transfer(@CurrentActor() actor: CurrentIdentity, @Req() request: AuthHttpRequest, @Param() params: TaskParamsDto, @Body() input: TransferTaskDto) {
    return this.commands.transfer(actor, readBearerToken(request), params.id, input, request.requestId);
  }
  @Post(':id/extend-deadline') @HttpCode(200) @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'extendTaskDeadline', summary: '管理员延期或首次指定人工任务截止', description: '仅SUPER_ADMIN且deadline.extend，真实领域适配器必须允许并同步合法领域截止。新截止须为ISO UTC且晚于当前截止和现在；不改付款、售后申请窗口、自动收货或交运事实。保留原截止、经办、状态和轮次；旧截止已到（含等号）先补记OVERDUE，再写EXTENDED或DEADLINE_ASSIGNED及历史/审计，全部同事务。终结拒绝；暂停是否允许由领域决定，延期不会恢复任务。同主体/旧版本/原因/规范化截止的最后成功结果changed=false，仍复核身份和领域资格。' })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } }) @ApiBody({ required: true, schema: extendTaskDeadlineBody })
  @ApiNotFoundResponse({ headers: requestIdHeader, schema: authErrorSchema(['TASK_NOT_FOUND']) })
  @ApiConflictResponse({ headers: requestIdHeader, schema: authErrorSchema(['VERSION_CONFLICT', 'TASK_DEADLINE_BLOCKED', 'TASK_DEADLINE_NOT_LATER', 'BUSINESS_MODULE_NOT_READY', 'TASK_LOCK_PLAN_CHANGED', 'TASK_VERSION_EXHAUSTED']) })
  @ApiOkResponse({ headers: requestIdHeader, schema: taskCommandSchema })
  extendDeadline(@CurrentActor() actor: CurrentIdentity, @Req() request: AuthHttpRequest, @Param() params: TaskParamsDto, @Body() input: ExtendTaskDeadlineDto) {
    return this.deadlines.extend(actor, readBearerToken(request), params.id, input, request.requestId);
  }
}
