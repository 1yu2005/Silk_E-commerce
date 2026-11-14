// 作用：协作契约明确来源、版本、线下边界及权限裁剪，生成调用器沿用统一HTTP能力。
import {object,array,integer,text,uuid,bool,nullable} from '../customers/customer.openapi.js';
import {date,address} from '../orders/order.openapi.js';
export {endpoint,idParam} from '../after-sales/after-sale.openapi.js';
const v=integer(2147483646),command={commandKey:uuid,expectedOrderVersion:v,reason:text(500)},source={sourceType:text(40),sourceId:uuid};
export const result=object({orderId:uuid,orderVersion:v,resultType:text(50),resultId:uuid,requestVersion:nullable(v),replayed:bool});
export const createBody=object({...command,communicationId:uuid,proposedAddress:address},[...Object.keys(command),'communicationId']);
const addressCommand={...command,expectedRequestVersion:v,expectedTaskVersion:v,communicationId:uuid};
export const addressBody=object(addressCommand);
export const physicalBody=object({...command,expectedRequestVersion:v,expectedTaskVersion:v,expectedPhysicalVersion:v,goodsLocation:text(200),items:array(object({orderItemId:uuid,checkedQuantity:integer(99,1)}),100)});
export const continueBody=object({...addressCommand,physicalVerificationId:uuid,customerConsent:{type:'string',enum:['CONTINUE_ORIGINAL']}});
export const offlineBody=object({...addressCommand,caseType:{type:'string',enum:['FORWARDING']},publicSummary:text(1000)});
const assisted={...command,expectedTaskVersion:v,communicationId:uuid,customerConsent:{type:'string' as const,enum:['REFUND_FULL']},type:{type:'string' as const,enum:['REFUND_ONLY','RETURN_REFUND']},reasonCode:{type:'string' as const,enum:['NOT_WANTED','QUALITY','WRONG_ITEM','DAMAGED','OTHER']},description:text(2000),evidenceFileIds:{...array(uuid,5),uniqueItems:true},proxyContextId:uuid,expectedProxyTaskVersion:v,physicalVerificationId:uuid,expectedRequestVersion:v,exceptionId:uuid,expectedExceptionVersion:v};
export const assistedBody=object(assisted,Object.keys(assisted).filter(k=>!['proxyContextId','expectedProxyTaskVersion','physicalVerificationId','expectedRequestVersion','exceptionId','expectedExceptionVersion'].includes(k)));
export const followupBody=object({...command,sourceType:{type:'string',enum:['ADDRESS_REQUEST','SHIPMENT_EXCEPTION','STOCK_EXCEPTION']},sourceId:uuid});
export const task=object({id:uuid,businessType:text(40),businessId:uuid,stage:text(40),status:text(20),round:integer(),version:v,assigneeId:nullable(uuid),dueAt:nullable(date),originalDueAt:nullable(date),firstOverdueAt:nullable(date),reassignNeeded:bool,canClaim:bool,sources:array(object(source))});
export const detail=object({orderId:uuid,orderNo:text(64),orderStatus:text(30),orderVersion:v,fulfillmentStage:text(40),physicalVersion:v,actualHandoverAt:nullable(date),autoReceiptDueAt:nullable(date),customerId:nullable(uuid),customerStatus:nullable(text(30)),customerStatusVersion:nullable(v),
 lastPhysicalCheck:nullable(object({id:uuid,goodsLocation:text(200),checkedPhysicalVersion:v,createdAt:date,current:bool})),inventoryLedger:array(object({id:uuid,actionId:uuid,skuId:uuid,eventType:text(50),beforeA:integer(),beforeR:integer(),deltaA:{type:'integer',minimum:-2147483647,maximum:2147483647},deltaR:{type:'integer',minimum:-2147483647,maximum:2147483647},afterA:integer(),afterR:integer(),createdAt:date})),
 blocks:array(object({id:uuid,...source,blocksShipment:bool,blocksReceipt:bool})),tasks:array(task),
 requests:array(object({id:uuid,status:text(20),version:v,reason:nullable(text(500)),proposedAddressSnapshot:nullable(address),communicationId:nullable(uuid),resolutionKind:nullable(text(30)),handoffAfterSaleId:nullable(uuid),handoffOfflineCaseId:nullable(uuid),physicalVerificationId:nullable(uuid),createdAt:date})),
 exceptions:array(object({id:uuid,type:text(40),status:text(30),version:v,goodsLocation:nullable(text(200)),physicalVersion:nullable(v),customerChoice:nullable(text(40)),handedAfterSaleIds:array(uuid)})),
 afterSales:array(object({id:uuid,number:text(64),status:text(40),version:v,returnPhysicalVersion:v,active:bool})),
 custody:array(object({id:uuid,afterSaleId:uuid,description:text(1000),quantity:integer(),disposition:text(40),location:nullable(text(200)),plannedAction:text(1000),status:text(30),version:v,followOfflineCaseId:nullable(uuid)})),
 offlineCases:array(object({id:uuid,caseNo:text(64),type:text(40),status:text(30),version:v,subject:text(100),publicSummary:text(1000)})),
 payment:nullable(object({number:text(64),status:text(30),amountCents:integer(100000000),paidAt:date})),refund:nullable(object({id:uuid,number:text(64),status:text(30),amountCents:integer(100000000),succeededAt:nullable(date),attemptCount:integer()})),
 balances:array(object({skuId:uuid,available:integer(),reserved:integer()})),stockIncidents:array(object({id:uuid,status:text(30),reason:text(500),version:v})),
 communications:array(object({id:uuid,result:text(4000),publicText:nullable(text(2000)),createdAt:date})),proxyContexts:array(object({id:uuid,action:text(40),status:text(30),expiresAt:date})),serverTime:date,inventoryNotice:text(200),refundNotice:text(200)});
