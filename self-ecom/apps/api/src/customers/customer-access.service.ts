// 作用：地址/购物车与冻结共享主体锁；敏感命令不得沿用Guard中的旧权限。
import {Inject,Injectable} from '@nestjs/common';
import type {Prisma} from '@prisma/client';
import {CurrentIdentityService,type CurrentIdentity} from '../auth/current-identity.service.js';
import {lockSessionSubject,requireSessionTransaction} from '../auth/session-support.js';
import {TokenValidationError} from '../auth/jwt-token.service.js';
import {AccessDeniedError} from '../auth/access-denied.error.js';
export interface CustomerContext {actor:CurrentIdentity;token:string;requestId:string}
@Injectable()
export class CustomerAccessService {
 constructor(@Inject(CurrentIdentityService) private readonly identities:CurrentIdentityService){}
 async customer(tx:Prisma.TransactionClient,ctx:CustomerContext,lock=true){
  requireSessionTransaction(tx);
  if(ctx.actor.subjectType!=='CUSTOMER')throw new TokenValidationError('TOKEN_SUBJECT_MISMATCH');
  if(lock)await lockSessionSubject(tx,ctx.actor);
  const current=await this.identities.authenticate(tx,ctx.token,'CUSTOMER');
  if(current.subjectId!==ctx.actor.subjectId||current.sessionId!==ctx.actor.sessionId)throw new TokenValidationError('TOKEN_INVALID');
  return current;
 }
 async employee(tx:Prisma.TransactionClient,ctx:CustomerContext,permission:'customer.read'|'customer.status.manage',lock=false){
  if(ctx.actor.subjectType!=='EMPLOYEE')throw new TokenValidationError('TOKEN_SUBJECT_MISMATCH');
  if(lock)await lockSessionSubject(tx,ctx.actor);
  const current=await this.identities.authenticate(tx,ctx.token,'EMPLOYEE');
  if(current.subjectType!=='EMPLOYEE'||current.subjectId!==ctx.actor.subjectId||current.sessionId!==ctx.actor.sessionId)throw new TokenValidationError('TOKEN_INVALID');
  if(current.mustChangePassword)throw new AccessDeniedError('PASSWORD_CHANGE_REQUIRED');
  if(!current.effectivePermissions.includes(permission)||(permission==='customer.status.manage'&&current.role!=='SUPER_ADMIN'))throw new AccessDeniedError('FORBIDDEN');
  return current;
 }
}
