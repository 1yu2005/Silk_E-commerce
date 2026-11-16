// 作用：真实独占PG差分核对旧全量ID筛选与新EXISTS分页；读取夹具不替代正式交易E2E或性能矩阵。
import 'reflect-metadata';
import {randomUUID} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {Client} from 'pg';
import {beforeAll,expect,it,vi} from 'vitest';
import {customer,employee,fixture,session,setupCoordinationFixtures} from './coordination-fixtures.js';
import type {CustomerContext} from '../src/customers/customer-access.service.js';
import {OrderAccess,orderReader} from '../src/orders/order-access.service.js';
import {OrderQueries} from '../src/orders/order-query.service.js';
import {OrderQueryDto} from '../src/orders/order.dto.js';
import {OrderError} from '../src/orders/order.errors.js';
import {AccessDeniedError} from '../src/auth/access-denied.error.js';
import {EmployeeExtraPermissionService} from '../src/employees/employee-extra-permission.service.js';
import {LogoutService} from '../src/auth/logout.service.js';

setupCoordinationFixtures({databasePrefix:'m415'});
const terminal=['REJECTED','WITHDRAWN','CLOSED','SUCCEEDED'];
const active=['PENDING_REVIEW','WAIT_SUPPLEMENT','WAIT_FULFILLMENT_CHECK','WAIT_REFUND','WAIT_RETURN','WAIT_RECEIPT','WAIT_INSPECTION','INSPECTION_EXCEPTION','FINAL_INSPECTION','REFUNDING','REFUND_FAILED'];
const select={id:true,number:true,status:true,payableCents:true,createdAt:true,paymentDeadline:true,paidAt:true,version:true,customerId:true,receiver:true,phone:true,fulfillmentStage:true,paymentBlocked:true,items:{select:{id:true,productNameSnapshot:true,imageAssetId:true,quantity:true,lineAmountCents:true}}} satisfies Prisma.OrderSelect;
const query=(values:Partial<OrderQueryDto>={})=>Object.assign(new OrderQueryDto(),values);
let buyer:CustomerContext,otherBuyer:CustomerContext;
const records=Array.from({length:116},(_,n)=>({n,id:randomUUID(),quoteId:randomUUID(),paymentId:randomUUID(),createdAt:new Date(Date.UTC(2026,0,1,0,Math.floor(n/12)))}));

async function addSale(tx:Prisma.TransactionClient,order:typeof records[number],status:string){
 const id=randomUUID(),materialId=randomUUID(),owner=order.n%2?otherBuyer:buyer;
 await tx.afterSale.create({data:{id,number:'EF-AS-'+randomUUID().replaceAll('-',''),orderId:order.id,customerId:owner.actor.subjectId,paymentId:order.paymentId,type:'REFUND_ONLY',status,reasonCode:'OTHER',applicationDescription:'独占读取等值夹具，不作为领域流程验收',currentMaterialVersionId:materialId,requestedRefundAmount:10000,createdAt:order.createdAt,closedAt:terminal.includes(status)?new Date(+order.createdAt+3000):null}});
 await tx.afterSaleMaterialVersion.create({data:{id:materialId,afterSaleId:id,versionNo:1,description:'真实父材料归属',submittedByCustomerId:owner.actor.subjectId}});
}

