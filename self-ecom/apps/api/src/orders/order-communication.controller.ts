// 作用：沿用板块3沟通命令；ORDER真实接通，AFTER_SALE未安装仍明确拒绝。
import {Body,Controller,Get,Inject,Param,Post,Query,Req} from '@nestjs/common';
import {ApiTags,ApiQuery} from '@nestjs/swagger';
import {IsIn,IsUUID} from 'class-validator';
import {EmployeeAccess,CustomerAccess} from '../auth/auth.decorators.js';
import {CurrentActor,readBearerToken,type AuthHttpRequest} from '../auth/auth-request-context.js';
import type {CurrentIdentity} from '../auth/current-identity.service.js';
import {PrismaService} from '../prisma/prisma.service.js';
import {runAuthTransaction} from '../auth/auth-transaction.js';
import {PaginationDto} from '../common/http/pagination.dto.js';
import {CommunicationService} from '../records/communication.service.js';
import {CommunicationDto,OrderIdDto} from './order.dto.js';
import * as O from './order.openapi.js';
const attachment=O.object({fileId:O.uuid,audience:{type:'string',enum:['INTERNAL','CUSTOMER_VISIBLE']},contentUrl:O.text(200)});
const publicAttachment=O.object({fileId:O.uuid,contentUrl:O.text(200)});
const body=O.object({scopeType:{type:'string',enum:['ORDER','AFTER_SALE']},scopeId:O.uuid,channel:{type:'string',enum:['PHONE','EXTERNAL_MESSAGE','IN_PERSON','OTHER']},occurredAt:O.date,result:O.text(4000),nextStep:O.text(1000),publicText:O.text(2000),correctsId:O.uuid,correctionReason:O.text(500),attachments:O.array(O.object({fileId:O.uuid,audience:{type:'string',enum:['INTERNAL','CUSTOMER_VISIBLE']}}),5)},['scopeType','scopeId','channel','occurredAt','result']);
const publicItem=O.object({id:O.uuid,publicText:O.text(2000),occurredAt:O.date,createdAt:O.date,correctsId:O.nullable(O.uuid),isCorrected:O.bool,attachments:O.array(publicAttachment)});
const internalItem=O.object({id:O.uuid,authorEmployeeId:O.uuid,channel:O.text(30),occurredAt:O.date,result:O.text(4000),nextStep:O.nullable(O.text(1000)),publicText:O.nullable(O.text(2000)),correctsId:O.nullable(O.uuid),correctionReason:O.nullable(O.text(500)),createdAt:O.date,attachments:O.array(attachment)});
const paged=(item:Parameters<typeof O.array>[0])=>O.object({items:O.array(item),total:O.integer(),page:O.integer(Number.MAX_SAFE_INTEGER,1),pageSize:O.integer(100,1)});
export class CommunicationQueryDto extends PaginationDto {@IsIn(['ORDER','AFTER_SALE']) scopeType!:'ORDER'|'AFTER_SALE';@IsUUID() scopeId!:string;}
@Controller('admin/communications') @ApiTags('Communications') @EmployeeAccess('order.service.read')
export class OrderCommunicationController {
 constructor(@Inject(PrismaService)private readonly db:PrismaService,@Inject(CommunicationService)private readonly service:CommunicationService){}
 @Post() @EmployeeAccess('communication.service.write') @O.endpoint('appendOrderCommunication','追加沟通/更正；内部内容不公开',O.object({id:O.uuid,createdAt:O.date,correctsId:O.nullable(O.uuid)}),body,true)
 append(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Body() b:CommunicationDto){return runAuthTransaction(this.db,tx=>this.service.appendCommunication(tx,{identity:a,token:readBearerToken(r)},{scopeType:b.scopeType,scopeId:b.scopeId,channel:b.channel,occurredAt:new Date(b.occurredAt),result:b.result,nextStep:b.nextStep,publicText:b.publicText,correctsId:b.correctsId,correctionReason:b.correctionReason,requestId:r.requestId!,attachments:b.attachments?.map(i=>({fileId:i.fileId,audience:i.audience}))}));}
 @Get() @O.listQuery() @ApiQuery({name:'scopeType',required:true,enum:['ORDER','AFTER_SALE']}) @ApiQuery({name:'scopeId',required:true,schema:O.uuid}) @O.endpoint('listOrderInternalCommunications','客服读取内部沟通',paged(internalItem))
 list(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Query() q:CommunicationQueryDto){return this.db.$transaction(tx=>this.service.readInternalCommunication(tx,{identity:a,token:readBearerToken(r)},{scopeType:q.scopeType,scopeId:q.scopeId},{page:q.page,pageSize:q.pageSize}));}
}
@Controller('store/orders/:id/communications') @ApiTags('Communications') @CustomerAccess()
export class StoreOrderCommunicationController {
 constructor(@Inject(PrismaService)private readonly db:PrismaService,@Inject(CommunicationService)private readonly service:CommunicationService){}
 @Get() @O.idParam() @O.listQuery() @O.endpoint('listMyOrderCommunications','本人读取沟通公开说明，内部内容不可见',paged(publicItem))
 list(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Query() q:PaginationDto){return this.db.$transaction(tx=>this.service.readPublicCommunication(tx,{identity:a,token:readBearerToken(r)},{scopeType:'ORDER',scopeId:p.id},{page:q.page,pageSize:q.pageSize}));}
}
