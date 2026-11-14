// 作用：正式接通售后Task、材料/寄回证据、沟通与状态历史；不注册测试实现。
import {Inject,Injectable,type OnModuleInit} from '@nestjs/common';
import type {Prisma,Task} from '@prisma/client';
import {TaskBusinessAdapters,type TaskCommandActor,type TaskLockResource} from '../tasks/task-business-adapters.js';
import {TaskError} from '../tasks/task.errors.js';
import {isTaskEligible} from '../tasks/task-access.service.js';
import {BusinessRecordAdapters} from '../records/business-record-adapters.js';
import {FileBusinessAdapters} from '../files/file-business-adapters.js';
import {FileError} from '../files/file.errors.js';
import {FulfillmentAfterSales} from '../orders/fulfillment-after-sales.js';
import {AfterSaleService} from './after-sale.service.js';
import {ownedSale,serviceReader,inspectionReader,salePermission} from './after-sale.access.js';
import {activeAfterSale,terminalStatuses} from './after-sale.rules.js';
import {SkuReferences} from '../catalog/sku-reference.service.js';
export async function afterSaleSkuReferenced(tx:Prisma.TransactionClient,skuIds:string[]){
 const items=await tx.orderItem.findMany({where:{skuId:{in:skuIds}},select:{orderId:true}});
 return await tx.afterSale.count({where:{orderId:{in:items.map(i=>i.orderId)}}})>0;
}
@Injectable()
export class AfterSaleAdapters implements OnModuleInit{
 constructor(@Inject(TaskBusinessAdapters)private readonly tasks:TaskBusinessAdapters,@Inject(FileBusinessAdapters)private readonly files:FileBusinessAdapters,@Inject(BusinessRecordAdapters)private readonly records:BusinessRecordAdapters,@Inject(FulfillmentAfterSales)private readonly fulfillment:FulfillmentAfterSales,@Inject(AfterSaleService)private readonly service:AfterSaleService,@Inject(SkuReferences)private readonly skus:SkuReferences){}
 onModuleInit(){
  this.skus.register({domain:'after-sale',referenced:afterSaleSkuReferenced});
  const authorize=async(tx:Prisma.TransactionClient,id:string,a:TaskCommandActor)=>{await ownedSale(tx,id,a);};
  const stageActive=async(tx:Prisma.TransactionClient,t:Task)=>{const s=await tx.afterSale.findUniqueOrThrow({where:{id:t.businessId}});const allowed=t.stage==='AFTER_SALE_REVIEW'?s.status==='PENDING_REVIEW'||s.status==='WAIT_FULFILLMENT_CHECK'&&t.entryKey.startsWith('handover:'):t.stage==='SUPPLEMENT_FOLLOW'?s.status==='WAIT_SUPPLEMENT':t.stage==='RETURN_FOLLOW'?['WAIT_RETURN','WAIT_RECEIPT'].includes(s.status):t.stage==='RETURN_RECEIVE'?s.status==='WAIT_RECEIPT':t.stage==='REFUND_PROCESS'?['WAIT_REFUND','REFUND_FAILED'].includes(s.status):false;if(!allowed)throw new TaskError('TASK_ENTRY_BLOCKED');return s;};
  this.tasks.registerLocker('AFTER_SALE',async(tx,id)=>{const rows=await tx.$queryRaw`SELECT id FROM after_sale WHERE id=${id}::uuid FOR UPDATE`;if(!Array.isArray(rows)||!rows.length)throw new TaskError('TASK_ENTRY_BLOCKED');});
  this.tasks.registerBusiness('AFTER_SALE',{
   async planLocks(tx,r){const s=await tx.afterSale.findUnique({where:{id:r.businessId}});if(!s)throw new TaskError('TASK_NOT_FOUND');const items=await tx.orderItem.findMany({where:{orderId:s.orderId}});const locks:TaskLockResource[]=[{kind:'CUSTOMER',id:s.customerId},{kind:'ORDER',id:s.orderId},...items.flatMap(i=>[{kind:'PRODUCT' as const,id:i.productId},{kind:'SKU_STOCK' as const,id:i.skuId}]),{kind:'AFTER_SALE',id:s.id}];return locks;},
   authorize:(tx,r,a)=>authorize(tx,r.businessId,a),
   async resolveEntry(tx,e,a,current){await authorize(tx,e.businessId,a);if(current)throw new TaskError('TASK_STAGE_ACTIVE');const s=await tx.afterSale.findUniqueOrThrow({where:{id:e.businessId}});await stageActive(tx,{businessId:s.id,stage:e.stage,entryKey:e.entryKey} as Task);return {startedAt:s.updatedAt};}
  });
  this.tasks.registerAccess('AFTER_SALE',{
   async visibleBusinessIds(tx,a){if(!serviceReader(a)&&!inspectionReader(a))return [];return (await tx.afterSale.findMany({select:{id:true}})).map(s=>s.id);},
   async describe(tx,a,t){await authorize(tx,t.businessId,a);const s=await tx.afterSale.findUniqueOrThrow({where:{id:t.businessId}});let valid=true;try{await stageActive(tx,t);}catch{valid=false;}return {number:s.number,label:'售后处理',detailPath:'/after-sales/'+s.id,canClaim:valid&&t.status==='OPEN'&&isTaskEligible(a,t),canRelease:valid&&t.status==='CLAIMED'&&t.assigneeId===a.subjectId,canReadHistoryReasons:serviceReader(a),canTransfer:valid,canExtendDeadline:valid&&!!t.dueAt};},
   async assertClaim(tx,a,t){await authorize(tx,t.businessId,a);await stageActive(tx,t);},async assertRelease(tx,a,t){await authorize(tx,t.businessId,a);await stageActive(tx,t);}
  });
  this.tasks.registerHandoff('AFTER_SALE',{async transfer(tx,a,_target,t){await authorize(tx,t.businessId,a);await stageActive(tx,t);},async qualificationLost(tx,_id,t){await ownedSale(tx,t.businessId,{subjectType:'SYSTEM'});}});
  this.tasks.registerDeadline('AFTER_SALE',{
   async assertCanExtend(tx,a,t){salePermission(a,'deadline.extend');await stageActive(tx,t);if(!['AFTER_SALE_REVIEW','SUPPLEMENT_FOLLOW','RETURN_FOLLOW','REFUND_PROCESS'].includes(t.stage))throw new TaskError('TASK_DEADLINE_BLOCKED');},
   async extend(tx,_a,t,dueAt){await stageActive(tx,t);if(t.stage==='SUPPLEMENT_FOLLOW')await tx.afterSaleSupplementRequest.updateMany({where:{afterSaleId:t.businessId,followTaskId:t.id,respondedAt:null,closedAt:null},data:{dueAt}});if(t.stage==='RETURN_FOLLOW')await tx.afterSale.update({where:{id:t.businessId},data:{returnDueAt:dueAt,version:{increment:1}}});}
  });
  this.tasks.registerLifecycle('AFTER_SALE',{
   async assertTransition(tx,a,t,action){const s=await ownedSale(tx,t.businessId,a);if(action==='CANCELLED'&&terminalStatuses.includes(s.status))return;if(action==='COMPLETED'){if(t.stage==='AFTER_SALE_REVIEW'&&s.status!=='PENDING_REVIEW')return;if(t.stage==='SUPPLEMENT_FOLLOW'&&s.status!=='WAIT_SUPPLEMENT')return;if(t.stage==='RETURN_FOLLOW'&&await tx.returnDispatchVerification.count({where:{afterSaleId:s.id,outcome:'IN_TRANSIT'}}))return;}throw new TaskError('TASK_TRANSITION_BLOCKED');},async applyTransition(){}
  });
  this.fulfillment.register({
   hasActive:(tx,orderId)=>tx.afterSale.count({where:{orderId,...activeAfterSale}}).then(n=>n>0),
   sourceBelongs:(tx,orderId,id)=>tx.afterSale.count({where:{id,orderId}}).then(n=>n>0),
   sourceActive:(tx,orderId,id)=>tx.afterSale.count({where:{id,orderId,...activeAfterSale}}).then(n=>n>0),
   physicalCheckStartedAt:async(tx,orderId)=>{const s=await tx.afterSale.findFirst({where:{orderId,status:'WAIT_FULFILLMENT_CHECK'},orderBy:{createdAt:'asc'}});return s?.updatedAt??null;},
   handoverRecorded:(tx,orderId,requestId)=>this.service.handoverRecorded(tx,orderId,requestId)
  });
  this.records.registerCommunication({scopeType:'AFTER_SALE',async lockAndAuthorize(tx,a,id){const s=await ownedSale(tx,id,a);await tx.$queryRaw`SELECT id FROM customer WHERE id=${s.customerId}::uuid FOR UPDATE`;await tx.$queryRaw`SELECT id FROM "order" WHERE id=${s.orderId}::uuid FOR UPDATE`;await tx.$queryRaw`SELECT id FROM after_sale WHERE id=${id}::uuid FOR UPDATE`;if(a.subjectType==='EMPLOYEE')salePermission(a,'after-sale.service.read');}});
  this.records.registerStateHistory({aggregateType:'AFTER_SALE',async lockAndValidate(tx,a,t){const s=await tx.afterSale.findUnique({where:{id:t.aggregateId}});if(!s||t.dimension!=='status'||s.status!==t.toState||a.type==='CUSTOMER'&&a.id!==s.customerId)throw new TaskError('TASK_ENTRY_BLOCKED');}});
  for(const ownerType of ['AFTER_SALE_MATERIAL','AFTER_SALE_RETURN_LOGISTICS','AFTER_SALE_RETURN_VERIFICATION'] as const){
   const find=async(tx:Prisma.TransactionClient,id:string)=>{if(ownerType==='AFTER_SALE_MATERIAL')return (await tx.afterSaleMaterialVersion.findUnique({where:{id}}))?.afterSaleId;if(ownerType==='AFTER_SALE_RETURN_VERIFICATION')return (await tx.returnDispatchVerification.findUnique({where:{id}}))?.afterSaleId;const r=await tx.returnLogisticsRevision.findUnique({where:{id}});return r?(await tx.returnParcel.findUnique({where:{id:r.parcelId}}))?.afterSaleId:undefined;};
   this.files.register({ownerType,async aggregate(tx,t){const id=await find(tx,t.ownerId);if(!id)throw new FileError('FILE_NOT_FOUND');return 'AFTER_SALE:'+id;},async authorize(tx,a,t,mode){const id=await find(tx,t.ownerId);if(!id)throw new FileError('FILE_NOT_FOUND');let s;try{s=await ownedSale(tx,id,a);}catch{throw new FileError('FILE_NOT_FOUND');}const internal=ownerType==='AFTER_SALE_RETURN_VERIFICATION';if(internal?(!serviceReader(a)||t.audience!=='INTERNAL'):t.audience!=='CUSTOMER_VISIBLE')throw new FileError('FILE_NOT_FOUND');if(!internal&&a.subjectType==='EMPLOYEE'&&!serviceReader(a)&&!(ownerType==='AFTER_SALE_RETURN_LOGISTICS'&&inspectionReader(a)))throw new FileError('FILE_NOT_FOUND');if(t.slot!=='evidence')throw new FileError('FILE_NOT_FOUND');if(mode==='BIND'){if(terminalStatuses.includes(s.status))throw new FileError('FILE_NOT_BINDABLE');if(internal){salePermission(a,'after-sale.return.follow');const task=await tx.task.findFirst({where:{businessType:'AFTER_SALE',businessId:s.id,stage:'RETURN_FOLLOW',status:'CLAIMED',assigneeId:a.subjectId}});if(!task)throw new FileError('FILE_NOT_BINDABLE');}else if(a.subjectType!=='CUSTOMER')throw new FileError('FILE_NOT_BINDABLE');}}});
  }
 }
}
