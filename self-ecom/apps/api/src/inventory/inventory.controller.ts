// 作用：库存静态路径先注册，所有写命令只接收业务输入；余额没有直接覆盖或改R入口。
import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EmployeeAccess } from '../auth/auth.decorators.js';
import { CurrentActor, readBearerToken, type AuthHttpRequest } from '../auth/auth-request-context.js';
import type { CurrentIdentity } from '../auth/current-identity.service.js';
import { InventorySources } from './inventory-source.service.js';
import { InventoryAdjustments } from './inventory-adjustment.service.js';
import { InventoryConversion } from './inventory-conversion.service.js';
import { InventoryQueries } from './inventory-query.service.js';
import * as D from './inventory.dto.js';
import * as O from './inventory.openapi.js';
import { object, int, text } from '../catalog/catalog.openapi.js';
const ctx=(actor:CurrentIdentity,r:AuthHttpRequest)=>({actor,token:readBearerToken(r),requestId:r.requestId});
@Controller('admin/inventory') @ApiTags('Inventory') @O.Protected()
export class InventoryController {
 constructor(@Inject(InventoryQueries) private readonly queries:InventoryQueries,@Inject(InventorySources) private readonly sources:InventorySources,@Inject(InventoryAdjustments) private readonly adjustments:InventoryAdjustments){}
 @Get() @EmployeeAccess('inventory.read') @O.QueryFields(['page','pageSize','keyword','skuId','lowStock','purchaseBlocked']) @O.Endpoint('listInventoryBalances','筛选SKU可用量和待付款占用',O.balanceList)
 list(@Query() q:D.InventoryQueryDto){return this.queries.balances(q);}
 @Get('ledger') @EmployeeAccess('inventory.read') @O.QueryFields(['page','pageSize','skuId','eventType','businessNumber','actorEmployeeId','from','to']) @O.Endpoint('listInventoryLedger','库存不可改流水',O.ledgerList)
 ledger(@Query() q:D.InventoryQueryDto){return this.queries.ledger(q);}
 @Get('actions/:id') @EmployeeAccess('inventory.read') @O.Params() @O.Endpoint('getInventoryAction','库存成功动作及关联流水',O.action)
 action(@Param() p:D.InventoryIdDto){return this.queries.action(p.id);}
 @Get('sources') @EmployeeAccess('inventory.read') @O.QueryFields(['page','pageSize','keyword','sourceType']) @O.Endpoint('listInventorySources','库存来源凭据',O.sourceList)
 sourceList(@Query() q:D.InventoryQueryDto){return this.queries.sources(q);}
 @Get('sources/:id') @EmployeeAccess('inventory.read') @O.Params() @O.Endpoint('getInventorySource','来源行净量和实际批次',O.sourceDetail)
 sourceDetail(@Param() p:D.InventoryIdDto){return this.queries.source(p.id);}
 @Post('sources') @EmployeeAccess('inventory.source.manage') @O.Endpoint('createInventorySource','创建核实来源凭据',O.sourceDetail,O.sourceCreate,true)
 async sourceCreate(@Body() b:D.SourceCreateDto,@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){const result=await this.sources.create(ctx(a,r),b);return {...await this.queries.source(result.id),changed:result.changed};}
 @Post('sources/:id/lines') @EmployeeAccess('inventory.source.manage') @O.Params() @O.Endpoint('addInventorySourceLine','追加固定SKU的核实来源行',O.sourceDetail,O.sourceAdd,true)
 async sourceAdd(@Param() p:D.InventoryIdDto,@Body() b:D.SourceAddLineDto,@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){await this.sources.addLine(ctx(a,r),p.id,b);return {...await this.queries.source(p.id),changed:true};}
 @Put('source-lines/:id/verified-quantity') @EmployeeAccess('inventory.source.manage') @O.Params() @O.Endpoint('verifyInventorySourceLine','有证据地修订核实数量',O.sourceDetail,O.sourceVerify)
 async verify(@Param() p:D.InventoryIdDto,@Body() b:D.SourceVerifyDto,@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){const line=await this.sources.verify(ctx(a,r),p.id,b);return {...await this.queries.source(line.sourceId),changed:true};}
 @Get('adjustments') @EmployeeAccess('inventory.read') @O.QueryFields(['page','pageSize','keyword','status','type','assigneeId','from','to']) @O.Endpoint('listInventoryAdjustments','筛选库存登记',O.adjustmentList)
 adjustmentList(@Query() q:D.InventoryQueryDto){return this.queries.adjustments(q);}
 @Get('adjustments/:id') @EmployeeAccess('inventory.read') @O.Params() @O.Endpoint('getInventoryAdjustment','登记、经办、核实和账务事实',O.adjustmentDetail)
 adjustmentDetail(@Param() p:D.InventoryIdDto){return this.queries.adjustment(p.id);}
 @Post('adjustments') @EmployeeAccess('inventory.adjustment.create') @O.Endpoint('createInventoryAdjustment','创建待确认登记，不改变余额',O.adjustmentDetail,O.adjustmentCreate,true)
 async create(@Body() b:D.AdjustmentCreateDto,@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){const result=await this.adjustments.create(ctx(a,r),b);return {...await this.queries.adjustment(result.id),changed:result.changed};}
 @Patch('adjustments/:id') @EmployeeAccess('inventory.adjustment.create') @O.Params() @O.Endpoint('editInventoryAdjustment','保存待确认登记，保持任务轮次',O.adjustmentDetail,O.adjustmentEdit)
 async edit(@Param() p:D.InventoryIdDto,@Body() b:D.AdjustmentEditDto,@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){const result=await this.adjustments.edit(ctx(a,r),p.id,b);return {...await this.queries.adjustment(p.id),changed:result.changed};}
 @Post('adjustments/:id/claim') @HttpCode(200) @EmployeeAccess('inventory.adjustment.claim') @O.Params() @O.Endpoint('claimInventoryAdjustment','领取当前入账或核实任务',O.adjustmentDetail,O.command)
 async claim(@Param() p:D.InventoryIdDto,@Body() b:D.AdjustmentCommandDto,@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){const result=await this.adjustments.claim(ctx(a,r),p.id,b);return {...await this.queries.adjustment(p.id),changed:result.changed};}
 @Post('adjustments/:id/post') @HttpCode(200) @EmployeeAccess('inventory.adjustment.post') @O.Params() @O.Endpoint('postInventoryAdjustment','当前经办确认并原子入账',O.adjustmentDetail,O.command)
 async post(@Param() p:D.InventoryIdDto,@Body() b:D.AdjustmentCommandDto,@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){const result=await this.adjustments.post(ctx(a,r),p.id,b);return {...await this.queries.adjustment(p.id),changed:result.changed};}
 @Post('adjustments/:id/void') @HttpCode(200) @EmployeeAccess('inventory.adjustment.void') @O.Params() @O.Endpoint('voidInventoryAdjustment','当前经办作废待确认登记',O.adjustmentDetail,O.voidBody)
 async void(@Param() p:D.InventoryIdDto,@Body() b:D.AdjustmentVoidDto,@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){const result=await this.adjustments.void(ctx(a,r),p.id,b);return {...await this.queries.adjustment(p.id),changed:result.changed};}
 @Post('adjustments/:id/corrections') @EmployeeAccess('inventory.adjustment.create') @O.Params() @O.Endpoint('createInventoryCorrection','针对已入账原根另开差额更正',O.adjustmentDetail,O.correction,true)
 async corrections(@Param() p:D.InventoryIdDto,@Body() b:D.CorrectionCreateDto,@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){const result=await this.adjustments.corrections(ctx(a,r),p.id,b);return {...await this.queries.adjustment(result.id),changed:result.changed};}
 @Post('adjustments/:id/resolve-check') @HttpCode(200) @EmployeeAccess('inventory.adjustment.post') @O.Params() @O.Endpoint('resolveInventoryCheck','校验问题已解决后开启新入账轮',O.adjustmentDetail,O.resolveBody)
 async resolve(@Param() p:D.InventoryIdDto,@Body() b:D.AdjustmentResolveDto,@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){const result=await this.adjustments.resolve(ctx(a,r),p.id,b);return {...await this.queries.adjustment(p.id),changed:result.changed};}
 @Get(':skuId') @EmployeeAccess('inventory.read') @O.Params('skuId') @O.Endpoint('getInventoryBalance','SKU余额及有效暂停摘要',O.balance)
 balance(@Param() p:D.InventorySkuIdDto){return this.queries.balance(p.skuId);}
 @Put(':skuId/warning-threshold') @EmployeeAccess('inventory.alert.manage') @O.Params('skuId') @O.Endpoint('setInventoryWarningThreshold','修改预警线，不产生数量流水',O.balance,object({...O.version,threshold:int(),reason:text(500,1)}))
 threshold(@Param() p:D.InventorySkuIdDto,@Body() b:D.InventoryThresholdDto,@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){return this.queries.threshold(ctx(a,r),p.skuId,b);}
}
@Controller('admin/products') @ApiTags('Inventory') @O.Protected()
export class InventoryConversionController {
 constructor(@Inject(InventoryConversion) private readonly conversion:InventoryConversion,@Inject(InventoryQueries) private readonly queries:InventoryQueries){}
 @Post(':id/initial-inventory-draft/convert') @HttpCode(200) @EmployeeAccess('inventory.adjustment.create','product.manage') @O.Params() @O.Endpoint('convertInitialInventoryDraft','数量草稿生成待确认登记',O.adjustmentDetail,O.conversion)
 async convert(@Param() p:D.InventoryIdDto,@Body() b:D.InitialConvertDto,@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){const result=await this.conversion.convert(ctx(a,r),p.id,b);return {...await this.queries.adjustment(result.id),converted:true,changed:result.changed};}
}
