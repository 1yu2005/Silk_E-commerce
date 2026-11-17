// 作用：板块12严格请求与按岗位裁剪响应；失败200必须读取attemptOutcome。
import {object,array,integer,text,uuid,bool,nullable} from '../customers/customer.openapi.js';
import {date,address} from '../orders/order.openapi.js';
import {result as saleResult} from './after-sale.openapi.js';
const version=integer(2147483646),fileIds={...array(uuid,5),uniqueItems:true},evidence=array(object({id:uuid,contentUrl:text(200)}),5);
const command={commandKey:uuid,expectedAfterSaleVersion:version,reason:text(500)},staff={...command,expectedTaskVersion:version},refs={...staff,expectedReturnPhysicalVersion:version,currentRevisionRefs:{...array(uuid,200),uniqueItems:true}};
export const line=object({orderItemId:uuid,matchedReceivedQty:integer(99),sellableQty:integer(99),unsellableQty:integer(99),conditionNote:text(1000)});
export const unmatched=object({description:text(1000),quantity:integer(2147483647,1),kind:{type:'string',enum:['WRONG_VARIANT','EXCESS','UNRELATED','UNKNOWN']},custodyLocation:text(200)});
const missing=array(object({orderItemId:uuid,remainingQty:integer(99,1)}),100);
export const prepare=object({...command,parcelId:uuid,sourceNamespace:text(80),sourceReference:text(200)},[...Object.keys(command),'sourceNamespace','sourceReference']);
export const receive=object({...staff,parcelId:uuid,receivedAt:date,goodsLocation:text(200),sourceNote:text(1000),evidenceFileIds:fileIds});
export const cancelReceiptSource=object({...staff,parcelId:uuid});
export const draft=object({...staff,receiptId:uuid,expectedReceiptVersion:version,expectedReturnPhysicalVersion:version,inspectionComplete:bool,items:array(line,100),unmatchedItems:array(unmatched,100),evidenceFileIds:fileIds});
export const inspectionRefs=object(refs);
export const exception=object({...refs,exceptionTypes:{...array({type:'string',enum:['SHORTAGE','WRONG_ITEM','EMPTY_PACKAGE','UNKNOWN_QUANTITY','DAMAGED']},5),minItems:1,uniqueItems:true},publicExplanation:text(1000)});
export const reship=object({...staff,missingItems:{...missing,minItems:1},communicationId:uuid,publicExplanation:text(1000)});
export const request=object({...staff,communicationId:uuid,publicExplanation:text(1000)});
export const approve=object({...refs,decision:{type:'string',enum:['APPROVE_FULL_REFUND']},publicExplanation:text(1000),responsibilityNote:text(1000)});
export const finalizeException=object({...refs,approvalId:uuid});
export const physicalEvent=object({...staff,receiptId:uuid,expectedReturnPhysicalVersion:version,kind:{type:'string',enum:['MOVE','DAMAGE','CORRECTION']},goodsLocation:text(200)});
const physicalLine=object({orderItemId:uuid,sellableQty:integer(99),damagedQty:integer(99),incidentItemIds:{...array(uuid,100),uniqueItems:true}});
export const physical=object({...staff,expectedPhysicalVersion:version,stoppedAt:date,goodsLocation:text(200),items:{...array(physicalLine,100),minItems:1},evidenceFileIds:fileIds});
const refundFields={...staff,physicalCheckId:uuid,expectedPhysicalVersion:version,expectedFinalInspectionId:uuid};
export const refund=object(refundFields,Object.keys(staff));
export const retry=object({...refundFields,refundId:uuid,expectedRefundVersion:version},[...Object.keys(staff),'refundId','expectedRefundVersion']);
export const result={...saleResult,properties:{...('properties' in saleResult?saleResult.properties:{}),receiptId:uuid,approvalId:uuid,finalInspectionId:uuid,physicalCheckId:uuid,reshipmentRequestId:uuid,physicalEventId:uuid}};
export const refundResult=object({afterSaleId:uuid,status:text(40),version,refundId:uuid,refundNo:text(40),refundVersion:version,refundStatus:{type:'string',enum:['FAILED','SUCCEEDED']},amountCents:integer(100000000,1),attemptId:uuid,attemptNo:integer(2147483647,1),attemptOutcome:{type:'string',enum:['FAILED','SUCCEEDED']},failureCode:nullable(text(80)),publicExplanation:text(1000),retryAllowed:bool,replayed:bool});
const revision=object({id:uuid,revisionNo:integer(),inspectionComplete:bool,basedReceiptPhysicalVersion:version,createdAt:date,reason:text(500),evidence,items:array(line),unmatchedItems:array(object({id:uuid,...('properties'in unmatched?unmatched.properties:{})}))});
const task=object({id:uuid,stage:text(40),round:integer(),status:text(20),version,dueAt:nullable(date),assigneeId:nullable(uuid),canClaim:bool},['id','stage','round','status','version','dueAt']);
const totalProps={orderItemId:uuid,purchasedQty:integer(99,1),receivedQty:integer(99),missingQty:integer(99),sellableQty:integer(99),unsellableQty:integer(99)};
export const view=object({afterSaleId:uuid,status:text(40),version,returnPhysicalVersion:version,stockPhysicalVersion:version,activeUnshippedCheckId:nullable(uuid),currentRevisionRefs:array(uuid),receivedPackages:integer(),
 receipts:array(object({id:uuid,parcelId:uuid,receivedAt:date,recordedAt:date,version,physicalVersion:version,goodsLocation:text(200),sourceNote:text(1000),currentRevisionId:nullable(uuid),evidence,revisions:array(revision)})),totals:array(object(totalProps,['orderItemId','purchasedQty','receivedQty','missingQty'])),
 parcels:array(object({id:uuid,batchNo:integer(2147483647,1),origin:text(30),reshipmentRequestId:nullable(uuid),received:bool,cancelledAt:nullable(date),cancellationReason:nullable(text(500)),canCancel:bool})),finalInspectionBlockers:array(text(500)),
 reshipments:array(object({id:uuid,round:integer(),status:text(20),dueAt:date,publicExplanation:nullable(text(1000)),missingItems:missing,returnAddressSnapshot:address,parcelIds:array(uuid)})),
 approvals:array(object({id:uuid,approvalNo:integer(),basedReturnPhysicalVersion:version,approvedAt:date,invalidatedAt:nullable(date),publicExplanation:text(1000)})),finalInspection:nullable(object({id:uuid,mode:text(30),confirmedAt:date})),
 physicalCheck:nullable(object({id:uuid,physicalVersion:version,status:text(20),goodsLocation:text(200),stoppedAt:date,checkedAt:date,evidence,items:array(object({orderItemId:uuid,purchasedQty:integer(99,1),sellableQty:integer(99),damagedQty:integer(99)}))})),physicalItems:array(object({orderItemId:uuid,quantity:integer(99,1),damagedQty:integer(99),unknown:bool,incidentItemIds:array(uuid)})),
 refund:nullable(object({id:uuid,status:text(20),version,succeededAt:nullable(date),refundNo:text(40),amountCents:integer(100000000,1),attempts:array(object({id:uuid,attemptNo:integer(),outcome:text(20),failureCode:nullable(text(80)),publicExplanation:text(1000),finishedAt:date}))},['id','status','version','succeededAt','attempts'])),tasks:array(task),
 allowedActions:object(Object.fromEntries(['prepare','receive','draft','exception','finalize','finalizeException','reship','requestException','approve','physical','refund','retry'].map(k=>[k,bool]))),serverTime:date,simulationNotice:text(100)});