beforeAll(async()=>{
 const {db,admin,warehouse}=fixture;buyer=await customer();otherBuyer=await customer();
 const setting=await db.storeSettingHead.findUniqueOrThrow({where:{id:1}});
 const product=await db.product.create({data:{productCode:'EF-'+randomUUID(),name:'读取等值服装',status:'ON_SALE',createdById:admin.actor.subjectId,updatedById:admin.actor.subjectId}});
 const skus=await Promise.all(['a'.repeat(64),'b'.repeat(64)].map(combinationSignature=>db.sku.create({data:{productId:product.id,code:('EF-'+randomUUID()).toUpperCase(),combinationSignature,priceCents:5000}})));
 const words=['MiXeD','mixed','A%B','A_B','A\\B','é汉字'];
 await db.$transaction(async tx=>{
  await tx.checkoutQuote.createMany({data:records.map(row=>({id:row.quoteId,customerId:(row.n%2?otherBuyer:buyer).actor.subjectId,addressIdSnapshot:randomUUID(),addressVersion:0,addressSnapshot:{},settingVersionId:setting.currentVersionId!,pricingRuleSnapshot:{},goodsAmountCents:10000,shippingFeeCents:0,payableCents:10000,createdAt:row.createdAt,expiresAt:new Date(+row.createdAt+1800000)}))});
  await tx.order.createMany({data:records.map(row=>({id:row.id,number:'EF-'+String(row.n).padStart(3,'0')+'-'+words[row.n%words.length],customerId:(row.n%2?otherBuyer:buyer).actor.subjectId,quoteId:row.quoteId,status:'WAIT_SHIPMENT',fulfillmentStage:['READY','PREPARING','UNCLAIMED'][row.n%3]!,goodsAmountCents:10000,shippingFeeCents:0,payableCents:10000,receiver:'收件'+words[row.n%words.length],phone:'010'+String(row.n).padStart(8,'0'),province:'测试省',city:'测试市',district:'测试区',detail:'独占读取夹具',shippingRuleSnapshot:{},paymentRuleSnapshot:{},settingVersionId:setting.currentVersionId!,paymentDeadline:new Date(+row.createdAt+1800000),paidAt:new Date(+row.createdAt+1000),createdAt:row.createdAt,paymentBlocked:row.n%2===0}))});
  await tx.orderItem.createMany({data:records.flatMap(row=>skus.map((sku,index)=>({id:randomUUID(),orderId:row.id,skuId:sku.id,productId:product.id,productNameSnapshot:index?'第二行':'第一行',productCodeSnapshot:product.productCode,skuCodeSnapshot:sku.code,specSnapshot:[],unitPriceCents:5000,quantity:1,lineAmountCents:5000})))});
  await tx.payment.createMany({data:records.map(row=>({id:row.paymentId,number:'EF-P-'+randomUUID().replaceAll('-',''),orderId:row.id,amountCents:10000,paidAt:new Date(+row.createdAt+1000),actorCustomerId:(row.n%2?otherBuyer:buyer).actor.subjectId,requestId:randomUUID()}))});
  for(const row of records)if(row.n>0)await addSale(tx,row,row.n<5?terminal[row.n-1]!:active[(row.n-5)%active.length]!);
  // 数据库只允许同单一个活跃售后；多条终态历史加一个活跃仍不能重复父订单。
  for(const status of terminal)await addSale(tx,records[5]!,status);
  for(const n of [12,13]){
   const row=records[n]!,cursor=await tx.taskStageCursor.create({data:{businessType:'ORDER',businessId:row.id,stage:'SHIPMENT_PROCESS',lastRound:1}});
   await tx.task.create({data:{cursorId:cursor.id,businessType:'ORDER',businessId:row.id,stage:'SHIPMENT_PROCESS',round:1,entryKey:'exists-fixture',requiredPermissions:['order.fulfillment.read'],status:'CLAIMED',assigneeId:warehouse.actor.subjectId,startedAt:row.createdAt,ruleSnapshot:{}}});
  }
  for(const n of [12,13,14]){
   const row=records[n]!,item=await tx.orderItem.findFirstOrThrow({where:{orderId:row.id}}),fulfillment=await tx.fulfillment.create({data:{orderId:row.id}});
   const packing=await tx.packingCheck.create({data:{fulfillmentId:fulfillment.id,orderId:row.id,checkedPhysicalVersion:0,checkedItems:[{orderItemId:item.id,quantity:1}],goodsLocation:'独占读取货架',checkedById:warehouse.actor.subjectId,commandKey:randomUUID()}});
   const shipment=await tx.shipment.create({data:{orderId:row.id,carrierName:'读取承运人',trackingNumber:'EF-'+n,preparedById:warehouse.actor.subjectId}});
   await tx.handoverAttempt.create({data:{orderId:row.id,shipmentId:shipment.id,attemptNo:1,startCommandKey:randomUUID(),fingerprint:'a'.repeat(64),status:n===14?'NOT_HANDED_OVER':n===13?'UNCERTAIN':'IN_PROGRESS',carrierSnapshot:shipment.carrierName,trackingSnapshot:shipment.trackingNumber,packingCheckId:packing.id,physicalVersion:0,startedById:warehouse.actor.subjectId,startedAt:row.createdAt,uncertainAfter:new Date(+row.createdAt+60000),resolvedAt:n===14?new Date(+row.createdAt+120000):null}});
   await tx.shipmentException.create({data:{orderId:row.id,type:'OTHER',status:n===13?'RESOLVED':'OPEN',incidentKey:randomUUID(),fingerprint:'b'.repeat(64),reason:'读取组合过滤',evidenceNote:'只用于查询等值',goodsLocation:'独占货架',orderItemIds:[item.id],physicalVersionAtOpen:0,createdById:warehouse.actor.subjectId,resolvedAt:n===13?new Date(+row.createdAt+1000):null}});
  }
 },{timeout:30000});
},60000);

