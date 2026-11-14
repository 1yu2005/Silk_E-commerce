// 作用：真实订单接通任务、经办、来源、沟通、快照文件、消费统计与SKU引用保护。
import {Inject,Injectable,type OnModuleInit} from '@nestjs/common';
import type {Prisma,Task,TaskBusinessSource} from '@prisma/client';
import {TaskBusinessAdapters,type TaskCommandActor,type TaskLockResource} from '../tasks/task-business-adapters.js';
import {isTaskEligible} from '../tasks/task-access.service.js';
import {TaskError} from '../tasks/task.errors.js';
import {taskActorKey,type TaskSourceRecord} from '../tasks/task-source.contract.js';
import {FileBusinessAdapters} from '../files/file-business-adapters.js';
import {FileError} from '../files/file.errors.js';
import {SkuReferences} from '../catalog/sku-reference.service.js';
import {CustomerConsumptionService} from '../customers/customer-consumption.service.js';
import {BusinessRecordAdapters} from '../records/business-record-adapters.js';
import {RecordInputError} from '../records/record-support.js';
import {orderReader,ownedOrder,requireOrderPermission} from './order-access.service.js';
import {OrderError} from './order.errors.js';
import {FulfillmentTaskPolicy} from './fulfillment-task.policy.js';
import {FulfillmentAfterSales} from './fulfillment-after-sales.js';
import {sourceBelongs,pendingHandover,shipmentBlocked} from './fulfillment.rules.js';
const sourceRow=(r:TaskBusinessSource):TaskSourceRecord=>({...r,sourceType:r.sourceType as TaskSourceRecord['sourceType'],status:r.status as TaskSourceRecord['status'],resolutionOutcome:r.resolutionOutcome as TaskSourceRecord['resolutionOutcome']});
@Injectable()
export class OrderAdapters implements OnModuleInit {
 constructor(@Inject(TaskBusinessAdapters)private readonly tasks:TaskBusinessAdapters,@Inject(FileBusinessAdapters)private readonly files:FileBusinessAdapters,
 @Inject(SkuReferences)private readonly skus:SkuReferences,@Inject(CustomerConsumptionService)private readonly consumption:CustomerConsumptionService,@Inject(BusinessRecordAdapters)private readonly records:BusinessRecordAdapters,
 @Inject(FulfillmentTaskPolicy)private readonly policy:FulfillmentTaskPolicy,@Inject(FulfillmentAfterSales)private readonly afterSales:FulfillmentAfterSales){}
 onModuleInit(){
  const authorize=async(tx:Prisma.TransactionClient,id:string,a:TaskCommandActor)=>{await ownedOrder(tx,id,a);if(a.subjectType==='EMPLOYEE'&&!orderReader(a)&&!a.effectivePermissions.includes('inventory.order-exception.manage'))throw new TaskError('TASK_ENTRY_BLOCKED');};
  const policy=this.policy,afterSales=this.afterSales;
  const active=(tx:Prisma.TransactionClient,t:Task)=>policy.active(tx,t);
  this.tasks.registerLocker('ORDER',async(tx,id)=>{await tx.$queryRaw`SELECT id FROM "order" WHERE id=${id}::uuid FOR UPDATE`;});
  this.tasks.registerBusiness('ORDER',{
   async planLocks(tx,ref){const o=await tx.order.findUnique({where:{id:ref.businessId},include:{items:true}});if(!o)throw new OrderError('ORDER_NOT_FOUND');
    const plan:TaskLockResource[]=[{kind:'CUSTOMER',id:o.customerId},{kind:'ORDER',id:o.id},...o.items.flatMap(i=>[{kind:'PRODUCT' as const,id:i.productId},{kind:'SKU_STOCK' as const,id:i.skuId}])];return plan;},
   authorize:(tx,ref,a)=>authorize(tx,ref.businessId,a),
   async resolveEntry(tx,e,a,current){await authorize(tx,e.businessId,a);const o=await tx.order.findUniqueOrThrow({where:{id:e.businessId}});if(current)throw new TaskError('TASK_STAGE_ACTIVE');
    if(e.stage==='SHIPMENT_PROCESS'){if(o.status!=='WAIT_SHIPMENT'||!o.paidAt||await pendingHandover(tx,o.id)||await shipmentBlocked(tx,o.id)||await afterSales.hasActive(tx,o.id))throw new TaskError('TASK_ENTRY_BLOCKED');return {startedAt:e.entryKey.startsWith('payment:')?o.paidAt:o.updatedAt};}
    if(e.stage==='HANDOVER_VERIFY'){const p=await pendingHandover(tx,o.id);if(p?.status!=='UNCERTAIN')throw new TaskError('TASK_ENTRY_BLOCKED');return {startedAt:o.updatedAt};}
    if(['SHIPMENT_EXCEPTION_VERIFY','CUSTOMER_CONTACT'].includes(e.stage)){const exception=await tx.shipmentException.findFirst({where:{orderId:o.id,status:'OPEN'},orderBy:{createdAt:'asc'}});if(exception)return {startedAt:exception.createdAt};}
    if(!['STOCK_EXCEPTION_VERIFY','PHYSICAL_VERIFY','ADMIN_STOCK_REVIEW','CUSTOMER_CONTACT'].includes(e.stage))throw new TaskError('TASK_ENTRY_BLOCKED');
    const sources=await tx.stockIncidentItem.findMany({where:{orderItem:{orderId:o.id},incident:{status:'OPEN'}},include:{incident:true},orderBy:{incident:{createdAt:'asc'}}});
    if(!sources.length)throw new TaskError('TASK_ENTRY_BLOCKED');return {startedAt:sources[0]!.incident.createdAt};
   }
  });
  this.tasks.registerAccess('ORDER',{
   async visibleBusinessIds(tx,a){if(!orderReader(a)&&!a.effectivePermissions.includes('inventory.order-exception.manage'))return [];return (await tx.order.findMany({select:{id:true}})).map(o=>o.id);},
   async describe(tx,a,t){await authorize(tx,t.businessId,a);const o=await tx.order.findUniqueOrThrow({where:{id:t.businessId}});let valid=true;try{await active(tx,t);}catch{valid=false;}
    return {number:o.number,label:t.stage==='SHIPMENT_PROCESS'?'订单待发货':'订单实物异常跟进',detailPath:'/orders/'+o.id,canClaim:valid&&t.status==='OPEN'&&isTaskEligible(a,t),canRelease:valid&&t.status==='CLAIMED'&&t.assigneeId===a.subjectId,canReadHistoryReasons:true,canTransfer:valid,canExtendDeadline:valid};},
   async assertClaim(tx,a,t){await authorize(tx,t.businessId,a);await active(tx,t);},async assertRelease(tx,a,t){await authorize(tx,t.businessId,a);await policy.release(tx,a,t);},
   claimed:(tx,a,t,requestId,now)=>policy.claimed(tx,a,t,requestId,now)
  });
  this.tasks.registerHandoff('ORDER',{transfer:policy.transfer,async qualificationLost(tx,_a,t){if(!await tx.order.count({where:{id:t.businessId}}))throw new TaskError('TASK_ENTRY_BLOCKED');/* 回池保留交运未知/暂停事实，扫描建立独立核实。 */}});
  this.tasks.registerDeadline('ORDER',{async assertCanExtend(tx,a,t){await authorize(tx,t.businessId,a);await active(tx,t);},async extend(tx,_a,t){await active(tx,t);}});
  this.tasks.registerLifecycle('ORDER',{
   async assertTransition(tx,a,t,action){await authorize(tx,t.businessId,a);const o=await tx.order.findUniqueOrThrow({where:{id:t.businessId}});
    if(action==='CANCELLED'&&(!await tx.taskBusinessSource.count({where:{taskId:t.id,status:'ACTIVE'}}))&&t.stage!=='SHIPMENT_PROCESS')return;
    if(action==='COMPLETED'&&t.stage==='SHIPMENT_PROCESS'&&o.actualHandoverAt)return;
    if(action==='SUSPENDED'&&t.stage==='SHIPMENT_PROCESS'&&(await pendingHandover(tx,o.id)||await shipmentBlocked(tx,o.id)))return;
    if(action==='CANCELLED'&&t.stage==='SHIPMENT_PROCESS'&&(o.actualHandoverAt||await pendingHandover(tx,o.id)||await shipmentBlocked(tx,o.id)||t.status==='SUSPENDED'))return;
    if(action==='RESUMED'&&t.stage==='SHIPMENT_PROCESS'){await active(tx,t);return;}
    if(action==='COMPLETED'&&t.stage!=='SHIPMENT_PROCESS'&&!await tx.taskBusinessSource.count({where:{taskId:t.id,status:'ACTIVE'}}))return;
    throw new TaskError('TASK_TRANSITION_BLOCKED');},async applyTransition(){/* 经办仅Task为权威，领域动作先提交在当前事务内。 */}
  });
  this.tasks.registerSources('ORDER',{
   async assertSource(tx,a,t,s){await authorize(tx,t.businessId,a);if(!(s.sourceType==='AFTER_SALE'?await afterSales.sourceBelongs(tx,t.businessId,s.sourceId):await sourceBelongs(tx,t.businessId,s.sourceType,s.sourceId)))throw new TaskError('TASK_SOURCE_CONFLICT');},
   async find(tx,t,s){const r=await tx.taskBusinessSource.findUnique({where:{taskId_sourceType_sourceId:{taskId:t.id,...s}}});return r?sourceRow(r):null;},
   async listActive(tx,t){return (await tx.taskBusinessSource.findMany({where:{taskId:t.id,status:'ACTIVE'},orderBy:{id:'asc'}})).map(sourceRow);},
   async add(tx,t,s,m){const r=await tx.taskBusinessSource.create({data:{taskId:t.id,...s,addCommandKey:m.commandKey,addReason:m.reason,addActorKey:taskActorKey(m.actor),createdAt:m.now}});
    await tx.taskBusinessSourceHistory.create({data:{sourceRecordId:r.id,action:'ACTIVE',commandKey:m.commandKey,actorKey:taskActorKey(m.actor),reason:m.reason,requestId:m.requestId,createdAt:m.now}});return sourceRow(r);},
   async finish(tx,t,s,status,m){const r=await tx.taskBusinessSource.update({where:{taskId_sourceType_sourceId:{taskId:t.id,sourceType:s.sourceType,sourceId:s.sourceId}},data:{status,endedAt:m.now,resolutionCommandKey:m.commandKey,resolutionReason:m.reason,resolutionActorKey:taskActorKey(m.actor),resolutionOutcome:m.outcome}});
    await tx.taskBusinessSourceHistory.create({data:{sourceRecordId:r.id,action:status,commandKey:m.commandKey,actorKey:taskActorKey(m.actor),reason:m.reason,requestId:m.requestId,createdAt:m.now}});return sourceRow(r);}
  });
  this.records.registerCommunication({scopeType:'ORDER',async lockAndAuthorize(tx,a,id){const o=await ownedOrder(tx,id,a);await tx.$queryRaw`SELECT id FROM customer WHERE id=${o.customerId}::uuid FOR UPDATE`;await tx.$queryRaw`SELECT id FROM "order" WHERE id=${id}::uuid FOR UPDATE`;if(a.subjectType==='EMPLOYEE')requireOrderPermission(a,'order.service.read');}});
  this.records.registerStateHistory({aggregateType:'ORDER',async lockAndValidate(tx,a,t){const o=await tx.order.findUnique({where:{id:t.aggregateId}});if(!o||(a.type==='CUSTOMER'&&a.id!==o.customerId))throw new RecordInputError();
   if(t.dimension==='fulfillment'){if(a.type==='CUSTOMER'||t.toState!==o.fulfillmentStage||!['UNCLAIMED','PREPARING','READY','HANDOVER_IN_PROGRESS','HANDOVER_UNCERTAIN','SHIPPED'].includes(t.toState))throw new RecordInputError();return;}
   if(t.dimension!=='status'||t.toState!==o.status||!(t.fromState===null&&o.status==='WAIT_PAYMENT'||t.fromState==='WAIT_PAYMENT'&&['WAIT_SHIPMENT','CLOSED'].includes(o.status)||t.fromState==='WAIT_SHIPMENT'&&o.status==='SHIPPED'||t.fromState==='SHIPPED'&&o.status==='COMPLETED'))throw new RecordInputError();}});
  this.files.register({ownerType:'ORDER_ITEM',async aggregate(tx,t){const i=await tx.orderItem.findUnique({where:{id:t.ownerId}});if(!i)throw new FileError('FILE_NOT_FOUND');return 'ORDER:'+i.orderId;},async authorize(tx,a,t,mode){if(mode==='BIND'||t.slot!=='snapshot'||t.audience!=='PUBLIC')throw new FileError('FILE_NOT_BINDABLE');const i=await tx.orderItem.findUnique({where:{id:t.ownerId},include:{order:true}});if(!i||(a.subjectType==='CUSTOMER'?i.order.customerId!==a.subjectId:!orderReader(a)))throw new FileError('FILE_NOT_FOUND');}});
  this.files.register({ownerType:'STOCK_INCIDENT',async aggregate(tx,t){if(!await tx.stockIncident.count({where:{id:t.ownerId}}))throw new FileError('FILE_NOT_FOUND');return 'STOCK_INCIDENT:'+t.ownerId;},async authorize(tx,a,t){if(a.subjectType!=='EMPLOYEE'||a.mustChangePassword||!a.effectivePermissions.includes('inventory.order-exception.manage')||t.audience!=='INTERNAL'||t.slot!=='evidence')throw new FileError('FILE_NOT_FOUND');if(!await tx.stockIncident.count({where:{id:t.ownerId}}))throw new FileError('FILE_NOT_FOUND');}});
  for(const ownerType of ['HANDOVER_VERIFICATION','SHIPMENT_EXCEPTION','SHIPMENT_EXCEPTION_DECISION','SHIPMENT_TRACKING_REVISION'] as const){
   const find=async(tx:Prisma.TransactionClient,id:string)=>ownerType==='HANDOVER_VERIFICATION'?tx.handoverVerification.findUnique({where:{id}}):ownerType==='SHIPMENT_EXCEPTION'?tx.shipmentException.findUnique({where:{id}}):ownerType==='SHIPMENT_EXCEPTION_DECISION'?tx.shipmentExceptionDecision.findUnique({where:{id}}).then(async d=>d?tx.shipmentException.findUnique({where:{id:d.exceptionId}}):null):tx.shipmentTrackingRevision.findUnique({where:{id}});
   this.files.register({ownerType,async aggregate(tx,t){const row=await find(tx,t.ownerId);if(!row)throw new FileError('FILE_NOT_FOUND');return 'ORDER:'+row.orderId;},async authorize(tx,a,t,mode){const row=await find(tx,t.ownerId);if(!row||a.subjectType!=='EMPLOYEE'||a.mustChangePassword||!orderReader(a)||t.audience!=='INTERNAL'||t.slot!=='evidence')throw new FileError('FILE_NOT_FOUND');if(mode==='BIND'&&!['shipment.handover','shipment.exception.manage','shipment.history.correct','shipment.tracking.correct','shipment.customer-confirm'].some(p=>a.effectivePermissions.includes(p)))throw new FileError('FILE_NOT_BINDABLE');}});
  }
  this.skus.register({domain:'order',async referenced(tx,ids){return (await tx.orderItem.count({where:{skuId:{in:ids}}}))>0;}});
  this.consumption.register({async read(tx,id){const [r]=await tx.$queryRaw<{amount:string}[]>`SELECT COALESCE(SUM(payable_cents),0)::text AS amount FROM "order" WHERE customer_id=${id}::uuid AND status='COMPLETED'`;return r!.amount;}});
 }
}
