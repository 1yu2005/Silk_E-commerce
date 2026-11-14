import {applyDecorators,Header} from '@nestjs/common';
import {ApiBearerAuth,ApiOperation,ApiOkResponse,ApiQuery,ApiBadRequestResponse,ApiForbiddenResponse,ApiUnauthorizedResponse} from '@nestjs/swagger';
import {authErrorSchema} from '../auth/employee-auth.openapi.js';
import {requestIdHeader} from '../health/health.openapi.js';
import {object,array,text,integer,bool} from '../customers/customer.openapi.js';
const decimal={type:'string' as const,pattern:'^-?(0|[1-9][0-9]*)$'};
const count={type:'string' as const,pattern:'^(0|[1-9][0-9]*)$'};
const date={type:'string' as const,format:'date-time'},id={type:'string' as const,format:'uuid'};
const meta={asOf:date,timeZone:{type:'string' as const,enum:['Asia/Shanghai']},definitionVersion:{type:'string' as const,enum:['DASHBOARD_V1']},from:date,to:date,firstDate:text(10),lastDate:text(10)};
const events={createdOrderCount:count,newCustomerCount:count,paidAmountCents:count,refundAmountCents:count,netReceiptsCents:decimal};
export const overview=object({...meta,today:object(events),current:object({waitingShipmentOrderCount:count,afterSalePausedOrderCount:count,pendingReviewAfterSaleCount:count,failedRefundCount:count,lowStockSkuCount:count})});
export const trends=object({...meta,days:{type:'integer',enum:[7,30]},items:array(object({date:text(10),...events}),30)});
export const hot=object({...meta,days:{type:'integer',enum:[30]},items:array(object({productId:id,productCode:text(64),name:text(120),status:text(30),archived:bool,paidQuantity:count}),20)});
export const lowStock=object({...meta,items:array(object({skuId:id,skuCode:text(64),productId:id,productCode:text(64),productName:text(120),available:integer(),warningThreshold:integer(),skuEnabled:bool,skuRetired:bool,productStatus:text(30),productArchived:bool}),100),total:integer(Number.MAX_SAFE_INTEGER),page:integer(Number.MAX_SAFE_INTEGER,1),pageSize:integer(100,1)});
export function endpoint(operationId:string,summary:string,response:ReturnType<typeof object>){return applyDecorators(Header('Cache-Control','no-store'),ApiBearerAuth('bearerAuth'),ApiOperation({operationId,summary,description:'只读真实成功Payment/Refund事件；北京日期半开窗口。同响应使用短只读快照，累计数字以十进制字符串返回。线下金额不计交易，跨请求不保证同快照。'}),ApiOkResponse({headers:requestIdHeader,schema:object({data:response,requestId:id})}),ApiBadRequestResponse({schema:authErrorSchema(['VALIDATION_FAILED'])}),ApiForbiddenResponse({schema:authErrorSchema(['FORBIDDEN','PASSWORD_CHANGE_REQUIRED'])}),ApiUnauthorizedResponse({schema:authErrorSchema(['TOKEN_INVALID','TOKEN_EXPIRED','SESSION_REVOKED','ACCOUNT_UNAVAILABLE'])}));}
export const trendQuery=()=>ApiQuery({name:'days',required:false,schema:{type:'integer',enum:[7,30],default:7}});
export const hotQuery=()=>applyDecorators(ApiQuery({name:'days',required:false,schema:{type:'integer',enum:[30],default:30}}),ApiQuery({name:'limit',required:false,schema:{type:'integer',minimum:1,maximum:20,default:10}}));
export const pageQuery=()=>applyDecorators(ApiQuery({name:'page',required:false,schema:integer(Number.MAX_SAFE_INTEGER,1)}),ApiQuery({name:'pageSize',required:false,schema:integer(100,1)}));