// 冻结的修复前算法作为真实DB差分oracle；不调用新reader，也不缓存候选ID或权限。
async function legacyList(ctx:CustomerContext,q:OrderQueryDto,admin=true){
 const {db,app}=fixture;
 if(q.from&&q.to&&new Date(q.from)>new Date(q.to))throw new OrderError('VALIDATION_FAILED');
 return db.$transaction(async tx=>{
  const a=await app.get(OrderAccess).current(tx,ctx,false);
  if(admin&&!orderReader(a)||!admin&&a.subjectType!=='CUSTOMER')throw new AccessDeniedError('FORBIDDEN');
  const where:Prisma.OrderWhereInput={...(a.subjectType==='CUSTOMER'?{customerId:a.subjectId}:q.customerId?{customerId:q.customerId}:{}),...(q.status?{status:q.status}:{}),...(q.fulfillmentStage?{fulfillmentStage:q.fulfillmentStage}:{}),...(q.number?{number:{contains:q.number}}:{}),...(q.receiverKeyword&&admin?{OR:[{receiver:{contains:q.receiverKeyword}},{phone:{contains:q.receiverKeyword}}]}:{}),...((q.from||q.to)?{createdAt:{...(q.from?{gte:new Date(q.from)}:{}),...(q.to?{lte:new Date(q.to)}:{})}}:{}),...(q.afterSaleOnly?{id:{in:(await tx.afterSale.findMany({where:{status:{notIn:terminal}},select:{orderId:true}})).map(row=>row.orderId)}}:{})};
  const scope:Prisma.OrderWhereInput[]=[];
  if(admin&&q.assigneeId)scope.push({id:{in:(await tx.task.findMany({where:{businessType:'ORDER',stage:'SHIPMENT_PROCESS',status:'CLAIMED',assigneeId:q.assigneeId},select:{businessId:true}})).map(row=>row.businessId)}});
  if(admin&&q.unresolvedHandover!==undefined){const ids=(await tx.handoverAttempt.findMany({where:{status:{in:['IN_PROGRESS','UNCERTAIN']}},select:{orderId:true}})).map(row=>row.orderId);scope.push({id:q.unresolvedHandover?{in:ids}:{notIn:ids}});}
  if(admin&&q.shipmentException!==undefined){const ids=(await tx.shipmentException.findMany({where:{status:'OPEN'},select:{orderId:true}})).map(row=>row.orderId);scope.push({id:q.shipmentException?{in:ids}:{notIn:ids}});}
  if(scope.length)where.AND=scope;
  const total=await tx.order.count({where}),skip=BigInt(q.page-1)*BigInt(q.pageSize);
  const rows=skip>=BigInt(total)?[]:await tx.order.findMany({where,select,orderBy:[{createdAt:'desc'},{id:'asc'}],skip:Number(skip),take:q.pageSize});
  return {items:rows.map(o=>({id:o.id,number:o.number,status:o.status,payableCents:o.payableCents,createdAt:o.createdAt,paymentDeadline:o.paymentDeadline,paidAt:o.paidAt,version:o.version,items:o.items.map(i=>({id:i.id,productName:i.productNameSnapshot,imageUrl:i.imageAssetId?'/api/v1/files/'+i.imageAssetId+'/content':null,quantity:i.quantity,lineAmountCents:i.lineAmountCents})),...(admin?{customerId:o.customerId,receiver:o.receiver,phone:o.phone,fulfillmentStage:o.fulfillmentStage,paymentBlocked:o.paymentBlocked}:{})})),total,page:q.page,pageSize:q.pageSize};
 },{isolationLevel:'RepeatableRead'});
}
async function equivalent(ctx:CustomerContext,q:OrderQueryDto,admin=true){
 const before=await legacyList(ctx,q,admin),after=await fixture.app.get(OrderQueries).list(ctx,q,admin);
 const {serverTime,...actual}=after;expect(serverTime).toBeInstanceOf(Date);expect(actual).toEqual(before);return after;
}
const ids=(rows:{items:{id:string}[]})=>rows.items.map(row=>row.id);

