import {Body,Controller,Get,HttpCode,Inject,Param,Post,Req} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import {EmployeeAccess} from '../auth/auth.decorators.js';
import {CurrentActor,readBearerToken,type AuthHttpRequest} from '../auth/auth-request-context.js';
import type {CurrentIdentity} from '../auth/current-identity.service.js';
import {OrderIdDto} from '../orders/order.dto.js';
import {CoordinationService} from './coordination.service.js';
import {CoordinationQueries} from './coordination-query.service.js';
import * as D from './coordination.dto.js';
import * as O from './coordination.openapi.js';
const ctx=(actor:CurrentIdentity,r:AuthHttpRequest)=>({actor,token:readBearerToken(r),requestId:r.requestId!});
@Controller('admin') @EmployeeAccess() @ApiTags('Coordination')
export class CoordinationController {
 constructor(@Inject(CoordinationService)private readonly service:CoordinationService,@Inject(CoordinationQueries)private readonly queries:CoordinationQueries){}
 @Get('orders/:id/coordination') @O.idParam() @O.endpoint('getOrderCoordination','异常实物、经办、期限和资金事实',O.detail)
 detail(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto){return this.queries.detail(ctx(a,r),p.id);}
 @Post('orders/:id/address-requests') @HttpCode(200) @EmployeeAccess('communication.service.write') @O.idParam() @O.endpoint('createAddressRequest','登记改址诉求，原订单地址不可编辑',O.result,O.createBody)
 create(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.CreateAddressRequestDto){return this.service.createAddress(ctx(a,r),p.id,b);}
 @Post('address-requests/:id/physical-verifications') @HttpCode(200) @EmployeeAccess('order.physical.check') @O.idParam() @O.endpoint('verifyAddressRequestPhysical','仓储核实停止作业及货仍在手',O.result,O.physicalBody)
 physical(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.VerifyAddressPhysicalDto){return this.service.verifyAddress(ctx(a,r),p.id,b);}
 @Post('address-requests/:id/continue-original') @HttpCode(200) @EmployeeAccess('shipment.customer-confirm') @O.idParam() @O.endpoint('continueOriginalAddress','顾客同意继续原地址，仅解除本来源',O.result,O.continueBody)
 continue(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.ContinueAddressDto){return this.service.continueOriginal(ctx(a,r),p.id,b);}
 @Post('address-requests/:id/resolve-cancel-reorder') @HttpCode(200) @EmployeeAccess('shipment.customer-confirm') @O.idParam() @O.endpoint('resolveAddressCancelReorder','原未付单已关闭，登记取消重下协调结果',O.result,O.addressBody)
 resolve(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.AddressCommandDto){return this.service.resolveUnpaid(ctx(a,r),p.id,b);}
 @Post('address-requests/:id/handoff-offline') @HttpCode(200) @EmployeeAccess('offline-case.manage') @O.idParam() @O.endpoint('handoffAddressOffline','已交运转线下工单，保留原运单',O.result,O.offlineBody)
 offline(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.AddressOfflineDto){return this.service.handoffOffline(ctx(a,r),p.id,b);}
 @Post('address-requests/:id/handoff-after-sale') @HttpCode(200) @EmployeeAccess('after-sale.review') @O.idParam() @O.endpoint('handoffAddressAfterSale','创建正式仅退款并原子移交改址来源',O.result,O.assistedBody)
 sale(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.AssistedAfterSaleDto){return this.service.handoffAfterSale(ctx(a,r),p.id,b);}
 @Post('orders/:id/after-sales/from-exception') @HttpCode(200) @EmployeeAccess('after-sale.review') @O.idParam() @O.endpoint('applyAfterSaleFromException','顾客明确同意后员工协助申请，尚未批准或退款',O.result,O.assistedBody)
 exception(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.AssistedAfterSaleDto){return this.service.fromException(ctx(a,r),p.id,b);}
 @Post('orders/:id/coordination-followups') @HttpCode(200) @EmployeeAccess('shipment.customer-confirm') @O.idParam() @O.endpoint('followupOrderCoordination','合法来源重入客服跟进，须显式重新领取',O.result,O.followupBody)
 followup(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.CoordinationFollowupDto){return this.service.followup(ctx(a,r),p.id,b);}
}
