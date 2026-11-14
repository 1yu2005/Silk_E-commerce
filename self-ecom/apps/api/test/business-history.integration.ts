// 作用：真实隔离PostgreSQL验证员工统一历史的权限、稳定SQL分页、退款重试与只读性；文件现场保留。
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdirSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { expect,it,vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { setupCoordinationFixtures,fixture,paid,shipped,apply,review,physical,saleTask,saleBody,communicate,http,employee,session,claim,receive,draft } from './coordination-fixtures.js';
import { BusinessHistoryService } from '../src/timeline/business-history.service.js';
import { BusinessHistoryQueryDto } from '../src/timeline/business-history.dto.js';
import { OrderHistoryController,AfterSaleHistoryController } from '../src/timeline/business-history.controller.js';
import { OrderIdDto } from '../src/orders/order.dto.js';
import { CommunicationService } from '../src/records/communication.service.js';
import { RefundService } from '../src/after-sales/refund.service.js';
import { EmployeeExtraPermissionService } from '../src/employees/employee-extra-permission.service.js';
import { OfflineCaseService } from '../src/coordination/offline-case.service.js';
import { CustomerService } from '../src/customers/customer.service.js';
import { ProxyInputService } from '../src/coordination/proxy-input.service.js';
import { ReturnInspectionService } from '../src/after-sales/return-inspection.service.js';
import { AfterSaleService } from '../src/after-sales/after-sale.service.js';
setupCoordinationFixtures({databasePrefix:'m414'});
// tsx/Vitest不生成decorator metadata；HTTP仍使用真实DTO和全局ValidationPipe。
for(const controller of [OrderHistoryController,AfterSaleHistoryController])Reflect.defineMetadata('design:paramtypes',[Object,Object,OrderIdDto,BusinessHistoryQueryDto],controller.prototype,'get');
const history=(id:string,actor=fixture.admin,type:'ORDER'|'AFTER_SALE'='ORDER',query={page:1,pageSize:100})=>fixture.app.get(BusinessHistoryService).history(actor,type,id,query);
async function communication(orderId:string,occurredAt:Date,result='客服内部核实结果'){
  return fixture.db.$transaction(tx=>fixture.app.get(CommunicationService).appendCommunication(tx,{identity:fixture.support.actor,token:fixture.support.token},{scopeType:'ORDER',scopeId:orderId,channel:'PHONE',occurredAt,result,publicText:'公开服务说明',requestId:randomUUID()}));
}
async function facts(){const db=fixture.db;return JSON.stringify({
  orders:await db.order.findMany({orderBy:{id:'asc'}}),payments:await db.payment.findMany({orderBy:{id:'asc'}}),refunds:await db.refund.findMany({orderBy:{id:'asc'}}),attempts:await db.refundAttempt.findMany({orderBy:{id:'asc'}}),
  inventory:await db.inventoryBalance.findMany({orderBy:{skuId:'asc'}}),actions:await db.inventoryAction.findMany({orderBy:{id:'asc'}}),ledger:await db.inventoryLedger.findMany({orderBy:{id:'asc'}}),tasks:await db.task.findMany({orderBy:{id:'asc'}}),taskHistory:await db.taskHistory.findMany({orderBy:{id:'asc'}}),deadlines:await db.deadlineEvent.findMany({orderBy:{id:'asc'}}),audits:await db.auditLog.findMany({orderBy:{id:'asc'}})});}
it('订单和售后复用真实事实来源，岗位裁剪发生在count之前，顾客公开history契约保持',async()=>{
  const f=await shipped(),sale=await apply(f,'RETURN_REFUND');await communicate(sale.afterSaleId);await communication(f.id,new Date(Date.now()-1000),'仓储不得看见的客服材料');
  const support=await history(f.id,fixture.support),warehouse=await history(f.id,fixture.warehouse),admin=await history(f.id);
  expect(support.items.some(x=>x.kind==='PAYMENT')).toBe(true);expect(support.items.some(x=>x.kind==='COMMUNICATION')).toBe(true);
  expect(warehouse.items.some(x=>['PAYMENT','COMMUNICATION','REFUND_ATTEMPT','OFFLINE_EVENT'].includes(x.kind))).toBe(false);
  expect(JSON.stringify(warehouse)).not.toContain('仓储不得看见');expect(warehouse.total).toBe(warehouse.items.length);expect(admin.total).toBeGreaterThan(warehouse.total);
  for(const row of [...warehouse.items,...support.items].filter(x=>['TASK_CHANGE','DEADLINE_EVENT'].includes(x.kind)))expect(row.internalNote).toBeNull();
  expect(warehouse.items.some(x=>x.source==='TIMER_PAUSE')).toBe(true);expect(warehouse.items.some(x=>x.source==='INVENTORY_LEDGER')).toBe(true);
  expect(warehouse.items.some(x=>x.source==='INVENTORY_LEDGER'&&x.action==='PAY')).toBe(true);
  const saleView=await history(sale.afterSaleId,fixture.warehouse,'AFTER_SALE');expect(saleView.items.some(x=>x.kind==='COMMUNICATION')).toBe(false);
  const publicHistory=await http('GET','/store/after-sales/'+sale.afterSaleId+'/history',f.c);expect(publicHistory.status).toBe(200);
  expect(publicHistory.json.data.items.every((x:Record<string,unknown>)=>'createdAt'in x&&'text'in x&&!('recordedAt'in x))).toBe(true);
  expect((await http('GET','/admin/orders/'+f.id+'/history',f.c)).status).toBe(401);
});
it('PAYMENT付款流水与RETURN_INSPECTION正式验收回补按真实父单纳入历史，其他订单不串入',async()=>{
  const f=await shipped(),sale=await apply(f,'RETURN_REFUND');await review(sale.afterSaleId);const receiptId=await receive(sale.afterSaleId);await draft(sale.afterSaleId,receiptId);
  const receipts=await fixture.db.returnReceipt.findMany({where:{afterSaleId:sale.afterSaleId}});await fixture.app.get(ReturnInspectionService).final(fixture.warehouse,sale.afterSaleId,{...await saleBody(sale.afterSaleId,'RETURN_INSPECT'),currentRevisionRefs:receipts.map(x=>x.currentInspectionRevisionId!)});
  const payment=await fixture.db.payment.findUniqueOrThrow({where:{orderId:f.id}}),final=await fixture.db.finalInspection.findUniqueOrThrow({where:{afterSaleId:sale.afterSaleId}}),ledgers=await fixture.db.inventoryLedger.findMany({where:{OR:[{businessType:'PAYMENT',businessId:payment.id},{businessType:'RETURN_INSPECTION',businessId:final.id}]}});
  expect(ledgers.map(x=>x.eventType).sort()).toEqual(['PAY','RETURN_RESTOCK']);expect(await fixture.db.inventoryBalance.findUnique({where:{skuId:f.sku.id}})).toMatchObject({available:10,reserved:0});
  const other=await paid(),otherPayment=await fixture.db.payment.findUniqueOrThrow({where:{orderId:other.id}}),foreign=await fixture.db.inventoryLedger.findMany({where:{businessType:'PAYMENT',businessId:otherPayment.id}});
  for(const [id,type] of [[f.id,'ORDER'],[sale.afterSaleId,'AFTER_SALE']] as const){
    const result=await history(id,fixture.warehouse,type);for(const row of ledgers)expect(result.items.some(x=>x.id===row.id&&x.kind==='INVENTORY_ACTION'&&x.source==='INVENTORY_LEDGER')).toBe(true);
    for(const row of foreign)expect(result.items.some(x=>x.id===row.id)).toBe(false);
    const service=await history(id,fixture.support,type);expect(service.items.some(x=>x.kind==='INVENTORY_ACTION')).toBe(false);
  }
});
it('正式售后跨北京午夜暂停后撤销恢复，独立恢复事件保留新期限且同刻两事实稳定不折叠',async()=>{
  const f=await shipped(),day=86400000,midnight=new Date(Math.floor((+fixture.clock.now()+8*3600000)/day)*day+day-8*3600000);
  fixture.clock.value=new Date(+midnight-1);
  // 业务时刻前移后由真实会话服务重新签发，不把过期token当作有效身份。
  const c=await session('CUSTOMER',f.c.actor.subjectId),admin=await session('EMPLOYEE',fixture.admin.actor.subjectId),warehouse=await session('EMPLOYEE',fixture.warehouse.actor.subjectId);
  const sale=await apply({...f,c},'RETURN_REFUND'),pause=await fixture.db.timerPause.findFirstOrThrow({where:{orderId:f.id},orderBy:{cycleNo:'desc'}});
  expect(pause).toMatchObject({status:'ACTIVE',pausedAt:new Date(+midnight-1),resumedAt:null,newDueAt:null});expect(pause.remainingMs).toBeGreaterThan(BigInt(3*day));
  expect((await history(f.id,warehouse)).items.some(x=>x.source==='TIMER_RESUME')).toBe(false);
  const resumedAt=new Date(+midnight+1234);fixture.clock.value=resumedAt;
  await fixture.app.get(AfterSaleService).withdraw(c,sale.afterSaleId,await saleBody(sale.afterSaleId));
  const resumed=await fixture.db.timerPause.findUniqueOrThrow({where:{id:pause.id}}),order=await fixture.db.order.findUniqueOrThrow({where:{id:f.id}});
  expect(resumed).toMatchObject({status:'RESUMED',resumedAt,newDueAt:new Date(+resumedAt+Number(pause.remainingMs))});expect(order.autoReceiptDueAt).toEqual(resumed.newDueAt);
  const before=await facts();
  for(const actor of [admin,warehouse]){
    const view=await history(f.id,actor),pair=view.items.filter(x=>x.id===pause.id&&['TIMER_PAUSE','TIMER_RESUME'].includes(x.source));
    expect(pair.map(x=>x.source)).toEqual(['TIMER_RESUME','TIMER_PAUSE']);
    expect(pair[0]).toMatchObject({kind:'STATE_CHANGE',recordedAt:resumedAt,occurredAt:resumedAt,beforeStatus:'PAUSED',afterStatus:'RESUMED',newDueAt:order.autoReceiptDueAt,internalNote:null});
    expect(pair[1]).toMatchObject({recordedAt:pause.pausedAt,afterStatus:'PAUSED',newDueAt:null});expect(new Set(pair.map(x=>x.kind+':'+x.id+':'+x.source)).size).toBe(2);
    expect(JSON.stringify(pair)).not.toContain(resumed.endReason!);expect(view.total).toBe(view.items.length);
  }
  const response=await http('GET','/admin/orders/'+f.id+'/history?kind=STATE_CHANGE',warehouse);expect(response.status).toBe(200);
  expect(response.json.data.items.find((x:{source:string;id:string})=>x.source==='TIMER_RESUME'&&x.id===pause.id)).toMatchObject({recordedAt:resumedAt.toISOString(),newDueAt:order.autoReceiptDueAt!.toISOString()});
  expect((await http('GET','/admin/orders/'+f.id+'/history',c)).status).toBe(401);
  const customer=await http('GET','/store/after-sales/'+sale.afterSaleId+'/history',c);expect(customer.status).toBe(200);
  expect(customer.json.data.items.every((x:Record<string,unknown>)=>'createdAt'in x&&'text'in x&&!('source'in x)&&!('newDueAt'in x))).toBe(true);expect(await facts()).toBe(before);
  // 同一领域Clock里产生下一周期的暂停和恢复：原id保留，source作固定消歧键。
  const next=await apply({...f,c},'RETURN_REFUND');await fixture.app.get(AfterSaleService).withdraw(c,next.afterSaleId,await saleBody(next.afterSaleId));
  const sameClock=await fixture.db.timerPause.findFirstOrThrow({where:{orderId:f.id},orderBy:{cycleNo:'desc'}});expect(sameClock.resumedAt).toEqual(sameClock.pausedAt);
  const pair=(await history(f.id,warehouse)).items.filter(x=>x.id===sameClock.id&&['TIMER_PAUSE','TIMER_RESUME'].includes(x.source));expect(pair.map(x=>x.source)).toEqual(['TIMER_PAUSE','TIMER_RESUME']);expect(new Set(pair.map(x=>x.kind+':'+x.id+':'+x.source)).size).toBe(2);
});
it('固定kind及严格DTO，安全大页/缺对象/无权限不泄露其他对象',async()=>{
  const f=await paid(),path='/admin/orders/'+f.id+'/history';
  for(const query of ['kind=AUDIT_LOG','kind=COMMUNICATION&raw=true','pageSize=101','page=1.5','page=0','pageSize=','kind=PAYMENT&kind=COMMUNICATION'])expect((await http('GET',path+'?'+query,fixture.support)).status).toBe(400);
  const page=await http('GET',path+'?page='+Number.MAX_SAFE_INTEGER+'&pageSize=100',fixture.support);expect(page.status).toBe(200);expect(page.json.data.items).toEqual([]);expect(page.json.data.total).toBeGreaterThan(0);
  expect((await http('GET','/admin/orders/not-a-uuid/history',fixture.support)).status).toBe(400);
  expect((await http('GET','/admin/orders/'+randomUUID()+'/history',fixture.support)).json.code).toBe('ORDER_NOT_FOUND');
  expect((await http('GET','/admin/after-sales/'+randomUUID()+'/history',fixture.support)).json.code).toBe('AFTER_SALE_NOT_FOUND');
});
it('晚录按recordedAt进入新页，固定kind/id同刻排序且跨页不丢不重',async()=>{
  const f=await paid(),older=await communication(f.id,new Date(Date.now()-1000),'先录近发生'),lateAt=new Date(Date.now()-86400000),late=await communication(f.id,lateAt,'后录早发生');
  const view=await history(f.id,fixture.support,'ORDER',{page:1,pageSize:100}),rows=view.items.filter(x=>x.kind==='COMMUNICATION');
  expect(rows.map(x=>x.id).indexOf(late.id)).toBeLessThan(rows.map(x=>x.id).indexOf(older.id));expect(rows.find(x=>x.id===late.id)!.occurredAt).toEqual(lateAt);
  // 明确性能夹具：合法关联真实订单，制造同记录时间并保留不同id；不当作支付/退款端到端事实。
  const recordedAt=new Date(),data=Array.from({length:120},(_,i)=>({id:randomUUID(),scopeType:'ORDER' as const,scopeId:f.id,authorEmployeeId:fixture.support.actor.subjectId,channel:'PHONE' as const,occurredAt:new Date(+recordedAt-i*1000),result:'性能夹具同刻事件',requestId:randomUUID(),createdAt:recordedAt}));
  await fixture.db.communication.createMany({data});const all=[];
  for(let page=1;page<=7;page++){const result=await fixture.app.get(BusinessHistoryService).history(fixture.support,'ORDER',f.id,{page,pageSize:20,kind:'COMMUNICATION'});expect(result.total).toBe(122);all.push(...result.items);}
  expect(all).toHaveLength(122);expect(new Set(all.map(x=>x.kind+':'+x.id)).size).toBe(122);
  expect(all.slice(0,120).map(x=>x.id)).toEqual(data.map(x=>x.id).sort().reverse());
});
it('失败退款Attempt逐次保留，重试成功不折叠，真实库存退款来源可查',async()=>{
  const f=await paid(),sale=await apply(f);await review(sale.afterSaleId);await physical(f,sale.afterSaleId);await saleTask(sale.afterSaleId,'REFUND_PROCESS');
  const body=async()=>{const a=await fixture.db.afterSale.findUniqueOrThrow({where:{id:sale.afterSaleId}});return {...await saleBody(a.id,'REFUND_PROCESS'),physicalCheckId:a.activeUnshippedCheckId!};};
  fixture.simulator.mode='FAIL_ONCE';const first=await fixture.app.get(RefundService).execute(fixture.support,sale.afterSaleId,await body());expect(first.attemptOutcome).toBe('FAILED');
  await fixture.app.get(RefundService).execute(fixture.support,sale.afterSaleId,{...await body(),refundId:first.refundId,expectedRefundVersion:first.refundVersion},true);
  const result=await fixture.app.get(BusinessHistoryService).history(fixture.support,'AFTER_SALE',sale.afterSaleId,{page:1,pageSize:20,kind:'REFUND_ATTEMPT'});
  expect(result.total).toBe(2);expect(result.items.map(x=>x.afterStatus).sort()).toEqual(['FAILED','SUCCEEDED']);expect(new Set(result.items.map(x=>x.id)).size).toBe(2);
  expect(result.items.every(x=>x.amountCents===20600)).toBe(true);expect((await history(sale.afterSaleId,fixture.warehouse,'AFTER_SALE')).items.some(x=>x.kind==='REFUND_ATTEMPT')).toBe(false);
  expect((await history(f.id,fixture.warehouse)).items.some(x=>x.kind==='INVENTORY_ACTION')).toBe(true);
});
it('个人额外授权即时生效；线下与代录来源仍遵守独立权限',async()=>{
  const f=await paid(),service=fixture.app.get(OfflineCaseService),oc=await service.create(fixture.support,{orderId:f.id,type:'OTHER_SERVICE',subject:'历史隔离线下工单',description:'内部材料',publicSummary:'已登记',expectedOrderVersion:(await fixture.db.order.findUniqueOrThrow({where:{id:f.id}})).version,commandKey:randomUUID(),reason:'真实登记'});
  // 明确范围夹具：合法工单的普通/代录事件用于来源权限断言，不伪造交易。
  await fixture.db.offlineCaseEvent.create({data:{offlineCaseId:oc.offlineCaseId,kind:'PROGRESS',occurredAt:new Date(),channel:'PHONE',result:'独立线下权限资料',actorEmployeeId:fixture.support.actor.subjectId,commandKey:randomUUID(),requestId:randomUUID()}});
  const employeeContext=await employee('MERCH_WAREHOUSE'),before=await history(f.id,employeeContext);expect(before.items.some(x=>x.kind==='OFFLINE_EVENT')).toBe(false);
  await fixture.app.get(EmployeeExtraPermissionService).replace(fixture.admin.actor,fixture.admin.token,employeeContext.actor.subjectId,{permissions:['offline-case.manage'],expectedVersion:0,reason:'本轮历史来源授权'},randomUUID());
  const current=await session('EMPLOYEE',employeeContext.actor.subjectId),after=await history(f.id,current);expect(after.items.some(x=>x.kind==='OFFLINE_EVENT')).toBe(true);expect(after.total).toBeGreaterThan(before.total);
  expect(after.items.some(x=>x.kind==='PAYMENT')).toBe(true); // 依赖补齐order.service.read，按当前权限而非岗位硬编码。
});
it('代录来源仍需独立权限及原核实人范围，不泄露共享Task来源材料',async()=>{
  const f=await paid(),customer=await fixture.db.customer.findUniqueOrThrow({where:{id:f.c.actor.subjectId}});
  await fixture.app.get(CustomerService).change(fixture.admin,customer.id,'LOGIN_FROZEN',{expectedVersion:customer.statusVersion,reason:'本轮历史代录权限验证'});
  const c=await fixture.db.customer.findUniqueOrThrow({where:{id:customer.id}}),o=await fixture.db.order.findUniqueOrThrow({where:{id:f.id}}),comm=await communication(f.id,new Date(Date.now()-100),'本轮独立身份核实沟通'),proxy=fixture.app.get(ProxyInputService);
  const context=await proxy.create(fixture.support,c.id,{orderId:f.id,action:'APPLY_AFTER_SALE',method:'PHONE_CALLBACK',verificationSummary:'仅原核实人能读取的代录核实材料',sourceCommunicationId:comm.id,expectedCustomerStatusVersion:c.statusVersion,expectedOrderVersion:o.version,commandKey:randomUUID(),reason:'本次指定诉求'});
  const t=await claim(f.id,'PROXY_INPUT',fixture.support);await proxy.apply(fixture.support,context.proxyContextId,{orderId:f.id,type:'REFUND_ONLY',reasonCode:'QUALITY',description:'真实冻结顾客代录诉求',evidenceFileIds:[],commandKey:randomUUID(),expectedProxyTaskVersion:t.version});
  const full=await history(f.id,fixture.support);expect(full.items.some(x=>x.source==='PROXY_EXECUTION')).toBe(true);expect(JSON.stringify(full)).not.toContain('仅原核实人能读取');
  const employeeContext=await employee('MERCH_WAREHOUSE'),extra=fixture.app.get(EmployeeExtraPermissionService);
  await extra.replace(fixture.admin.actor,fixture.admin.token,employeeContext.actor.subjectId,{permissions:['after-sale.service.read'],expectedVersion:0,reason:'只授服务历史范围'},randomUUID());
  const limited=await session('EMPLOYEE',employeeContext.actor.subjectId),withoutProxy=await history(f.id,limited);expect(withoutProxy.items.some(x=>x.source==='PROXY_EXECUTION'||x.taskStage==='PROXY_INPUT')).toBe(false);
  await extra.replace(fixture.admin.actor,fixture.admin.token,employeeContext.actor.subjectId,{permissions:['customer.frozen.proxy'],expectedVersion:1,reason:'独立核实授权仍不获取他人核实内容'},randomUUID());
  const otherVerifier=await history(f.id,await session('EMPLOYEE',employeeContext.actor.subjectId));expect(otherVerifier.items.some(x=>x.source==='PROXY_EXECUTION')).toBe(false);
  expect(otherVerifier.items.filter(x=>x.kind==='TASK_CHANGE').every(x=>x.internalNote===null)).toBe(true);
});
function statement(value:unknown){if(typeof value==='string')return {text:value,values:[] as unknown[]};const config=value as {text?:string;values?:unknown[]};return {text:config?.text??'',values:config?.values??[]};}
it('count之后并发追加真实沟通不会进入同次items，下一次GET才看到新事实',async()=>{
  const f=await paid(),original=Client.prototype.query;let appendedId:string|undefined,inserted=false;
  const wrapper=function(this:Client,...args:unknown[]){
    const result=Reflect.apply(original,this,args) as Promise<unknown>,sql=statement(args[0]).text;
    if(!inserted&&sql.includes('SELECT count(*) AS total')&&sql.includes('visible_history')){
      inserted=true;return result.then(async value=>{appendedId=(await communication(f.id,new Date(Date.now()-1000),'count后并发提交的真实沟通')).id;return value;});
    }return result;
  };
  const spy=vi.spyOn(Client.prototype,'query').mockImplementation(wrapper as unknown as typeof Client.prototype.query);let view:Awaited<ReturnType<typeof history>>;
  try{view=await history(f.id,fixture.support);}finally{spy.mockRestore();}
  expect(inserted).toBe(true);expect(view!.items.some(x=>x.id===appendedId)).toBe(false);expect(view!.total).toBe(view!.items.length);
  const next=await history(f.id,fixture.support);expect(next.items.some(x=>x.id===appendedId)).toBe(true);expect(next.total).toBe(view!.total+1);
});
it('20与100条SQL次数恒定；count和items真实计划与RR快照可核验，GET不写业务事实',async()=>{
  const f=await paid(),now=new Date();await fixture.db.communication.createMany({data:Array.from({length:120},()=>({scopeType:'ORDER' as const,scopeId:f.id,authorEmployeeId:fixture.support.actor.subjectId,channel:'PHONE' as const,occurredAt:now,result:'独立SQL性能夹具',requestId:randomUUID(),createdAt:now}))});
  const before=await facts(),spy=vi.spyOn(Client.prototype,'query');let first:ReturnType<typeof statement>[],second:ReturnType<typeof statement>[];
  try{await history(f.id,fixture.admin,'ORDER',{page:1,pageSize:20});first=spy.mock.calls.map(args=>statement(args[0]));spy.mockClear();await history(f.id,fixture.admin,'ORDER',{page:1,pageSize:100});second=spy.mock.calls.map(args=>statement(args[0]));}finally{spy.mockRestore();}
  expect(first!.length).toBe(second!.length);expect(first!.some(x=>/REPEATABLE READ/i.test(x.text))).toBe(true);expect(first!.some(x=>x.text.includes('SET TRANSACTION READ ONLY'))).toBe(true);expect(first!.filter(x=>x.text.includes('visible_history'))).toHaveLength(2);
  const plans=[];for(const sql of second!.filter(x=>x.text.includes('visible_history'))){const client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();try{const result=await client.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql.text,sql.values);plans.push(result.rows[0]['QUERY PLAN']);}finally{await client.end();}}
  const evidenceDirectory=resolve('../../docs/verification/evidence/M4-14');mkdirSync(evidenceDirectory,{recursive:true});
  writeFileSync(resolve(evidenceDirectory,'business-history-sql-'+Date.now()+'.json'),JSON.stringify({recordedAt:new Date().toISOString(),page20Queries:first!.length,page100Queries:second!.length,plans},null,2)+'\n');expect(await facts()).toBe(before);
});
it('GET可以在订单及SKU写行被其他事务锁定时完成，不复用业务写锁',async()=>{
  const f=await paid();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),held=new Promise<void>(r=>entered=r);
  const lock=fixture.db.$transaction(async tx=>{await tx.$queryRaw(Prisma.sql`SELECT id FROM "order" WHERE id=${f.id}::uuid FOR UPDATE`);await tx.$queryRaw(Prisma.sql`SELECT id FROM sku WHERE id=${f.sku.id}::uuid FOR UPDATE`);entered();await gate;},{timeout:5000});
  await held;try{const result=await http('GET','/admin/orders/'+f.id+'/history',fixture.admin);expect(result.status).toBe(200);}finally{release();await lock;}
});
