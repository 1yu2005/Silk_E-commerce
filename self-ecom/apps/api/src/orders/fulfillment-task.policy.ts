// 作用：所有任务入口共用履约领域守卫；经办只在Task保存，回池不抹掉未决交运。
import {Inject,Injectable} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import type {Prisma,Task} from '@prisma/client';
import {TaskError} from '../tasks/task.errors.js';
import type {TaskBusinessHandoff,TaskEmployee} from '../tasks/task-business-adapters.js';
import {AuditService} from '../audit/audit.service.js';
import {StateHistoryService} from '../records/state-history.service.js';
import {FulfillmentAfterSales} from './fulfillment-after-sales.js';
import {checkWholeOrder,pendingHandover,shipmentBlocked,validPacking} from './fulfillment.rules.js';
@Injectable()
export class FulfillmentTaskPolicy {
 constructor(@Inject(FulfillmentAfterSales)private readonly afterSales:FulfillmentAfterSales,@Inject(StateHistoryService)private readonly history:StateHistoryService,@Inject(AuditService)private readonly audit:AuditService){}
 async active(tx:Prisma.TransactionClient,t:Task){const o=await tx.order.findUniqueOrThrow({where:{id:t.businessId}});
  if(t.stage==='SHIPMENT_PROCESS'){
   if(o.status!=='WAIT_SHIPMENT'||await pendingHandover(tx,o.id)||await shipmentBlocked(tx,o.id)||await this.afterSales.hasActive(tx,o.id))throw new TaskError('TASK_ENTRY_BLOCKED');
  }else if(!await tx.taskBusinessSource.count({where:{taskId:t.id,status:'ACTIVE'}}))throw new TaskError('TASK_ENTRY_BLOCKED');return o;
 }
 async release(tx:Prisma.TransactionClient,a:TaskEmployee,t:Task){const o=await this.active(tx,t);if(t.stage==='SHIPMENT_PROCESS'){const p=await validPacking(tx,o);if(!p||p.checkedById!==a.subjectId||+p.createdAt<+t.updatedAt)throw new TaskError('TASK_ENTRY_BLOCKED');}}
 async claimed(tx:Prisma.TransactionClient,a:TaskEmployee,t:Task,requestId:string,now:Date){if(t.stage!=='SHIPMENT_PROCESS')return;const before=await this.active(tx,t);
  const stage=before.fulfillmentStage==='READY'&&await validPacking(tx,before)?'READY':'PREPARING';
  await tx.fulfillment.upsert({where:{orderId:before.id},create:{orderId:before.id,createdAt:now,updatedAt:now},update:{}});
  const o=await tx.order.update({where:{id:before.id},data:{fulfillmentStage:stage,version:{increment:1},updatedAt:now}});
  if(before.fulfillmentStage!==stage)await this.history.appendStateHistory(tx,{type:'EMPLOYEE',id:a.subjectId},{aggregateType:'ORDER',aggregateId:o.id,dimension:'fulfillment',commandKey:'claim:'+t.id+':'+t.version,fromState:before.fulfillmentStage,toState:stage,requestId,reason:'领取发货任务'});
  await this.audit.appendAudit(tx,{actor:{type:'EMPLOYEE',id:a.subjectId},action:'order.fulfillment',targetId:o.id,requestId,reason:'领取发货任务',after:{orderStatus:o.status,orderVersion:o.version,fulfillmentStage:stage,fulfillmentAction:'CLAIM'}});
 }
 transfer:TaskBusinessHandoff['transfer']=async(tx,a,_target,t,evidence)=>{const o=await this.active(tx,t);if(t.stage!=='SHIPMENT_PROCESS')return;
  if(!evidence||evidence.physicalVersion!==o.stockPhysicalVersion||!evidence.goodsLocation.trim())throw new TaskError('TASK_ENTRY_BLOCKED');
  const items=checkWholeOrder(await tx.orderItem.findMany({where:{orderId:o.id}}),evidence.items);
  const f=await tx.fulfillment.upsert({where:{orderId:o.id},create:{orderId:o.id},update:{}});
  // 交接本身移动实物，递增版本并追加全量核对；旧核对和旧齐货意见由版本自动失效。
  const p=await tx.packingCheck.create({data:{orderId:o.id,fulfillmentId:f.id,checkedPhysicalVersion:o.stockPhysicalVersion+1,checkedItems:items,goodsLocation:evidence.goodsLocation.trim(),checkedById:a.subjectId,commandKey:randomUUID(),createdAt:evidence.now}});
  await tx.fulfillment.update({where:{id:f.id},data:{currentPackingCheckId:p.id,version:{increment:1},updatedAt:evidence.now}});
  const shipment=await tx.shipment.findUnique({where:{orderId:o.id}}),stage=shipment?'READY':'PREPARING';
  await tx.order.update({where:{id:o.id},data:{stockPhysicalVersion:{increment:1},fulfillmentStage:stage,version:{increment:1},updatedAt:evidence.now}});
  if(o.fulfillmentStage!==stage)await this.history.appendStateHistory(tx,{type:'EMPLOYEE',id:a.subjectId},{aggregateType:'ORDER',aggregateId:o.id,dimension:'fulfillment',commandKey:'transfer:'+t.id+':'+t.version,fromState:o.fulfillmentStage,toState:stage,requestId:evidence.requestId,reason:'转交时全量核对实物'});
  await this.audit.appendAudit(tx,{actor:{type:'EMPLOYEE',id:a.subjectId},action:'order.fulfillment',targetId:o.id,requestId:evidence.requestId,reason:'转交时核对整单实物与货物位置',after:{fulfillmentAction:'PHYSICAL_CHECK',sourceId:p.id}});
 };
}
