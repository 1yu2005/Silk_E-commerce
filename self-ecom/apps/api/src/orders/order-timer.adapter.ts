// 作用：BR-05内核的真实PostgreSQL仓储；真实交运后按来源暂停/恢复，并固化首次规则。
import {Inject,Injectable,type OnModuleInit} from '@nestjs/common';
import {OrderTimerRepositories} from '../tasks/order-timer.service.js';
import {TaskError} from '../tasks/task.errors.js';
import type {OrderTimerState} from '../tasks/order-timer.rules.js';
import {requireOrderPermission} from './order-access.service.js';
import {sourceBelongs} from './fulfillment.rules.js';
import {FulfillmentAfterSales} from './fulfillment-after-sales.js';
@Injectable()
export class OrderTimerAdapter implements OnModuleInit {
 constructor(@Inject(OrderTimerRepositories)private readonly repositories:OrderTimerRepositories,@Inject(FulfillmentAfterSales)private readonly afterSales:FulfillmentAfterSales){}
 onModuleInit(){const afterSales=this.afterSales;this.repositories.register({
  async assertAllowed(tx,a,id,c){const o=await tx.order.findUnique({where:{id}});if(!o)throw new TaskError('TASK_ENTRY_BLOCKED');
   if(c.action==='ADD_BLOCK'||c.action==='RELEASE_BLOCK'){
    if(a.subjectType==='CUSTOMER'&&!(o.customerId===a.subjectId&&(c.source.sourceType==='AFTER_SALE'&&await afterSales.sourceBelongs(tx,id,c.source.sourceId)||c.source.sourceType==='HANDOVER_UNCERTAIN'&&c.action==='ADD_BLOCK'&&await afterSales.hasActive(tx,id)&&await tx.handoverAttempt.count({where:{id:c.source.sourceId,orderId:id,status:'UNCERTAIN'}})>0||c.source.sourceType==='STOCK_EXCEPTION'&&c.action==='RELEASE_BLOCK'&&o.status==='CLOSED')))throw new TaskError('ORDER_TIMER_BLOCKED');
    const type=c.source.sourceType;
    if(a.subjectType==='EMPLOYEE'){
     const allowed=type==='STOCK_EXCEPTION'?['inventory.order-exception.manage']:type==='HANDOVER_UNCERTAIN'?(c.action==='ADD_BLOCK'?['shipment.handover','inventory.order-exception.manage','shipment.exception.manage']:['shipment.handover']):type==='SHIPMENT_EXCEPTION'?(c.action==='RELEASE_BLOCK'?['shipment.exception.manage','shipment.customer-confirm','shipment.handover']:['shipment.exception.manage']):['after-sale.service.read'];
     requireOrderPermission(a,allowed.find(p=>a.effectivePermissions.includes(p))??allowed[0]!);
    }
    if(!(type==='AFTER_SALE'?await afterSales.sourceBelongs(tx,id,c.source.sourceId):await sourceBelongs(tx,id,type,c.source.sourceId)))throw new TaskError('ORDER_TIMER_BLOCKED');
    if(c.action==='RELEASE_BLOCK'&&o.status!=='CLOSED'){
     const unresolved=type==='STOCK_EXCEPTION'?await tx.stockIncident.count({where:{id:c.source.sourceId,status:'OPEN'}}):type==='SHIPMENT_EXCEPTION'?await tx.shipmentException.count({where:{id:c.source.sourceId,status:'OPEN'}}):type==='HANDOVER_UNCERTAIN'?await tx.handoverAttempt.count({where:{id:c.source.sourceId,status:{in:['IN_PROGRESS','UNCERTAIN']}}}):await afterSales.sourceActive(tx,id,c.source.sourceId);
     if(unresolved)throw new TaskError('ORDER_TIMER_BLOCKED');
    }
   }else if(c.action==='RECORD_HANDOVER'){
    requireOrderPermission(a,'shipment.handover');const s=await tx.shipment.findUnique({where:{orderId:id}});if(!['WAIT_SHIPMENT','SHIPPED'].includes(o.status)||s?.status!=='CONFIRMED'||!s.actualHandoverAt||+s.actualHandoverAt!==+c.actualAt)throw new TaskError('ORDER_TIMER_BLOCKED');
   }else if(c.action==='FINISH'&&o.status!==c.terminal){
    if(c.terminal!=='COMPLETED'||o.status!=='SHIPPED'||(a.subjectType==='CUSTOMER'&&a.subjectId!==o.customerId)||await tx.orderBlock.count({where:{orderId:id,active:true,blocksReceipt:true}})||await afterSales.hasActive(tx,id))throw new TaskError('ORDER_TIMER_BLOCKED');
   }
  },
  async load(tx,id,c){const o=await tx.order.findUniqueOrThrow({where:{id},include:{blocks:true,pauses:{orderBy:{cycleNo:'asc'}},timerReceipts:true}});
   const status:OrderTimerState['status']=o.status==='REFUNDED'?'REFUNDED':o.status==='COMPLETED'?'COMPLETED':o.status==='SHIPPED'?'SHIPPED':o.fulfillmentStage==='HANDOVER_UNCERTAIN'?'HANDOVER_UNKNOWN':'UNSHIPPED';
   return {orderId:id,status:c?.action==='FINISH'&&(o.autoReceiptDueAt||o.pauses.some(p=>p.status==='ACTIVE'))?'SHIPPED':status,version:o.timerVersion,autoReceiptDays:o.autoReceiptDays,actualHandoverAt:o.actualHandoverAt,baseDueAt:o.autoReceiptBaseDueAt,dueAt:o.autoReceiptDueAt,updatedAt:o.updatedAt,
    blocks:o.blocks.map(b=>({sourceType:b.sourceType as OrderTimerState['blocks'][number]['sourceType'],sourceId:b.sourceId,active:b.active,blocksShipment:b.blocksShipment,blocksReceipt:b.blocksReceipt,createdAt:b.createdAt,releasedAt:b.releasedAt})),
    pauses:o.pauses.map(p=>({...p,status:p.status as OrderTimerState['pauses'][number]['status'],remainingMs:Number(p.remainingMs)})),commandReceipts:o.timerReceipts.map(r=>({key:r.key,signature:r.signature}))};
  },
  async save(tx,s,version,c){let snapshot; if(c.action==='RECORD_HANDOVER'){const o=await tx.order.findUniqueOrThrow({where:{id:s.orderId}});if(!o.receiptSettingVersionId)throw new TaskError('ORDER_TIMER_BLOCKED');const setting=await tx.storeSettingVersion.findUniqueOrThrow({where:{id:o.receiptSettingVersionId}});snapshot={unit:'NATURAL_DAY',amount:setting.autoReceiptDays,versionNumber:setting.versionNumber,timeZone:'Asia/Shanghai',algorithmVersion:1};}
   const changed=await tx.order.updateMany({where:{id:s.orderId,timerVersion:version},data:{timerVersion:s.version,actualHandoverAt:s.actualHandoverAt,autoReceiptBaseDueAt:s.baseDueAt,autoReceiptDueAt:s.dueAt,updatedAt:s.updatedAt,...(c.action==='RECORD_HANDOVER'?{status:'SHIPPED',fulfillmentStage:'SHIPPED',receiptRuleSnapshot:snapshot}: {})}});if(changed.count!==1)throw new TaskError('VERSION_CONFLICT');
   for(const b of s.blocks){await tx.orderBlock.upsert({where:{orderId_type_sourceType_sourceId:{orderId:s.orderId,type:b.sourceType,sourceType:b.sourceType,sourceId:b.sourceId}},create:{orderId:s.orderId,type:b.sourceType,...b,sourceAfterSaleId:b.sourceType==='AFTER_SALE'?b.sourceId:null},update:{active:b.active,releasedAt:b.releasedAt,releaseCommandKey:b.active?null:c.commandKey}});}
   for(const p of s.pauses){const pause=await tx.timerPause.upsert({where:{orderId_cycleNo:{orderId:s.orderId,cycleNo:p.cycleNo}},create:{orderId:s.orderId,...p,remainingMs:BigInt(p.remainingMs)},update:{status:p.status,resumedAt:p.resumedAt,newDueAt:p.newDueAt,endReason:p.endReason}});
    if(p.status==='ACTIVE'){const blocks=await tx.orderBlock.findMany({where:{orderId:s.orderId,active:true,blocksReceipt:true}});await tx.timerPauseBlock.createMany({data:blocks.map(b=>({pauseId:pause.id,blockId:b.id,createdAt:s.updatedAt})),skipDuplicates:true});}}
   const receipt=s.commandReceipts.find(r=>r.key===c.commandKey);if(!receipt)throw new TaskError('ORDER_TIMER_STATE_INVALID');await tx.orderTimerReceipt.create({data:{orderId:s.orderId,...receipt}});
  }
 });}
}
