// 作用：顾客业务契约明确版本、严格输入、购物车增量语义及NOT_READY统计。
import {applyDecorators,Header} from '@nestjs/common';
import {ApiBadRequestResponse,ApiBearerAuth,ApiBody,ApiConflictResponse,ApiCreatedResponse,ApiForbiddenResponse,ApiNotFoundResponse,ApiOkResponse,ApiOperation,ApiParam,ApiQuery,ApiServiceUnavailableResponse,ApiUnauthorizedResponse,type OpenAPIObject} from '@nestjs/swagger';
import {authErrorSchema} from '../auth/employee-auth.openapi.js';
import {requestIdHeader} from '../health/health.openapi.js';
type Schema=NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string];
export const uuid:Schema={type:'string',format:'uuid'};
export const bool:Schema={type:'boolean'};const date:Schema={type:'string',format:'date-time'};
export const integer=(max=2147483647,min=0):Schema=>({type:'integer',minimum:min,maximum:max});
export const text=(maxLength:number,minLength=1):Schema=>({type:'string',minLength,maxLength});
export const nullable=(s:Schema):Schema=>({...s,nullable:true});
export const array=(items:Schema,maxItems?:number):Schema=>({type:'array',items,...(maxItems===undefined?{}:{maxItems})});
export const object=(properties:Record<string,Schema>,required=Object.keys(properties)):Schema=>({type:'object',additionalProperties:false,properties,required});
const decimal:Schema={type:'string',pattern:'^(0|[1-9][0-9]*)$'};
const status:Schema={type:'string',enum:['NORMAL','TRADE_RESTRICTED','LOGIN_FROZEN']};
export const version={expectedVersion:integer(2147483646)};
export const statusBody=object({...version,reason:text(500)});
const summary={id:uuid,nickname:text(40),status,statusVersion:integer(),createdAt:date,lastLoginAt:nullable(date)};
export const customerDetail=object({...summary,phone:text(11),avatarUrl:nullable(text(200)),ordersAvailability:{type:'string',enum:['NOT_READY','AVAILABLE']}});
export const paged=(item:Schema,extra:Record<string,Schema>={}):Schema=>object({items:array(item),total:integer(Number.MAX_SAFE_INTEGER),page:integer(Number.MAX_SAFE_INTEGER,1),pageSize:integer(100,1),...extra});
export const customerList=paged(object({...summary,phoneMasked:text(20)}));
export const statusResult=object({id:uuid,status,statusVersion:integer(),changed:bool});
export const history=paged(object({id:uuid,customerId:uuid,fromStatus:status,toStatus:status,fromVersion:integer(),toVersion:integer(),reason:text(500),actorEmployeeId:uuid,requestId:text(64),createdAt:date}));
export const consumption=object({availability:{type:'string',enum:['NOT_READY','AVAILABLE']},amountCents:nullable(decimal),currency:{type:'string',enum:['CNY']},asOf:date,definitionVersion:{type:'string',enum:['completed-unrefunded-v1']}});
export const addressFields={receiver:text(40),phone:{...text(30),pattern:'^\\+?[0-9 -]{3,30}$'},province:text(50),city:text(50),district:text(50),detail:text(200),isDefault:bool};
export const address=object({id:uuid,customerId:uuid,...addressFields,version:integer(),createdAt:date,updatedAt:date});
export const addressList=object({items:array(address,20)});
export const affected=object({id:uuid,version:integer(),isDefault:bool});
export const addressResult=object({address,affectedAddresses:array(affected,20),changed:bool});
export const addressDeleted=object({deleted:bool,id:uuid,deletedId:uuid,affectedAddresses:array(affected,20)});
export const cartItem=object({id:uuid,skuId:uuid,productId:uuid,productName:text(120),skuCode:text(64),mainImageUrl:nullable(text(200)),choices:array(object({dimension:text(30),value:text(30)}),3),unitPriceCents:nullable(integer(1000000,1)),available:integer(),quantity:integer(99,1),selected:bool,version:integer(),validity:{type:'string',enum:['VALID','PRODUCT_UNAVAILABLE','SKU_DISABLED','PRICE_UNAVAILABLE','OUT_OF_STOCK','STOCK_INSUFFICIENT','PURCHASE_BLOCKED']},purchasable:bool,validityMessage:text(200),lineAmountCents:nullable(decimal)});
export const cartSummary=object({totalItemCount:integer(Number.MAX_SAFE_INTEGER),selectedItemCount:integer(Number.MAX_SAFE_INTEGER),invalidSelectedCount:integer(Number.MAX_SAFE_INTEGER),selectedSubtotalCents:nullable(decimal),canCheckout:bool});
export const cartList=paged(cartItem,{summary:cartSummary});
export const cartWrite=object({item:cartItem,changed:bool});
export const cartAdded=object({item:cartItem,created:bool});
const batchItem=object({id:uuid,...version});
export const batchFields={items:{...array(batchItem,100),minItems:1,description:'最多100个不同项目，每项携带当前版本；全体通过才提交'}};
export const cartBatch=object({items:array(object({id:uuid,version:integer(),selected:bool,deleted:bool}),100)});
export function endpoint(operationId:string,summaryText:string,response:Schema,body?:Schema,created=false,both=false){return applyDecorators(
 Header('Cache-Control','no-store'),ApiBearerAuth('bearerAuth'),ApiOperation({operationId,summary:summaryText,description:'私有对象按本人归属；写命令持主体锁后重验身份及版本，与审计同事务。金额为整数分，汇总为十进制字符串。购物车不留货，小计不是结算报价。'}),
 ...(body?[ApiBody({required:true,schema:body})]:[]),
 (created?ApiCreatedResponse:ApiOkResponse)({headers:requestIdHeader,schema:object({data:response,requestId:uuid})}),
 ...(both?[ApiOkResponse({headers:requestIdHeader,schema:object({data:response,requestId:uuid})})]:[]),
 ApiBadRequestResponse({schema:authErrorSchema(['VALIDATION_FAILED'])}),ApiUnauthorizedResponse({schema:authErrorSchema(['TOKEN_INVALID','TOKEN_EXPIRED','TOKEN_SUBJECT_MISMATCH','SESSION_REVOKED','ACCOUNT_UNAVAILABLE'])}),
 ApiForbiddenResponse({schema:authErrorSchema(['FORBIDDEN','PASSWORD_CHANGE_REQUIRED'])}),ApiNotFoundResponse({schema:authErrorSchema(['CUSTOMER_NOT_FOUND','ADDRESS_NOT_FOUND','CART_ITEM_NOT_FOUND'])}),
 ApiConflictResponse({schema:authErrorSchema(['VERSION_CONFLICT','ADDRESS_LIMIT_REACHED','PRODUCT_UNAVAILABLE','SKU_UNAVAILABLE','PRICE_UNAVAILABLE','PURCHASE_BLOCKED','CART_QUANTITY_LIMIT','STOCK_INSUFFICIENT','CART_ITEM_INVALID','CART_CHANGED'])}),
 ApiServiceUnavailableResponse({schema:authErrorSchema(['CUSTOMER_CONSUMPTION_UNAVAILABLE'])}));}
export const idParam=()=>ApiParam({name:'id',schema:uuid});
export function listQuery(customer=false){return applyDecorators(...Object.entries({page:integer(Number.MAX_SAFE_INTEGER,1),pageSize:integer(100,1),...(customer?{phone:text(11),nickname:text(40),status,registeredFrom:date,registeredTo:date}:{})}).map(([name,schema])=>ApiQuery({name,required:false,schema})));}
