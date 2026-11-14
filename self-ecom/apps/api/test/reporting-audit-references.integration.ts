// 作用：真实业务事务验证引用、旧审计只追加回填、断点/高水位及引用失败整体回滚。
import 'reflect-metadata';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {it,expect} from 'vitest';
import {Prisma} from '@prisma/client';
import {AuditService} from '../src/audit/audit.service.js';
import {resolveAuditBusinessReferences} from '../src/audit/audit-business-reference.js';
import {backfillAuditReferenceBatch,initialAuditReferenceCheckpoint} from '../src/audit/audit-reference-backfill.js';
import {RefundService} from '../src/after-sales/refund.service.js';
import {OfflineCaseService} from '../src/coordination/offline-case.service.js';
import {CartService} from '../src/customers/cart.service.js';
import {OrderService} from '../src/orders/order.service.js';
import {OrderCommands} from '../src/orders/order-command.service.js';
import {StockIncidents} from '../src/orders/stock-incident.service.js';
import {ReturnInspectionService} from '../src/after-sales/return-inspection.service.js';
import {fixture,setupCoordinationFixtures,paid,shipped,apply,review,physical,saleTask,saleBody,receive,draft} from './coordination-fixtures.js';

setupCoordinationFixtures({databasePrefix:'m414'});

it('正式支付、库存支付动作和任务审计均关联真实订单；伪造快照业务ID不能改变归属',async()=>{
  const {db}=fixture,f=await paid(),payment=await db.payment.findUniqueOrThrow({where:{orderId:f.id}}),action=await db.inventoryAction.findFirstOrThrow({where:{businessType:'PAYMENT',businessId:payment.id}});
  const log=await db.auditLog.findFirstOrThrow({where:{targetType:'InventoryAction',targetId:action.id},include:{businessReferences:true}});
  expect(log.businessReferences).toEqual([expect.objectContaining({businessType:'ORDER',businessId:f.id})]);
  const task=await db.task.findFirstOrThrow({where:{businessType:'ORDER',businessId:f.id}}),requestId=randomUUID(),fakeId=randomUUID();
  await db.$transaction(tx=>new AuditService().appendAudit(tx,{actor:{type:'SYSTEM'},action:'task.create',targetId:task.id,requestId,reason:'核对真实任务归属',after:{businessType:'ORDER',businessId:fakeId}}));
  const refs=await db.auditBusinessReference.findMany({where:{auditLog:{requestId}}});expect(refs).toEqual([expect.objectContaining({businessType:'ORDER',businessId:f.id})]);expect(refs.some(r=>r.businessId===fakeId)).toBe(false);
});

it('真实退款成功审计同时关联退款/售后/订单，早期售后申请不会倒挂到后来退款',async()=>{
  const {db,app,support}=fixture,f=await paid(),sale=await apply(f);await review(sale.afterSaleId);const check=await physical(f,sale.afterSaleId);await saleTask(sale.afterSaleId,'REFUND_PROCESS');
  await app.get(RefundService).execute(support,sale.afterSaleId,{...await saleBody(sale.afterSaleId,'REFUND_PROCESS'),physicalCheckId:check.physicalCheckId});
  const refund=await db.refund.findUniqueOrThrow({where:{afterSaleId:sale.afterSaleId}}),logs=await db.auditLog.findMany({where:{targetType:'AfterSale',targetId:sale.afterSaleId},orderBy:{createdAt:'asc'}}),refundLog=logs.find(l=>(l.afterData as Prisma.JsonObject)?.afterSaleAction==='refund')!,applyLog=logs.find(l=>(l.afterData as Prisma.JsonObject)?.afterSaleAction==='apply')!;
  expect(refund.status).toBe('SUCCEEDED');
  expect((await db.auditBusinessReference.findMany({where:{auditLogId:refundLog.id}})).map(r=>[r.businessType,r.businessId])).toEqual(expect.arrayContaining([['ORDER',f.id],['AFTER_SALE',sale.afterSaleId],['REFUND',refund.id]]));
  const resolved=await db.$transaction(tx=>resolveAuditBusinessReferences(tx,[applyLog]));expect(resolved.references.some(r=>r.businessType==='REFUND')).toBe(false);
});

