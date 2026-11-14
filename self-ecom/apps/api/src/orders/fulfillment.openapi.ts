// 作用：履约操作与员工/顾客投影的显式契约；生成客户端据此更新。
import * as O from './order.openapi.js';
export const version=O.integer(2147483646),date=O.date;
export const base={commandKey:O.uuid,expectedOrderVersion:version,expectedTaskVersion:version,reason:O.text(500)};
export const line=O.object({orderItemId:O.uuid,checkedQuantity:O.integer(99,1)}),lines={...O.array(line,100),minItems:1};
const evidence={evidenceNote:O.text(2000),evidenceFileIds:O.array(O.uuid,5)};
export const pack=O.object({...base,items:lines,goodsLocation:O.text(200),expectedPhysicalVersion:version});
export const prepare=O.object({...base,carrierName:O.text(60),trackingNumber:{...O.text(100),pattern:'^[A-Za-z0-9-]{1,100}$'}});
export const start=O.object({...base,shipmentId:O.uuid,packingCheckId:O.uuid,expectedPhysicalVersion:version});
const attempt={...base,attemptId:O.uuid,expectedAttemptVersion:version};
export const confirm=O.object({...attempt,actualHandoverAt:date});
export const uncertain=O.object({...attempt,...evidence},[...Object.keys(attempt),'evidenceNote']);
export const resolve=O.object({...attempt,...evidence,conclusion:{type:'string',enum:['HANDED_OVER','NOT_HANDED_OVER','STILL_UNCERTAIN']},actualHandoverAt:date,goodsLocation:O.text(200),items:lines,expectedPhysicalVersion:version},[...Object.keys(attempt),'evidenceNote','conclusion']);
export const exception=O.object({...base,...evidence,incidentKey:O.text(128,16),type:{type:'string',enum:['SHORTAGE','DAMAGED','WRONG_VARIANT','OTHER']},orderItemIds:{...O.array(O.uuid,100),minItems:1},goodsLocation:O.text(200),stockIncidentId:O.uuid},[...Object.keys(base),'evidenceNote','incidentKey','type','orderItemIds','goodsLocation']);
const decision={...base,...evidence,expectedExceptionVersion:version,currentPhysicalVersion:version};
export const exceptionResolve=O.object(decision,[...Object.keys(base),'evidenceNote','expectedExceptionVersion','currentPhysicalVersion']);
export const warehouse=O.object({...decision,items:lines,goodsLocation:O.text(200)},[...Object.keys(base),'evidenceNote','expectedExceptionVersion','currentPhysicalVersion','items','goodsLocation']);
export const customer=O.object({...decision,choice:{type:'string',enum:['WAIT','CONTINUE','REQUEST_REFUND']}},[...Object.keys(base),'evidenceNote','expectedExceptionVersion','currentPhysicalVersion','choice']);
export const tracking=O.object({...('properties' in prepare?prepare.properties:{}),...evidence},Object.keys('properties' in prepare?prepare.properties??{}:{}));
export const result=O.object({orderId:O.uuid,orderStatus:O.status,fulfillmentStage:O.text(30),orderVersion:version,tasks:O.array(O.object({id:O.uuid,stage:O.text(40),status:O.text(20),version})),replayed:O.bool,shipmentId:O.uuid,packingCheckId:O.uuid,attemptId:O.uuid,attemptNo:O.integer(),attemptStatus:O.text(30),attemptVersion:version,exceptionId:O.uuid,verificationId:O.uuid,revisionId:O.uuid,conclusion:O.text(30)},['orderId','orderStatus','fulfillmentStage','orderVersion','tasks','replayed']);
export const receipt=O.object({orderId:O.uuid,orderStatus:O.status,completedAt:date,afterSaleDeadline:date,receiptSource:{type:'string',enum:['CUSTOMER','SYSTEM']},replayed:O.bool});
export const receiptView=O.object({actualHandoverAt:O.nullable(date),baseDueAt:O.nullable(date),dueAt:O.nullable(date),paused:O.bool,completedAt:O.nullable(date),afterSaleDeadline:O.nullable(date),source:O.nullable(O.text(20))});
const decisionView=O.object({id:O.uuid,kind:O.text(40),physicalVersion:version,description:O.text(2000),createdAt:date});
export const detail=O.object({orderId:O.uuid,status:O.status,stage:O.text(30),orderVersion:version,physicalVersion:version,serverTime:date,
 shipment:O.nullable(O.object({id:O.uuid,status:O.text(20),carrierName:O.text(60),trackingNumber:O.text(100),actualHandoverAt:O.nullable(date),version})),
 packingCheck:O.nullable(O.object({id:O.uuid,physicalVersion:version,goodsLocation:O.text(200),createdAt:date})),
 packingHistory:O.array(O.object({id:O.uuid,physicalVersion:version,goodsLocation:O.text(200),checkedItems:lines,createdAt:date,checkedById:O.uuid})),
 tasks:O.array(O.object({id:O.uuid,stage:O.text(40),status:O.text(20),version,round:O.integer(),assigneeId:O.nullable(O.uuid),canClaim:O.bool})),
 attempts:O.array(O.object({id:O.uuid,startCommandKey:O.uuid,attemptNo:O.integer(),status:O.text(30),version,startedAt:date,uncertainAfter:date,carrierName:O.text(60),trackingNumber:O.text(100),actualHandoverAt:O.nullable(date),procedureViolation:O.bool,startedById:O.uuid,resolutionReason:O.nullable(O.text(500))},['id','startCommandKey','attemptNo','status','version','startedAt','uncertainAfter','carrierName','trackingNumber','actualHandoverAt','procedureViolation'])),
 verifications:O.array(O.object({id:O.uuid,attemptId:O.uuid,conclusion:O.text(30),actualHandoverAt:O.nullable(date),goodsLocation:O.nullable(O.text(200)),physicalVersion:O.nullable(version),reason:O.text(500),evidenceNote:O.nullable(O.text(2000)),createdAt:date})),
 exceptions:O.array(O.object({id:O.uuid,type:O.text(30),status:O.text(20),reason:O.text(500),evidenceNote:O.text(2000),goodsLocation:O.text(200),orderItemIds:O.array(O.uuid,100),version,physicalVersionAtOpen:version,verifiedPhysicalVersion:O.nullable(version),createdAt:date,resolvedAt:O.nullable(date),stockIncidentId:O.nullable(O.uuid),canWarehouseConfirm:O.bool,canCustomerConfirm:O.bool,decisions:O.array(decisionView)})),
 revisions:O.array(O.object({id:O.uuid,oldCarrier:O.text(60),oldTracking:O.text(100),newCarrier:O.text(60),newTracking:O.text(100),reason:O.text(500),evidenceNote:O.nullable(O.text(2000)),historical:O.bool,createdAt:date})),
 evidence:O.array(O.object({ownerId:O.uuid,fileId:O.uuid,contentUrl:O.text(200)})),blocks:O.array(O.object({id:O.uuid,type:O.text(40),sourceType:O.text(40),sourceId:O.uuid,blocksShipment:O.bool,blocksReceipt:O.bool})),receipt:receiptView,
 allowedActions:O.object(Object.fromEntries(['pack','prepare','start','confirm','uncertain','resolve','exception','correctTracking','historicalTracking'].map(k=>[k,O.bool])))
});
