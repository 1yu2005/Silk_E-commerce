// 作用：真实保管安排的任务/锁/文件解析器；售后终态不抹除实物执行义务。
import {Inject,Injectable,type OnModuleInit} from '@nestjs/common';
import type {Prisma,Task} from '@prisma/client';
import {TaskBusinessAdapters,type TaskCommandActor} from '../tasks/task-business-adapters.js';
import {TaskError} from '../tasks/task.errors.js';
import {isTaskEligible} from '../tasks/task-access.service.js';
import {FileBusinessAdapters} from '../files/file-business-adapters.js';
import {FileError} from '../files/file.errors.js';
import {salePermission,inspectionReader} from '../after-sales/after-sale.access.js';
import {DisputeError} from './dispute.rules.js';
@Injectable()
export class CustodyAdapters implements OnModuleInit{
 constructor(@Inject(TaskBusinessAdapters)private readonly tasks:TaskBusinessAdapters,@Inject(FileBusinessAdapters)private readonly files:FileBusinessAdapters){}
 onModuleInit(){
  const find=async(tx:Prisma.TransactionClient,id:string)=>{const a=await tx.custodyArrangement.findUnique({where:{id}});if(!a)throw new TaskError('TASK_NOT_FOUND');return {a,s:await tx.afterSale.findUniqueOrThrow({where:{id:a.afterSaleId}})};};
  const authorize=async(tx:Prisma.TransactionClient,id:string,actor:TaskCommandActor)=>{const v=await find(tx,id);if(actor.subjectType!=='SYSTEM'&&!inspectionReader(actor))throw new DisputeError('DISPUTE_NOT_FOUND');return v;};
  const valid=(status:string,entryKey:string)=>status!=='COMPLETED'||entryKey.startsWith('correction:');
  const current=async(tx:Prisma.TransactionClient,t:Pick<Task,'businessId'|'stage'|'entryKey'>)=>{const v=await find(tx,t.businessId);if(t.stage!=='CUSTODY_EXECUTE'||!valid(v.a.status,t.entryKey))throw new TaskError('TASK_ENTRY_BLOCKED');return v;};
  this.tasks.registerLocker('CUSTODY_ARRANGEMENT',async(tx,id)=>{if(!(await tx.$queryRaw<{id:string}[]>`SELECT id FROM custody_arrangement WHERE id=${id}::uuid FOR UPDATE`).length)throw new TaskError('TASK_ENTRY_BLOCKED');});
  this.tasks.registerBusiness('CUSTODY_ARRANGEMENT',{
   async planLocks(tx,r){const v=await find(tx,r.businessId);return [{kind:'CUSTOMER',id:v.s.customerId},{kind:'ORDER',id:v.s.orderId},{kind:'AFTER_SALE',id:v.s.id},{kind:'CUSTODY_ARRANGEMENT',id:r.businessId}];},
   authorize:(tx,r,a)=>authorize(tx,r.businessId,a).then(()=>{}),
   async resolveEntry(tx,e,a,active){await authorize(tx,e.businessId,a);if(active)throw new TaskError('TASK_STAGE_ACTIVE');const v=await current(tx,e);return {startedAt:v.a.createdAt};}
  });
  this.tasks.registerAccess('CUSTODY_ARRANGEMENT',{
   async visibleBusinessIds(tx,a){if(!inspectionReader(a))return [];return (await tx.custodyArrangement.findMany({select:{id:true}})).map(x=>x.id);},
   async describe(tx,a,t){const v=await authorize(tx,t.businessId,a),current=valid(v.a.status,t.entryKey);return {number:v.s.number,label:'结案后物品保管与寄还',detailPath:'/custody-arrangements/'+t.businessId,canClaim:current&&t.status==='OPEN'&&isTaskEligible(a,t),canRelease:current&&t.status==='CLAIMED'&&t.assigneeId===a.subjectId,canReadHistoryReasons:true,canTransfer:current,canExtendDeadline:false};},
   async assertClaim(tx,a,t){await authorize(tx,t.businessId,a);await current(tx,t);},async assertRelease(tx,a,t){await authorize(tx,t.businessId,a);await current(tx,t);}
  });
  this.tasks.registerHandoff('CUSTODY_ARRANGEMENT',{async transfer(tx,a,_target,t){await authorize(tx,t.businessId,a);await current(tx,t);},async qualificationLost(tx,_id,t){await find(tx,t.businessId);}});
  this.tasks.registerLifecycle('CUSTODY_ARRANGEMENT',{async assertTransition(tx,a,t,action){await authorize(tx,t.businessId,a);const v=await find(tx,t.businessId);if(action==='COMPLETED'&&v.a.status==='COMPLETED')return;throw new TaskError('TASK_TRANSITION_BLOCKED');},async applyTransition(){}});
  for(const ownerType of ['DISPUTE_DECISION','CUSTODY_EVENT'] as const){const locate=async(tx:Prisma.TransactionClient,id:string)=>{if(ownerType==='DISPUTE_DECISION'){const d=await tx.disputeDecision.findUnique({where:{id}});return d?{afterSaleId:d.afterSaleId,actorId:d.decidedById,arrangementId:null}:null;}const e=await tx.custodyEvent.findUnique({where:{id}}),a=e?await tx.custodyArrangement.findUnique({where:{id:e.arrangementId}}):null;return e&&a?{afterSaleId:a.afterSaleId,actorId:e.actorEmployeeId,arrangementId:a.id}:null;};this.files.register({ownerType,async aggregate(tx,t){const v=await locate(tx,t.ownerId);if(!v)throw new FileError('FILE_NOT_FOUND');return 'AFTER_SALE:'+v.afterSaleId;},async authorize(tx,a,t,mode){const v=await locate(tx,t.ownerId);if(!v||a.subjectType!=='EMPLOYEE'||a.mustChangePassword||t.slot!=='evidence'||t.audience!=='INTERNAL')throw new FileError('FILE_NOT_FOUND');if(ownerType==='DISPUTE_DECISION'){if(a.role!=='SUPER_ADMIN'||!a.effectivePermissions.includes('after-sale.dispute.decide'))throw new FileError('FILE_NOT_FOUND');}else if(!inspectionReader(a))throw new FileError('FILE_NOT_FOUND');if(mode==='BIND'){if(a.subjectId!==v.actorId)throw new FileError('FILE_NOT_BINDABLE');salePermission(a,ownerType==='DISPUTE_DECISION'?'after-sale.dispute.decide':'after-sale.inspection.confirm');if(ownerType==='CUSTODY_EVENT'&&!await tx.task.count({where:{businessType:'CUSTODY_ARRANGEMENT',businessId:v.arrangementId!,stage:'CUSTODY_EXECUTE',status:'CLAIMED',assigneeId:a.subjectId}}))throw new FileError('FILE_NOT_BINDABLE');}}});}
 }
}