it('正式线下工单和其任务审计同时关联工单/订单，线下记录不会创建退款引用',async()=>{
  const {db,app,support}=fixture,f=await paid(),order=await db.order.findUniqueOrThrow({where:{id:f.id}}),offline=await app.get(OfflineCaseService).create(support,{orderId:f.id,type:'OTHER_SERVICE',subject:'引用链核对',description:'独占库实际测试工单',publicSummary:'已登记跟进',expectedOrderVersion:order.version,commandKey:randomUUID(),reason:'核对线下引用'});
  const logs=await db.auditLog.findMany({where:{OR:[{targetType:'Coordination',targetId:offline.offlineCaseId},{targetType:'Task',targetId:offline.taskId!}]},include:{businessReferences:true}});
  expect(logs.length).toBeGreaterThanOrEqual(2);for(const log of logs){expect(log.businessReferences).toEqual(expect.arrayContaining([expect.objectContaining({businessType:'ORDER',businessId:f.id}),expect.objectContaining({businessType:'OFFLINE_CASE',businessId:offline.offlineCaseId})]));expect(log.businessReferences.some(r=>r.businessType==='REFUND')).toBe(false);}
});

it('一项真实缺货事件涉及两订单时，事件及库存购买阻塞审计保留两个确定订单引用',async()=>{
  const {db,app,admin}=fixture,f=await paid(),address=await db.address.findFirstOrThrow({where:{customerId:f.c.actor.subjectId}}),cart=await app.get(CartService).add(f.c,{skuId:f.sku.id,quantity:1});
  const input={addressId:address.id,items:[{cartItemId:cart.item.id,skuId:f.sku.id,quantity:1}]},orders=app.get(OrderService),quote=await orders.preview(f.c,input),second=await orders.create(f.c,{...input,quoteId:quote.quoteId},randomUUID());await app.get(OrderCommands).pay(f.c,second.orderId);
  const incident=await app.get(StockIncidents).create(admin,{skuId:f.sku.id,incidentKey:randomUUID(),reason:'实际检查两单共享SKU',evidenceNote:'隔离库缺货核对',evidenceFileIds:[]}),block=await db.inventoryPurchaseBlock.findFirstOrThrow({where:{sourceType:'ORDER_STOCK_EXCEPTION',sourceId:incident.id}});
  const logs=await db.auditLog.findMany({where:{OR:[{targetType:'StockIncident',targetId:incident.id},{targetType:'InventoryPurchaseBlock',targetId:block.id}]},include:{businessReferences:true}});expect(logs.length).toBe(2);
  for(const log of logs)expect(log.businessReferences.map(r=>r.businessId).sort()).toEqual([f.id,second.orderId].sort());
});

it('真实退货最终验收回补动作经FinalInspection关联售后和订单',async()=>{
  const {db,app,warehouse}=fixture,f=await shipped(),sale=await apply(f,'RETURN_REFUND');await review(sale.afterSaleId);const receipt=await receive(sale.afterSaleId);await draft(sale.afterSaleId,receipt);const current=await db.returnReceipt.findUniqueOrThrow({where:{id:receipt}});
  const final=await app.get(ReturnInspectionService).final(warehouse,sale.afterSaleId,{...await saleBody(sale.afterSaleId,'RETURN_INSPECT'),currentRevisionRefs:[current.currentInspectionRevisionId!]}),action=await db.inventoryAction.findFirstOrThrow({where:{businessType:'RETURN_INSPECTION',businessId:final.finalInspectionId!}}),log=await db.auditLog.findFirstOrThrow({where:{targetType:'InventoryAction',targetId:action.id},include:{businessReferences:true}});
  expect(log.businessReferences).toEqual(expect.arrayContaining([expect.objectContaining({businessType:'ORDER',businessId:f.id}),expect.objectContaining({businessType:'AFTER_SALE',businessId:sale.afterSaleId})]));
});

