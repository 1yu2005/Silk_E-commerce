// 作用：板块14独占真实PostgreSQL验证审计HTTP权限、引用去重、稳定快照和安全投影。
import {randomUUID} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {Client} from 'pg';
import {beforeEach,expect,it,vi} from 'vitest';
import {AuditQueryController} from '../src/audit-query/audit-query.controller.js';
import {AuditFilterOptionsDto,AuditIdDto,AuditListQueryDto} from '../src/audit-query/audit-query.dto.js';
import {AuditQueryService} from '../src/audit-query/audit-query.service.js';
import type {Clock} from '../src/common/time/clock.js';
import type {PrismaService} from '../src/prisma/prisma.service.js';
import {EmployeeRoleService} from '../src/employees/employee-role.service.js';
import {RefundService} from '../src/after-sales/refund.service.js';
import {OrderAccess} from '../src/orders/order-access.service.js';
import {fixture as f,setupCoordinationFixtures,http,employee,customer,paid,apply,review,physical,claim,saleBody} from './coordination-fixtures.js';
Reflect.defineMetadata('design:paramtypes',[Object,Object,AuditListQueryDto],AuditQueryController.prototype,'list');
Reflect.defineMetadata('design:paramtypes',[Object,Object,AuditFilterOptionsDto],AuditQueryController.prototype,'filterOptions');
Reflect.defineMetadata('design:paramtypes',[Object,Object,AuditIdDto],AuditQueryController.prototype,'detail');
setupCoordinationFixtures({databasePrefix:'m414'});
const now=new Date('2030-11-15T02:00:00Z'),stamp=new Date('2030-11-14T18:00:00Z');
beforeEach(()=>{f.clock.value=now;});
type Row=Awaited<ReturnType<AuditQueryService['detail']>>;
type List=Awaited<ReturnType<AuditQueryService['list']>>;
async function audit(input:Partial<Prisma.AuditLogUncheckedCreateInput>={}){
  // 直接构造不可变旧审计/畸形历史夹具，仅证明读取安全，不冒充真实交易或writer成功证据。
  return f.db.auditLog.create({data:{actorType:'EMPLOYEE',actorEmployeeId:f.admin.actor.subjectId,action:'task.claim',targetType:'Task',targetId:randomUUID(),
    requestId:randomUUID(),createdAt:stamp,afterData:{taskStatus:'CLAIMED',round:1},...input}});
}
const range={from:'2030-11-08T16:00:00.000Z',to:now.toISOString()};
async function list(values:Record<string,string|number>={},ctx=f.admin){const p=new URLSearchParams(Object.entries(values).map(([k,v])=>[k,String(v)]));return http('GET','/admin/audit-logs?'+p,ctx);}
async function good<T>(promise:ReturnType<typeof http>):Promise<T>{const r=await promise;expect(r.status).toBe(200);expect(r.json.requestId).toEqual(expect.any(String));return r.json.data as T;}
it('默认最近7北京日期且from含/to不含，SYSTEM没有伪员工，未来事实不读',async()=>{
  const targetId=randomUUID(),from=new Date(range.from);
  for(const createdAt of [new Date(+from-1),from,new Date(+now-1),now,new Date(+now+1)])await audit({targetId,actorType:'SYSTEM',actorEmployeeId:null,action:'task.overdue.record',createdAt});
  const result=await good<List>(list({targetId}));expect(result).toMatchObject({total:2,page:1,pageSize:20,from:range.from,to:now.toISOString(),timeZone:'Asia/Shanghai',asOf:now.toISOString()});
  expect(result.items.every(r=>r.actor.type==='SYSTEM'&&r.actor.id===null&&r.actor.employee===null)).toBe(true);
});
it('同createdAt多行以id稳定分页，重复读取不漏不重，total取真实日志数',async()=>{
  const targetId=randomUUID(),rows=[];for(let i=0;i<23;i++)rows.push(await audit({targetId}));
  const first=await good<List>(list({targetId,...range})),second=await good<List>(list({targetId,...range,page:2})),again=await good<List>(list({targetId,...range}));
  const ids=rows.map(r=>r.id).sort().reverse();expect(first.total).toBe(23);expect(first.items.map(r=>r.id)).toEqual(ids.slice(0,20));expect(second.items.map(r=>r.id)).toEqual(ids.slice(20));expect(again.items).toEqual(first.items);
});
it('组合主体/动作/对象/请求/业务号筛选，EXISTS多引用不放大items或count',async()=>{
  const targetId=randomUUID(),requestId=randomUUID(),orderNo='O'+randomUUID().replaceAll('-','').toUpperCase(),saleNo='AS'+randomUUID().replaceAll('-','').toUpperCase();
  const row=await audit({targetId,requestId});await f.db.auditBusinessReference.createMany({data:[
    {auditLogId:row.id,businessType:'ORDER',businessId:randomUUID(),businessNo:orderNo},
    {auditLogId:row.id,businessType:'AFTER_SALE',businessId:randomUUID(),businessNo:saleNo},
  ]});await audit({targetId});
  const filter={...range,actorType:'EMPLOYEE',actorEmployeeId:f.admin.actor.subjectId,action:'task.claim',targetType:'Task',targetId,requestId,businessType:'ORDER',businessNo:'  '+orderNo+'  '};
  const selected=await good<List>(list(filter));expect(selected.total).toBe(1);expect(selected.items.map(x=>x.id)).toEqual([row.id]);expect(selected.items[0]!.businessReferences).toHaveLength(2);
  expect((await good<List>(list({...range,businessNo:saleNo}))).items.map(r=>r.id)).toEqual([row.id]);
  expect((await good<List>(list({...range,businessNo:orderNo+"' OR 1=1 --"}))).total).toBe(0);
  expect((await good<List>(list({...range,businessNo:'O-NOT-EXISTS'}))).items).toEqual([]);
});
it('真实支付→售后→逐行核实→成功模拟退款后，可按原订单/售后/退款号追踪已写引用',async()=>{
  f.clock.followWallClock();const order=await paid(),sale=await apply(order);await review(sale.afterSaleId);await physical(order,sale.afterSaleId);await claim(sale.afterSaleId,'REFUND_PROCESS',f.support,'AFTER_SALE');
  const current=await f.db.afterSale.findUniqueOrThrow({where:{id:sale.afterSaleId}});await f.app.get(RefundService).execute(f.support,sale.afterSaleId,{...await saleBody(sale.afterSaleId,'REFUND_PROCESS'),physicalCheckId:current.activeUnshippedCheckId!,expectedPhysicalVersion:(await f.db.order.findUniqueOrThrow({where:{id:order.id}})).stockPhysicalVersion});
  const stored=await f.db.order.findUniqueOrThrow({where:{id:order.id}}),refund=await f.db.refund.findUniqueOrThrow({where:{orderId:order.id}}),afterSale=await f.db.afterSale.findUniqueOrThrow({where:{id:sale.afterSaleId}});
  expect(refund.status).toBe('SUCCEEDED');
  const byOrder=await good<List>(list({businessType:'ORDER',businessNo:stored.number,pageSize:100}));
  expect(byOrder.items.some(r=>r.action==='order.pay')).toBe(true);expect(byOrder.items.some(r=>r.action==='after-sale.change')).toBe(true);expect(new Set(byOrder.items.map(r=>r.id)).size).toBe(byOrder.items.length);
  for(const [businessType,businessNo]of [['AFTER_SALE',afterSale.number],['REFUND',refund.refundNo]]){const r=await good<List>(list({businessType:businessType!,businessNo:businessNo!,pageSize:100}));expect(r.total).toBeGreaterThan(0);expect(r.items.every(x=>x.businessReferences.some(ref=>ref.businessType===businessType&&ref.businessNo===businessNo))).toBe(true);}
});
it('filter-options真实静态路由仅给最小当前员工标识，包含停用历史且无自由显示名',async()=>{
  const old=await employee('CUSTOMER_SERVICE'),e=await f.db.employee.update({where:{id:old.actor.subjectId},data:{status:'DISABLED',displayName:'不应展示的自由姓名13800138000'}});await audit({actorEmployeeId:e.id});
  const options=await good<Awaited<ReturnType<AuditQueryService['filterOptions']>>>(http('GET','/admin/audit-logs/filter-options?actorKeyword='+e.username+'&limit=100',f.admin));
  expect(options.employees).toHaveLength(1);expect(options.employees[0]).toMatchObject({id:e.id,username:e.username,disabled:true});expect(Object.keys(options.employees[0]!).sort()).toEqual(['disabled','displayName','id','username']);
  expect(JSON.stringify(options)).not.toContain('13800138000');expect(JSON.stringify(options)).not.toContain(e.passwordHash);
  expect((await good<List>(list({...range,actorEmployeeId:e.id}))).total).toBe(1);
});
it('仓储/客服所有审计入口403且早于参数/目标检查，顾客不能进入员工域',async()=>{
  const row=await audit();for(const ctx of [f.warehouse,f.support])for(const path of ['/admin/audit-logs?unknown=x','/admin/audit-logs/'+row.id,'/admin/audit-logs/not-uuid','/admin/audit-logs/filter-options?limit=999'])expect((await http('GET',path,ctx)).status).toBe(403);
  const c=await customer();expect((await http('GET','/admin/audit-logs',c)).status).toBe(401);
});
it('真实调岗后保留的旧管理员token下一请求立即403，不能凭旧快照读审计',async()=>{
  const former=await employee('SUPER_ADMIN');expect((await list({},former)).status).toBe(200);
  const e=await f.db.employee.findUniqueOrThrow({where:{id:former.actor.subjectId}});
  await f.app.get(EmployeeRoleService).change(f.admin.actor,f.admin.token,e.id,{role:'CUSTOMER_SERVICE',expectedVersion:e.version,reason:'独占测试正式撤销管理员岗位'},randomUUID());
  expect((await list({},former)).status).toBe(403);expect((await http('GET','/admin/audit-logs/filter-options',former)).status).toBe(403);
});
it.each(['list','detail','filterOptions'] as const)('Guard通过后真实调岗提交，%s事务再次验证当前权限且不返回旧payload或元数据',async method=>{
  const former=await employee('SUPER_ADMIN'),row=await audit(),service=f.app.get(AuditQueryService);
  let entered!:()=>void,release!:()=>void;const reached=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});
  const pause=async<T>(read:()=>Promise<T>)=>{entered();await gate;return read();};
  const originalList=service.list.bind(service),originalDetail=service.detail.bind(service),originalOptions=service.filterOptions.bind(service);
  const spy=method==='list'?vi.spyOn(service,'list').mockImplementation((...args)=>pause(()=>originalList(...args)))
    :method==='detail'?vi.spyOn(service,'detail').mockImplementation((...args)=>pause(()=>originalDetail(...args)))
      :vi.spyOn(service,'filterOptions').mockImplementation((...args)=>pause(()=>originalOptions(...args)));
  const path=method==='list'?'/admin/audit-logs':method==='detail'?'/admin/audit-logs/'+row.id:'/admin/audit-logs/filter-options';
  const pending=http('GET',path,former);
  try{
    await reached;const employee=await f.db.employee.findUniqueOrThrow({where:{id:former.actor.subjectId}});
    await f.app.get(EmployeeRoleService).change(f.admin.actor,f.admin.token,employee.id,{role:'CUSTOMER_SERVICE',expectedVersion:employee.version,reason:'Guard通过后正式调岗提交屏障'},randomUUID());
    release();const response=await pending;expect(response.status).toBe(403);expect(response.json.code).toBe('FORBIDDEN');
    expect(response.json.data).toBeUndefined();expect(JSON.stringify(response.json)).not.toMatch(/changes|businessReferences|employees|actorTypes|beforeData|afterData/);
  }finally{release();await pending;spy.mockRestore();}
});
it('已知与未知旧载荷、原因、账号自由字段均不兜底原文；必要改密/状态差异仍可读',async()=>{
  const secret='private-payload-secret',targetId=randomUUID(),row=await audit({action:'employee.password.reset',targetType:'Employee',targetId,reason:secret+' 13800138000 完整地址',beforeData:{passwordHash:secret,phone:'13800138000'},afterData:{passwordChanged:true,mustChangePassword:true,storage_key:secret,displayName:secret,rawBody:{token:secret}}});
  const detail=await good<Row>(http('GET','/admin/audit-logs/'+row.id,f.admin));expect(detail.changes.map(c=>c.field)).toEqual(['passwordChanged','mustChangePassword']);expect(detail.hasReason).toBe(true);expect(JSON.stringify(detail)).not.toContain(secret);expect(JSON.stringify(detail)).not.toContain('13800138000');
  const unknown=await audit({action:secret,targetType:'ArbitraryLegacyTarget',targetId:'private-address',reason:secret,afterData:{nested:{token:secret}}});
  const historical=await good<Row>(http('GET','/admin/audit-logs/'+unknown.id,f.admin));expect(historical).toMatchObject({action:'UNKNOWN',targetType:'UNKNOWN',targetId:null,detailsAvailable:false,changes:[]});expect(JSON.stringify(historical)).not.toContain(secret);
  expect((await http('GET','/admin/audit-logs/'+randomUUID(),f.admin)).json.code).toBe('AUDIT_LOG_NOT_FOUND');
});
it.each(['page=0','page=1e2','pageSize=101','page=101&pageSize=100','page=1&page=2','businessNo=','action=unknown.action','targetType=Unknown','actorType=SYSTEM&actorEmployeeId=00112233-4455-4677-8899-aabbccddeeff',
  'actorEmployeeId=00112233-4455-4677-8899-aabbccddeeff&actorCustomerId=00112233-4455-4677-8899-aabbccddeeff','from=2030-11-15T00%3A00%3A00','from=2030-02-30T00%3A00%3A00Z',
  'from=2030-11-15T02%3A00%3A00Z&to=2030-11-14T00%3A00%3A00Z','from=2029-01-01T00%3A00%3A00Z&to=2030-11-15T00%3A00%3A00Z','unknown=private-input'])('HTTP严格拒绝非法参数 %s',async q=>{
  const r=await http('GET','/admin/audit-logs?'+q,f.admin);expect(r.status).toBe(400);expect(['VALIDATION_FAILED','QUERY_RANGE_TOO_LARGE']).toContain(r.json.code);expect(JSON.stringify(r.json)).not.toContain('private-input');
});
it('准确接受366天和10000定位边界，并对filter-options/非法UUID分别匹配校验',async()=>{
  expect((await list({from:new Date(+now-366*86400000).toISOString(),to:now.toISOString(),page:100,pageSize:100})).status).toBe(200);
  for(const path of ['/admin/audit-logs/filter-options?limit=101','/admin/audit-logs/filter-options?limit=1e2','/admin/audit-logs/filter-options?limit=20&limit=30','/admin/audit-logs/not-a-uuid'])expect((await http('GET',path,f.admin)).status).toBe(400);
});
it('count后并发插入审计，RR内items/total仍同快照，下一请求才见新行',async()=>{
  const targetId=randomUUID();await audit({targetId});let entered!:()=>void,release!:()=>void;const reached=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});
  const db={ $transaction:(work:(tx:Prisma.TransactionClient)=>Promise<unknown>,options:object)=>f.db.$transaction(async tx=>{
    const delegate=new Proxy(tx.auditLog,{get(target,key,receiver){if(key==='count')return async(args:Prisma.AuditLogCountArgs)=>{const total=await target.count(args);entered();await gate;return total;};return Reflect.get(target,key,receiver);}});
    return work(new Proxy(tx,{get(target,key,receiver){return key==='auditLog'?delegate:Reflect.get(target,key,receiver);}}));
  },options) } as unknown as PrismaService;
  const service=new AuditQueryService(db,{now:()=>now} as Clock,f.app.get(OrderAccess)),pending=service.list(f.admin,Object.assign(new AuditListQueryDto(),{targetId,...range}));
  await reached;await audit({targetId});release();const old=await pending;expect(old.total).toBe(1);expect(old.items).toHaveLength(1);expect((await good<List>(list({targetId,...range}))).total).toBe(2);
});
it('20→100行实际SQL次数不线性增长；GET无写副作用，无审计修改删除入口',async()=>{
  const targetId=randomUUID();for(let i=0;i<105;i++)await audit({targetId});
  const before={audits:await f.db.auditLog.count(),payments:await f.db.payment.count(),refunds:await f.db.refund.count(),actions:await f.db.inventoryAction.count(),tasks:await f.db.task.count()};
  const spy=vi.spyOn(Client.prototype,'query');
  try{
    const measure=async(size:number)=>{spy.mockClear();const result=await good<List>(list({targetId,...range,pageSize:size}));const queries=spy.mock.calls.map(call=>{const value:unknown=call[0];return typeof value==='string'?value:typeof value==='object'&&value&&'text'in value?String(value.text):'';});expect(queries.filter(s=>/SELECT/.test(s)).length).toBeGreaterThan(0);expect(queries.every(s=>!/FOR\s+(?:UPDATE|NO KEY UPDATE|SHARE|KEY SHARE)/i.test(s))).toBe(true);return {n:queries.filter(s=>/SELECT/.test(s)).length,result};};
    const small=await measure(20),large=await measure(100);expect(small.result.items).toHaveLength(20);expect(large.result.items).toHaveLength(100);expect(large.n).toBe(small.n);
  }finally{spy.mockRestore();}
  const row=(await good<List>(list({targetId,...range}))).items[0]!;for(const method of ['PUT','PATCH','DELETE'])expect((await http(method,'/admin/audit-logs/'+row.id,f.admin,{})).status).toBe(404);
  expect({audits:await f.db.auditLog.count(),payments:await f.db.payment.count(),refunds:await f.db.refund.count(),actions:await f.db.inventoryAction.count(),tasks:await f.db.task.count()}).toEqual(before);
});
it('真实数据库查询故障由HTTP统一返回技术错误，不能伪装空列表或泄露SQL',async()=>{
  const service=f.app.get(AuditQueryService),spy=vi.spyOn(service,'list').mockImplementation(async()=>{await f.db.$queryRaw`SELECT 1 / 0`;throw new Error('unreachable');});
  try{const result=await list();expect(result.status).toBe(500);expect(result.json.code).toBe('INTERNAL_ERROR');expect(JSON.stringify(result.json)).not.toMatch(/SELECT|division|Prisma|stack/);}finally{spy.mockRestore();}
});
