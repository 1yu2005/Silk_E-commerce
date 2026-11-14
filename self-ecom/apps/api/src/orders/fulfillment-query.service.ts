// 作用：履约工作台字段白名单；私有证据不进入顾客物流投影。
import {Inject,Injectable} from '@nestjs/common';
import {PrismaService} from '../prisma/prisma.service.js';
import {Clock} from '../common/time/clock.js';
import type {CustomerContext} from '../customers/customer-access.service.js';
import {OrderAccess,orderReader} from './order-access.service.js';
import {isTaskEligible} from '../tasks/task-access.service.js';
import {AccessDeniedError} from '../auth/access-denied.error.js';
import {OrderError} from './order.errors.js';
import {FulfillmentAfterSales} from './fulfillment-after-sales.js';
import {validPacking} from './fulfillment.rules.js';
@Injectable()
export class FulfillmentQueries {
 constructor(@Inject(PrismaService)private readonly db:PrismaService,@Inject(OrderAccess)private readonly access:OrderAccess,@Inject(Clock)private readonly clock:Clock,@Inject(FulfillmentAfterSales)private readonly afterSales:FulfillmentAfterSales){}
 detail(ctx:CustomerContext,id:string){return this.db.$transaction(async tx=>{
  const a=await this.access.current(tx,ctx,false);if(a.subjectType!=='EMPLOYEE'||!orderReader(a))throw new AccessDeniedError('FORBIDDEN');
  const o=await tx.order.findUnique({where:{id}});if(!o)throw new OrderError('ORDER_NOT_FOUND');
  const can=(p:string)=>a.effectivePermissions.includes(p),physical=can('order.fulfillment.read');
  const tasks=await tx.task.findMany({where:{businessType:'ORDER',businessId:id},orderBy:[{stage:'asc'},{round:'desc'}]});
  const owns=(stage:string)=>tasks.some(t=>t.stage===stage&&t.status==='CLAIMED'&&t.assigneeId===a.subjectId&&isTaskEligible(a,t));
  const shipment=await tx.shipment.findUnique({where:{orderId:id}}),packing=await validPacking(tx,o),allChecks=physical?await tx.packingCheck.findMany({where:{orderId:id},orderBy:[{createdAt:'desc'},{id:'desc'}]}):[];
  const attempts=await tx.handoverAttempt.findMany({where:{orderId:id},orderBy:{attemptNo:'desc'}}),pending=attempts.find(t=>['IN_PROGRESS','UNCERTAIN'].includes(t.status));
  const blocks=await tx.orderBlock.findMany({where:{orderId:id,active:true},select:{id:true,type:true,sourceType:true,sourceId:true,blocksShipment:true,blocksReceipt:true}}),afterSale=await this.afterSales.hasActive(tx,id);
  const blocked=blocks.some(b=>b.blocksShipment)||afterSale,work=o.status==='WAIT_SHIPMENT'&&!blocked&&!pending&&owns('SHIPMENT_PROCESS');
  const exceptions=await tx.shipmentException.findMany({where:{orderId:id},orderBy:[{createdAt:'asc'},{id:'asc'}]});
  const decisions=await tx.shipmentExceptionDecision.findMany({where:{exceptionId:{in:exceptions.map(e=>e.id)}},orderBy:[{createdAt:'asc'},{id:'asc'}]});
  const revisions=await tx.shipmentTrackingRevision.findMany({where:{orderId:id},orderBy:[{createdAt:'asc'},{id:'asc'}]});
  const verifications=physical?await tx.handoverVerification.findMany({where:{orderId:id},orderBy:[{createdAt:'asc'},{id:'asc'}]}):[];
  const ownerIds=[...exceptions.map(e=>e.id),...decisions.map(d=>d.id),...revisions.map(e=>e.id),...verifications.map(e=>e.id)];
  const evidence=await tx.fileReference.findMany({where:{ownerType:{in:['SHIPMENT_EXCEPTION','SHIPMENT_EXCEPTION_DECISION','SHIPMENT_TRACKING_REVISION','HANDOVER_VERIFICATION']},ownerId:{in:ownerIds},audience:'INTERNAL'},select:{ownerId:true,fileAssetId:true}});
  return {orderId:id,status:o.status,stage:o.fulfillmentStage,orderVersion:o.version,physicalVersion:o.stockPhysicalVersion,serverTime:this.clock.now(),
   shipment:shipment?{id:shipment.id,status:shipment.status,carrierName:shipment.carrierName,trackingNumber:shipment.trackingNumber,actualHandoverAt:shipment.actualHandoverAt,version:shipment.version}:null,
   packingCheck:physical&&packing?{id:packing.id,physicalVersion:packing.checkedPhysicalVersion,goodsLocation:packing.goodsLocation,createdAt:packing.createdAt}:null,
   packingHistory:allChecks.map(p=>({id:p.id,physicalVersion:p.checkedPhysicalVersion,goodsLocation:p.goodsLocation,checkedItems:p.checkedItems,createdAt:p.createdAt,checkedById:p.checkedById})),
   tasks:tasks.map(t=>({id:t.id,stage:t.stage,status:t.status,version:t.version,round:t.round,assigneeId:t.assigneeId,canClaim:t.status==='OPEN'&&isTaskEligible(a,t)&&(t.stage!=='SHIPMENT_PROCESS'||!blocked&&!pending&&o.status==='WAIT_SHIPMENT')})),
   attempts:attempts.map(t=>({id:t.id,startCommandKey:t.startCommandKey,attemptNo:t.attemptNo,status:t.status,version:t.version,startedAt:t.startedAt,uncertainAfter:t.uncertainAfter,carrierName:t.carrierSnapshot,trackingNumber:t.trackingSnapshot,actualHandoverAt:t.actualHandoverAt,procedureViolation:t.procedureViolation,...(physical?{startedById:t.startedById,resolutionReason:t.resolutionReason}:{})})),
   verifications:verifications.map(v=>({id:v.id,attemptId:v.attemptId,conclusion:v.conclusion,actualHandoverAt:v.actualHandoverAt,goodsLocation:v.goodsLocation,physicalVersion:v.physicalVersion,reason:v.reason,evidenceNote:v.evidenceNote,createdAt:v.createdAt})),
   exceptions:exceptions.map(e=>({id:e.id,type:e.type,status:e.status,reason:e.reason,evidenceNote:e.evidenceNote,goodsLocation:e.goodsLocation,orderItemIds:e.orderItemIds,version:e.version,physicalVersionAtOpen:e.physicalVersionAtOpen,verifiedPhysicalVersion:e.currentVerifiedPhysicalVersion,createdAt:e.createdAt,resolvedAt:e.resolvedAt,stockIncidentId:e.stockIncidentId,canWarehouseConfirm:e.status==='OPEN'&&can('shipment.exception.manage')&&owns('SHIPMENT_EXCEPTION_VERIFY'),canCustomerConfirm:e.status==='OPEN'&&can('shipment.customer-confirm')&&can('communication.service.write')&&owns('CUSTOMER_CONTACT'),decisions:decisions.filter(d=>d.exceptionId===e.id).map(d=>({id:d.id,kind:d.kind,physicalVersion:d.physicalVersion,description:d.description,createdAt:d.createdAt}))})),
   revisions:revisions.map(r=>({id:r.id,oldCarrier:r.oldCarrier,oldTracking:r.oldTracking,newCarrier:r.newCarrier,newTracking:r.newTracking,reason:r.reason,evidenceNote:r.evidenceNote,historical:r.historical,createdAt:r.createdAt})),
   evidence:evidence.map(e=>({ownerId:e.ownerId,fileId:e.fileAssetId,contentUrl:'/api/v1/files/'+e.fileAssetId+'/content'})),blocks,
   receipt:{actualHandoverAt:o.actualHandoverAt,baseDueAt:o.autoReceiptBaseDueAt,dueAt:o.autoReceiptDueAt,paused:blocks.some(b=>b.blocksReceipt)||afterSale,completedAt:o.completedAt,afterSaleDeadline:o.afterSaleDeadline,source:o.receiptSource},
   allowedActions:{pack:work&&can('shipment.pack'),prepare:work&&can('shipment.pack'),start:work&&o.fulfillmentStage==='READY'&&!!packing&&!!shipment&&can('shipment.handover'),confirm:pending?.status==='IN_PROGRESS'&&owns('SHIPMENT_PROCESS')&&can('shipment.handover'),uncertain:pending?.status==='IN_PROGRESS'&&owns('SHIPMENT_PROCESS')&&can('shipment.handover'),resolve:pending?.status==='UNCERTAIN'&&owns('HANDOVER_VERIFY')&&can('shipment.handover'),exception:['WAIT_SHIPMENT','SHIPPED'].includes(o.status)&&can('shipment.exception.manage')&&(o.status==='SHIPPED'||owns('SHIPMENT_PROCESS')||owns('HANDOVER_VERIFY')||owns('SHIPMENT_EXCEPTION_VERIFY')),correctTracking:!!shipment&&!pending&&['WAIT_SHIPMENT','SHIPPED'].includes(o.status)&&can('shipment.tracking.correct'),historicalTracking:!!shipment&&!pending&&['COMPLETED','REFUNDED'].includes(o.status)&&a.role==='SUPER_ADMIN'&&can('shipment.history.correct')}
  };
 },{isolationLevel:'RepeatableRead'});}
}