it('引用插入真实数据库失败使业务变更、审计和命令结果全部回滚',async()=>{
  const {db,admin}=fixture,f=await paid(),before=await db.order.findUniqueOrThrow({where:{id:f.id}}),requestId=randomUUID(),key=randomUUID();
  await db.$executeRawUnsafe(`CREATE FUNCTION reporting_reference_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '独占库引用失败'; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER reporting_reference_fail BEFORE INSERT ON audit_business_reference FOR EACH ROW EXECUTE FUNCTION reporting_reference_fail()`);
  try{
    await expect(db.$transaction(async tx=>{
      await tx.order.update({where:{id:f.id},data:{version:{increment:1}}});
      await tx.coordinationCommandResult.create({data:{orderId:f.id,action:'reporting-rollback',commandKey:key,fingerprint:'a'.repeat(64),resultType:'ORDER',resultId:f.id}});
      await new AuditService().appendAudit(tx,{actor:{type:'EMPLOYEE',id:admin.actor.subjectId},action:'order.fulfillment',targetId:f.id,requestId,reason:'验证引用写入失败'});
    })).rejects.toThrow();
  }finally{await db.$executeRawUnsafe('DROP TRIGGER reporting_reference_fail ON audit_business_reference');await db.$executeRawUnsafe('DROP FUNCTION reporting_reference_fail()');}
  expect(await db.order.findUniqueOrThrow({where:{id:f.id}})).toEqual(before);expect(await db.auditLog.count({where:{requestId}})).toBe(0);expect(await db.coordinationCommandResult.count({where:{commandKey:key}})).toBe(0);
});

it('有界回填断点可重跑且高水位固定；非UUID/缺失对象诊断，不从相同requestId猜订单',async()=>{
  const {db}=fixture,f=await paid(),requestId=randomUUID(),createdAt=new Date('2020-01-01T00:00:00Z');
  const legacy=await db.auditLog.createManyAndReturn({data:[
    {actorType:'SYSTEM',action:'order.close',targetType:'Order',targetId:f.id,reason:'原始原因',requestId,createdAt},
    {actorType:'SYSTEM',action:'order.close',targetType:'Order',targetId:f.id.toUpperCase(),reason:'原大写UUID目标不改写',requestId,createdAt},
    {actorType:'SYSTEM',action:'order.close',targetType:'Order',targetId:'legacy-not-a-uuid',reason:'原非UUID目标',requestId,createdAt},
    {actorType:'SYSTEM',action:'task.create',targetType:'Task',targetId:randomUUID(),reason:'原缺失任务',requestId,createdAt},
    {actorType:'SYSTEM',action:'future.unknown',targetType:'Coordination',targetId:randomUUID(),afterData:{coordinationAction:'future-action',orderId:f.id},reason:'未知不可推断',requestId,createdAt},
  ]});
  const before=await db.auditLog.findMany({orderBy:{id:'asc'}}),initial=await initialAuditReferenceCheckpoint(db);
  const newer=await db.auditLog.create({data:{actorType:'SYSTEM',action:'order.close',targetType:'Order',targetId:f.id,requestId:randomUUID(),reason:'高水位之后',createdAt:new Date(Date.now()+60000)}});
  let result=await backfillAuditReferenceBatch(db,initial,2);expect(result.scanned).toBe(2);expect(result.done).toBe(false);
  const repeated=await backfillAuditReferenceBatch(db,initial,2);expect(repeated.inserted).toBe(0);expect(repeated.checkpoint).toEqual(result.checkpoint);
  const diagnostics=[...result.diagnostics];while(!result.done){result=await backfillAuditReferenceBatch(db,result.checkpoint,20);diagnostics.push(...result.diagnostics);}
  expect(diagnostics.map(d=>d.reason)).toEqual(expect.arrayContaining(['NON_UUID_TARGET','MISSING_OBJECT','UNKNOWN_RELATIONSHIP']));
  expect(await db.auditBusinessReference.count({where:{auditLogId:newer.id}})).toBe(0);
  expect(await db.auditLog.findMany({where:{id:{in:before.map(l=>l.id)}},orderBy:{id:'asc'}})).toEqual(before);
  for(const row of legacy){const refs=await db.auditBusinessReference.findMany({where:{auditLogId:row.id}});if(row.targetId.toLowerCase()===f.id)expect(refs).toEqual([expect.objectContaining({businessType:'ORDER',businessId:f.id})]);else expect(refs).toEqual([]);}
  let replay=await backfillAuditReferenceBatch(db,initial,1000);expect(replay.inserted).toBe(0);while(!replay.done){replay=await backfillAuditReferenceBatch(db,replay.checkpoint,1000);expect(replay.inserted).toBe(0);}
});

