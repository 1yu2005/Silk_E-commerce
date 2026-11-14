import {Controller,Get,Inject,Query,Req} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import {EmployeeAccess} from '../auth/auth.decorators.js';
import {CurrentActor,readBearerToken,type AuthHttpRequest} from '../auth/auth-request-context.js';
import type {CurrentIdentity} from '../auth/current-identity.service.js';
import {PaginationDto} from '../common/http/pagination.dto.js';
import {ReportingService} from './reporting.service.js';
import {HotProductsQueryDto,TrendQueryDto} from './reporting.dto.js';
import * as O from './reporting.openapi.js';
const context=(actor:CurrentIdentity,r:AuthHttpRequest)=>({actor,token:readBearerToken(r),requestId:r.requestId!});
@Controller('admin/dashboard') @EmployeeAccess('dashboard.read') @ApiTags('Dashboard')
export class ReportingController {
 constructor(@Inject(ReportingService)private readonly service:ReportingService){}
 @Get('overview') @O.endpoint('getDashboardOverview','今日经营事件与当前业务数量',O.overview)
 overview(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){return this.service.overview(context(a,r));}
 @Get('trends') @O.trendQuery() @O.endpoint('getDashboardTrends','北京日期7/30天逐日趋势',O.trends)
 trends(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Query() q:TrendQueryDto){return this.service.trends(context(a,r),q.days as 7|30);}
 @Get('hot-products') @O.hotQuery() @O.endpoint('getDashboardHotProducts','近30天SPU支付件数，退款不倒扣',O.hot)
 hot(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Query() q:HotProductsQueryDto){return this.service.hotProducts(context(a,r),q.limit);}
 @Get('low-stock') @O.pageQuery() @O.endpoint('getDashboardLowStock','全余额账户预警摘要，含等号，不含R或成本',O.lowStock)
 lowStock(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Query() q:PaginationDto){return this.service.lowStock(context(a,r),q);}
}
