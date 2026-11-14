// 作用：复用订单/售后既定员工历史路径，顾客历史维持旧公开契约。
import { Controller,Get,Inject,Param,Query,Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EmployeeAccess } from '../auth/auth.decorators.js';
import { CurrentActor,readBearerToken,type AuthHttpRequest } from '../auth/auth-request-context.js';
import type { CurrentIdentity } from '../auth/current-identity.service.js';
import { OrderIdDto } from '../orders/order.dto.js';
import { BusinessHistoryQueryDto } from './business-history.dto.js';
import { BusinessHistoryService } from './business-history.service.js';
import * as O from './business-history.openapi.js';
const context=(actor:CurrentIdentity,r:AuthHttpRequest)=>({actor,token:readBearerToken(r),requestId:r.requestId!});
@Controller('admin/orders') @ApiTags('BusinessHistory') @EmployeeAccess()
export class OrderHistoryController {
  constructor(@Inject(BusinessHistoryService)private readonly history:BusinessHistoryService){}
  @Get(':id/history') @O.idParam() @O.listQuery() @O.kindQuery() @O.endpoint('getAdminOrderHistory')
  get(@CurrentActor() actor:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Query() q:BusinessHistoryQueryDto){return this.history.history(context(actor,r),'ORDER',p.id,q);}
}
@Controller('admin/after-sales') @ApiTags('BusinessHistory') @EmployeeAccess()
export class AfterSaleHistoryController {
  constructor(@Inject(BusinessHistoryService)private readonly history:BusinessHistoryService){}
  @Get(':id/history') @O.idParam() @O.listQuery() @O.kindQuery() @O.endpoint('getAdminAfterSaleHistory')
  get(@CurrentActor() actor:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:OrderIdDto,@Query() q:BusinessHistoryQueryDto){return this.history.history(context(actor,r),'AFTER_SALE',p.id,q);}
}
