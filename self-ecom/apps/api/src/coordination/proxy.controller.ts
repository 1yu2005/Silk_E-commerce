import {Body,Controller,Get,HttpCode,Inject,Param,Post,Req} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import {EmployeeAccess} from '../auth/auth.decorators.js';
import {CurrentActor,readBearerToken,type AuthHttpRequest} from '../auth/auth-request-context.js';
import type {CurrentIdentity} from '../auth/current-identity.service.js';
import {OrderIdDto} from '../orders/order.dto.js';
import {ProxyInputService} from './proxy-input.service.js';
import * as D from './proxy.dto.js';
import * as O from './proxy.openapi.js';
const ctx=(actor:CurrentIdentity,r:AuthHttpRequest)=>({actor,token:readBearerToken(r),requestId:r.requestId!});
@Controller('admin') @ApiTags('Coordination') @EmployeeAccess('customer.frozen.proxy')
export class ProxyController {
 constructor(@Inject(ProxyInputService)private readonly service:ProxyInputService){}
 @Post('customers/:id/proxy-contexts') @HttpCode(200) @O.idParam() @O.endpoint('createFrozenCustomerProxyContext','记录原订单指定输入的人工身份核实',O.summary,O.createBody)
 create(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.CreateProxyContextDto){return this.service.create(ctx(a,r),p.id,b);}
 @Get('proxy-contexts/:id') @O.idParam() @O.endpoint('getFrozenCustomerProxyContext','本人核实上下文及代录任务',O.detail)
 get(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto){return this.service.get(ctx(a,r),p.id);}
 @Post('proxy-contexts/:id/after-sales') @HttpCode(200) @O.idParam() @O.endpoint('applyAfterSaleAsProxy','为冻结顾客代录正式售后申请，仍待独立审核',O.execution,O.applyBody)
 apply(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.ProxyApplyDto){return this.service.apply(ctx(a,r),p.id,b);}
 @Post('proxy-contexts/:id/supplements') @HttpCode(200) @O.idParam() @O.endpoint('supplementAfterSaleAsProxy','为原售后代录完整材料版本',O.execution,O.supplementBody)
 supplement(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.ProxySupplementDto){return this.service.supplement(ctx(a,r),p.id,b);}
 @Post('proxy-contexts/:id/return-logistics') @HttpCode(200) @O.idParam() @O.endpoint('saveReturnLogisticsAsProxy','代录获准包裹物流及实际寄出声明',O.execution,O.logisticsBody)
 logistics(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.ProxyReturnLogisticsDto){return this.service.returnLogistics(ctx(a,r),p.id,b);}
 @Post('proxy-contexts/:id/offline-results') @HttpCode(200) @EmployeeAccess('customer.frozen.proxy','offline-case.manage') @O.idParam() @O.endpoint('recordOfflineResultAsProxy','代录线下结果，不改变系统退款及库存',O.execution,O.offlineBody)
 offline(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.ProxyOfflineResultDto){return this.service.offlineResult(ctx(a,r),p.id,b);}
}