it('EXISTS01：全部活跃、四终态、无售后、false/缺省、多历史不重复；准确总数及父/子原序',async()=>{
 const {admin}=fixture;
 const first=await equivalent(admin,query({afterSaleOnly:true,pageSize:100})),second=await equivalent(admin,query({afterSaleOnly:true,page:2,pageSize:100}));
 expect(first.total).toBe(111);expect(second.total).toBe(111);
 const actual=[...ids(first),...ids(second)],expected=records.filter(row=>row.n>=5).sort((a,b)=>+b.createdAt-+a.createdAt||a.id.localeCompare(b.id)).map(row=>row.id);
 expect(actual).toEqual(expected);expect(new Set(actual).size).toBe(111);expect(actual.filter(id=>id===records[5]!.id)).toHaveLength(1);
 expect(first.items.every(row=>row.items.length===2)).toBe(true);
 const missing=await equivalent(admin,query({pageSize:100})),disabled=await equivalent(admin,query({afterSaleOnly:false,pageSize:100}));
 expect(missing.total).toBe(116);expect(disabled.total).toBe(116);expect(ids(disabled)).toEqual(ids(missing));
},60000);

it('EXISTS02：标量组合、日期含端点、大小写/Unicode与LIKE通配/反斜杠保持Prisma原语义',async()=>{
 for(const q of [
  {status:'WAIT_SHIPMENT',fulfillmentStage:'READY',customerId:buyer.actor.subjectId,number:'EF-',receiverKeyword:'收件',from:records[24]!.createdAt.toISOString(),to:records[83]!.createdAt.toISOString()},
  {status:'WAIT_PAYMENT'},{from:records[48]!.createdAt.toISOString(),to:records[48]!.createdAt.toISOString()},
  ...['MiXeD','mixed','é汉字','A%B','A_B','A\\B','A\\\\B','%','_','\\'].flatMap(value=>[{number:value},{receiverKeyword:value}]),
 ])await equivalent(fixture.admin,query({afterSaleOnly:true,...q}));
 const upper=await equivalent(fixture.admin,query({afterSaleOnly:true,receiverKeyword:'MiXeD',pageSize:100})),lower=await equivalent(fixture.admin,query({afterSaleOnly:true,receiverKeyword:'mixed',pageSize:100}));
 expect(upper.total).toBeGreaterThan(0);expect(lower.total).toBeGreaterThan(0);expect(ids(upper)).not.toEqual(ids(lower));
 await expect(fixture.app.get(OrderQueries).list(fixture.admin,query({afterSaleOnly:true,from:'2026-01-02',to:'2026-01-01'}),true)).rejects.toMatchObject({code:'VALIDATION_FAILED'});
},60000);

it('EXISTS03：assignee/未决交运/异常正反和组合；顾客强制自身范围且忽略管理员专用筛选',async()=>{
 const cases:Partial<OrderQueryDto>[]=[{assigneeId:fixture.warehouse.actor.subjectId},{assigneeId:randomUUID()},{unresolvedHandover:true},{unresolvedHandover:false},{shipmentException:true},{shipmentException:false},{assigneeId:fixture.warehouse.actor.subjectId,unresolvedHandover:true,shipmentException:true},{assigneeId:fixture.warehouse.actor.subjectId,unresolvedHandover:true,shipmentException:false},{unresolvedHandover:false,shipmentException:true}];
 for(const q of cases)await equivalent(fixture.admin,query({afterSaleOnly:true,...q,pageSize:100}));
 expect(ids(await equivalent(fixture.admin,query({afterSaleOnly:true,...cases[6]})))).toEqual([records[12]!.id]);
 expect(ids(await equivalent(fixture.admin,query({afterSaleOnly:true,...cases[7]})))).toEqual([records[13]!.id]);
 expect(ids(await equivalent(fixture.admin,query({afterSaleOnly:true,...cases[8]})))).toEqual([records[14]!.id]);
 const own=await equivalent(buyer,query({afterSaleOnly:true,pageSize:100,customerId:otherBuyer.actor.subjectId,receiverKeyword:'不存在',assigneeId:randomUUID(),unresolvedHandover:true,shipmentException:true}),false);
 expect(own.total).toBe(records.filter(row=>row.n>=5&&row.n%2===0).length);expect(own.items.every(row=>!('customerId' in row)&&!('receiver' in row)&&!('phone' in row))).toBe(true);
 await expect(fixture.app.get(OrderQueries).list(fixture.admin,query({afterSaleOnly:true}),false)).rejects.toMatchObject({code:'FORBIDDEN'});
},60000);

