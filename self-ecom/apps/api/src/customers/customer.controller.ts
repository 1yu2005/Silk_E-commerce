// 作用：只暴露明确的顾客查询、管理员状态命令及本人地址/购物车接口。
import {Body,Controller,Delete,Get,HttpCode,Inject,Param,Patch,Post,Query,Req,Res} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import type {ServerResponse} from 'node:http';
import {EmployeeAccess,CustomerAccess} from '../auth/auth.decorators.js';
import {CurrentActor,readBearerToken,type AuthHttpRequest} from '../auth/auth-request-context.js';
import type {CurrentIdentity} from '../auth/current-identity.service.js';
import {PaginationDto} from '../common/http/pagination.dto.js';
import {CustomerService} from './customer.service.js';
import {AddressService} from './address.service.js';
import {CartService} from './cart.service.js';
import {CustomerIdDto,CustomerQueryDto,CustomerStatusDto,AddressCreateDto,AddressUpdateDto,VersionDto,CartAddDto,CartUpdateDto,CartBatchDto,CartSelectionDto} from './customer.dto.js';
import * as O from './customer.openapi.js';
const context=(actor:CurrentIdentity,r:AuthHttpRequest)=>({actor,token:readBearerToken(r),requestId:r.requestId!});
@Controller('admin/customers') @ApiTags('Customers') @EmployeeAccess('customer.read')
export class CustomerController {
 constructor(@Inject(CustomerService)private readonly service:CustomerService){}
 @Get() @O.listQuery(true) @O.endpoint('listCustomers','查询顾客（列表手机号脱敏）',O.customerList)
 list(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Query() q:CustomerQueryDto){return this.service.list(context(a,r),q);}
 @Get(':id') @O.idParam() @O.endpoint('getCustomer','查询顾客资料',O.customerDetail)
 detail(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:CustomerIdDto){return this.service.detail(context(a,r),p.id);}
 @Get(':id/addresses') @O.idParam() @O.endpoint('getCustomerAddresses','客服只读查询完整地址簿',O.addressList)
 addresses(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:CustomerIdDto){return this.service.addresses(context(a,r),p.id);}
 @Get(':id/status-history') @O.idParam() @O.listQuery() @O.endpoint('getCustomerStatusHistory','查询顾客状态历史',O.history)
 history(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:CustomerIdDto,@Query() q:PaginationDto){return this.service.history(context(a,r),p.id,q);}
 @Get(':id/consumption') @O.idParam() @O.endpoint('getCustomerConsumption','完成且未全额退款消费统计；未接订单明确NOT_READY',O.consumption)
 consumption(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:CustomerIdDto){return this.service.consumed(context(a,r),p.id);}
 @Post(':id/restrict-trade') @HttpCode(200) @EmployeeAccess('customer.status.manage') @O.idParam() @O.endpoint('restrictCustomerTrade','限制新建订单，保留登录与旧单能力',O.statusResult,O.statusBody)
 restrict(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:CustomerIdDto,@Body() b:CustomerStatusDto){return this.service.change(context(a,r),p.id,'TRADE_RESTRICTED',b);}
 @Post(':id/freeze-login') @HttpCode(200) @EmployeeAccess('customer.status.manage') @O.idParam() @O.endpoint('freezeCustomerLogin','冻结新登录并撤销全部旧会话，不取消旧单',O.statusResult,O.statusBody)
 freeze(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:CustomerIdDto,@Body() b:CustomerStatusDto){return this.service.change(context(a,r),p.id,'LOGIN_FROZEN',b);}
 @Post(':id/restore') @HttpCode(200) @EmployeeAccess('customer.status.manage') @O.idParam() @O.endpoint('restoreCustomer','恢复正常，旧冻结会话仍无效',O.statusResult,O.statusBody)
 restore(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:CustomerIdDto,@Body() b:CustomerStatusDto){return this.service.change(context(a,r),p.id,'NORMAL',b);}
}
@Controller('store/addresses') @ApiTags('Addresses') @CustomerAccess()
export class AddressController {
 constructor(@Inject(AddressService)private readonly service:AddressService){}
 @Get() @O.endpoint('listAddresses','读取本人全部地址，默认优先',O.addressList)
 list(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){return this.service.list(context(a,r));}
 @Get(':id') @O.idParam() @O.endpoint('getAddress','读取本人地址，其他人统一404',O.address)
 get(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:CustomerIdDto){return this.service.list(context(a,r),p.id);}
 @Post() @O.endpoint('createAddress','新增本人地址，首条不隐式默认',O.addressResult,O.object(O.addressFields,['receiver','phone','province','city','district','detail']),true)
 create(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Body() b:AddressCreateDto){return this.service.create(context(a,r),b);}
 @Patch(':id') @O.idParam() @O.endpoint('updateAddress','修改本人地址，不影响旧订单',O.addressResult,O.object({...O.version,...O.addressFields},['expectedVersion']))
 update(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:CustomerIdDto,@Body() b:AddressUpdateDto){return this.service.update(context(a,r),p.id,b);}
 @Post(':id/set-default') @HttpCode(200) @O.idParam() @O.endpoint('setDefaultAddress','原子清旧默认并更新双方版本',O.addressResult,O.object(O.version))
 setDefault(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:CustomerIdDto,@Body() b:VersionDto){return this.service.setDefault(context(a,r),p.id,b);}
 @Delete(':id') @O.idParam() @O.endpoint('deleteAddress','删除本人地址，JSON请求体必须携带当前版本',O.addressDeleted,O.object(O.version))
 remove(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:CustomerIdDto,@Body() b:VersionDto){return this.service.remove(context(a,r),p.id,b);}
}
@Controller('store/cart') @ApiTags('Cart') @CustomerAccess()
export class CartController {
 constructor(@Inject(CartService)private readonly service:CartService){}
 @Get() @O.listQuery() @O.endpoint('getCart','分页购物车，summary覆盖全车选中集合',O.cartList)
 list(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Query() q:PaginationDto){return this.service.list(context(a,r),q);}
 @Post('items') @O.endpoint('addCartItem','quantity是新增件数；新行201、合并200；丢响应先刷新，禁止自动重试',O.cartAdded,O.object({skuId:O.uuid,quantity:O.integer(99,1)}),true,true)
 async add(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Body() b:CartAddDto,@Res({passthrough:true}) res:ServerResponse){const result=await this.service.add(context(a,r),b);res.statusCode=result.created?201:200;return result;}
 @Patch('items/:id') @O.idParam() @O.endpoint('updateCartItem','quantity替换总件数；失效项目仍允许减少和取消勾选',O.cartWrite,O.object({...O.version,quantity:O.integer(99,1),selected:O.bool},['expectedVersion']))
 update(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:CustomerIdDto,@Body() b:CartUpdateDto){return this.service.update(context(a,r),p.id,b);}
 @Delete('items/:id') @O.idParam() @O.endpoint('deleteCartItem','删除本人项目，不增加库存',O.cartBatch,O.object(O.version))
 remove(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Param() p:CustomerIdDto,@Body() b:VersionDto){return this.service.remove(context(a,r),p.id,b);}
 @Post('selection') @HttpCode(200) @O.endpoint('selectCartItems','最多100项原子勾选，任一归属/版本失败整批回滚',O.cartBatch,O.object({...O.batchFields,selected:O.bool}))
 select(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Body() b:CartSelectionDto){return this.service.selection(context(a,r),b);}
 @Post('items/batch-delete') @HttpCode(200) @O.endpoint('deleteCartItems','最多100项原子删除，不接受重复ID',O.cartBatch,O.object(O.batchFields))
 batch(@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest,@Body() b:CartBatchDto){return this.service.batch(context(a,r),b);}
}
