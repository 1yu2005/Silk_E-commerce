// 作用：暴露真实报价、建单、模拟支付、关单和库存异常命令；履约与收货使用专用控制器。
import {Body,Controller,Get,Headers,HttpCode,Inject,Param,Post,Query,Req,Res} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import type {ServerResponse} from 'node:http';
import {EmptyBodyPipe} from '../common/http/empty-body.pipe.js';
import {CustomerAccess,EmployeeAccess} from '../auth/auth.decorators.js';
import {CurrentActor,readBearerToken,type AuthHttpRequest} from '../auth/auth-request-context.js';
import type {CurrentIdentity} from '../auth/current-identity.service.js';
import {OrderService} from './order.service.js';
import {OrderCommands} from './order-command.service.js';
import {OrderQueries} from './order-query.service.js';
import {StockIncidents} from './stock-incident.service.js';
import * as D from './order.dto.js';
import * as O from './order.openapi.js';
const context=(actor:CurrentIdentity,r:AuthHttpRequest)=>({actor,token:readBearerToken(r),requestId:r.requestId!});
@Controller('store/checkout') @ApiTags('Orders') @CustomerAccess()
export class CheckoutController {
 constructor(@Inject(OrderService)private readonly service:OrderService){}
 @Post('preview') @O.endpoint('previewCheckout','服务器结算报价，5分钟有效，不占货',O.quote,O.previewBody,true)
 preview(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Body() b:D.PreviewDto){return this.service.preview(context(a,r),b);}
}
@Controller('store/orders') @ApiTags('Orders') @CustomerAccess()
export class StoreOrdersController {
 constructor(@Inject(OrderService)private readonly service:OrderService,@Inject(OrderCommands)private readonly commands:OrderCommands,@Inject(OrderQueries)private readonly queries:OrderQueries){}
 @Post() @O.keyHeader() @O.endpoint('createOrder','固定购买键幂等建单；成功恢复优先',O.created,O.createBody,true,true)
 async create(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Body() b:D.CreateOrderDto,@Headers('idempotency-key') key:unknown,@Res({passthrough:true}) response:ServerResponse){const result=await this.service.create(context(a,r),b,key);response.statusCode=result.replayed?200:201;return result;}
 @Get() @O.listQuery() @O.query() @O.endpoint('listMyOrders','分页查询本人订单',O.list)
 list(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Query() q:D.OrderQueryDto){return this.queries.list(context(a,r),q);}
 @Get(':id') @O.idParam() @O.endpoint('getMyOrder','本人订单快照、模拟付款事实和公开历史',O.detail)
 detail(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:D.OrderIdDto){return this.queries.detail(context(a,r),p.id);}
 @Post(':id/pay') @HttpCode(200) @O.idParam() @O.endpoint('payMyOrder','模拟付款；一单唯一成功，重复返回原事实',O.payment,O.object({}))
 pay(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:D.OrderIdDto,@Body(new EmptyBodyPipe()) _b:unknown){void _b;return this.commands.pay(context(a,r),p.id);}
 @Post(':id/cancel') @HttpCode(200) @O.idParam() @O.endpoint('cancelMyOrder','顾客取消未付订单，安全净释放，不恢复购物车',O.closed,O.cancelBody)
 cancel(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:D.OrderIdDto,@Body() b:D.CancelOrderDto){return this.commands.cancel(context(a,r),p.id,b.reason);}
}
@Controller('admin/orders') @ApiTags('Orders') @EmployeeAccess()
export class AdminOrdersController {
 constructor(@Inject(OrderCommands)private readonly commands:OrderCommands,@Inject(OrderQueries)private readonly queries:OrderQueries){}
 @Get() @O.listQuery() @O.query() @O.endpoint('listAdminOrders','按客服或履约权限查询订单',O.list)
 list(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Query() q:D.OrderQueryDto){return this.queries.list(context(a,r),q,true);}
 @Get(':id') @O.idParam() @O.endpoint('getAdminOrder','订单详情；成本另需product.cost.read',O.detail)
 detail(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:D.OrderIdDto){return this.queries.detail(context(a,r),p.id,true);}
 @Post(':id/close-unpaid') @HttpCode(200) @EmployeeAccess('order.unpaid.close') @O.idParam() @O.endpoint('closeUnpaidOrder','超级管理员安全关闭未付单，必填原因',O.closed,O.closeBody)
 close(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:D.OrderIdDto,@Body() b:D.CloseOrderDto){return this.commands.closeUnpaid(context(a,r),p.id,b);}
}
@Controller('admin/inventory/stock-incidents') @ApiTags('StockIncidents') @EmployeeAccess('inventory.order-exception.manage')
export class StockIncidentsController {
 constructor(@Inject(StockIncidents)private readonly commands:StockIncidents,@Inject(OrderQueries)private readonly queries:OrderQueries){}
 @Get() @O.listQuery() @O.skuQuery() @O.endpoint('listStockIncidents','查询真实库存异常',O.incidents)
 list(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Query() q:D.IncidentQueryDto){return this.queries.incidents(context(a,r),q,q.skuId);}
 @Get('candidates/:skuId') @O.skuParam() @O.endpoint('getStockIncidentCandidates','读取可声明的待付或已付未交运行',O.candidates)
 candidates(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:D.SkuIdDto){return this.queries.candidates(context(a,r),p.skuId);}
 @Get(':id') @O.idParam() @O.endpoint('getStockIncident','异常影响、补齐、任务与历史',O.incidentDetail)
 detail(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:D.OrderIdDto){return this.queries.incident(context(a,r),p.id);}
 @Post() @O.endpoint('createStockIncident','登记真实异常、暂停新购与受影响订单',O.incidentResult,O.incidentBody,true)
 create(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Body() b:D.IncidentCreateDto){return this.commands.create(context(a,r),b);}
 @Post(':id/verify') @HttpCode(200) @O.idParam() @O.endpoint('verifyStockIncident','当前核实经办确认损耗，保留历史',O.commandResult,O.verifyBody)
 verify(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:D.OrderIdDto,@Body() b:D.IncidentVerifyDto){return this.commands.verify(context(a,r),p.id,b);}
 @Post(':id/replenishments') @HttpCode(200) @O.idParam() @O.endpoint('replenishStockIncident','从已入账可售分配补齐，A减R不变',O.commandResult,O.replenishBody)
 replenish(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:D.OrderIdDto,@Body() b:D.ReplenishmentDto){return this.commands.replenish(context(a,r),p.id,b);}
 @Post(':id/resolve') @HttpCode(200) @O.idParam() @O.endpoint('resolveStockIncident','全部实际处理后只解除此异常来源',O.commandResult,O.resolveBody)
 resolve(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:D.OrderIdDto,@Body() b:D.IncidentCommandDto){return this.commands.resolve(context(a,r),p.id,b);}
}
