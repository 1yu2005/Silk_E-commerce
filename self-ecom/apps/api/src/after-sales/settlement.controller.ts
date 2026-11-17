// 作用：真实板块12命令；所有写入均要求当前任务、身份及版本。
import {Body,Controller,Get,HttpCode,Inject,Param,Post,Req} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import {EmployeeAccess,CustomerAccess} from '../auth/auth.decorators.js';
import {CurrentActor,readBearerToken,type AuthHttpRequest} from '../auth/auth-request-context.js';
import type {CurrentIdentity} from '../auth/current-identity.service.js';
import {OrderIdDto} from '../orders/order.dto.js';
import {ReturnInspectionService} from './return-inspection.service.js';
import {UnshippedPhysicalService} from './unshipped-physical.service.js';
import {RefundService} from './refund.service.js';
import {SettlementQueries} from './settlement-query.service.js';
import * as D from './settlement.dto.js';
import * as O from './settlement.openapi.js';
import {idParam,endpoint} from './after-sale.openapi.js';
const ctx=(actor:CurrentIdentity,r:AuthHttpRequest)=>({actor,token:readBearerToken(r),requestId:r.requestId!});
@Controller('admin/after-sales') @ApiTags('AfterSalesSettlement') @EmployeeAccess()
export class SettlementController{
 constructor(@Inject(ReturnInspectionService)private readonly inspections:ReturnInspectionService,@Inject(UnshippedPhysicalService)private readonly physical:UnshippedPhysicalService,@Inject(RefundService)private readonly refunds:RefundService,@Inject(SettlementQueries)private readonly queries:SettlementQueries){}
 @Get(':id/settlement') @idParam() @endpoint('getAdminAfterSaleSettlement','按岗位读取验收与退款事实',O.view)
 detail(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto){return this.queries.detail(ctx(a,r),p.id);}
 @Post(':id/receipt-sources') @HttpCode(200) @EmployeeAccess('after-sale.receipt.record') @idParam() @endpoint('prepareAfterSaleReceipt','登记稳定实包来源，不视为实际收包',O.result,O.prepare)
 prepareAfterSaleReceipt(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.PrepareReceiptDto){return this.inspections.prepare(ctx(a,r),p.id,b);}
 @Post(':id/receipt-source-cancellations') @HttpCode(200) @EmployeeAccess('after-sale.receipt.record') @idParam() @endpoint('cancelAfterSaleReceiptSource','撤销无物流且未实收的仓储误登记，保留审计',O.result,O.cancelReceiptSource)
 cancelAfterSaleReceiptSource(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.CancelReceiptSourceDto){return this.inspections.cancelSource(ctx(a,r),p.id,b);}
 @Post(':id/receipts') @HttpCode(200) @EmployeeAccess('after-sale.receipt.record') @idParam() @endpoint('receiveAfterSaleReturn','登记真实到仓及保管位置',O.result,O.receive)
 receiveAfterSaleReturn(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.ReceiveDto){return this.inspections.receive(ctx(a,r),p.id,b);}
 @Post(':id/inspection-drafts') @HttpCode(200) @EmployeeAccess('after-sale.inspection.confirm') @idParam() @endpoint('saveAfterSaleInspectionDraft','按包追加完整核对版本',O.result,O.draft)
 saveAfterSaleInspectionDraft(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.DraftDto){return this.inspections.draft(ctx(a,r),p.id,b);}
 @Post(':id/inspection-exceptions') @HttpCode(200) @EmployeeAccess('after-sale.inspection.confirm') @idParam() @endpoint('reportAfterSaleInspectionException','少件错货空包转异常跟进',O.result,O.exception)
 reportAfterSaleInspectionException(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.InspectionExceptionDto){return this.inspections.exception(ctx(a,r),p.id,b);}
 @Post(':id/reshipments') @HttpCode(200) @EmployeeAccess('after-sale.return.follow') @idParam() @endpoint('requestAfterSaleReshipment','按真实缺件授权本轮补寄',O.result,O.reship)
 requestAfterSaleReshipment(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.ReshipmentDto){return this.inspections.reship(ctx(a,r),p.id,b);}
 @Post(':id/exception-refund-requests') @HttpCode(200) @EmployeeAccess('after-sale.return.follow') @idParam() @endpoint('requestAfterSaleExceptionRefund','申请管理员异常全退批准',O.result,O.request)
 requestAfterSaleExceptionRefund(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.ExceptionRefundRequestDto){return this.inspections.requestException(ctx(a,r),p.id,b);}
 @Post(':id/exception-refund-approvals') @HttpCode(200) @EmployeeAccess('after-sale.dispute.decide') @idParam() @endpoint('approveAfterSaleExceptionRefund','管理员批准，不直接退款或回补',O.result,O.approve)
 approveAfterSaleExceptionRefund(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.ApproveExceptionDto){return this.inspections.approve(ctx(a,r),p.id,b);}
 @Post(':id/final-inspection') @HttpCode(200) @EmployeeAccess('after-sale.inspection.confirm') @idParam() @endpoint('finalizeAfterSaleInspection','正常齐货最终验收并唯一回补',O.result,O.inspectionRefs)
 finalizeAfterSaleInspection(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.InspectionRefsDto){return this.inspections.final(ctx(a,r),p.id,b);}
 @Post(':id/exception-final-inspection') @HttpCode(200) @EmployeeAccess('after-sale.inspection.confirm') @idParam() @endpoint('finalizeAfterSaleExceptionInspection','批准后按真实实收独立最终核实',O.result,O.finalizeException)
 finalizeAfterSaleExceptionInspection(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.FinalizeExceptionDto){return this.inspections.final(ctx(a,r),p.id,b,true);}
 @Post(':id/return-physical-events') @HttpCode(200) @EmployeeAccess('after-sale.inspection.confirm') @idParam() @endpoint('recordAfterSaleReturnPhysicalEvent','实物移动损坏更正，使旧基线失效',O.result,O.physicalEvent)
 recordAfterSaleReturnPhysicalEvent(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.PhysicalEventDto){return this.inspections.physicalEvent(ctx(a,r),p.id,b);}
 @Post(':id/physical-checks') @HttpCode(200) @EmployeeAccess('order.physical.check') @idParam() @endpoint('confirmAfterSalePhysicalCheck','未交运本售后全行核实，不回补',O.result,O.physical)
 confirmAfterSalePhysicalCheck(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.PhysicalCheckDto){return this.physical.check(ctx(a,r),p.id,b);}
 @Post(':id/refund') @HttpCode(200) @EmployeeAccess('after-sale.refund.execute') @idParam() @endpoint('executeAfterSaleRefund','当前经办执行全额模拟退款，FAILED也是200',O.refundResult,O.refund)
 executeAfterSaleRefund(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.RefundDto){return this.refunds.execute(ctx(a,r),p.id,b);}
 @Post(':id/refund-retries') @HttpCode(200) @EmployeeAccess('after-sale.refund.retry') @idParam() @endpoint('retryAfterSaleRefund','原退款业务新键重试，需额外retry资格',O.refundResult,O.retry)
 retryAfterSaleRefund(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.RefundRetryDto){return this.refunds.execute(ctx(a,r),p.id,b,true);}
}
@Controller('store/after-sales') @ApiTags('AfterSalesSettlement') @CustomerAccess()
export class StoreSettlementController{constructor(@Inject(SettlementQueries)private readonly queries:SettlementQueries){}
 @Get(':id/settlement') @idParam() @endpoint('getMyAfterSaleSettlement','本人公开收包验收与退款进度',O.view)
 detail(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto){return this.queries.detail(ctx(a,r),p.id);}
}
