// 作用：独立m414库以真实完成/未收货订单核验消费批量查询、详情一致、MVCC与真实reader故障；不伪造资金事实。
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdirSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { expect,it,vi } from 'vitest';
import { setupCoordinationFixtures,fixture,shipped,http } from './coordination-fixtures.js';
import { CustomerService } from '../src/customers/customer.service.js';
import { CustomerController } from '../src/customers/customer.controller.js';
import { CustomerIdDto,CustomerQueryDto } from '../src/customers/customer.dto.js';
import { FulfillmentService } from '../src/orders/fulfillment.service.js';
setupCoordinationFixtures({databasePrefix:'m414'});
Reflect.defineMetadata('design:paramtypes',[Object,Object,CustomerQueryDto],CustomerController.prototype,'list');
for(const method of ['detail','consumption'])Reflect.defineMetadata('design:paramtypes',[Object,Object,CustomerIdDto],CustomerController.prototype,method);
const tag='消费批量_'+randomUUID().slice(0,8),tracked:{customerId:string;orderId:string;amount:string}[]=[];
let pending:Awaited<ReturnType<typeof shipped>>;
const customers=()=>fixture.app.get(CustomerService);
function sql(value:unknown){return typeof value==='string'?value:(value as {text?:string})?.text??'';}
function save(label:string,value:unknown){const directory=resolve('../../docs/verification/evidence/M4-14');mkdirSync(directory,{recursive:true});writeFileSync(resolve(directory,label+'-'+Date.now()+'.json'),JSON.stringify({recordedAt:new Date().toISOString(),evidence:value},null,2)+'\n');}
async function financialFacts(){const db=fixture.db;return JSON.stringify({orders:await db.order.findMany({orderBy:{id:'asc'}}),payments:await db.payment.findMany({orderBy:{id:'asc'}}),refunds:await db.refund.findMany({orderBy:{id:'asc'}}),attempts:await db.refundAttempt.findMany({orderBy:{id:'asc'}}),balances:await db.inventoryBalance.findMany({orderBy:{skuId:'asc'}}),actions:await db.inventoryAction.findMany({orderBy:{id:'asc'}}),ledger:await db.inventoryLedger.findMany({orderBy:{id:'asc'}}),tasks:await db.task.findMany({orderBy:{id:'asc'}}),audit:await db.auditLog.findMany({orderBy:{id:'asc'}})});}
it('真实完成与未收货顾客聚合不同，列表和详情/独立消费接口相符',async()=>{
  for(let i=0;i<3;i++){
    const f=await shipped();if(i<2)await fixture.app.get(FulfillmentService).confirmReceipt(f.c,f.id);else pending=f;
    await fixture.db.customer.update({where:{id:f.c.actor.subjectId},data:{nickname:tag}});tracked.push({customerId:f.c.actor.subjectId,orderId:f.id,amount:i<2?'20600':'0'});
  }
  const list=await customers().list(fixture.support,{page:1,pageSize:20,nickname:tag});expect(list.total).toBe(3);expect(new Set(list.items.map(x=>x.consumption.asOf)).size).toBe(1);
  for(const expected of tracked){const row=list.items.find(x=>x.id===expected.customerId)!;expect(row.consumption).toMatchObject({availability:'AVAILABLE',amountCents:expected.amount,currency:'CNY',definitionVersion:'completed-unrefunded-v1'});const detail=await customers().detail(fixture.support,expected.customerId),consumed=await customers().consumed(fixture.support,expected.customerId);expect(detail.ordersAvailability).toBe('AVAILABLE');expect(consumed.amountCents).toBe(row.consumption.amountCents);}
  save('consumption-facts',{tracked,items:list.items.map(x=>({customerId:x.id,consumption:x.consumption}))});
});
it('120个无消费合法性能顾客与真实顾客混合，20→100列表数据库查询预算恒定',async()=>{
  // 只追加无订单顾客作为性能基数；不直接SQL创建成功交易或消费额。
  const createdAt=new Date(Date.now()-86400000);await fixture.db.customer.createMany({data:Array.from({length:120},(_,i)=>({phone:'137'+String(10000000+i),nickname:tag,passwordHash:fixture.hash,createdAt}))});
  const before=await financialFacts(),spy=vi.spyOn(Client.prototype,'query'),counts:Record<string,number>={},statements:Record<string,string[]>={};let sample:Awaited<ReturnType<CustomerService['list']>>;
  try{for(const pageSize of [20,100]){spy.mockClear();const result=await customers().list(fixture.support,{page:1,pageSize,nickname:tag});expect(result.items).toHaveLength(pageSize);expect(result.total).toBe(123);counts[pageSize]=spy.mock.calls.length;statements[pageSize]=spy.mock.calls.map(args=>sql(args[0]));if(pageSize===100)sample=result;}}finally{spy.mockRestore();}
  expect(counts[20]).toBe(counts[100]);expect(counts[100]).toBeLessThanOrEqual(9);expect(statements[100]!.filter(text=>text.includes('o.customer_id=ANY'))).toHaveLength(1);expect(statements[100]!.some(text=>/REPEATABLE READ/.test(text))).toBe(true);
  for(const row of sample!.items.slice(0,8)){const exact=await customers().consumed(fixture.support,row.id);expect(row.consumption.amountCents).toBe(exact.amountCents);expect(row.consumption.availability).toBe('AVAILABLE');}
  expect(await financialFacts()).toBe(before);save('consumption-query-budget',{counts,statements,rows20:20,rows100:100,total:123});
});
it('列表选定顾客后并发真实确认收货，消费批量聚合仍读取旧快照',async()=>{
  const original=Client.prototype.query;let completed=false;
  const wrapper=function(this:Client,...args:unknown[]){const result=Reflect.apply(original,this,args) as Promise<unknown>,text=sql(args[0]);
    if(!completed&&/FROM\s+"public"\."customer"/.test(text)&&text.includes('LIMIT')){completed=true;return result.then(async value=>{await fixture.app.get(FulfillmentService).confirmReceipt(pending.c,pending.id);return value;});}return result;};
  const spy=vi.spyOn(Client.prototype,'query').mockImplementation(wrapper as unknown as typeof Client.prototype.query);let snapshot:Awaited<ReturnType<CustomerService['list']>>;
  try{snapshot=await customers().list(fixture.support,{page:1,pageSize:100,nickname:tag});}finally{spy.mockRestore();}
  expect(completed).toBe(true);const old=snapshot!.items.find(x=>x.id===pending.c.actor.subjectId)!;expect(old.consumption.amountCents).toBe('0');const after=await customers().consumed(fixture.support,pending.c.actor.subjectId);expect(after.amountCents).toBe('20600');expect(await fixture.db.order.findUnique({where:{id:pending.id}})).toMatchObject({status:'COMPLETED'});save('consumption-mvcc',{customerId:pending.c.actor.subjectId,listSnapshot:old.consumption,nextRead:after});
});
it('真实PG消费reader语句超时让列表/详情/消费明确503，不能成功降级成0',async()=>{
  const results=[];for(const path of ['/admin/customers?nickname='+encodeURIComponent(tag),'/admin/customers/'+tracked[0]!.customerId,'/admin/customers/'+tracked[0]!.customerId+'/consumption']){
    const original=Client.prototype.query;let timedOut=false;
    const wrapper=function(this:Client,...args:unknown[]){if(!timedOut&&sql(args[0]).includes('SUM(p.amount_cents::bigint)')){
      timedOut=true;return (async()=>{await Reflect.apply(original,this,[{text:'SET LOCAL statement_timeout=1'}]);await Reflect.apply(original,this,[{text:'SELECT pg_sleep(0.1)'}]);return Reflect.apply(original,this,args);})();
    }return Reflect.apply(original,this,args);};
    const spy=vi.spyOn(Client.prototype,'query').mockImplementation(wrapper as unknown as typeof Client.prototype.query);let result:Awaited<ReturnType<typeof http>>;
    try{result=await http('GET',path,fixture.support);}finally{spy.mockRestore();}
    expect(timedOut).toBe(true);expect(result!.status).toBe(503);expect(result!.json.code).toBe('CUSTOMER_CONSUMPTION_UNAVAILABLE');expect(result!.json.data).toBeUndefined();expect(JSON.stringify(result!.json)).not.toMatch(/SELECT|postgres|password|stack/i);results.push({path,status:result!.status,error:result!.json});
  }
  const recovered=await http('GET','/admin/customers/'+tracked[0]!.customerId+'/consumption',fixture.support);expect(recovered.status).toBe(200);expect(recovered.json.data.amountCents).toBe('20600');save('consumption-reader-fault',{results,recovered:true});
});
it('无customer.read的岗位不获得消费入口；大页安全为空，GET在订单行被锁定时正常完成',async()=>{
  expect((await http('GET','/admin/customers/'+tracked[0]!.customerId+'/consumption',fixture.warehouse)).status).toBe(403);
  const page=await http('GET','/admin/customers?page='+Number.MAX_SAFE_INTEGER+'&pageSize=100',fixture.support);expect(page.status).toBe(200);expect(page.json.data.items).toEqual([]);expect(page.json.data.total).toBe(123);
  let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),held=new Promise<void>(r=>entered=r),before=await financialFacts();
  const lock=fixture.db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "order" WHERE id=${tracked[0]!.orderId}::uuid FOR UPDATE`;entered();await gate;},{timeout:5000});await held;
  try{const result=await http('GET','/admin/customers/'+tracked[0]!.customerId+'/consumption',fixture.support);expect(result.status).toBe(200);expect(result.json.data.amountCents).toBe('20600');}finally{release();await lock;}
  expect(await financialFacts()).toBe(before);
});
