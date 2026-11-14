// 作用：Customer父锁保护地址上限与默认切换；姓名、电话和详细地址不进入审计。
import {Inject,Injectable} from '@nestjs/common';
import type {Address,Prisma} from '@prisma/client';
import {PrismaService} from '../prisma/prisma.service.js';
import {AuditService} from '../audit/audit.service.js';
import {runAuthTransaction} from '../auth/auth-transaction.js';
import {CustomerAccessService,type CustomerContext} from './customer-access.service.js';
import {CustomerError} from './customer.errors.js';
import type {AddressCreateDto,AddressUpdateDto,VersionDto} from './customer.dto.js';
const fields=['receiver','phone','province','city','district','detail','isDefault'] as const;
@Injectable()
export class AddressService {
 constructor(@Inject(PrismaService)private readonly db:PrismaService,@Inject(CustomerAccessService)private readonly access:CustomerAccessService,@Inject(AuditService)private readonly audit:AuditService){}
 list(ctx:CustomerContext,id?:string){return this.db.$transaction(async tx=>{const actor=await this.access.customer(tx,ctx,false);if(id){const item=await tx.address.findFirst({where:{id,customerId:actor.subjectId}});if(!item)throw new CustomerError('ADDRESS_NOT_FOUND');return item;}const items=await tx.address.findMany({where:{customerId:actor.subjectId},orderBy:[{isDefault:'desc'},{createdAt:'asc'},{id:'asc'}]});return {items};},{isolationLevel:'RepeatableRead'});}
 private async record(tx:Prisma.TransactionClient,ctx:CustomerContext,row:Address,changed:string[]){await this.audit.appendAudit(tx,{actor:{type:'CUSTOMER',id:ctx.actor.subjectId},action:'address.change',targetId:row.id,requestId:ctx.requestId,after:{addressFields:changed,isDefault:row.isDefault,addressVersion:row.version}});}
 private async clearDefault(tx:Prisma.TransactionClient,ctx:CustomerContext,except?:string){const rows=await tx.address.findMany({where:{customerId:ctx.actor.subjectId,isDefault:true,...(except?{id:{not:except}}:{})}});const affected=[];for(const row of rows){if(row.version>=2147483647)throw new CustomerError('VERSION_CONFLICT');const updated=await tx.address.update({where:{id:row.id},data:{isDefault:false,version:{increment:1}}});await this.record(tx,ctx,updated,['isDefault']);affected.push({id:updated.id,version:updated.version,isDefault:false});}return affected;}
 create(ctx:CustomerContext,input:AddressCreateDto){return runAuthTransaction(this.db,async tx=>{const actor=await this.access.customer(tx,ctx);if(await tx.address.count({where:{customerId:actor.subjectId}})>=20)throw new CustomerError('ADDRESS_LIMIT_REACHED');
  const affectedAddresses=input.isDefault?await this.clearDefault(tx,ctx):[];
  const address=await tx.address.create({data:{customerId:actor.subjectId,...input,isDefault:input.isDefault??false}});await this.record(tx,ctx,address,[...fields]);affectedAddresses.push({id:address.id,version:address.version,isDefault:address.isDefault});return {address,affectedAddresses,changed:true};
 });}
 update(ctx:CustomerContext,id:string,input:AddressUpdateDto){return runAuthTransaction(this.db,async tx=>{await this.access.customer(tx,ctx);const row=await tx.address.findFirst({where:{id,customerId:ctx.actor.subjectId}});if(!row)throw new CustomerError('ADDRESS_NOT_FOUND');if(row.version!==input.expectedVersion)throw new CustomerError('VERSION_CONFLICT');
  const supplied=fields.filter(k=>input[k]!==undefined);if(!supplied.length)throw new CustomerError('VALIDATION_FAILED');const changed=supplied.filter(k=>row[k]!==input[k]);
  if(!changed.length)return {address:row,affectedAddresses:[],changed:false};if(row.version>=2147483647)throw new CustomerError('VERSION_CONFLICT');
  const affectedAddresses=input.isDefault?await this.clearDefault(tx,ctx,id):[];
  const patch=Object.fromEntries(supplied.map(k=>[k,input[k]]));const address=await tx.address.update({where:{id},data:{...patch,version:{increment:1}}});await this.record(tx,ctx,address,changed);affectedAddresses.push({id,version:address.version,isDefault:address.isDefault});return {address,affectedAddresses,changed:true};
 });}
 setDefault(ctx:CustomerContext,id:string,input:VersionDto){return this.update(ctx,id,{...input,isDefault:true});}
 remove(ctx:CustomerContext,id:string,input:VersionDto){return runAuthTransaction(this.db,async tx=>{await this.access.customer(tx,ctx);const row=await tx.address.findFirst({where:{id,customerId:ctx.actor.subjectId}});if(!row)throw new CustomerError('ADDRESS_NOT_FOUND');if(row.version!==input.expectedVersion)throw new CustomerError('VERSION_CONFLICT');await tx.address.delete({where:{id}});await this.record(tx,ctx,row,['deleted']);return {deleted:true,id,deletedId:id,affectedAddresses:[]};});}
}
