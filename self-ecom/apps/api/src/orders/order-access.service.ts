// 作用：统一订单主体复核；所有业务写入仍在持锁事务内再次授权。
import {Inject,Injectable} from '@nestjs/common';
import type {Prisma} from '@prisma/client';
import {CurrentIdentityService} from '../auth/current-identity.service.js';
import {lockSessionSubject} from '../auth/session-support.js';
import {AccessDeniedError} from '../auth/access-denied.error.js';
import {TokenValidationError} from '../auth/jwt-token.service.js';
import type {CustomerContext} from '../customers/customer-access.service.js';
import type {TaskCommandActor} from '../tasks/task-business-adapters.js';
import {OrderError} from './order.errors.js';
export const orderReader=(a:TaskCommandActor)=>a.subjectType==='EMPLOYEE'&&!a.mustChangePassword&&['order.service.read','order.fulfillment.read'].some(p=>a.effectivePermissions.includes(p));
export function requireOrderPermission(a:TaskCommandActor,p:string){if(a.subjectType!=='EMPLOYEE'||a.mustChangePassword||!a.effectivePermissions.includes(p))throw new AccessDeniedError('FORBIDDEN');return a;}
export async function ownedOrder(tx:Prisma.TransactionClient,id:string,actor:TaskCommandActor){const o=await tx.order.findUnique({where:{id}});if(!o||(actor.subjectType==='CUSTOMER'&&o.customerId!==actor.subjectId))throw new OrderError('ORDER_NOT_FOUND');return o;}
@Injectable()
export class OrderAccess {
 constructor(@Inject(CurrentIdentityService)private readonly identities:CurrentIdentityService){}
 async current(tx:Prisma.TransactionClient,ctx:CustomerContext,lock=true){
  if(lock)await lockSessionSubject(tx,ctx.actor);
  const a=await this.identities.authenticate(tx,ctx.token,ctx.actor.subjectType);
  if(a.subjectId!==ctx.actor.subjectId||a.sessionId!==ctx.actor.sessionId)throw new TokenValidationError('TOKEN_INVALID');
  if(a.subjectType==='EMPLOYEE'&&a.mustChangePassword)throw new AccessDeniedError('PASSWORD_CHANGE_REQUIRED');return a;
 }
}
