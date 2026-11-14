// 作用：受限争议决定与实际物品事件入口，全部动作在服务端复核当前权限及经办。
import {Body,Controller,Get,HttpCode,Inject,Param,Post,Req} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import {EmployeeAccess} from '../auth/auth.decorators.js';
import {CurrentActor,readBearerToken,type AuthHttpRequest} from '../auth/auth-request-context.js';
import type {CurrentIdentity} from '../auth/current-identity.service.js';
import {OrderIdDto} from '../orders/order.dto.js';
import {DisputeService} from './dispute.service.js';
import {CustodyService} from './custody.service.js';
import * as D from './dispute.dto.js';
import * as O from './dispute.openapi.js';
const context=(actor:CurrentIdentity,r:AuthHttpRequest)=>({actor,token:readBearerToken(r),requestId:r.requestId!});
@Controller('admin/after-sales') @ApiTags('Coordination') @EmployeeAccess()
export class DisputeController{
 constructor(@Inject(DisputeService)private readonly service:DisputeService){}
 @Get(':id/disputes') @EmployeeAccess('after-sale.service.read') @O.idParam() @O.endpoint('getAfterSaleDisputes','查询争议与结案后物品安排',O.detail)
 detail(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto){return this.service.detail(context(a,r),p.id);}
 @Post(':id/dispute-followups') @HttpCode(200) @EmployeeAccess('after-sale.return.follow') @O.idParam() @O.endpoint('startDisputeFollowup','建立客服争议跟进，必须另行显式领取',O.result,O.followupBody)
 followup(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.DisputeCommandDto){return this.service.followup(context(a,r),p.id,b);}
 @Post(':id/dispute-requests') @HttpCode(200) @EmployeeAccess('after-sale.return.follow') @O.idParam() @O.endpoint('requestAfterSaleDispute','当前客服跟进经办提请受限争议决定',O.result,O.requestBody)
 request(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.DisputeRequestDto){return this.service.request(context(a,r),p.id,b);}
 @Post(':id/close-decision') @HttpCode(200) @EmployeeAccess('after-sale.dispute.decide') @O.idParam() @O.endpoint('decideAfterSaleClose','管理员BR-07受限结案，保留实物后续任务',O.result,O.closeBody)
 close(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.CloseDecisionDto){return this.service.close(context(a,r),p.id,b);}
}
@Controller('admin/custody-arrangements') @ApiTags('Coordination') @EmployeeAccess('after-sale.inspection.read')
export class CustodyController{
 constructor(@Inject(CustodyService)private readonly service:CustodyService){}
 @Get(':id') @O.idParam() @O.endpoint('getCustodyArrangement','查询独立物品义务及真实执行事件',O.custodyDetail)
 detail(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto){return this.service.detail(context(a,r),p.id);}
 @Post(':id/correction-followups') @HttpCode(200) @EmployeeAccess('after-sale.inspection.confirm') @O.idParam() @O.endpoint('startCustodyCorrection','为已完成的物品安排建立须显式领取的历史更正任务',O.correctionResult,O.correctionBody)
 correction(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.CustodyCorrectionFollowupDto){return this.service.correctionFollowup(context(a,r),p.id,b);}
 @Post(':id/events') @HttpCode(200) @EmployeeAccess('after-sale.inspection.confirm') @O.idParam() @O.endpoint('recordCustodyEvent','仓储当前经办记录实际交接、寄还、在途或异常',O.eventResult,O.eventBody)
 event(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Body() b:D.CustodyEventDto){return this.service.event(context(a,r),p.id,b);}
}
