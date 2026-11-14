// 作用：独立m414真实PostgreSQL核验看板空库、半开时间边界、MVCC、只读、查询预算和真实连接故障。
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdirSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { Prisma } from '@prisma/client';
import { expect,it,vi } from 'vitest';
import { setupCoordinationFixtures,fixture,paid,http } from './coordination-fixtures.js';
import { ReportingService } from '../src/reporting/reporting.service.js';
import { ReportingController } from '../src/reporting/reporting.controller.js';
import { TrendQueryDto,HotProductsQueryDto } from '../src/reporting/reporting.dto.js';
import { PaginationDto } from '../src/common/http/pagination.dto.js';
setupCoordinationFixtures({databasePrefix:'m414'});
for(const [method,dto] of [['trends',TrendQueryDto],['hot',HotProductsQueryDto],['lowStock',PaginationDto]] as const)Reflect.defineMetadata('design:paramtypes',[Object,Object,dto],ReportingController.prototype,method);
const reporting=()=>fixture.app.get(ReportingService);
function sql(value:unknown){return typeof value==='string'?value:(value as {text?:string})?.text??'';}
function save(label:string,value:unknown){const directory=resolve('../../docs/verification/evidence/M4-14');mkdirSync(directory,{recursive:true});writeFileSync(resolve(directory,label+'-'+Date.now()+'.json'),JSON.stringify({recordedAt:new Date().toISOString(),evidence:value},null,2)+'\n');}
async function facts(){const db=fixture.db;return JSON.stringify({orders:await db.order.findMany({orderBy:{id:'asc'}}),payment:await db.payment.findMany({orderBy:{id:'asc'}}),refund:await db.refund.findMany({orderBy:{id:'asc'}}),attempts:await db.refundAttempt.findMany({orderBy:{id:'asc'}}),balance:await db.inventoryBalance.findMany({orderBy:{skuId:'asc'}}),inventory:await db.inventoryAction.findMany({orderBy:{id:'asc'}}),ledger:await db.inventoryLedger.findMany({orderBy:{id:'asc'}}),tasks:await db.task.findMany({orderBy:{id:'asc'}}),taskHistory:await db.taskHistory.findMany({orderBy:{id:'asc'}}),deadline:await db.deadlineEvent.findMany({orderBy:{id:'asc'}}),audit:await db.auditLog.findMany({orderBy:{id:'asc'}})});}
it('空业务库仍是真实AVAILABLE：今日/当前为字符串零，7/30天补零、热销和预警为空',async()=>{
  const overview=await reporting().overview(fixture.warehouse);expect(Object.values(overview.today)).toEqual(['0','0','0','0','0']);expect(Object.values(overview.current)).toEqual(['0','0','0','0','0']);
  for(const days of [7,30] as const){const result=await reporting().trends(fixture.warehouse,days);expect(result.items).toHaveLength(days);expect(new Set(result.items.map(x=>x.date)).size).toBe(days);expect(result.items.every(x=>x.paidAmountCents==='0'&&x.refundAmountCents==='0'&&x.netReceiptsCents==='0')).toBe(true);}
  expect((await reporting().hotProducts(fixture.warehouse,10)).items).toEqual([]);expect(await reporting().lowStock(fixture.warehouse,{page:1,pageSize:20})).toMatchObject({items:[],total:0});
});
it('北京午夜前1ms/午夜/次日午夜真实支付分别归属，asOf为严格半开终点',async()=>{
  const midnight=new Date('2026-11-15T16:00:00.000Z');
  fixture.clock.value=new Date(+midnight-1);const before=await paid();
  fixture.clock.value=midnight;const at=await paid();
  fixture.clock.value=new Date(+midnight+86400000);const next=await paid();
  const payments=await fixture.db.payment.findMany({where:{orderId:{in:[before.id,at.id,next.id]}},orderBy:{paidAt:'asc'}});expect(payments.map(x=>+x.paidAt)).toEqual([+midnight-1,+midnight,+midnight+86400000]);
  fixture.clock.value=midnight;const atBoundary=await reporting().overview(fixture.warehouse);expect(atBoundary.today.paidAmountCents).toBe('0');expect(atBoundary.from).toBe(midnight.toISOString());expect(atBoundary.to).toBe(midnight.toISOString());
  fixture.clock.value=new Date(+midnight+1);expect((await reporting().overview(fixture.warehouse)).today.paidAmountCents).toBe('20600');
  fixture.clock.value=new Date(+midnight+86400000+1);const trends=await reporting().trends(fixture.warehouse,7),byDate=new Map(trends.items.map(x=>[x.date,x]));
  expect(byDate.get('2026-11-15')!.paidAmountCents).toBe('20600');expect(byDate.get('2026-11-16')!.paidAmountCents).toBe('20600');expect(byDate.get('2026-11-17')!.paidAmountCents).toBe('20600');expect(trends.timeZone).toBe('Asia/Shanghai');
  save('reporting-midnight',{payments:payments.map(x=>({orderId:x.orderId,amountCents:x.amountCents,paidAt:x.paidAt})),atBoundary,trend:trends});
});
it('overview第一段读取后并发真实建单支付，today/current仍属于同一MVCC快照',async()=>{
  const baseline=await reporting().overview(fixture.warehouse),original=Client.prototype.query;let committedOrderId:string|undefined,inserted=false;
  const wrapper=function(this:Client,...args:unknown[]){const result=Reflect.apply(original,this,args) as Promise<unknown>,text=sql(args[0]);
    if(!inserted&&text.includes('AS "createdOrderCount"')&&text.includes('CROSS JOIN')){inserted=true;return result.then(async value=>{committedOrderId=(await paid()).id;return value;});}return result;};
  const spy=vi.spyOn(Client.prototype,'query').mockImplementation(wrapper as unknown as typeof Client.prototype.query);let snapshot:Awaited<ReturnType<ReportingService['overview']>>;
  try{snapshot=await reporting().overview(fixture.warehouse);}finally{spy.mockRestore();}
  expect(inserted).toBe(true);expect(snapshot!.current).toEqual(baseline.current);expect(snapshot!.today.paidAmountCents).toBe(baseline.today.paidAmountCents);
  const after=await reporting().overview(fixture.warehouse);expect(BigInt(after.current.waitingShipmentOrderCount)).toBe(BigInt(baseline.current.waitingShipmentOrderCount)+1n);
  expect(await fixture.db.payment.count({where:{orderId:committedOrderId}})).toBe(1);save('reporting-mvcc',{baseline,snapshot:snapshot!,after,committedOrderId});
});
it('生产read首句合并事务模式真实生效：RR/只读且PostgreSQL拒绝零行UPDATE，连接可恢复',async()=>{
  const original=Client.prototype.query,statements:string[]=[];let inspected=false,mode:Record<string,string>|undefined,writeErrorCode:string|undefined;
  const wrapper=function(this:Client,...args:unknown[]){
    const text=sql(args[0]);statements.push(text);
    if(!inspected&&text.includes('AS "createdOrderCount"')&&text.includes('CROSS JOIN')){
      inspected=true;
      return (async()=>{
        const result=await Reflect.apply(original,this,[{text:"SELECT current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') readonly"}]);mode=result.rows[0];
        try{await Reflect.apply(original,this,[{text:'UPDATE employee SET display_name=display_name WHERE false'}]);}catch(error){writeErrorCode=(error as {code?:string}).code;throw error;}
        throw new Error('数据库未拒绝只读事务中的UPDATE');
      })();
    }
    return Reflect.apply(original,this,args);
  };
  const spy=vi.spyOn(Client.prototype,'query').mockImplementation(wrapper as unknown as typeof Client.prototype.query);
  try{await expect(reporting().overview(fixture.warehouse)).rejects.toBeDefined();}finally{spy.mockRestore();}
  expect(inspected).toBe(true);expect(mode).toEqual({isolation:'repeatable read',readonly:'on'});expect(writeErrorCode).toBe('25006');
  const combined=statements.findIndex(text=>/SET TRANSACTION READ ONLY, ISOLATION LEVEL REPEATABLE READ/.test(text)),firstSelect=statements.findIndex(text=>/^\s*SELECT/i.test(text));
  expect(combined).toBeGreaterThanOrEqual(0);expect(firstSelect).toBeGreaterThan(combined);expect(statements.filter(text=>/^\s*SET/i.test(text))).toHaveLength(1);
  expect((await http('GET','/admin/dashboard/overview',fixture.warehouse)).status).toBe(200);save('reporting-transaction-mode',{mode,writeErrorCode,combinedBeforeFirstSelect:true,recovered:true});
});
async function performanceBalances(count:number){
  const db=fixture.db,productIds=Array.from({length:count},()=>randomUUID()),skuIds=Array.from({length:count},()=>randomUUID());
  await db.product.createMany({data:productIds.map(id=>({id,productCode:'RB-'+id,name:'独立预警查询预算夹具',status:'DRAFT',createdById:fixture.admin.actor.subjectId,updatedById:fixture.admin.actor.subjectId}))});
  await db.sku.createMany({data:skuIds.map((id,i)=>({id,code:('RB-'+id).toUpperCase(),productId:productIds[i]!,combinationSignature:'DEFAULT',priceCents:100,costCents:50}))});
  await db.inventoryBalance.createMany({data:skuIds.map(skuId=>({skuId,available:0,reserved:0,warningThreshold:0}))});return skuIds;
}
it('真实预警120行中20/100分页及7/30趋势SQL预算恒定，READ ONLY/RR可核验',async()=>{
  const baseline=await reporting().lowStock(fixture.warehouse,{page:1,pageSize:100});await performanceBalances(120);const original=Client.prototype.query,spy=vi.spyOn(Client.prototype,'query'),counts:Record<string,number>={},statements:Record<string,string[]>={};
  try{
    for(const pageSize of [20,100]){spy.mockClear();const result=await reporting().lowStock(fixture.warehouse,{page:1,pageSize});expect(result.items).toHaveLength(pageSize);expect(result.total).toBe(baseline.total+120);statements['low'+pageSize]=spy.mock.calls.map(args=>sql(args[0]));counts['low'+pageSize]=statements['low'+pageSize]!.length;}
    for(const days of [7,30] as const){spy.mockClear();await reporting().trends(fixture.warehouse,days);statements['trend'+days]=spy.mock.calls.map(args=>sql(args[0]));counts['trend'+days]=statements['trend'+days]!.length;}
  }finally{spy.mockRestore();expect(Client.prototype.query).toBe(original);}
  expect(counts.low20).toBe(counts.low100);expect(counts.trend7).toBe(counts.trend30);expect(statements.low20!.some(text=>/SET TRANSACTION READ ONLY/.test(text))).toBe(true);expect(statements.low20!.some(text=>/REPEATABLE READ/.test(text))).toBe(true);expect(counts.low100).toBeLessThanOrEqual(8);expect(counts.trend30).toBeLessThanOrEqual(7);
  save('reporting-query-budget',{counts,statements});
});
it('low-stock count后并发新增合法零余额账户，items和total仍在同一次快照',async()=>{
  const [skuId]=await performanceBalances(1),baseline=await reporting().lowStock(fixture.warehouse,{page:1,pageSize:100}),db=fixture.db;
  // 先准备SKU，随后仅追加零余额合法账户，不伪造库存增减或资金事实。
  expect(await db.sku.count({where:{id:skuId}})).toBe(1);const product=await db.product.create({data:{productCode:'RB-'+randomUUID(),name:'并发零余额来源',status:'DRAFT',createdById:fixture.admin.actor.subjectId,updatedById:fixture.admin.actor.subjectId}}),newSku=await db.sku.create({data:{code:('RB-'+randomUUID()).toUpperCase(),productId:product.id,combinationSignature:'DEFAULT',priceCents:100,costCents:50}});
  const original=Client.prototype.query;let inserted=false;
  const wrapper=function(this:Client,...args:unknown[]){const result=Reflect.apply(original,this,args) as Promise<unknown>,text=sql(args[0]);
    if(!inserted&&text.includes('SELECT count(*)::text total FROM inventory_balance')){inserted=true;return result.then(async value=>{await db.inventoryBalance.create({data:{skuId:newSku.id,available:0,reserved:0,warningThreshold:0}});return value;});}return result;};
  const spy=vi.spyOn(Client.prototype,'query').mockImplementation(wrapper as unknown as typeof Client.prototype.query);let snapshot:Awaited<ReturnType<ReportingService['lowStock']>>;
  try{snapshot=await reporting().lowStock(fixture.warehouse,{page:1,pageSize:100});}finally{spy.mockRestore();}
  expect(inserted).toBe(true);expect(snapshot!.total).toBe(baseline.total);expect(snapshot!.items.some(x=>x.skuId===newSku.id)).toBe(false);expect((await reporting().lowStock(fixture.warehouse,{page:1,pageSize:100})).total).toBe(baseline.total+1);
});
it('真实DB语句超时返回技术错误，不能以全零成功降级；后续连接可恢复',async()=>{
  const original=Client.prototype.query;let timedOut=false;
  const wrapper=function(this:Client,...args:unknown[]){const text=sql(args[0]);if(!timedOut&&text.includes('AS "createdOrderCount"')&&text.includes('CROSS JOIN')){
    timedOut=true;return (async()=>{await Reflect.apply(original,this,[{text:'SET LOCAL statement_timeout=1'}]);await Reflect.apply(original,this,[{text:'SELECT pg_sleep(0.1)'}]);return Reflect.apply(original,this,args);})();
  }return Reflect.apply(original,this,args);};
  const spy=vi.spyOn(Client.prototype,'query').mockImplementation(wrapper as unknown as typeof Client.prototype.query);let response:Awaited<ReturnType<typeof http>>;
  try{response=await http('GET','/admin/dashboard/overview',fixture.warehouse);}finally{spy.mockRestore();}
  expect(timedOut).toBe(true);expect(response!.status).toBe(500);expect(response!.json.data).toBeUndefined();expect(JSON.stringify(response!.json)).not.toMatch(/SELECT|postgres|password|stack/i);
  expect((await http('GET','/admin/dashboard/overview',fixture.warehouse)).status).toBe(200);save('reporting-db-fault',{status:response!.status,error:response!.json,recovered:true});
});
it('PostgreSQL聚合十进制编码跨JS安全整数仍精确，标为独立数值编码夹具',async()=>{
  // 不制造任何成功Payment/Refund。VALUES只核验报表采用的bigint/numeric→text驱动与JSON边界。
  const [row]=await fixture.db.$queryRaw<{paid:string;refund:string;net:string}[]>`WITH amounts AS (SELECT sum(n::bigint) AS paid FROM (VALUES (9007199254740991::bigint),(2::bigint)) v(n)) SELECT paid::text AS paid,(paid+1)::text AS refund,(-1::numeric)::text AS net FROM amounts`;
  expect(row).toEqual({paid:'9007199254740993',refund:'9007199254740994',net:'-1'});expect(JSON.parse(JSON.stringify(row))).toEqual(row);save('reporting-decimal-encoding',{fixtureType:'SQL_VALUES_ENCODING_ONLY_NO_BUSINESS_FACTS',row});
});
it('全部看板GET在业务写行锁持有期间完成且不改变交易/库存/任务/审计；严格分页与未知字段拒绝',async()=>{
  const f=await paid(),before=await facts();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),held=new Promise<void>(r=>entered=r);
  const lock=fixture.db.$transaction(async tx=>{await tx.$queryRaw(Prisma.sql`SELECT id FROM "order" WHERE id=${f.id}::uuid FOR UPDATE`);await tx.$queryRaw(Prisma.sql`SELECT id FROM sku WHERE id=${f.sku.id}::uuid FOR UPDATE`);entered();await gate;},{timeout:5000});await held;
  try{for(const path of ['/overview','/trends?days=7','/hot-products?limit=20','/low-stock?pageSize=100'])expect((await http('GET','/admin/dashboard'+path,fixture.warehouse)).status).toBe(200);}finally{release();await lock;}
  expect(await facts()).toBe(before);
  for(const path of ['/trends?days=8','/trends?timeZone=UTC','/hot-products?days=7','/hot-products?limit=21','/low-stock?pageSize=101','/low-stock?page=1.5'])expect((await http('GET','/admin/dashboard'+path,fixture.warehouse)).status).toBe(400);
  const page=await http('GET','/admin/dashboard/low-stock?page='+Number.MAX_SAFE_INTEGER+'&pageSize=100',fixture.warehouse);expect(page.status).toBe(200);expect(page.json.data.items).toEqual([]);expect(page.json.data.total).toBeGreaterThan(0);
});
