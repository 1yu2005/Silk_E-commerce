// 作用：仓储事实登记与顾客收货入口；所有条件仍在服务端持锁后复核。
import {Body,Controller,Get,HttpCode,Inject,Param,Post,Req} from '@nestjs/common';
import {ApiParam,ApiTags} from '@nestjs/swagger';
import {IsUUID} from 'class-validator';
import {EmployeeAccess,CustomerAccess} from '../auth/auth.decorators.js';
import {CurrentActor,readBearerToken,type AuthHttpRequest} from '../auth/auth-request-context.js';
import type {CurrentIdentity} from '../auth/current-identity.service.js';
import {EmptyBodyPipe} from '../common/http/empty-body.pipe.js';
import {OrderIdDto} from './order.dto.js';
import * as D from './fulfillment.dto.js';
import * as F from './fulfillment.openapi.js';
import * as O from './order.openapi.js';
import {FulfillmentService} from './fulfillment.service.js';
import {FulfillmentQueries} from './fulfillment-query.service.js';
const ctx=(actor:CurrentIdentity,r:AuthHttpRequest)=>({actor,token:readBearerToken(r),requestId:r.requestId!});
export class ExceptionParamsDto extends OrderIdDto {@IsUUID() exceptionId!:string;}
@Controller('admin/orders/:id/fulfillment') @ApiTags('Fulfillment') @EmployeeAccess() @O.idParam()
export class FulfillmentController {
 constructor(@Inject(FulfillmentService)private readonly service:FulfillmentService,@Inject(FulfillmentQueries)private readonly queries:FulfillmentQueries){}
 @Get() @O.endpoint('getOrderFulfillment','履约工作台与动作资格',F.detail)
 detail(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto){return this.queries.detail(ctx(a,r),p.id);}
 @Post('claim') @HttpCode(200) @EmployeeAccess('shipment.claim') @O.endpoint('claimOrderShipment','领取付款时已创建的发货任务',O.object({changed:O.bool,taskId:O.uuid}),O.object({expectedOrderVersion:F.version,expectedTaskVersion:F.version}))
 async claim(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.ClaimShipmentDto){const result=await this.service.claim(ctx(a,r),p.id,b);return {changed:result.changed,taskId:result.task.id};}
 @Post('pack') @HttpCode(200) @EmployeeAccess('shipment.pack') @O.endpoint('packOrderShipment','逐行整单打包核对',F.result,F.pack)
 pack(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.PackDto){return this.service.pack(ctx(a,r),p.id,b);}
 @Post('physical-check') @HttpCode(200) @EmployeeAccess('shipment.pack') @O.endpoint('invalidateOrderPacking','移动/撤回打包，递增实物版本并使旧检查失效',F.result,F.pack)
 physical(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.PackDto){return this.service.pack(ctx(a,r),p.id,b,true);}
 @Post('prepare') @HttpCode(200) @EmployeeAccess('shipment.pack') @O.endpoint('prepareOrderShipment','准备运单；变更保留旧新值，不标记发货',F.result,F.prepare)
 prepare(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.PrepareShipmentDto){return this.service.prepare(ctx(a,r),p.id,b);}
 @Post('start-handover') @HttpCode(200) @EmployeeAccess('shipment.handover') @O.endpoint('startOrderHandover','先持久化交运动作，成功后才允许线下交包',F.result,F.start)
 start(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.StartHandoverDto){return this.service.start(ctx(a,r),p.id,b);}
 @Post('confirm-handover') @HttpCode(200) @EmployeeAccess('shipment.handover') @O.endpoint('confirmOrderHandover','登记当前动作已实际交运的事实',F.result,F.confirm)
 confirm(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.ConfirmHandoverDto){return this.service.confirm(ctx(a,r),p.id,b);}
 @Post('declare-uncertain') @HttpCode(200) @EmployeeAccess('shipment.handover') @O.endpoint('declareOrderHandoverUncertain','主动声明结果不明，停止普通交包并建立核实任务',F.result,F.uncertain)
 uncertain(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.AttemptEvidenceDto){return this.service.declareUncertain(ctx(a,r),p.id,b);}
 @Post('resolve-handover') @HttpCode(200) @EmployeeAccess('shipment.handover') @O.endpoint('resolveOrderHandover','独立领取后核实已交、未交或仍不明',F.result,F.resolve)
 resolve(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.ResolveHandoverDto){return this.service.resolve(ctx(a,r),p.id,b);}
 @Post('exceptions') @HttpCode(200) @EmployeeAccess('shipment.exception.manage') @O.endpoint('createShipmentException','登记本订单独立异常，创建仓储与客服任务',F.result,F.exception)
 exception(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.ShipmentExceptionDto){return this.service.exception(ctx(a,r),p.id,b);}
 @Post('exceptions/:exceptionId/warehouse-ready') @HttpCode(200) @EmployeeAccess('shipment.exception.manage') @ApiParam({name:'exceptionId',schema:{type:'string',format:'uuid'}}) @O.endpoint('confirmShipmentExceptionReady','仓储全量核实齐货，绑定当前实物版本',F.result,F.warehouse)
 warehouse(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:ExceptionParamsDto,@Body() b:D.WarehouseReadyDto){return this.service.warehouseReady(ctx(a,r),p.id,p.exceptionId,b);}
 @Post('exceptions/:exceptionId/customer-choice') @HttpCode(200) @EmployeeAccess('shipment.customer-confirm','communication.service.write') @ApiParam({name:'exceptionId',schema:{type:'string',format:'uuid'}}) @O.endpoint('recordShipmentCustomerChoice','客服记录等待、继续或退款意愿；不自动退款',F.result,F.customer)
 customer(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:ExceptionParamsDto,@Body() b:D.CustomerConfirmationDto){return this.service.customerChoice(ctx(a,r),p.id,p.exceptionId,b);}
 @Post('exceptions/:exceptionId/resolve') @HttpCode(200) @EmployeeAccess('shipment.exception.manage') @ApiParam({name:'exceptionId',schema:{type:'string',format:'uuid'}}) @O.endpoint('resolveShipmentException','仓储核实经办检查双确认同版本，只解除本来源',F.result,F.exceptionResolve)
 exceptionResolve(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:ExceptionParamsDto,@Body() b:D.ExceptionCommandDto){return this.service.resolveException(ctx(a,r),p.id,p.exceptionId,b);}
 @Post('tracking') @HttpCode(200) @EmployeeAccess('shipment.tracking.correct') @O.endpoint('correctShipmentTracking','运单拼写更正，未决交运冻结，不代表重发',F.result,F.tracking)
 tracking(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.TrackingCorrectionDto){return this.service.correctTracking(ctx(a,r),p.id,b);}
 @Post('historical-tracking') @HttpCode(200) @EmployeeAccess('shipment.history.correct') @O.endpoint('correctHistoricalShipmentTracking','管理员对完成/退款订单的历史运单纠错，需证据',F.result,F.tracking)
 historical(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.TrackingCorrectionDto){return this.service.correctTracking(ctx(a,r),p.id,b,true);}
}
@Controller('store/orders/:id/confirm-receipt') @ApiTags('Orders') @CustomerAccess()
export class ReceiptController {
 constructor(@Inject(FulfillmentService)private readonly service:FulfillmentService){}
 @Post() @HttpCode(200) @O.idParam() @O.endpoint('confirmMyOrderReceipt','本人主动确认收货，重复不延长售后窗口',F.receipt,O.object({}))
 confirm(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body(new EmptyBodyPipe()) _b:unknown){void _b;return this.service.confirmReceipt(ctx(a,r),p.id);}
}
