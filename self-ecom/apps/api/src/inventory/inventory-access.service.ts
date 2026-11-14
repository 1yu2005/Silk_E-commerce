// 作用：库存命令锁内复核最新会话及权限；经办只使用Task，不维护第二套owner。
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, Task } from '@prisma/client';
import { CurrentIdentityService, type CurrentIdentity } from '../auth/current-identity.service.js';
import { AccessDeniedError } from '../auth/access-denied.error.js';
import { TokenValidationError } from '../auth/jwt-token.service.js';
import { InventoryError } from './inventory.errors.js';
export interface InventoryContext {actor:CurrentIdentity;token:string;requestId:string}
export function permission(actor:CurrentIdentity,permissions:readonly string[]) {
 if(actor.subjectType!=='EMPLOYEE'||actor.mustChangePassword||permissions.some(p=>!actor.effectivePermissions.includes(p)))throw new AccessDeniedError('FORBIDDEN');return actor;
}
@Injectable()
export class InventoryAccess {
 constructor(@Inject(CurrentIdentityService) private readonly identities:CurrentIdentityService){}
 async actor(tx:Prisma.TransactionClient,ctx:InventoryContext,permissions:readonly string[],lock=true){
  if(ctx.actor.subjectType!=='EMPLOYEE')throw new AccessDeniedError('FORBIDDEN');
  if(lock)await tx.$queryRaw`SELECT id FROM employee WHERE id=${ctx.actor.subjectId}::uuid FOR UPDATE`;
  const current=await this.identities.authenticate(tx,ctx.token,'EMPLOYEE');
  if(current.subjectId!==ctx.actor.subjectId||current.sessionId!==ctx.actor.sessionId)throw new TokenValidationError('TOKEN_INVALID');
  return permission(current,permissions);
 }
 async task(tx:Prisma.TransactionClient,id:string,checkRequired:boolean){
  const task=await tx.task.findFirst({where:{businessType:'INVENTORY_ADJUSTMENT',businessId:id,stage:checkRequired?'INVENTORY_RECONCILE':'INVENTORY_POST',status:{in:['OPEN','CLAIMED']}}});
  if(!task)throw new InventoryError('INVENTORY_CHECK_REQUIRED');return task;
 }
 assignee(actor:CurrentIdentity,task:Task,expectedTaskVersion:number){
  if(task.version!==expectedTaskVersion)throw new InventoryError('VERSION_CONFLICT');
  permission(actor,['inventory.read','inventory.adjustment.claim','inventory.adjustment.post']);
  if(task.status!=='CLAIMED'||task.assigneeId!==actor.subjectId)throw new InventoryError('TASK_NOT_ASSIGNEE');
 }
}
