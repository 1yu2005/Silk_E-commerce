// 作用：后台仅按customer.read投影顾客资料；管理员状态变更、会话撤销和历史审计同事务。
import {Inject,Injectable} from '@nestjs/common';
import type {CustomerStatus,Prisma} from '@prisma/client';
import {PrismaService} from '../prisma/prisma.service.js';
import {AuditService} from '../audit/audit.service.js';
import {AuthSessionService} from '../auth/auth-session.service.js';
import {runAuthTransaction} from '../auth/auth-transaction.js';
import {CustomerAccessService,type CustomerContext} from './customer-access.service.js';
import {CustomerConsumptionService} from './customer-consumption.service.js';
import {CustomerError} from './customer.errors.js';
import type {CustomerQueryDto,CustomerStatusDto} from './customer.dto.js';
import type {PaginationDto} from '../common/http/pagination.dto.js';
const select={id:true,phone:true,nickname:true,status:true,statusVersion:true,createdAt:true,lastLoginAt:true,avatarAssetId:true} satisfies Prisma.CustomerSelect;
const readOptions={isolationLevel:'RepeatableRead' as const};
@Injectable()
export class CustomerService {
 constructor(@Inject(PrismaService)private readonly db:PrismaService,@Inject(CustomerAccessService)private readonly access:CustomerAccessService,
 @Inject(AuditService)private readonly audit:AuditService,@Inject(AuthSessionService)private readonly sessions:AuthSessionService,
 @Inject(CustomerConsumptionService)private readonly consumption:CustomerConsumptionService){}
 async list(ctx:CustomerContext,q:CustomerQueryDto){
  if(q.registeredFrom&&q.registeredTo&&new Date(q.registeredFrom)>new Date(q.registeredTo))throw new CustomerError('VALIDATION_FAILED');
  return this.db.$transaction(async tx=>{await this.access.employee(tx,ctx,'customer.read');
   const where:Prisma.CustomerWhereInput={...(q.phone?{phone:q.phone}:{}),...(q.nickname?{nickname:{contains:q.nickname,mode:'insensitive'}}:{}),...(q.status?{status:q.status}:{}),
    ...((q.registeredFrom||q.registeredTo)?{createdAt:{...(q.registeredFrom?{gte:new Date(q.registeredFrom)}:{}),...(q.registeredTo?{lte:new Date(q.registeredTo)}:{})}}:{})};
   const total=await tx.customer.count({where});const skip=BigInt(q.page-1)*BigInt(q.pageSize);
   const items=skip>=BigInt(total)?[]:await tx.customer.findMany({where,select,orderBy:[{createdAt:'desc'},{id:'asc'}],skip:Number(skip),take:q.pageSize});
   return {items:items.map(r=>({id:r.id,nickname:r.nickname,status:r.status,statusVersion:r.statusVersion,createdAt:r.createdAt,lastLoginAt:r.lastLoginAt,phoneMasked:r.phone.slice(0,3)+'****'+r.phone.slice(-4)})),total,page:q.page,pageSize:q.pageSize};
  },readOptions);
 }
 private async exists(tx:Prisma.TransactionClient,id:string){if(!await tx.customer.count({where:{id}}))throw new CustomerError('CUSTOMER_NOT_FOUND');}
 detail(ctx:CustomerContext,id:string){return this.db.$transaction(async tx=>{await this.access.employee(tx,ctx,'customer.read');const row=await tx.customer.findUnique({where:{id},select});if(!row)throw new CustomerError('CUSTOMER_NOT_FOUND');const {avatarAssetId,...rest}=row;return {...rest,avatarUrl:avatarAssetId?'/api/v1/files/'+avatarAssetId+'/content':null,ordersAvailability:'NOT_READY' as const};},readOptions);}
 addresses(ctx:CustomerContext,id:string){return this.db.$transaction(async tx=>{await this.access.employee(tx,ctx,'customer.read');await this.exists(tx,id);const items=await tx.address.findMany({where:{customerId:id},orderBy:[{isDefault:'desc'},{createdAt:'asc'},{id:'asc'}]});return {items};},readOptions);}
 history(ctx:CustomerContext,id:string,q:PaginationDto){return this.db.$transaction(async tx=>{await this.access.employee(tx,ctx,'customer.read');await this.exists(tx,id);const total=await tx.customerStatusHistory.count({where:{customerId:id}});const skip=BigInt(q.page-1)*BigInt(q.pageSize);const items=skip>=BigInt(total)?[]:await tx.customerStatusHistory.findMany({where:{customerId:id},orderBy:[{toVersion:'desc'},{id:'asc'}],skip:Number(skip),take:q.pageSize});return {items,total,page:q.page,pageSize:q.pageSize};},readOptions);}
 consumed(ctx:CustomerContext,id:string){return this.db.$transaction(async tx=>{await this.access.employee(tx,ctx,'customer.read');await this.exists(tx,id);return this.consumption.read(tx,id);},readOptions);}
 change(ctx:CustomerContext,id:string,status:CustomerStatus,input:CustomerStatusDto){return runAuthTransaction(this.db,async tx=>{
  const actor=await this.access.employee(tx,ctx,'customer.status.manage',true);
  await tx.$queryRaw`SELECT id FROM customer WHERE id=${id}::uuid FOR UPDATE`;
  const before=await tx.customer.findUnique({where:{id},select:{status:true,statusVersion:true,tokenVersion:true}});if(!before)throw new CustomerError('CUSTOMER_NOT_FOUND');
  if(before.statusVersion!==input.expectedVersion)throw new CustomerError('VERSION_CONFLICT');
  if(before.status===status)return {id,status,statusVersion:before.statusVersion,changed:false};
  if(before.statusVersion>=2147483647||(status==='LOGIN_FROZEN'&&before.tokenVersion>=2147483647))throw new CustomerError('VERSION_CONFLICT');
  const result=await tx.customer.update({where:{id},data:{status,statusVersion:{increment:1},...(status==='LOGIN_FROZEN'?{tokenVersion:{increment:1}}:{})},select:{id:true,status:true,statusVersion:true}});
  if(status==='LOGIN_FROZEN')await this.sessions.revokeAll(tx,{subjectType:'CUSTOMER',subjectId:id},'LOGIN_FROZEN');
  await tx.customerStatusHistory.create({data:{customerId:id,fromStatus:before.status,toStatus:status,fromVersion:before.statusVersion,toVersion:result.statusVersion,reason:input.reason,actorEmployeeId:actor.subjectId,requestId:ctx.requestId}});
  await this.audit.appendAudit(tx,{actor:{type:'EMPLOYEE',id:actor.subjectId},action:'customer.status.change',targetId:id,requestId:ctx.requestId,reason:input.reason,
   before:{status:before.status,customerStatusVersion:before.statusVersion},after:{status,customerStatusVersion:result.statusVersion}});
  return {...result,changed:true};
 });}
}
