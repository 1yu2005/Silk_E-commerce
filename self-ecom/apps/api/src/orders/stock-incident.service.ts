// 作用：真实异常登记、核实、补齐与解除；候选锁计划变化重跑整个事务，不在SKU锁后补取订单。
import {Inject,Injectable} from '@nestjs/common';
import {Prisma,type OrderItem,type StockIncidentItem} from '@prisma/client';
import {commandFingerprint} from '../common/command-fingerprint.js';
import {PrismaService} from '../prisma/prisma.service.js';
import {runAuthTransaction} from '../auth/auth-transaction.js';
import {Clock} from '../common/time/clock.js';
import type {CustomerContext} from '../customers/customer-access.service.js';
import {InventoryKernel} from '../inventory/inventory-kernel.service.js';
import {InventoryBlocks} from '../inventory/inventory-block.service.js';
import {lockStock} from '../inventory/inventory-support.js';
import {TaskEntryService,type TaskEntryContext} from '../tasks/task-entry.service.js';
import {TaskSourceService} from '../tasks/task-source.service.js';
import {OrderTimerService} from '../tasks/order-timer.service.js';
import {TaskError} from '../tasks/task.errors.js';
import {FileBindingService} from '../files/file-binding.service.js';
import {AuditService} from '../audit/audit.service.js';
import {OrderAccess,requireOrderPermission} from './order-access.service.js';
import {refreshDamage} from './order-stock.js';
import {OrderError} from './order.errors.js';
import type {IncidentCreateDto,IncidentVerifyDto,IncidentCommandDto,ReplenishmentDto} from './order.dto.js';
const live=['WAIT_PAYMENT','WAIT_SHIPMENT'];
const retryPlan=(e:unknown)=>e instanceof TaskError&&e.code==='TASK_LOCK_PLAN_CHANGED';
@Injectable()
export class StockIncidents {
 constructor(@Inject(PrismaService)private readonly db:PrismaService,@Inject(OrderAccess)private readonly access:OrderAccess,@Inject(Clock)private readonly clock:Clock,
 @Inject(TaskEntryService)private readonly entry:TaskEntryService,@Inject(TaskSourceService)private readonly sources:TaskSourceService,@Inject(OrderTimerService)private readonly timer:OrderTimerService,
 @Inject(InventoryKernel)private readonly stock:InventoryKernel,@Inject(InventoryBlocks)private readonly blocks:InventoryBlocks,@Inject(FileBindingService)private readonly files:FileBindingService,@Inject(AuditService)private readonly audit:AuditService){}
 private fingerprint(ctx:CustomerContext,command:string,payload:unknown){return commandFingerprint({command,version:1,actor:{type:ctx.actor.subjectType,id:ctx.actor.subjectId},payload});}
 private candidates(tx:Prisma.TransactionClient,skuId:string,ids?:string[]){return tx.orderItem.findMany({where:{skuId,...(ids?{id:{in:ids}}:{}),order:{status:{in:live},actualHandoverAt:null}},orderBy:{id:'asc'}});}
 create(ctx:CustomerContext,input:IncidentCreateDto){const normalized={incidentKey:input.incidentKey,skuId:input.skuId,reason:input.reason,evidenceNote:input.evidenceNote,...(input.items?{items:input.items.map(i=>({orderItemId:i.orderItemId,...(i.damagedQuantity!==undefined?{damagedQuantity:i.damagedQuantity}:{})})).sort((a,b)=>a.orderItemId.localeCompare(b.orderItemId))}:{}),evidenceFileIds:[...(input.evidenceFileIds??[])].sort()};
  const fingerprint=this.fingerprint(ctx,'stock.incident.create',normalized);if(input.items&&new Set(input.items.map(i=>i.orderItemId)).size!==input.items.length)throw new OrderError('VALIDATION_FAILED');
  return runAuthTransaction(this.db,async tx=>{
   // 此处只做定位和身份读取；withContext统一先锁所有员工/顾客/订单，再锁SKU。
   requireOrderPermission(await this.access.current(tx,ctx,false),'inventory.order-exception.manage');
   const prior=await tx.stockIncident.findUnique({where:{incidentKey:input.incidentKey}});if(prior){if(prior.fingerprint!==fingerprint)throw new OrderError('STOCK_INCIDENT_CONFLICT');return {id:prior.id,version:prior.version,status:prior.status,replayed:true};}
   const candidate=await this.candidates(tx,input.skuId,input.items?.map(i=>i.orderItemId));
   if(input.items&&candidate.length!==input.items.length)throw new OrderError('STOCK_INCIDENT_CONFLICT',{route:'已关闭订单不再释放；已释放实物损耗请走库存来源与可售损耗流程'});
   const refs=[...new Set(candidate.map(i=>i.orderId))].sort().map(businessId=>({businessType:'ORDER' as const,businessId}));
   const product=await tx.sku.findUnique({where:{id:input.skuId},select:{productId:true}});if(!product)throw new OrderError('PRODUCT_UNAVAILABLE');
   const apply=async(context?:TaskEntryContext)=>{
    const actor=requireOrderPermission(await this.access.current(tx,ctx,false),'inventory.order-exception.manage');
    const nowCandidate=await this.candidates(tx,input.skuId,input.items?.map(i=>i.orderItemId));if(candidate.map(i=>i.id).join()!==nowCandidate.map(i=>i.id).join())throw new TaskError('TASK_LOCK_PLAN_CHANGED');
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'incident:'+input.incidentKey},0))::text`;
    const repeated=await tx.stockIncident.findUnique({where:{incidentKey:input.incidentKey}});if(repeated){if(repeated.fingerprint!==fingerprint)throw new OrderError('STOCK_INCIDENT_CONFLICT');return {id:repeated.id,version:repeated.version,status:repeated.status,replayed:true};}
    const now=this.clock.now();const incident=await tx.stockIncident.create({data:{incidentKey:input.incidentKey,fingerprint,skuId:input.skuId,reason:input.reason,evidenceNote:input.evidenceNote,createdById:actor.subjectId,createdAt:now}});
    for(const item of nowCandidate){const order=await tx.order.findUniqueOrThrow({where:{id:item.orderId}});const d=input.items?.find(l=>l.orderItemId===item.id)?.damagedQuantity;
     if(d!==undefined&&d>item.quantity)throw new OrderError('STOCK_INCIDENT_CONFLICT');
     const f=await tx.stockIncidentItem.create({data:{incidentId:incident.id,orderItemId:item.id,allocationType:order.status==='WAIT_PAYMENT'?'RESERVED':'PAID_PREPARATION',quantityAffected:item.quantity,damagedQuantity:d??null,verificationState:d===undefined?'UNKNOWN':'CONFIRMED',conclusion:d===undefined?null:d===0?'INTACT':'DAMAGED',verifiedById:d===undefined?null:actor.subjectId,verifiedAt:d===undefined?null:now}});
     if(order.status==='WAIT_SHIPMENT')await this.paidLoss(tx,ctx,item,f,'create');
     await tx.orderItem.update({where:{id:item.id},data:{physicalVersion:{increment:1}}});await tx.order.update({where:{id:order.id},data:{stockPhysicalVersion:{increment:1},version:{increment:1},updatedAt:now}});
     await refreshDamage(tx,order.id);
    }
    await this.blocks.open(tx,input.skuId,'ORDER_STOCK_EXCEPTION',incident.id,'ORDER_STOCK_CHECK', {type:'EMPLOYEE',id:actor.subjectId},ctx.requestId);
    if(context)for(const ref of refs){for(const stage of ['STOCK_EXCEPTION_VERIFY','PHYSICAL_VERIFY','ADMIN_STOCK_REVIEW','CUSTOMER_CONTACT'] as const)await this.sources.attach(context,{...ref,stage,sourceType:'STOCK_EXCEPTION',sourceId:incident.id,entryKey:'incident:'+incident.id,reason:input.reason});
     await this.timer.addBlock(context,ref.businessId,{sourceType:'STOCK_EXCEPTION',sourceId:incident.id},{commandKey:'incident:'+incident.id,reason:input.reason});}
    for(const fileId of normalized.evidenceFileIds)await this.files.bindFiles(tx,{identity:actor,token:ctx.token},{ownerType:'STOCK_INCIDENT',ownerId:incident.id,slot:'evidence',audience:'INTERNAL',fileIds:[fileId],commandKey:incident.id});
    await this.record(tx,ctx,incident.id,'CREATE',input.reason,input.incidentKey,{affectedCount:nowCandidate.length,evidenceNote:input.evidenceNote});return {id:incident.id,version:incident.version,status:incident.status,replayed:false};
   };
   if(refs.length)return this.entry.withContext(tx,{type:'EMPLOYEE',subjectId:ctx.actor.subjectId,token:ctx.token},refs,ctx.requestId,apply,[{kind:'PRODUCT',id:product.productId},{kind:'SKU_STOCK',id:input.skuId}]);
   await this.access.current(tx,ctx);await lockStock(tx,[input.skuId]);return apply();
  },retryPlan);
 }
 private async paidLoss(tx:Prisma.TransactionClient,ctx:CustomerContext,item:OrderItem,f:StockIncidentItem,suffix:string){
  const o=await tx.order.findUniqueOrThrow({where:{id:item.orderId}});if(f.damagedQuantity===null||f.damagedQuantity===0)return;
  await this.stock.execute(tx,{businessType:'ORDER',businessId:o.id,businessNumber:o.number,actionType:'PAID_PREPARATION_LOSS',actionKey:'PAID_PREPARATION_LOSS:'+f.id+':'+suffix,semantic:{incidentItemId:f.id,damaged:f.damagedQuantity},actor:{type:'EMPLOYEE',id:ctx.actor.subjectId},requestId:ctx.requestId,reason:'已付未交运实物损耗，不二次扣减可售或占用',effects:[{skuId:item.skuId,deltaA:0,deltaR:0,eventType:'PAID_PREPARATION_LOSS'}]});
 }
 private async inIncident<T>(ctx:CustomerContext,id:string,command:(tx:Prisma.TransactionClient,context:TaskEntryContext|undefined)=>Promise<T>){return runAuthTransaction(this.db,async tx=>{
  requireOrderPermission(await this.access.current(tx,ctx,false),'inventory.order-exception.manage');const before=await tx.stockIncident.findUnique({where:{id},include:{items:{include:{orderItem:true}}}});if(!before)throw new OrderError('INCIDENT_NOT_FOUND');
  const refs=[...new Set(before.items.map(i=>i.orderItem.orderId))].sort().map(businessId=>({businessType:'ORDER' as const,businessId}));
  const apply=async(context?:TaskEntryContext)=>{requireOrderPermission(await this.access.current(tx,ctx,false),'inventory.order-exception.manage');await tx.$queryRaw`SELECT id FROM stock_incident WHERE id=${id}::uuid FOR UPDATE`;return command(tx,context);};
  if(refs.length)return this.entry.withContext(tx,{type:'EMPLOYEE',subjectId:ctx.actor.subjectId,token:ctx.token},refs,ctx.requestId,apply);
  await this.access.current(tx,ctx);await lockStock(tx,[before.skuId]);return apply();
 },retryPlan);}
 private async assigned(tx:Prisma.TransactionClient,ctx:CustomerContext,orderId:string,version:number,versions?:IncidentCommandDto['taskVersions']){const task=await tx.task.findFirst({where:{businessType:'ORDER',businessId:orderId,stage:'STOCK_EXCEPTION_VERIFY',status:{in:['OPEN','CLAIMED']}}});if(!task||task.status!=='CLAIMED'||task.assigneeId!==ctx.actor.subjectId)throw new OrderError('TASK_NOT_ASSIGNED');const expected=versions?versions.find(v=>v.taskId===task.id)?.expectedVersion:version;if(task.version!==expected)throw new OrderError('VERSION_CONFLICT');return task;}
 private async replay(tx:Prisma.TransactionClient,id:string,key:string,fingerprint:string){const prior=await tx.stockIncidentCommand.findUnique({where:{incidentId_commandKey:{incidentId:id,commandKey:key}}});if(prior&&prior.fingerprint!==fingerprint)throw new OrderError('STOCK_INCIDENT_CONFLICT');return prior?{...(prior.result as Record<string,unknown>),replayed:true}:null;}
 private async receipt(tx:Prisma.TransactionClient,id:string,key:string,fingerprint:string,action:string,result:Prisma.InputJsonObject){await tx.stockIncidentCommand.create({data:{incidentId:id,commandKey:key,fingerprint,action,result}});return result;}
 private commandPayload(input:IncidentCommandDto){return {expectedVersion:input.expectedVersion,expectedTaskVersion:input.expectedTaskVersion,commandKey:input.commandKey,reason:input.reason,evidenceNote:input.evidenceNote,...(input.taskVersions?{taskVersions:input.taskVersions.map(v=>({taskId:v.taskId,expectedVersion:v.expectedVersion})).sort((a,b)=>a.taskId.localeCompare(b.taskId))}:{})};}
 verify(ctx:CustomerContext,id:string,input:IncidentVerifyDto){const fingerprint=this.fingerprint(ctx,'stock.incident.verify',{id,...this.commandPayload(input),items:input.items.map(i=>({orderItemId:i.orderItemId,damagedQuantity:i.damagedQuantity,conclusion:i.conclusion})).sort((a,b)=>a.orderItemId.localeCompare(b.orderItemId))});
  if(new Set(input.items.map(i=>i.orderItemId)).size!==input.items.length)throw new OrderError('VALIDATION_FAILED');return this.inIncident(ctx,id,async tx=>{
   const prior=await this.replay(tx,id,input.commandKey,fingerprint);if(prior)return prior;const incident=await tx.stockIncident.findUniqueOrThrow({where:{id},include:{items:{include:{orderItem:true,replenishments:true}}}});if(incident.status!=='OPEN'||incident.version!==input.expectedVersion)throw new OrderError('VERSION_CONFLICT');
   for(const line of input.items){const f=incident.items.find(i=>i.orderItemId===line.orderItemId);if(!f||f.verificationState==='SETTLED'||line.damagedQuantity>f.quantityAffected)throw new OrderError('STOCK_INCIDENT_CONFLICT');await this.assigned(tx,ctx,f.orderItem.orderId,input.expectedTaskVersion,input.taskVersions);
    // 已确认的损耗不能被覆盖；零损耗待补货可经新的明确完好核实解除。
    if(f.damagedQuantity!==null&&line.damagedQuantity!==f.damagedQuantity)throw new OrderError('STOCK_INCIDENT_CONFLICT');if(line.conclusion==='INTACT'&&line.damagedQuantity!==0)throw new OrderError('VALIDATION_FAILED');
    const changed=await tx.stockIncidentItem.update({where:{id:f.id},data:{damagedQuantity:line.damagedQuantity,conclusion:line.conclusion,verificationState:f.replenishments.reduce((n,r)=>n+r.quantity,0)===line.damagedQuantity&&line.damagedQuantity>0?'REPLENISHED':'CONFIRMED',verifiedById:ctx.actor.subjectId,verifiedAt:this.clock.now(),version:{increment:1}}});
    if(f.allocationType==='PAID_PREPARATION'&&f.damagedQuantity===null)await this.paidLoss(tx,ctx,f.orderItem,changed,input.commandKey);
    await tx.orderItem.update({where:{id:f.orderItemId},data:{physicalVersion:{increment:1}}});await tx.order.update({where:{id:f.orderItem.orderId},data:{stockPhysicalVersion:{increment:1},version:{increment:1}}});await refreshDamage(tx,f.orderItem.orderId);
    await this.record(tx,ctx,id,'VERIFY',input.reason,input.commandKey,{damagedQuantity:line.damagedQuantity,conclusion:line.conclusion,evidenceNote:input.evidenceNote},f.id);
   }
   const updated=await tx.stockIncident.update({where:{id},data:{version:{increment:1}}});return this.receipt(tx,id,input.commandKey,fingerprint,'VERIFY',{id,version:updated.version,replayed:false});
  });
 }
 replenish(ctx:CustomerContext,id:string,input:ReplenishmentDto){const fingerprint=this.fingerprint(ctx,'stock.incident.replenish',{id,...input});return this.inIncident(ctx,id,async tx=>{
  const prior=await this.replay(tx,id,input.commandKey,fingerprint);if(prior)return prior;const incident=await tx.stockIncident.findUniqueOrThrow({where:{id},include:{items:{include:{orderItem:{include:{order:true}},replenishments:true}}}});
  const f=incident.items.find(i=>i.orderItemId===input.orderItemId);if(!f||incident.status!=='OPEN'||f.damagedQuantity===null||f.verificationState==='SETTLED')throw new OrderError('INCIDENT_UNRESOLVED');
  const o=f.orderItem.order;if(incident.version!==input.expectedIncidentVersion||o.version!==input.expectedOrderVersion)throw new OrderError('VERSION_CONFLICT');if(f.orderItem.physicalVersion!==input.expectedPhysicalVersion)throw new OrderError('PHYSICAL_CHECK_STALE');
  await this.assigned(tx,ctx,o.id,input.expectedTaskVersion);if(!live.includes(o.status)||o.actualHandoverAt)throw new OrderError('STOCK_INCIDENT_CONFLICT');const remaining=f.damagedQuantity-f.replenishments.reduce((n,r)=>n+r.quantity,0);if(input.quantity>remaining)throw new OrderError('STOCK_INCIDENT_CONFLICT');
  const a=await this.stock.execute(tx,{businessType:'ORDER',businessId:o.id,businessNumber:o.number,actionType:'ALLOCATE_REPLACEMENT',actionKey:'ALLOCATE_REPLACEMENT:'+id+':'+input.commandKey,semantic:{id,...input},actor:{type:'EMPLOYEE',id:ctx.actor.subjectId},requestId:ctx.requestId,reason:input.reason,effects:[{skuId:incident.skuId,deltaA:-input.quantity,deltaR:0,eventType:'ALLOCATE_REPLACEMENT'}]});
  const r=await tx.stockReplenishment.create({data:{incidentItemId:f.id,orderItemId:f.orderItemId,quantity:input.quantity,inventoryActionId:a.action.id,commandKey:input.commandKey,fingerprint,actorEmployeeId:ctx.actor.subjectId,goodsLocation:input.goodsLocation,reason:input.reason}});
  if(remaining===input.quantity)await tx.stockIncidentItem.update({where:{id:f.id},data:{verificationState:'REPLENISHED',version:{increment:1}}});
  const item=await tx.orderItem.update({where:{id:f.orderItemId},data:{physicalVersion:{increment:1}}});const updated=await tx.order.update({where:{id:o.id},data:{stockPhysicalVersion:{increment:1},version:{increment:1}}});await refreshDamage(tx,o.id);
  const next=await tx.stockIncident.update({where:{id},data:{version:{increment:1}}});await this.record(tx,ctx,id,'REPLENISH',input.reason,input.commandKey,{quantity:input.quantity,remaining:remaining-input.quantity,evidenceNote:input.evidenceNote,goodsLocation:input.goodsLocation},f.id);
  return this.receipt(tx,id,input.commandKey,fingerprint,'REPLENISH',{id,replenishmentId:r.id,inventoryActionId:a.action.id,remaining:remaining-input.quantity,version:next.version,orderVersion:updated.version,physicalVersion:item.physicalVersion,replayed:false});
 });}
 resolve(ctx:CustomerContext,id:string,input:IncidentCommandDto){const fingerprint=this.fingerprint(ctx,'stock.incident.resolve',{id,...this.commandPayload(input)});return this.inIncident(ctx,id,async(tx,context)=>{
  const prior=await this.replay(tx,id,input.commandKey,fingerprint);if(prior)return prior;const incident=await tx.stockIncident.findUniqueOrThrow({where:{id},include:{items:{include:{orderItem:true,replenishments:true}}}});if(incident.status!=='OPEN'||incident.version!==input.expectedVersion)throw new OrderError('VERSION_CONFLICT');
  for(const f of incident.items){if(f.verificationState!=='SETTLED')await this.assigned(tx,ctx,f.orderItem.orderId,input.expectedTaskVersion,input.taskVersions);if(f.verificationState!=='SETTLED'&&(f.damagedQuantity===null||f.damagedQuantity-f.replenishments.reduce((n,r)=>n+r.quantity,0)>0||(f.conclusion==='WAIT_REPLACEMENT'&&f.verificationState!=='REPLENISHED')))throw new OrderError('INCIDENT_UNRESOLVED');}
  const updated=await tx.stockIncident.update({where:{id},data:{status:'RESOLVED',resolvedAt:this.clock.now(),version:{increment:1}}});
  const orderIds=[...new Set(incident.items.map(f=>f.orderItem.orderId))].sort();for(const orderId of orderIds){await refreshDamage(tx,orderId);if(context){await this.timer.releaseBlock(context,orderId,{sourceType:'STOCK_EXCEPTION',sourceId:id},{commandKey:input.commandKey,reason:input.reason});
    const rows=await tx.taskBusinessSource.findMany({where:{sourceType:'STOCK_EXCEPTION',sourceId:id,status:'ACTIVE',taskId:{in:(await tx.task.findMany({where:{businessType:'ORDER',businessId:orderId},select:{id:true}})).map(t=>t.id)}},orderBy:{taskId:'asc'}});
    for(const row of rows){const t=await tx.task.findUniqueOrThrow({where:{id:row.taskId}});await this.sources.cancel(context,{businessType:'ORDER',businessId:orderId,taskId:t.id,expectedVersion:t.version,sourceType:'STOCK_EXCEPTION',sourceId:id,commandKey:input.commandKey,reason:'来源已处理：'+input.reason});}
   }}
  await this.blocks.resolve(tx,incident.skuId,'ORDER_STOCK_EXCEPTION',id,{type:'EMPLOYEE',id:ctx.actor.subjectId},ctx.requestId,input.reason);await this.record(tx,ctx,id,'RESOLVE',input.reason,input.commandKey,{evidenceNote:input.evidenceNote});return this.receipt(tx,id,input.commandKey,fingerprint,'RESOLVE',{id,status:updated.status,version:updated.version,replayed:false});
 });}
 private async record(tx:Prisma.TransactionClient,ctx:CustomerContext,id:string,action:'CREATE'|'VERIFY'|'REPLENISH'|'RESOLVE',reason:string,commandKey:string,after:Prisma.InputJsonObject,itemId?:string){await tx.stockIncidentHistory.create({data:{incidentId:id,incidentItemId:itemId,action,actorType:'EMPLOYEE',actorId:ctx.actor.subjectId,reason,commandKey,requestId:ctx.requestId,after}});
  const incident=await tx.stockIncident.findUniqueOrThrow({where:{id}});await this.audit.appendAudit(tx,{actor:{type:'EMPLOYEE',id:ctx.actor.subjectId},action:'stock.incident',targetId:id,requestId:ctx.requestId,reason,after:{incidentVersion:incident.version,incidentAction:action}});
 }
}
