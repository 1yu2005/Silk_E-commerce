// 作用：将线下工单接入真实任务池、经办资格、锁序和私有文件；未使用测试适配器。
import {Inject,Injectable,type OnModuleInit} from '@nestjs/common';
import type {OfflineCase,Prisma,Task} from '@prisma/client';
import {TaskBusinessAdapters,type TaskCommandActor,type TaskLockResource} from '../tasks/task-business-adapters.js';
import {isTaskEligible} from '../tasks/task-access.service.js';
import {TaskError} from '../tasks/task.errors.js';
import {FileBusinessAdapters} from '../files/file-business-adapters.js';
import {FileError} from '../files/file.errors.js';
import {offlinePermission,ownedOffline} from './offline-case.service.js';
import {offlineTerminal} from './offline-case.rules.js';

function stageActive(row:OfflineCase,task:Pick<Task,'stage'|'entryKey'>){
 if(offlineTerminal(row.status)||task.stage!=='OFFLINE_FOLLOW'&&task.stage!=='ADMIN_DISPUTE'||task.stage==='ADMIN_DISPUTE'&&(!row.adminRequestEventId||row.adminDecisionEventId||task.entryKey!=='admin:'+row.adminRequestEventId))throw new TaskError('TASK_ENTRY_BLOCKED');
}
@Injectable()
export class OfflineCaseAdapters implements OnModuleInit{
 constructor(@Inject(TaskBusinessAdapters)private readonly tasks:TaskBusinessAdapters,@Inject(FileBusinessAdapters)private readonly files:FileBusinessAdapters){}
 onModuleInit(){
  this.tasks.registerLocker('OFFLINE_CASE',async(tx,id)=>{const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM offline_case WHERE id=${id}::uuid FOR UPDATE`;if(!rows.length)throw new TaskError('TASK_NOT_FOUND');});
  const authorize=async(tx:Prisma.TransactionClient,id:string,actor:TaskCommandActor,intent?:'OVERDUE_SCAN')=>{
   if(actor.subjectType==='SYSTEM'&&intent==='OVERDUE_SCAN'){if(!await tx.offlineCase.count({where:{id}}))throw new TaskError('TASK_NOT_FOUND');return;}
   await ownedOffline(tx,id,actor);
  };
  this.tasks.registerBusiness('OFFLINE_CASE',{
   async relatedReferences(tx,r){const row=await tx.offlineCase.findUnique({where:{id:r.businessId}});if(!row)throw new TaskError('TASK_NOT_FOUND');return [{businessType:'ORDER',businessId:row.orderId}];},
   async planLocks(tx,r){const row=await tx.offlineCase.findUnique({where:{id:r.businessId}});if(!row)throw new TaskError('TASK_NOT_FOUND');const locks:TaskLockResource[]=[{kind:'CUSTOMER',id:row.customerId},{kind:'ORDER',id:row.orderId},{kind:'OFFLINE_CASE',id:row.id}];return locks;},
   authorize:(tx,r,a,intent)=>authorize(tx,r.businessId,a,intent),
   async resolveEntry(tx,e,a,current){await authorize(tx,e.businessId,a);if(current)throw new TaskError('TASK_STAGE_ACTIVE');const row=await tx.offlineCase.findUniqueOrThrow({where:{id:e.businessId}});stageActive(row,e);if(e.stage==='OFFLINE_FOLLOW'&&!e.entryKey.startsWith('create:'))throw new TaskError('TASK_ENTRY_BLOCKED');if(e.stage==='ADMIN_DISPUTE'){const request=await tx.offlineCaseEvent.findUnique({where:{id:row.adminRequestEventId!}});if(!request||request.adminDecision!=='REQUEST')throw new TaskError('TASK_ENTRY_BLOCKED');return {startedAt:request.createdAt};}return {startedAt:row.createdAt};}
  });
  this.tasks.registerAccess('OFFLINE_CASE',{
   async visibleBusinessIds(tx,a){try{offlinePermission(a);}catch{return [];}return (await tx.offlineCase.findMany({select:{id:true}})).map(row=>row.id);},
   async describe(tx,a,t){await authorize(tx,t.businessId,a);const row=await tx.offlineCase.findUniqueOrThrow({where:{id:t.businessId}});let active=true;try{stageActive(row,t);}catch{active=false;}return {number:row.caseNo,label:'线下处理工单',detailPath:'/offline-cases/'+row.id,canClaim:active&&t.status==='OPEN'&&isTaskEligible(a,t),canRelease:active&&t.status==='CLAIMED'&&t.assigneeId===a.subjectId,canTransfer:active,canExtendDeadline:false,canReadHistoryReasons:true};},
   async assertClaim(tx,a,t){await authorize(tx,t.businessId,a);stageActive(await tx.offlineCase.findUniqueOrThrow({where:{id:t.businessId}}),t);},
   async assertRelease(tx,a,t){await authorize(tx,t.businessId,a);stageActive(await tx.offlineCase.findUniqueOrThrow({where:{id:t.businessId}}),t);}
  });
  this.tasks.registerHandoff('OFFLINE_CASE',{
   async transfer(tx,a,_target,t){await authorize(tx,t.businessId,a);stageActive(await tx.offlineCase.findUniqueOrThrow({where:{id:t.businessId}}),t);},
   async qualificationLost(tx,_actorId,t){if(!await tx.offlineCase.count({where:{id:t.businessId}}))throw new TaskError('TASK_NOT_FOUND');}
  });
  this.tasks.registerDeadline('OFFLINE_CASE',{async assertCanExtend(){throw new TaskError('TASK_DEADLINE_BLOCKED');},async extend(){throw new TaskError('TASK_DEADLINE_BLOCKED');}});
  this.tasks.registerLifecycle('OFFLINE_CASE',{
   async assertTransition(tx,a,t,action){await authorize(tx,t.businessId,a);const row=await tx.offlineCase.findUniqueOrThrow({where:{id:t.businessId}});if(action==='COMPLETED'&&(t.stage==='OFFLINE_FOLLOW'&&offlineTerminal(row.status)||t.stage==='ADMIN_DISPUTE'&&row.adminDecisionEventId&&t.entryKey==='admin:'+row.adminRequestEventId))return;throw new TaskError('TASK_TRANSITION_BLOCKED');},async applyTransition(){}
  });
  this.files.register({ownerType:'OFFLINE_CASE_EVENT',
   async aggregate(tx,target){const event=await tx.offlineCaseEvent.findUnique({where:{id:target.ownerId}});if(!event)throw new FileError('FILE_NOT_FOUND');return 'OFFLINE_CASE:'+event.offlineCaseId;},
   async authorize(tx,a,target,mode){
    if(target.slot!=='evidence'||target.audience!=='INTERNAL')throw new FileError('FILE_NOT_FOUND');
    const event=await tx.offlineCaseEvent.findUnique({where:{id:target.ownerId}});if(!event)throw new FileError('FILE_NOT_FOUND');
    let row:OfflineCase;try{row=await ownedOffline(tx,event.offlineCaseId,a);}catch{throw new FileError('FILE_NOT_FOUND');}
    if(mode==='BIND'){
     if(a.subjectType!=='EMPLOYEE'||event.actorEmployeeId!==a.subjectId||offlineTerminal(row.status))throw new FileError('FILE_NOT_BINDABLE');
     const stage=event.adminDecision&&event.adminDecision!=='REQUEST'?'ADMIN_DISPUTE':'OFFLINE_FOLLOW';
     const task=await tx.task.findFirst({where:{businessType:'OFFLINE_CASE',businessId:row.id,stage,status:'CLAIMED',assigneeId:a.subjectId}});
     if(!task||!isTaskEligible(a,task))throw new FileError('FILE_NOT_BINDABLE');
    }
   }
  });
 }
}