it('投影主键、枚举、非空标识及审计FK约束由数据库强制执行',async()=>{
  const {db}=fixture,f=await paid(),log=await db.auditLog.findFirstOrThrow({where:{targetType:'Order',targetId:f.id}}),ref=await db.auditBusinessReference.findFirstOrThrow({where:{auditLogId:log.id}});
  await expect(db.auditBusinessReference.create({data:{auditLogId:ref.auditLogId,businessType:ref.businessType,businessId:ref.businessId,businessNo:ref.businessNo}})).rejects.toMatchObject({code:'P2002'});
  await expect(db.auditBusinessReference.create({data:{auditLogId:randomUUID(),businessType:'ORDER',businessId:f.id}})).rejects.toMatchObject({code:'P2003'});
  await expect(db.$executeRaw`INSERT INTO audit_business_reference(audit_log_id,business_type,business_id) VALUES(${log.id}::uuid,'ORDER',' ')`).rejects.toThrow();
  await expect(db.$executeRaw`INSERT INTO audit_business_reference(audit_log_id,business_type,business_id) VALUES(${log.id}::uuid,'UNKNOWN',${f.id})`).rejects.toThrow();
  await expect(db.auditLog.delete({where:{id:log.id}})).rejects.toMatchObject({code:'P2003'});
});

it('命令行维护显式apply且真实断点可续跑；再次从完成断点执行新增0且原日志不变',async()=>{
  const {db}=fixture,checkpoint=join(mkdtempSync(join(tmpdir(),'audit-reference-cli-')),'checkpoint.json'),before=await db.auditLog.findMany({orderBy:{id:'asc'}});
  const command=(apply:boolean,maxBatches:number)=>spawnSync(process.execPath,[resolve(__dirname,'../node_modules/tsx/dist/cli.mjs'),'scripts/backfill-audit-references.ts',...(apply?['--apply']:[]),'--checkpoint',checkpoint,'--batch-size','2','--max-batches',String(maxBatches)],{cwd:resolve(__dirname,'..'),env:process.env,encoding:'utf8',windowsHide:true});
  expect(command(false,1).status).toBe(1);const first=command(true,1);expect(first.status).toBe(0);expect(JSON.parse(first.stdout)).toMatchObject({scanned:2,done:false});
  const resumed=command(true,1000);expect(resumed.status).toBe(0);expect(JSON.parse(resumed.stdout).done).toBe(true);
  const repeated=command(true,1000);expect(repeated.status).toBe(0);expect(JSON.parse(repeated.stdout)).toMatchObject({scanned:0,inserted:0,done:true});
  expect(await db.auditLog.findMany({orderBy:{id:'asc'}})).toEqual(before);
},30000);
