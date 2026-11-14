// 作用：只暴露本期正式命令，审核同意不等于退款成功。
import {Body,Controller,Get,HttpCode,Inject,Param,Post,Query,Req,Res} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import type {ServerResponse} from 'node:http';
import {CustomerAccess,EmployeeAccess} from '../auth/auth.decorators.js';
import {CurrentActor,readBearerToken,type AuthHttpRequest} from '../auth/auth-request-context.js';
import type {CurrentIdentity} from '../auth/current-identity.service.js';
import {PaginationDto} from '../common/http/pagination.dto.js';
import {OrderIdDto} from '../orders/order.dto.js';
import {AfterSaleService} from './after-sale.service.js';
import {AfterSaleQueries} from './after-sale-query.service.js';
import * as D from './after-sale.dto.js';
import * as O from './after-sale.openapi.js';
const context=(actor:CurrentIdentity,r:AuthHttpRequest)=>({actor,token:readBearerToken(r),requestId:r.requestId!});
@Controller('store/after-sales') @ApiTags('AfterSales') @CustomerAccess()
export class StoreAfterSalesController{
 constructor(@Inject(AfterSaleService)private readonly service:AfterSaleService,@Inject(AfterSaleQueries)private readonly queries:AfterSaleQueries){}
 @Get() @O.listQuery() @O.query() @O.endpoint('listMyAfterSales','本人售后列表',O.list)
 list(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Query() q:D.AfterSaleQueryDto){return this.queries.list(context(a,r),q);}
 @Post() @O.endpoint('applyMyAfterSale','整单申请，成功恢复优先',O.result,O.applyBody,true,true)
 async apply(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Body() b:D.ApplyAfterSaleDto,@Res({passthrough:true}) response:ServerResponse){const result=await this.service.apply(context(a,r),b);response.statusCode=result.replayed?200:201;return result;}
 @Get(':id') @O.idParam() @O.endpoint('getMyAfterSale','本人售后公开详情',O.detail)
 detail(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto){return this.queries.detail(context(a,r),p.id);}
 @Get(':id/history') @O.idParam() @O.listQuery() @O.endpoint('getMyAfterSaleHistory','公开任务与期限时间线',O.history)
 history(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Query() q:PaginationDto){return this.queries.history(context(a,r),p.id,q);}
 @Post(':id/supplements') @HttpCode(200) @O.idParam() @O.endpoint('supplementMyAfterSale','完整替换当前材料，新审核轮',O.result,O.supplementBody)
 supplement(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.SupplementDto){return this.service.supplement(context(a,r),p.id,b);}
 @Post(':id/withdraw') @HttpCode(200) @O.idParam() @O.endpoint('withdrawMyAfterSale','撤销尚无批准或拒绝决定的待审申请',O.result,O.commandBody)
 withdraw(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.AfterSaleCommandDto){return this.service.withdraw(context(a,r),p.id,b);}
 @Post(':id/return-logistics') @HttpCode(200) @O.idParam() @O.endpoint('saveMyReturnLogistics','追加寄回物流版本，单号不代表实际寄出',O.result,O.logisticsBody)
 logistics(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.ReturnLogisticsDto){return this.service.returnLogistics(context(a,r),p.id,b);}
}
@Controller('admin/after-sales') @ApiTags('AfterSales') @EmployeeAccess()
export class AdminAfterSalesController{
 constructor(@Inject(AfterSaleService)private readonly service:AfterSaleService,@Inject(AfterSaleQueries)private readonly queries:AfterSaleQueries){}
 @Get() @O.listQuery() @O.query() @O.endpoint('listAdminAfterSales','客服或仓储售后队列',O.list)
 list(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Query() q:D.AfterSaleQueryDto){return this.queries.list(context(a,r),q,true);}
 @Get(':id') @O.idParam() @O.endpoint('getAdminAfterSale','按客服或仓储权限裁剪详情',O.detail)
 detail(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto){return this.queries.detail(context(a,r),p.id);}
 @Get(':id/history') @O.idParam() @O.listQuery() @O.endpoint('getAdminAfterSaleHistory','售后任务期限及决定时间线',O.history)
 history(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Query() q:PaginationDto){return this.queries.history(context(a,r),p.id,q);}
 @Post(':id/review') @HttpCode(200) @EmployeeAccess('after-sale.review') @O.idParam() @O.endpoint('reviewAfterSale','当前审核经办提交明确决定',O.result,O.reviewBody)
 review(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.ReviewDto){return this.service.review(context(a,r),p.id,b);}
 @Post(':id/return-verifications') @HttpCode(200) @EmployeeAccess('after-sale.return.follow') @O.idParam() @O.endpoint('verifyAfterSaleReturn','记录寄出核实，不登记实收到仓',O.result,O.verificationBody)
 verify(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.ReturnVerificationDto){return this.service.verifyReturn(context(a,r),p.id,b);}
 @Post(':id/close') @HttpCode(200) @EmployeeAccess('after-sale.close') @O.idParam() @O.endpoint('closeAfterSale','BR-07受限关闭，只解除自身来源',O.result,O.closeBody)
 close(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.CloseAfterSaleDto){return this.service.close(context(a,r),p.id,b);}
 @Post(':id/confirm-no-return-refund') @HttpCode(200) @EmployeeAccess('after-sale.review') @O.idParam() @O.endpoint('confirmNoReturnRefund','交运事实变化后明确无需退货决定',O.result,O.confirmBody)
 confirm(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.ConfirmNoReturnDto){return this.service.confirmNoReturn(context(a,r),p.id,b);}
}