it('EXISTS04：20→100真实PG语句预算、参数随页有界；越界/超大页仍返回准确total',async()=>{
 const original=Client.prototype.query,statements:{sql:string;parameters:number}[]=[];let tracing=false;
 Client.prototype.query=function(this:Client,...args:unknown[]){const first=args[0],sql=typeof first==='string'?first:(first as {text?:string})?.text,values=typeof first==='string'?args[1]:(first as {values?:unknown[]})?.values;if(tracing&&sql)statements.push({sql,parameters:Array.isArray(values)?values.length:0});return Reflect.apply(original,this,args);} as typeof original;
 const counts:number[]=[];
 try{
  for(const pageSize of [20,100]){
   statements.length=0;tracing=true;const result=await fixture.app.get(OrderQueries).list(fixture.admin,query({afterSaleOnly:true,pageSize}),true);tracing=false;
   expect(result.items).toHaveLength(pageSize);expect(result.total).toBe(111);counts.push(statements.length);
   expect(Math.max(...statements.map(row=>row.parameters))).toBeLessThanOrEqual(pageSize+16);
   expect(statements.filter(row=>/\bEXISTS\s*\(/i.test(row.sql)&&/after_sale/.test(row.sql))).toHaveLength(2);
   expect(statements.some(row=>/SET TRANSACTION ISOLATION LEVEL REPEATABLE READ/i.test(row.sql))).toBe(true);
  }
  expect(counts[1]!).toBeLessThanOrEqual(counts[0]!+2);
 }finally{tracing=false;Client.prototype.query=original;}
 for(const page of [7,Number.MAX_SAFE_INTEGER]){const result=await equivalent(fixture.admin,query({afterSaleOnly:true,page,pageSize:20}));expect(result.items).toEqual([]);expect(result.total).toBe(111);}
},60000);

it('EXISTS05：旧actor在正式额外授权撤销后读到当前权限；强制改密/停用/注销即时拒绝',async()=>{
 const {app,db,admin}=fixture,member=await employee('CUSTOMER_SERVICE'),permissions=app.get(EmployeeExtraPermissionService),target=member.actor.subjectId;
 await permissions.replace(admin.actor,admin.token,target,{permissions:['order.fulfillment.read'],expectedVersion:0,reason:'独占查询实时授权回归'},randomUUID());
 const stale=await session('EMPLOYEE',target);expect(stale.actor.subjectType==='EMPLOYEE'&&stale.actor.effectivePermissions.includes('order.fulfillment.read')).toBe(true);
 await permissions.replace(admin.actor,admin.token,target,{permissions:[],expectedVersion:1,reason:'正式撤销后沿原token读取'},randomUUID());
 const current=vi.spyOn(OrderAccess.prototype,'current');
 try{await app.get(OrderQueries).list(stale,query({afterSaleOnly:true}),true);const resolved=await current.mock.results.at(-1)!.value;expect(resolved.subjectType).toBe('EMPLOYEE');if(resolved.subjectType!=='EMPLOYEE')throw new Error('未得到员工当前身份');expect(resolved.permissionVersion).toBe(2);expect(resolved.effectivePermissions).not.toContain('order.fulfillment.read');}finally{current.mockRestore();}
 await db.employee.update({where:{id:target},data:{mustChangePassword:true}});
 await expect(app.get(OrderQueries).list(stale,query({afterSaleOnly:true}),true)).rejects.toMatchObject({code:'PASSWORD_CHANGE_REQUIRED'});
 const disabled=await employee('CUSTOMER_SERVICE');await db.employee.update({where:{id:disabled.actor.subjectId},data:{status:'DISABLED'}});
 await expect(app.get(OrderQueries).list(disabled,query({afterSaleOnly:true}),true)).rejects.toMatchObject({code:'ACCOUNT_UNAVAILABLE'});
 const loggedOut=await employee('CUSTOMER_SERVICE');await app.get(LogoutService).logout(loggedOut.token,randomUUID());
 await expect(app.get(OrderQueries).list(loggedOut,query({afterSaleOnly:true}),true)).rejects.toMatchObject({code:'SESSION_REVOKED'});
 const frozen=await customer();await db.customer.update({where:{id:frozen.actor.subjectId},data:{status:'LOGIN_FROZEN'}});
 await expect(app.get(OrderQueries).list(frozen,query({afterSaleOnly:true}),false)).rejects.toMatchObject({code:'ACCOUNT_UNAVAILABLE'});
},60000);
