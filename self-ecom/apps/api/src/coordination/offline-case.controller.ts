// 作用：只提供线下协作正式命令，不能借工单结束售后、生成系统退款或调整库存。
import {Body,Controller,Get,HttpCode,Inject,Param,Post,Query,Req,Res} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import type {ServerResponse} from 'node:http';
import {EmployeeAccess} from '../auth/auth.decorators.js';
import {CurrentActor,readBearerToken,type AuthHttpRequest} from '../auth/auth-request-context.js';
import type {CurrentIdentity} from '../auth/current-identity.service.js';
import {OrderIdDto} from '../orders/order.dto.js';
import {OfflineCaseService} from './offline-case.service.js';
import * as D from './offline-case.dto.js';
import * as O from './offline-case.openapi.js';
const context=(actor:CurrentIdentity,r:AuthHttpRequest)=>({actor,token:readBearerToken(r),requestId:r.requestId!});
@Controller('admin/offline-cases') @ApiTags('OfflineCases') @EmployeeAccess('offline-case.manage')
export class OfflineCaseController{
 constructor(@Inject(OfflineCaseService)private readonly service:OfflineCaseService){}
 @Get() @O.query() @O.endpoint('listOfflineCases','线下工单队列与当前任务',O.list)
 list(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Query() q:D.OfflineCaseQueryDto){return this.service.list(context(a,r),q);}
 @Post() @O.endpoint('createOfflineCase','登记线下工单并进入待领任务',O.result,O.create,true)
 async create(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Body() b:D.CreateOfflineCaseDto,@Res({passthrough:true}) response:ServerResponse){const result=await this.service.create(context(a,r),b);response.statusCode=result.replayed?200:201;return result;}
 @Get(':id') @O.idParam() @O.endpoint('getOfflineCase','线下工单、内部事件及物品后续',O.detail)
 detail(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto){return this.service.detail(context(a,r),p.id);}
 @Post(':id/begin') @HttpCode(200) @O.idParam() @O.endpoint('beginOfflineCase','当前已领经办开始处理',O.result,O.commandBody)
 begin(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.OfflineCommandDto){return this.service.begin(context(a,r),p.id,b);}
 @Post(':id/events') @HttpCode(200) @O.idParam() @O.endpoint('appendOfflineCaseEvent','追加线下结果、更正或管理员协调决定',O.result,O.eventBody)
 event(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.OfflineEventDto){return this.service.append(context(a,r),p.id,b);}
 @Post(':id/resolve') @HttpCode(200) @O.idParam() @O.endpoint('resolveOfflineCase','实际处理完成且依赖均已处理',O.result,O.resolveBody)
 resolve(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.ResolveOfflineCaseDto){return this.service.resolve(context(a,r),p.id,b);}
 @Post(':id/close') @HttpCode(200) @O.idParam() @O.endpoint('closeOfflineCase','有理由结束无需继续且无物品争议阻挡的工单',O.result,O.closeBody)
 close(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.CloseOfflineCaseDto){return this.service.close(context(a,r),p.id,b);}
}
