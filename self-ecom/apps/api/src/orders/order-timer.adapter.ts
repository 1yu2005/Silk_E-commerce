// 作用：BR-05内核的真实PostgreSQL仓储；本期未交运，不启动自动收货计时。
import {Inject,Injectable,type OnModuleInit} from '@nestjs/common';
import {OrderTimerRepositories} from '../tasks/order-timer.service.js';
import {TaskError} from '../tasks/task.errors.js';
import type {OrderTimerState} from '../tasks/order-timer.rules.js';
import {requireOrderPermission} from './order-access.service.js';
@Injectable()
export class OrderTimerAdapter implements OnModuleInit {
 constructor(@Inject(OrderTimerRepositories)private readonly repositories:OrderTimerRepositories){}
 onModuleInit(){this.repositories.register({
  async assertAllowed(tx,a,id,c){const o=await tx.order.findUnique({where:{id}});if(!o)throw new TaskError('TASK_ENTRY_BLOCKED');
   if(c.action==='ADD_BLOCK'||c.action==='RELEASE_BLOCK'){
    if((a.subjectType==='CUSTOMER'&&!(c.action==='RELEASE_BLOCK'&&o.status==='CLOSED'&&o.customerId===a.subjectId))||c.source.sourceType!=='STOCK_EXCEPTION')throw new TaskError('ORDER_TIMER_BLOCKED');
    if(a.subjectType==='EMPLOYEE')requireOrderPermission(a,'inventory.order-exception.manage');
    const n=await tx.stockIncidentItem.count({where:{incidentId:c.source.sourceId,orderItem:{orderId:id}}});if(!n)throw new TaskError('ORDER_TIMER_BLOCKED');
    if(c.action==='RELEASE_BLOCK'&&o.status!=='CLOSED'&&await tx.stockIncident.count({where:{id:c.source.sourceId,status:'OPEN'}}))throw new TaskError('ORDER_TIMER_BLOCKED');
   }else if(c.action==='RECORD_HANDOVER'){
    requireOrderPermission(a,'shipment.handover');if(o.status!=='SHIPPED'||!o.actualHandoverAt||+o.actualHandoverAt!==+c.actualAt)throw new TaskError('ORDER_TIMER_BLOCKED');
   }else if(c.action==='FINISH'&&o.status!==c.terminal)throw new TaskError('ORDER_TIMER_BLOCKED');
  },
  async load(tx,id){const o=await tx.order.findUniqueOrThrow({where:{id},include:{blocks:true,pauses:{orderBy:{cycleNo:'asc'}},timerReceipts:true}});
   const status:OrderTimerState['status']=o.status==='REFUNDED'?'REFUNDED':o.status==='COMPLETED'?'COMPLETED':o.status==='SHIPPED'?'SHIPPED':o.fulfillmentStage==='HANDOVER_UNCERTAIN'?'HANDOVER_UNKNOWN':'UNSHIPPED';
   return {orderId:id,status,version:o.timerVersion,autoReceiptDays:o.autoReceiptDays,actualHandoverAt:o.actualHandoverAt,baseDueAt:o.autoReceiptBaseDueAt,dueAt:o.autoReceiptDueAt,updatedAt:o.updatedAt,
    blocks:o.blocks.map(b=>({sourceType:b.sourceType as OrderTimerState['blocks'][number]['sourceType'],sourceId:b.sourceId,active:b.active,createdAt:b.createdAt,releasedAt:b.releasedAt})),
    pauses:o.pauses.map(p=>({...p,status:p.status as OrderTimerState['pauses'][number]['status'],remainingMs:Number(p.remainingMs)})),commandReceipts:o.timerReceipts.map(r=>({key:r.key,signature:r.signature}))};
  },
  async save(tx,s,version,c){const changed=await tx.order.updateMany({where:{id:s.orderId,timerVersion:version},data:{timerVersion:s.version,actualHandoverAt:s.actualHandoverAt,autoReceiptBaseDueAt:s.baseDueAt,autoReceiptDueAt:s.dueAt,updatedAt:s.updatedAt}});if(changed.count!==1)throw new TaskError('VERSION_CONFLICT');
   for(const b of s.blocks){await tx.orderBlock.upsert({where:{orderId_type_sourceType_sourceId:{orderId:s.orderId,type:b.sourceType,sourceType:b.sourceType,sourceId:b.sourceId}},create:{orderId:s.orderId,type:b.sourceType,...b},update:{active:b.active,releasedAt:b.releasedAt,releaseCommandKey:b.active?null:c.commandKey}});}
   for(const p of s.pauses){await tx.timerPause.upsert({where:{orderId_cycleNo:{orderId:s.orderId,cycleNo:p.cycleNo}},create:{orderId:s.orderId,...p,remainingMs:BigInt(p.remainingMs)},update:{status:p.status,resumedAt:p.resumedAt,newDueAt:p.newDueAt,endReason:p.endReason}});}
   const receipt=s.commandReceipts.find(r=>r.key===c.commandKey);if(!receipt)throw new TaskError('ORDER_TIMER_STATE_INVALID');await tx.orderTimerReceipt.create({data:{orderId:s.orderId,...receipt}});
  }
 });}
}
