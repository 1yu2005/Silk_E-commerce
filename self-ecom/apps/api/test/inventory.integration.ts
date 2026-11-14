// 作用：仅在本轮独占PostgreSQL验证库存成功事实、并发与失败回滚；不连接开发库制造余额。
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { assertSafeTestDatabase } from '../scripts/database-env.js';
import { AppModule } from '../src/app.module.js';
import { APP_CONFIG, loadConfiguration } from '../src/config/environment.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuditService, type AuditPayload } from '../src/audit/audit.service.js';
import { JwtTokenService } from '../src/auth/jwt-token.service.js';
import { CurrentIdentityService } from '../src/auth/current-identity.service.js';
import { seedPermissionCatalog } from '../src/permissions/permission-seed.js';
import { ProductCommands } from '../src/catalog/product-command.service.js';
import { InventorySources } from '../src/inventory/inventory-source.service.js';
import { InventoryAdjustments } from '../src/inventory/inventory-adjustment.service.js';
import { InventoryConversion } from '../src/inventory/inventory-conversion.service.js';
import type { InventoryContext } from '../src/inventory/inventory-access.service.js';
import { InventoryAutomatic, InventoryDomainPorts, type AutomaticOperation, type InventoryDomainFacts, type InventoryDomainPort } from '../src/inventory/inventory-automatic.service.js';
import { InventoryBlocks } from '../src/inventory/inventory-block.service.js';
import { InventoryQueries } from '../src/inventory/inventory-query.service.js';
import { runAuthTransaction } from '../src/auth/auth-transaction.js';
import { EmployeeRoleService } from '../src/employees/employee-role.service.js';
import { configureApp } from '../src/common/configure-app.js';
import { InventoryController, InventoryConversionController } from '../src/inventory/inventory.controller.js';
import * as D from '../src/inventory/inventory.dto.js';
import { CategoryService } from '../src/catalog/category.service.js';
import { Clock } from '../src/common/time/clock.js';
import { TaskDeadlineService } from '../src/tasks/task-deadline.service.js';
import { TaskOverdueScanService } from '../src/tasks/task-overdue-scan.service.js';
import { TaskEntryService } from '../src/tasks/task-entry.service.js';
const metadata=(controller:object,rows:Record<string,unknown[]>)=>{for(const [key,types]of Object.entries(rows))Reflect.defineMetadata('design:paramtypes',types,controller,key);};
metadata(InventoryController.prototype,{list:[D.InventoryQueryDto],ledger:[D.InventoryQueryDto],action:[D.InventoryIdDto],sourceList:[D.InventoryQueryDto],sourceDetail:[D.InventoryIdDto],sourceCreate:[D.SourceCreateDto,Object,Object],sourceAdd:[D.InventoryIdDto,D.SourceAddLineDto,Object,Object],verify:[D.InventoryIdDto,D.SourceVerifyDto,Object,Object],adjustmentList:[D.InventoryQueryDto],adjustmentDetail:[D.InventoryIdDto],create:[D.AdjustmentCreateDto,Object,Object],edit:[D.InventoryIdDto,D.AdjustmentEditDto,Object,Object],claim:[D.InventoryIdDto,D.AdjustmentCommandDto,Object,Object],post:[D.InventoryIdDto,D.AdjustmentCommandDto,Object,Object],void:[D.InventoryIdDto,D.AdjustmentVoidDto,Object,Object],corrections:[D.InventoryIdDto,D.CorrectionCreateDto,Object,Object],resolve:[D.InventoryIdDto,D.AdjustmentResolveDto,Object,Object],balance:[D.InventorySkuIdDto],threshold:[D.InventorySkuIdDto,D.InventoryThresholdDto,Object,Object]});
metadata(InventoryConversionController.prototype,{convert:[D.InventoryIdDto,D.InitialConvertDto,Object,Object]});
assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL,process.env.DATABASE_URL);
if(process.env.NODE_ENV!=='test'||!/^\/m105_[a-f0-9]{32}_test$/.test(new URL(process.env.DATABASE_URL!).pathname))throw new Error('仅允许运行本轮独占库存测试库');
class ControlledAudit extends AuditService{
 fail=false;checkpoint:((tx:Prisma.TransactionClient,payload:AuditPayload)=>Promise<void>)|undefined;
 override async appendAudit(tx:Prisma.TransactionClient,payload:AuditPayload){await super.appendAudit(tx,payload);await this.checkpoint?.(tx,payload);if(this.fail&&payload.action==='inventory.action')throw new Error('库存隔离审计故障');}
}
const audit=new ControlledAudit();let app:INestApplication,db:PrismaService,source:InventorySources,adjustments:InventoryAdjustments,conversion:InventoryConversion,products:ProductCommands;
let base='',directory='',testFactCreated=false;const responses:{path:string;method:string;status:number;code?:string;requestId:string|null}[]=[];
let staff:InventoryContext,peer:InventoryContext,service:InventoryContext;
async function actor(role:'MERCH_WAREHOUSE'|'CUSTOMER_SERVICE'|'SUPER_ADMIN'='MERCH_WAREHOUSE'){
 const id=randomUUID(),sid=randomUUID();const row=await db.employee.create({data:{id,username:'iv_'+id.replaceAll('-','').slice(0,20),displayName:'库存隔离测试',role,mustChangePassword:false,passwordHash:'仅隔离会话夹具'}});
 const issued=await app.get(JwtTokenService).issue({subjectType:'EMPLOYEE',subjectId:id,sessionId:sid,tokenVersion:row.tokenVersion});
 await db.authSession.create({data:{id:sid,subjectType:'EMPLOYEE',employeeId:id,tokenVersion:row.tokenVersion,createdAt:issued.issuedAt,expiresAt:issued.expiresAt}});
 return {actor:await app.get(CurrentIdentityService).authenticate(db,issued.accessToken,'EMPLOYEE'),token:issued.accessToken,requestId:randomUUID()};
}
beforeAll(async()=>{
 directory=await mkdtemp(join(tmpdir(),'self-ecom-inventory-'));
 const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(APP_CONFIG).useValue({...loadConfiguration({...process.env,LOG_LEVEL:'silent'}),uploadDir:directory}).overrideProvider(AuditService).useValue(audit).compile();
 app=module.createNestApplication();configureApp(app);await app.listen(0,'127.0.0.1');base=await app.getUrl();db=app.get(PrismaService);await seedPermissionCatalog(db);source=app.get(InventorySources);adjustments=app.get(InventoryAdjustments);conversion=app.get(InventoryConversion);products=app.get(ProductCommands);
 staff=await actor();peer=await actor();service=await actor('CUSTOMER_SERVICE');
},30000);
afterAll(async()=>{if(testFactCreated)await db.$executeRawUnsafe('DROP TABLE module6_test_fact');await app?.close();await writeFile(resolve('../../docs/verification/evidence/M1-06',`inventory-http-${Date.now()}.json`),JSON.stringify(responses,null,2));console.log('保留库存测试图片：'+directory);});
async function call(path:string,method='GET',body?:unknown,who:InventoryContext|null=staff){const r=await fetch(base+'/api/v1'+path,{method,headers:{'Content-Type':'application/json',...(who?{Authorization:'Bearer '+who.token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const json=await r.json();responses.push({path,method,status:r.status,code:json.code,requestId:r.headers.get('x-request-id')});expect(json.requestId).toBe(r.headers.get('x-request-id'));return {r,json};}
async function upload(purpose='INVENTORY_EVIDENCE',who=staff){const png=await sharp({create:{width:30,height:40,channels:3,background:'#394f59'}}).png().toBuffer();const body=new FormData();body.append('purpose',purpose);body.append('file',new Blob([new Uint8Array(png)]),'test.png');const r=await fetch(base+'/api/v1/files',{method:'POST',headers:{Authorization:'Bearer '+who.token},body});expect(r.status).toBe(201);return (await r.json()).data.id as string;}
const ctx=(who=staff)=>({...who,requestId:randomUUID()});
async function fixture(quantity=100,type:'RECEIPT'|'LOSS'='RECEIPT',skuId?:string){
 const product=skuId?null:await products.create(ctx(),{name:'库存隔离服装'});skuId??=product!.skus[0]!.id;
 const s=await source.create(ctx(),{sourceType:type,namespace:'TEST',reference:randomUUID(),note:'独占测试库核实证据',lines:[{lineKey:'1',skuId,verifiedQuantity:quantity}]});
 const line=await db.inventorySourceLine.findFirstOrThrow({where:{sourceId:s.id}});return {product,skuId,source:s,line};
}
async function pending(f:Awaited<ReturnType<typeof fixture>>,quantity:number,batchKey='B001',who=staff){return adjustments.create(ctx(who),{type:f.source.sourceType==='LOSS'?'AVAILABLE_LOSS':'ARRIVAL',reason:'隔离实收核实',evidenceNote:'独占夹具',lines:[{skuId:f.skuId,sourceLineId:f.line.id,quantity,...(f.source.sourceType==='LOSS'?{}:{batchKey})}]});}
async function versions(id:string){const a=await db.inventoryAdjustment.findUniqueOrThrow({where:{id}});const t=await db.task.findFirstOrThrow({where:{businessType:'INVENTORY_ADJUSTMENT',businessId:id,stage:a.checkRequired?'INVENTORY_RECONCILE':'INVENTORY_POST',status:{in:['OPEN','CLAIMED']}}});return {expectedVersion:a.version,expectedTaskVersion:t.version};}
async function post(id:string,who=staff){await adjustments.claim(ctx(who),id,await versions(id));const input=await versions(id);const result=await adjustments.post(ctx(who),id,input);return {result,input};}
it('IT01/SW01：来源规范身份、核实边界、SKU外键与原零账户复用',async()=>{
 const f=await fixture();expect(await db.inventoryBalance.findUnique({where:{skuId:f.skuId}})).toMatchObject({available:0,reserved:0});
 await expect(source.create(ctx(),{sourceType:'RECEIPT',namespace:' test ',reference:f.source.reference.toLowerCase(),note:'重复核实',lines:[{lineKey:'1',skuId:f.skuId,verifiedQuantity:1}]})).rejects.toMatchObject({code:'SOURCE_ALREADY_EXISTS'});
 await expect(source.create(ctx(service),{sourceType:'RECEIPT',namespace:'TEST',reference:randomUUID(),note:'无权',lines:[{lineKey:'1',skuId:f.skuId,verifiedQuantity:1}]})).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(db.$executeRaw`UPDATE inventory_source_line SET net_posted_quantity=101 WHERE id=${f.line.id}::uuid`).rejects.toBeDefined();
});
it('SW02/03/04：待确认不变、同人领取、同指纹重放、批次永久占用与累计上限',async()=>{
 const f=await fixture(),p=await pending(f,40);expect(await db.inventoryBalance.findUnique({where:{skuId:f.skuId}})).toMatchObject({available:0,reserved:0});
 await expect(adjustments.post(ctx(),p.id,await versions(p.id))).rejects.toMatchObject({code:'TASK_NOT_ASSIGNEE'});
 const {input}=await post(p.id);const repeated=await adjustments.post(ctx(peer),p.id,input);expect(repeated.changed).toBe(false);
 await expect(adjustments.post(ctx(),p.id,{...input,expectedVersion:1})).rejects.toMatchObject({code:'INVENTORY_ACTION_CONFLICT'});
 const duplicate=await pending(f,40);await adjustments.claim(ctx(),duplicate.id,await versions(duplicate.id));await expect(adjustments.post(ctx(),duplicate.id,await versions(duplicate.id))).rejects.toMatchObject({code:'SOURCE_BATCH_ALREADY_POSTED'});
 await post((await pending(f,60,'B002')).id);const excess=await pending(f,1,'B003');await adjustments.claim(ctx(),excess.id,await versions(excess.id));
 await expect(adjustments.post(ctx(),excess.id,await versions(excess.id))).rejects.toMatchObject({code:'SOURCE_QUANTITY_EXCEEDED'});
 expect(await db.inventorySourceLine.findUnique({where:{id:f.line.id}})).toMatchObject({netPostedQuantity:100});expect(await db.inventoryBalance.findUnique({where:{skuId:f.skuId}})).toMatchObject({available:100,reserved:0});
 expect(await db.inventoryLedger.count({where:{skuId:f.skuId}})).toBe(2);
 await expect(source.verify(ctx(),f.line.id,{expectedVersion:2,verifiedQuantity:99,reason:'减少核实',evidenceNote:'实际核实'})).rejects.toMatchObject({code:'SOURCE_QUANTITY_BELOW_POSTED'});
});
it('SW06：根差额更正、净量归零不释放批次，不能引用更正链',async()=>{
 const f=await fixture(20),p=await pending(f,20);await post(p.id);const root=await db.inventoryAdjustmentLine.findFirstOrThrow({where:{adjustmentId:p.id}});
 const correction=await adjustments.corrections(ctx(),p.id,{reason:'正确实收到15',evidenceNote:'核实少5',lines:[{rootLineId:root.id,signedDeltaA:-5}]});await post(correction.id);
 const c2=await adjustments.corrections(ctx(),p.id,{reason:'再次核实18',evidenceNote:'核实增加3',lines:[{rootLineId:root.id,signedDeltaA:3}]});await post(c2.id);
 expect(await db.inventorySourceLine.findUnique({where:{id:f.line.id}})).toMatchObject({netPostedQuantity:18});
 const c3=await adjustments.corrections(ctx(),p.id,{reason:'退回误记',evidenceNote:'原根净量清零',lines:[{rootLineId:root.id,signedDeltaA:-18}]});await post(c3.id);
 const dup=await pending(f,1);await adjustments.claim(ctx(),dup.id,await versions(dup.id));await expect(adjustments.post(ctx(),dup.id,await versions(dup.id))).rejects.toMatchObject({code:'SOURCE_BATCH_ALREADY_POSTED'});
 const chain=await db.inventoryAdjustmentLine.findFirstOrThrow({where:{adjustmentId:correction.id}});
 await expect(adjustments.corrections(ctx(),correction.id,{reason:'错误链',evidenceNote:'不允许',lines:[{rootLineId:chain.id,signedDeltaA:1}]})).rejects.toMatchObject({code:'CORRECTION_NOT_ALLOWED'});
});
it('SW07：损耗不足提交核实待办、无成功动作；核实必须真实解决并生成新轮',async()=>{
 const f=await fixture(3,'LOSS'),p=await pending(f,3);await adjustments.claim(ctx(),p.id,await versions(p.id));
 await expect(adjustments.post(ctx(),p.id,await versions(p.id))).rejects.toMatchObject({code:'STOCK_INSUFFICIENT'});
 expect(await db.inventoryAdjustment.findUnique({where:{id:p.id}})).toMatchObject({status:'PENDING',checkRequired:true});expect(await db.inventoryAction.count({where:{adjustmentId:p.id}})).toBe(0);
 expect((await db.task.findMany({where:{businessId:p.id},orderBy:{stage:'asc'}})).map(t=>t.status).sort()).toEqual(['OPEN','SUSPENDED']);
 await adjustments.claim(ctx(),p.id,await versions(p.id));await expect(adjustments.resolve(ctx(),p.id,{...await versions(p.id),reason:'声称完成',evidenceNote:'尚无可用库存'})).rejects.toMatchObject({code:'INVENTORY_CHECK_UNRESOLVED'});
 const receipt=await fixture(3,'RECEIPT',f.skuId);await post((await pending(receipt,3)).id);
 await adjustments.resolve(ctx(),p.id,{...await versions(p.id),reason:'补货已核实',evidenceNote:'正式到货已确认3件'});expect((await versions(p.id)).expectedTaskVersion).toBe(0);
 await post(p.id);expect(await db.inventoryBalance.findUnique({where:{skuId:f.skuId}})).toMatchObject({available:0,reserved:0,purchaseBlocked:false});
 expect(await db.inventorySourceLine.findUnique({where:{id:receipt.line.id}})).toMatchObject({netPostedQuantity:3});expect(await db.inventorySourceLine.findUnique({where:{id:f.line.id}})).toMatchObject({netPostedQuantity:3});
});
it('SW08：转换数量来自草稿、版本递增后同键重放、FK、作废不复活草稿',async()=>{
 const f=await fixture(12);await products.draftSave(ctx(),f.product!.id,{expectedProductVersion:0,expectedDraftVersion:null,lines:[{skuId:f.skuId,quantity:12}]});
 const p=await db.product.findUniqueOrThrow({where:{id:f.product!.id}}),draft=await db.initialInventoryDraft.findFirstOrThrow({where:{productId:p.id}});
 const input={expectedProductVersion:p.version,expectedDraftVersion:draft.version,sourceId:f.source.id,mappings:[{skuId:f.skuId,sourceLineId:f.line.id,batchKey:'INIT'}],reason:'转换库存数量草稿'};
 const first=await conversion.convert(ctx(),p.id,input);expect(await conversion.convert(ctx(peer),p.id,input)).toEqual({...first,changed:false});
 await expect(conversion.convert(ctx(),p.id,{...input,mappings:[{...input.mappings[0]!,batchKey:'OTHER'}]})).rejects.toMatchObject({code:'INITIAL_CONVERSION_CONFLICT'});
 expect(await db.initialInventoryDraft.findUnique({where:{id:draft.id}})).toMatchObject({status:'CONVERTED',adjustmentId:first.id});expect(await db.inventoryBalance.findUnique({where:{skuId:f.skuId}})).toMatchObject({available:0});
 await adjustments.claim(ctx(),first.id,await versions(first.id));await adjustments.void(ctx(),first.id,{...await versions(first.id),reason:'转换演示作废'});
 expect((await conversion.convert(ctx(),p.id,input)).id).toBe(first.id);expect((await db.initialInventoryDraft.findUniqueOrThrow({where:{id:draft.id}})).status).toBe('CONVERTED');
});
it('IT03：审计故障回滚来源、批次、余额、动作、登记及任务；修复后可重新确认',async()=>{
 const f=await fixture(5),p=await pending(f,5);await adjustments.claim(ctx(),p.id,await versions(p.id));const before=await versions(p.id);
 audit.fail=true;try{await expect(adjustments.post(ctx(),p.id,before)).rejects.toThrow('库存隔离审计故障');}finally{audit.fail=false;}
 expect(await versions(p.id)).toEqual(before);expect(await db.inventoryAction.count({where:{adjustmentId:p.id}})).toBe(0);expect(await db.inventoryReceiptBatch.count({where:{sourceLineId:f.line.id}})).toBe(0);
 expect(await db.inventorySourceLine.findUnique({where:{id:f.line.id}})).toMatchObject({netPostedQuantity:0});expect(await db.inventoryBalance.findUnique({where:{skuId:f.skuId}})).toMatchObject({available:0,reserved:0});
 await adjustments.post(ctx(),p.id,before);expect(await db.inventoryBalance.findUnique({where:{skuId:f.skuId}})).toMatchObject({available:5});
});
it('IT01：INT_MAX合法入账，追加溢出返回409并保持无半状态',async()=>{
 const f=await fixture(2147483647),p=await pending(f,2147483647);await post(p.id);
 const extra=await fixture(1,'RECEIPT',f.skuId),p2=await pending(extra,1);await adjustments.claim(ctx(),p2.id,await versions(p2.id));
 await expect(adjustments.post(ctx(),p2.id,await versions(p2.id))).rejects.toMatchObject({code:'INVENTORY_LIMIT_EXCEEDED'});
 expect(await db.inventoryBalance.findUnique({where:{skuId:f.skuId}})).toMatchObject({available:2147483647});expect(await db.inventoryAction.count({where:{adjustmentId:p2.id}})).toBe(0);
});
it('IT02：同登记串行100次和并发100次只有一个动作；不同批并发不超来源',async()=>{
 const f=await fixture(10),p=await pending(f,5);const {input}=await post(p.id);
 for(let i=0;i<100;i++)expect((await adjustments.post(ctx(),p.id,input)).changed).toBe(false);
 const results=await Promise.allSettled(Array.from({length:100},()=>adjustments.post(ctx(),p.id,input)));
 console.log('100并发结果诊断',results.filter(r=>r.status==='rejected').map(r=>({code:r.reason?.code,message:String(r.reason?.message).slice(0,250)})));
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(100);expect(await db.inventoryAction.count({where:{adjustmentId:p.id}})).toBe(1);
 const a=await pending(f,4,'A'),b=await pending(f,4,'B',peer);await adjustments.claim(ctx(),a.id,await versions(a.id));await adjustments.claim(ctx(peer),b.id,await versions(b.id));
 const race=await Promise.allSettled([adjustments.post(ctx(),a.id,await versions(a.id)),adjustments.post(ctx(peer),b.id,await versions(b.id))]);
 expect(race.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(race.find(r=>r.status==='rejected')).toMatchObject({reason:{code:'SOURCE_QUANTITY_EXCEEDED'}});
 expect(await db.inventorySourceLine.findUnique({where:{id:f.line.id}})).toMatchObject({netPostedQuantity:9});
},30000);
it('IT04：并发两笔负更正共同不能穿透原根净量',async()=>{
 const f=await fixture(10),p=await pending(f,10);await post(p.id);const root=await db.inventoryAdjustmentLine.findFirstOrThrow({where:{adjustmentId:p.id}});
 const make=(who:InventoryContext)=>adjustments.corrections(ctx(who),p.id,{reason:'核实差额',evidenceNote:'同根并发',lines:[{rootLineId:root.id,signedDeltaA:-7}]});
 const a=await make(staff),b=await make(peer);await adjustments.claim(ctx(),a.id,await versions(a.id));await adjustments.claim(ctx(peer),b.id,await versions(b.id));
 const race=await Promise.allSettled([adjustments.post(ctx(),a.id,await versions(a.id)),adjustments.post(ctx(peer),b.id,await versions(b.id))]);expect(race.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect(race.find(r=>r.status==='rejected')).toMatchObject({reason:{code:'CORRECTION_NOT_ALLOWED'}});expect(await db.inventoryBalance.findUnique({where:{skuId:f.skuId}})).toMatchObject({available:3,reserved:0});
});
it('合法大写更正根UUID走真实HTTP并确认成功，大小写混合重复根不能新建登记',async()=>{
 const f=await fixture(4),p=await pending(f,4);await post(p.id);const root=await db.inventoryAdjustmentLine.findFirstOrThrow({where:{adjustmentId:p.id}});
 const result=await call('/admin/inventory/adjustments/'+p.id+'/corrections','POST',{reason:'核实录入差额',evidenceNote:'合法UUID大小写回归',lines:[{rootLineId:root.id.toUpperCase(),signedDeltaA:-1}]});
 expect(result.r.status).toBe(201);const id=result.json.data.id as string;await post(id);
 expect(await db.inventoryAdjustmentLine.findFirst({where:{adjustmentId:id}})).toMatchObject({rootLineId:root.id,signedDeltaA:-1});
 expect(await db.inventoryBalance.findUnique({where:{skuId:f.skuId}})).toMatchObject({available:3,reserved:0});
 const count=await db.inventoryAdjustment.count();const duplicate=await call('/admin/inventory/adjustments/'+p.id+'/corrections','POST',{reason:'重复根拒绝',evidenceNote:'不得拆分重复根',lines:[{rootLineId:root.id,signedDeltaA:-1},{rootLineId:root.id.toUpperCase(),signedDeltaA:-1}]});
 expect(duplicate.r.status).toBe(409);expect(duplicate.json.code).toBe('CORRECTION_NOT_ALLOWED');expect(await db.inventoryAdjustment.count()).toBe(count);
});
it('IT07：两人抢领、转交和调岗回池，旧经办不能继续确认',async()=>{
 const f=await fixture(3),p=await pending(f,3);const v=await versions(p.id);const results=await Promise.allSettled([adjustments.claim(ctx(),p.id,v),adjustments.claim(ctx(peer),p.id,v)]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);const t=await db.task.findFirstOrThrow({where:{businessId:p.id,status:'CLAIMED'}});const old=t.assigneeId===staff.actor.subjectId?staff:peer;
 const admin=await actor('SUPER_ADMIN');await app.get(EmployeeRoleService).change(admin.actor,admin.token,old.actor.subjectId,{role:'CUSTOMER_SERVICE',expectedVersion:0,reason:'库存资格撤销测试'},randomUUID());
 expect(await db.task.findUnique({where:{id:t.id}})).toMatchObject({status:'OPEN',assigneeId:null,reassignNeeded:true});
 await expect(adjustments.post(ctx(old),p.id,await versions(p.id))).rejects.toMatchObject({code:'FORBIDDEN'});
 // 后续场景使用新会话员工，避免复用已调岗测试主体。
 if(old===staff)staff=await actor();else peer=await actor();
});
it('IT07：入账先持主体锁时提交成功，随后撤权不能撤销已入账事实',async()=>{
 const who=await actor(),admin=await actor('SUPER_ADMIN'),f=await fixture(1),p=await pending(f,1,'B',who);await adjustments.claim(ctx(who),p.id,await versions(p.id));
 let entered!:()=>void,release!:()=>void;const reached=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});
 audit.checkpoint=async(_tx,payload)=>{if(payload.action==='inventory.action'&&payload.actor.type==='EMPLOYEE'&&payload.actor.id===who.actor.subjectId){entered();await gate;}};
 const posting=adjustments.post(ctx(who),p.id,await versions(p.id));await reached;
 const changing=app.get(EmployeeRoleService).change(admin.actor,admin.token,who.actor.subjectId,{role:'CUSTOMER_SERVICE',expectedVersion:0,reason:'后提交调岗'},randomUUID());release();
 try{await posting;await changing;}finally{audit.checkpoint=undefined;}
 expect(await db.inventoryAdjustment.findUnique({where:{id:p.id}})).toMatchObject({status:'POSTED'});
});
it('SW09/IT07：低库存含等号、多来源暂停只解除当前源且不产生数量流水',async()=>{
 const f=await fixture(10);await post((await pending(f,10)).id);const query=app.get(InventoryQueries),blocks=app.get(InventoryBlocks);
 expect(await query.balance(f.skuId)).toMatchObject({lowStock:true});const balance=await db.inventoryBalance.findUniqueOrThrow({where:{skuId:f.skuId}});
 await query.threshold(ctx(),f.skuId,{expectedVersion:balance.version,threshold:9,reason:'预警边界'});expect(await query.balance(f.skuId)).toMatchObject({lowStock:false});
 const one=randomUUID(),two=randomUUID();await runAuthTransaction(db,async tx=>{await tx.$queryRaw`SELECT sku_id FROM inventory_balance WHERE sku_id=${f.skuId}::uuid FOR UPDATE`;
  await blocks.open(tx,f.skuId,'PHYSICAL_CHECK',one,'CHECK',{type:'SYSTEM'},randomUUID());await blocks.open(tx,f.skuId,'PHYSICAL_CHECK',two,'CHECK',{type:'SYSTEM'},randomUUID());
  await blocks.resolve(tx,f.skuId,'PHYSICAL_CHECK',one,{type:'SYSTEM'},randomUUID(),'核实一项完成');});
 expect(await query.balance(f.skuId)).toMatchObject({purchaseBlocked:true});expect(await db.inventoryLedger.count({where:{skuId:f.skuId}})).toBe(1);
});
// 测试父事实仓储只存在独占库；正式模块中没有该表/端口注册，不冒充真实订单。
let automatic:InventoryAutomatic;
async function automaticFixture(skuId:string,overrides:Partial<InventoryDomainFacts>={}){
 const id=randomUUID();const facts:InventoryDomainFacts={factId:id,businessId:id,number:'TEST-'+id,state:'NEW',actor:{type:'EMPLOYEE',id:staff.actor.subjectId},deadline:new Date(Date.now()+60000),paymentBlocked:false,paymentSucceeded:false,refundSucceeded:false,handover:'NONE',finalInspection:false,exceptionApproved:false,completeReceived:false,finalPhysicalCheck:false,afterSaleId:null,checkedAfterSaleId:null,physicalVersion:0,checkedPhysicalVersion:0,restockedByOtherPath:false,
  lines:[{skuId,quantity:2,damaged:0,saleable:2,received:2,replacementQuantity:0,unfilledQuantity:0}],...overrides};
 await db.$executeRaw`INSERT INTO module6_test_fact(id,body,state) VALUES(${id}::uuid,${JSON.stringify(facts)}::jsonb,${facts.state})`;return facts;
}
async function autoRun(operation:AutomaticOperation,fact:InventoryDomainFacts){return runAuthTransaction(db,tx=>automatic.execute(tx,operation,fact.factId,ctx(),randomUUID()));}
it('IT05：自动父事实适配器默认拒绝；测试适配器真实锁定/校验父事实后才允许执行',async()=>{
 automatic=app.get(InventoryAutomatic);await expect(runAuthTransaction(db,tx=>automatic.execute(tx,'RESERVE',randomUUID(),ctx(),randomUUID()))).rejects.toMatchObject({code:'INVENTORY_DOMAIN_NOT_READY'});
 await db.$executeRawUnsafe(`CREATE TABLE module6_test_fact(id uuid PRIMARY KEY,body jsonb NOT NULL,state text NOT NULL,applications integer NOT NULL DEFAULT 0,action_id uuid REFERENCES inventory_action(id),physical_revision integer NOT NULL DEFAULT 0)`);testFactCreated=true;
 const read=async(tx:Prisma.TransactionClient,id:string)=>{const [r]=await tx.$queryRaw<{body:InventoryDomainFacts;state:InventoryDomainFacts['state']}[]>`SELECT body,state FROM module6_test_fact WHERE id=${id}::uuid`;
  if(!r)throw new Error('测试父事实不存在');return {...r.body,state:r.state,deadline:r.body.deadline?new Date(r.body.deadline):null};};
 const port:InventoryDomainPort={
  async lockAndAuthorize(tx,_operation,id,access){const c=access as InventoryContext;await tx.$queryRaw`SELECT id FROM employee WHERE id=${c.actor.subjectId}::uuid FOR UPDATE`;
   const current=await app.get(CurrentIdentityService).authenticate(tx,c.token,'EMPLOYEE');if(current.subjectType!=='EMPLOYEE'||!current.effectivePermissions.includes('inventory.adjustment.post'))throw new Error('测试领域无权限');
   await tx.$queryRaw`SELECT id FROM module6_test_fact WHERE id=${id}::uuid FOR UPDATE`;const f=await read(tx,id);if(f.actor.type!=='EMPLOYEE'||f.actor.id!==current.subjectId)throw new Error('测试领域归属不符');return f;},
  readLocked:(_tx,_operation,id)=>read(_tx,id),
  async apply(tx,operation,facts,actionId){const state=operation==='RESERVE'?'UNPAID':operation==='PAY'?'PAID':operation==='CLOSE'?'CLOSED':operation==='UNSHIPPED_REFUND_RESTOCK'?'REFUNDED':operation==='RETURN_RESTOCK'?'INSPECTED':facts.state;
   await tx.$executeRaw`UPDATE module6_test_fact SET applications=applications+1,action_id=${actionId}::uuid,state=${state},physical_revision=physical_revision+${['PAID_PREPARATION_LOSS','ALLOCATE_REPLACEMENT'].includes(operation)?1:0} WHERE id=${facts.factId}::uuid`;},
 };
 for(const op of ['RESERVE','PAY','CLOSE','RETURN_RESTOCK','UNSHIPPED_REFUND_RESTOCK','PAID_PREPARATION_LOSS','ALLOCATE_REPLACEMENT'] as const)app.get(InventoryDomainPorts).register(op,port);
});
it('IT05：预占/付款/净释放、未知受损拒绝、整数边界、多SKU失败全部回滚',async()=>{
 const f=await fixture(10);await post((await pending(f,10)).id);await db.product.update({where:{id:f.product!.id},data:{status:'ON_SALE'}});await db.sku.update({where:{id:f.skuId},data:{priceCents:100}});
 const reserve=await automaticFixture(f.skuId);await autoRun('RESERVE',reserve);expect(await db.inventoryBalance.findUnique({where:{skuId:f.skuId}})).toMatchObject({available:8,reserved:2});
 const pay=await automaticFixture(f.skuId,{state:'UNPAID',paymentSucceeded:true});await autoRun('PAY',pay);expect(await db.inventoryBalance.findUnique({where:{skuId:f.skuId}})).toMatchObject({available:8,reserved:0});
 await autoRun('RESERVE',await automaticFixture(f.skuId));const damaged=await automaticFixture(f.skuId,{state:'UNPAID',lines:[{...reserve.lines[0]!,damaged:1}]});await autoRun('CLOSE',damaged);
 expect(await db.inventoryBalance.findUnique({where:{skuId:f.skuId}})).toMatchObject({available:7,reserved:0});
 const unknown=await automaticFixture(f.skuId,{state:'UNPAID',lines:[{...reserve.lines[0]!,damaged:null}]});await expect(autoRun('CLOSE',unknown)).rejects.toMatchObject({code:'ORDER_STOCK_BLOCKED'});
 const paidLoss=await automaticFixture(f.skuId,{state:'PAID',lines:[{...reserve.lines[0]!,damaged:1}]});await autoRun('PAID_PREPARATION_LOSS',paidLoss);expect(await db.inventoryBalance.findUnique({where:{skuId:f.skuId}})).toMatchObject({available:7,reserved:0});
 expect(await db.inventoryLedger.findFirst({where:{businessId:paidLoss.businessId}})).toMatchObject({deltaA:0,deltaR:0,eventType:'PAID_PREPARATION_LOSS'});
 const second=await fixture(1);await post((await pending(second,1)).id);await db.product.update({where:{id:second.product!.id},data:{status:'ON_SALE'}});await db.sku.update({where:{id:second.skuId},data:{priceCents:100}});
 const multiple=await automaticFixture(f.skuId,{lines:[reserve.lines[0]!,{...reserve.lines[0]!,skuId:second.skuId}]});await expect(autoRun('RESERVE',multiple)).rejects.toMatchObject({code:'STOCK_INSUFFICIENT'});
 expect(await db.inventoryBalance.findUnique({where:{skuId:f.skuId}})).toMatchObject({available:7,reserved:0});expect(await db.inventoryAction.count({where:{businessId:multiple.businessId}})).toBe(0);
});
it('IT06：退款/最终验收时点、核实版本、错售后、零回补100次与审计回滚',async()=>{
 const f=await fixture(1),afterSaleId=randomUUID(),line={skuId:f.skuId,quantity:2,damaged:1,saleable:1,received:2,replacementQuantity:0,unfilledQuantity:0};
 const base={state:'PAID' as const,afterSaleId,checkedAfterSaleId:afterSaleId,physicalVersion:2,checkedPhysicalVersion:2,finalPhysicalCheck:true,lines:[line]};
 await expect(autoRun('UNSHIPPED_REFUND_RESTOCK',await automaticFixture(f.skuId,base))).rejects.toMatchObject({code:'RESTOCK_NOT_ALLOWED'});
 await expect(autoRun('UNSHIPPED_REFUND_RESTOCK',await automaticFixture(f.skuId,{...base,refundSucceeded:true,checkedPhysicalVersion:1}))).rejects.toMatchObject({code:'PHYSICAL_CHECK_STALE'});
 await expect(autoRun('UNSHIPPED_REFUND_RESTOCK',await automaticFixture(f.skuId,{...base,refundSucceeded:true,checkedAfterSaleId:randomUUID()}))).rejects.toMatchObject({code:'PHYSICAL_CHECK_STALE'});
 await expect(autoRun('UNSHIPPED_REFUND_RESTOCK',await automaticFixture(f.skuId,{...base,refundSucceeded:true,handover:'UNKNOWN'}))).rejects.toMatchObject({code:'RESTOCK_NOT_ALLOWED'});
 const refund=await automaticFixture(f.skuId,{...base,refundSucceeded:true});await autoRun('UNSHIPPED_REFUND_RESTOCK',refund);await autoRun('UNSHIPPED_REFUND_RESTOCK',refund);
 expect(await db.inventoryBalance.findUnique({where:{skuId:f.skuId}})).toMatchObject({available:1});
 const allBad=await automaticFixture(f.skuId,{...base,finalInspection:true,completeReceived:true,lines:[{...line,damaged:2,saleable:0}]});
 audit.fail=true;try{await expect(autoRun('RETURN_RESTOCK',allBad)).rejects.toThrow('库存隔离审计故障');}finally{audit.fail=false;}
 expect(await db.inventoryAction.count({where:{businessId:allBad.businessId}})).toBe(0);await autoRun('RETURN_RESTOCK',allBad);
 for(let i=0;i<100;i++)expect((await autoRun('RETURN_RESTOCK',allBad)).changed).toBe(false);
 expect(await db.inventoryAction.count({where:{businessId:allBad.businessId}})).toBe(1);expect(await db.inventoryLedger.count({where:{businessId:allBad.businessId}})).toBe(0);
 const zero=await automaticFixture(f.skuId,{...base,refundSucceeded:true,lines:[{...line,saleable:0,damaged:2}]});await autoRun('UNSHIPPED_REFUND_RESTOCK',zero);expect(await db.inventoryLedger.count({where:{businessId:zero.businessId}})).toBe(0);
});
it('IT08：静态路径、UUID、严格数量/字段、查询布尔及读取权限均经真实HTTP',async()=>{
 for(const path of ['/admin/inventory','/admin/inventory/ledger','/admin/inventory/sources','/admin/inventory/adjustments']){const {r,json}=await call(path);expect(r.status,JSON.stringify(json)).toBe(200);}
 const malformed=await call('/admin/inventory/not-a-uuid');expect(malformed.r.status).toBe(400);
 expect((await call('/admin/inventory?lowStock=1')).r.status).toBe(400);expect((await call('/admin/inventory?lowStock=true')).r.status).toBe(200);
 expect((await call('/admin/inventory','GET',undefined,service)).r.status).toBe(403);
 const f=await fixture(2);const payload={type:'ARRIVAL',reason:'HTTP严格校验',lines:[{skuId:f.skuId,sourceLineId:f.line.id,batchKey:'B',quantity:2}]};
 expect((await call('/admin/inventory/adjustments','POST',{...payload,lines:[{...payload.lines[0],deltaR:1}]})).r.status).toBe(400);
 expect((await call('/admin/inventory/adjustments','POST',{...payload,lines:[{...payload.lines[0],quantity:1.1}]})).r.status).toBe(400);
 const made=await call('/admin/inventory/adjustments','POST',payload);expect(made.r.status,JSON.stringify(made.json)).toBe(201);expect(made.json.data).toMatchObject({status:'PENDING',taskVersion:0,adjustmentVersion:0});
 const claimed=await call(`/admin/inventory/adjustments/${made.json.data.id}/claim`,'POST',{expectedVersion:0,expectedTaskVersion:0});expect(claimed.r.status).toBe(200);
 const posted=await call(`/admin/inventory/adjustments/${made.json.data.id}/post`,'POST',{expectedVersion:0,expectedTaskVersion:claimed.json.data.taskVersion});expect(posted.r.status,JSON.stringify(posted.json)).toBe(200);
 expect(posted.json.data).toMatchObject({status:'POSTED',task:null});expect(posted.json.data.ledger).toHaveLength(1);
});
it('IT08：私有凭证归属/用途、跨来源拒绝、历史保留且顾客/客服/匿名不可读',async()=>{
 const f=await fixture(2),image=await upload();const s=await source.create(ctx(),{sourceType:'RECEIPT',namespace:'HTTP-EVIDENCE',reference:randomUUID(),note:'带图核实',evidenceFileIds:[image],lines:[{lineKey:'1',skuId:f.skuId,verifiedQuantity:2}]});
 for(const who of [null,service]){const r=await fetch(base+`/api/v1/files/${image}/content`,{headers:who?{Authorization:'Bearer '+who.token}:{}});expect(r.status).toBe(404);}
 const allowed=await fetch(base+`/api/v1/files/${image}/content`,{headers:{Authorization:'Bearer '+staff.token}});expect(allowed.status).toBe(200);expect(allowed.headers.get('cache-control')).toBe('private, no-store');
 await expect(source.create(ctx(),{sourceType:'RECEIPT',namespace:'HTTP-EVIDENCE',reference:randomUUID(),note:'跨来源错误',evidenceFileIds:[image],lines:[{lineKey:'1',skuId:f.skuId,verifiedQuantity:2}]})).rejects.toMatchObject({code:'FILE_NOT_BINDABLE'});
 const line=await db.inventorySourceLine.findFirstOrThrow({where:{sourceId:s.id}}),p=await adjustments.create(ctx(),{type:'ARRIVAL',reason:'通过来源查看凭证',lines:[{skuId:f.skuId,sourceLineId:line.id,batchKey:'B',quantity:2}]});await post(p.id);
 const detail=await app.get(InventoryQueries).adjustment(p.id);expect(detail.sources[0]!.evidence[0]!.id).toBe(image);expect(await db.fileReference.count({where:{fileAssetId:image}})).toBe(1);
});
it('SW10/IT08：合法来源入账后真实上架，公开投影无占用/成本/内部来源',async()=>{
 const f=await fixture(12);await post((await pending(f,12)).id);let p=await db.product.findUniqueOrThrow({where:{id:f.product!.id}});
 const cat=await app.get(CategoryService).write(staff.actor,staff.token,randomUUID(),null,{name:'库存可售验收'+randomUUID().slice(0,8)},'create');
 await products.edit(ctx(),p.id,{expectedVersion:p.version,categoryId:cat.id});p=await db.product.findUniqueOrThrow({where:{id:p.id}});
 await products.prices(ctx(),p.id,{expectedVersion:p.version,skuIds:[f.skuId],priceCents:9900,costCents:5000});p=await db.product.findUniqueOrThrow({where:{id:p.id}});
 await products.images(ctx(),p.id,{expectedVersion:p.version,mainImageId:await upload('PRODUCT_IMAGE'),galleryImageIds:[]});p=await db.product.findUniqueOrThrow({where:{id:p.id}});
 await products.status(ctx(),p.id,{expectedVersion:p.version,reason:'真实入账完成，上架验收'},'publish');
 const {r,json}=await call('/store/products/'+p.id,'GET',undefined,null);expect(r.status).toBe(200);expect(json.data.skus[0]).toMatchObject({available:12,purchasable:true,priceCents:9900});
 const body=JSON.stringify(json.data);for(const field of ['reserved','costCents','sourceLineId','conversionFingerprint'])expect(body).not.toContain(field);
});

it('IT03：流水、源量、任务故障各自回滚，转换的任务与附件失败不留孤单',async()=>{
 for(const table of ['inventory_ledger','inventory_source_line','task']){
  const f=await fixture(3),p=await pending(f,3);await adjustments.claim(ctx(),p.id,await versions(p.id));const before=await versions(p.id);
  await db.$executeRawUnsafe(`CREATE FUNCTION module6_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '模块6独占故障'; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER module6_fault BEFORE INSERT OR UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION module6_fault()`);
  try{await expect(adjustments.post(ctx(),p.id,before)).rejects.toBeDefined();}finally{await db.$executeRawUnsafe(`DROP TRIGGER module6_fault ON ${table}`);await db.$executeRawUnsafe('DROP FUNCTION module6_fault()');}
  expect(await versions(p.id)).toEqual(before);expect(await db.inventoryAdjustment.findUnique({where:{id:p.id}})).toMatchObject({status:'PENDING'});
  expect(await db.inventoryBalance.findUnique({where:{skuId:f.skuId}})).toMatchObject({available:0,reserved:0});expect(await db.inventorySourceLine.findUnique({where:{id:f.line.id}})).toMatchObject({netPostedQuantity:0});
  expect(await db.inventoryAction.count({where:{adjustmentId:p.id}})).toBe(0);expect(await db.inventoryLedger.count({where:{skuId:f.skuId}})).toBe(0);expect(await db.inventoryReceiptBatch.count({where:{sourceLineId:f.line.id}})).toBe(0);
 }
 const f=await fixture(12);await products.draftSave(ctx(),f.product!.id,{expectedProductVersion:0,expectedDraftVersion:null,lines:[{skuId:f.skuId,quantity:12}]});
 const p=await db.product.findUniqueOrThrow({where:{id:f.product!.id}}),draft=await db.initialInventoryDraft.findFirstOrThrow({where:{productId:p.id}}),image=await upload();
 const input={expectedProductVersion:p.version,expectedDraftVersion:draft.version,sourceId:f.source.id,mappings:[{skuId:f.skuId,sourceLineId:f.line.id,batchKey:'INIT'}],reason:'转换故障隔离测试',evidenceFileIds:[image]};
 for(const table of ['task','file_reference']){
  await db.$executeRawUnsafe(`CREATE FUNCTION module6_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '模块6独占故障'; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER module6_fault BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION module6_fault()`);
  try{await expect(conversion.convert(ctx(),p.id,input)).rejects.toBeDefined();}finally{await db.$executeRawUnsafe(`DROP TRIGGER module6_fault ON ${table}`);await db.$executeRawUnsafe('DROP FUNCTION module6_fault()');}
  expect(await db.initialInventoryDraft.findUnique({where:{id:draft.id}})).toMatchObject({status:'EDITABLE',adjustmentId:null,version:draft.version});
  expect(await db.inventoryAdjustment.count({where:{conversionKey:draft.conversionKey}})).toBe(0);expect(await db.fileReference.count({where:{fileAssetId:image}})).toBe(0);
 }
 await conversion.convert(ctx(),p.id,input);
});
it('IT04：损耗更正最多归还已扣数量，来源净量与根流水可复算',async()=>{
 const receipt=await fixture(10);await post((await pending(receipt,10)).id);const loss=await fixture(3,'LOSS',receipt.skuId),root=await pending(loss,3);await post(root.id);
 const line=await db.inventoryAdjustmentLine.findFirstOrThrow({where:{adjustmentId:root.id}});
 const correction=await adjustments.corrections(ctx(),root.id,{reason:'多扣一件',evidenceNote:'隔离核实少损耗1件',lines:[{rootLineId:line.id,signedDeltaA:1}]});await post(correction.id);
 const tooMuch=await adjustments.corrections(ctx(),root.id,{reason:'不能凭空新增',evidenceNote:'故意超出原根损耗的拒绝测试',lines:[{rootLineId:line.id,signedDeltaA:3}]});await adjustments.claim(ctx(),tooMuch.id,await versions(tooMuch.id));
 await expect(adjustments.post(ctx(),tooMuch.id,await versions(tooMuch.id))).rejects.toMatchObject({code:'CORRECTION_NOT_ALLOWED'});
 expect(await db.inventoryBalance.findUnique({where:{skuId:receipt.skuId}})).toMatchObject({available:8,reserved:0});expect(await db.inventorySourceLine.findUnique({where:{id:loss.line.id}})).toMatchObject({netPostedQuantity:2});
});
it('IT05/06：补齐只扣A；最终验收独立于退款，少件需批准且零回补并发不加库存',async()=>{
 const f=await fixture(10);await post((await pending(f,10)).id);const afterSaleId=randomUUID();
 const replacement=await automaticFixture(f.skuId,{state:'PAID',lines:[{skuId:f.skuId,quantity:2,damaged:1,saleable:1,received:2,replacementQuantity:1,unfilledQuantity:1}]});
 await autoRun('ALLOCATE_REPLACEMENT',replacement);await autoRun('ALLOCATE_REPLACEMENT',replacement);expect(await db.inventoryBalance.findUnique({where:{skuId:f.skuId}})).toMatchObject({available:9,reserved:0});
 const base={state:'PAID' as const,handover:'HANDED' as const,afterSaleId,checkedAfterSaleId:afterSaleId,finalInspection:true,physicalVersion:1,checkedPhysicalVersion:1,completeReceived:true,lines:[{skuId:f.skuId,quantity:2,damaged:0,saleable:1,received:1,replacementQuantity:0,unfilledQuantity:0}]};
 await expect(autoRun('RETURN_RESTOCK',await automaticFixture(f.skuId,base))).rejects.toMatchObject({code:'RESTOCK_NOT_ALLOWED'});
 const approved=await automaticFixture(f.skuId,{...base,exceptionApproved:true,finalPhysicalCheck:true});await autoRun('RETURN_RESTOCK',approved);
 expect(await db.inventoryBalance.findUnique({where:{skuId:f.skuId}})).toMatchObject({available:10});
 await expect(autoRun('RETURN_RESTOCK',await automaticFixture(f.skuId,{...base,restockedByOtherPath:true,exceptionApproved:true,finalPhysicalCheck:true}))).rejects.toMatchObject({code:'RESTOCK_NOT_ALLOWED'});
 const zero=await automaticFixture(f.skuId,{...base,handover:'NONE',refundSucceeded:true,finalPhysicalCheck:true,lines:[{...base.lines[0]!,saleable:0,received:2,damaged:2}]});
 const results=await Promise.all(Array.from({length:20},()=>autoRun('UNSHIPPED_REFUND_RESTOCK',zero)));expect(results.filter(r=>r.changed)).toHaveLength(1);
 expect(await db.inventoryLedger.count({where:{businessId:zero.businessId}})).toBe(0);expect(await db.inventoryBalance.findUnique({where:{skuId:f.skuId}})).toMatchObject({available:10});
});
it('审查回归：库存任务人工指定截止后可扫描逾期，系统仍不能进入人工阶段',async()=>{
 const f=await fixture(10),p=await pending(f,10),admin=await actor('SUPER_ADMIN');
 const task=await db.task.findFirstOrThrow({where:{businessId:p.id,stage:'INVENTORY_POST'}});
 const now=Date.now(),clock=vi.spyOn(app.get(Clock),'now').mockReturnValue(new Date(now));
 try{
  await app.get(TaskDeadlineService).extend(admin.actor,admin.token,task.id,{expectedVersion:task.version,newDueAt:new Date(now+60000).toISOString(),reason:'明确库存人工处理截止'},randomUUID());
  clock.mockReturnValue(new Date(now+60000));
  const scan=await app.get(TaskOverdueScanService).scan();
  expect(scan).toMatchObject({status:'SUCCEEDED',changedCount:1,failedCount:0});
  expect(await db.task.findUniqueOrThrow({where:{id:task.id}})).toMatchObject({status:'OPEN',everOverdue:true,firstOverdueAt:new Date(now+60000)});
  expect(await db.deadlineEvent.count({where:{taskId:task.id,eventType:'OVERDUE'}})).toBe(1);
  expect(await db.auditLog.count({where:{targetId:task.id,action:'task.overdue.record',actorType:'SYSTEM'}})).toBe(1);
  expect(await app.get(TaskOverdueScanService).scan()).toMatchObject({status:'SUCCEEDED',changedCount:0,failedCount:0});
  expect(await db.inventoryBalance.findUniqueOrThrow({where:{skuId:f.skuId}})).toMatchObject({available:0,reserved:0});
  expect(await db.inventoryAdjustment.findUniqueOrThrow({where:{id:p.id}})).toMatchObject({status:'PENDING'});
  await expect(db.$transaction(tx=>app.get(TaskEntryService).withContext(tx,{type:'SYSTEM'},[{businessType:'INVENTORY_ADJUSTMENT',businessId:p.id}],randomUUID(),async()=>undefined))).rejects.toMatchObject({code:'INVENTORY_DOMAIN_NOT_READY'});
 }finally{clock.mockRestore();}
});
it('审查回归：读取登记期间并发入账，返回同一快照的状态、余额、来源、任务和流水',async()=>{
 const f=await fixture(10),p=await pending(f,10),original=db.$transaction.bind(db);let observed=false;
 const spy=vi.spyOn(db,'$transaction').mockImplementation(((command:(tx:Prisma.TransactionClient)=>Promise<unknown>,options:object)=>{
  // 仅拦截这次详情读取；并发入账仍运行完整的真实事务与锁序。
  spy.mockRestore();return original(async tx=>command(new Proxy(tx,{get(client,key){
   if(key!=='inventoryAdjustment')return Reflect.get(client,key);
   return new Proxy(tx.inventoryAdjustment,{get(delegate,method){
    if(method!=='findUnique')return Reflect.get(delegate,method);
    return async(input:Prisma.InventoryAdjustmentFindUniqueArgs)=>{const row=await delegate.findUnique(input);
     if(!observed&&row?.id===p.id){observed=true;await post(p.id);}return row;};
   }});
  }})),options);
 }) as typeof db.$transaction);
 try{
  const view=await app.get(InventoryQueries).adjustment(p.id);
  expect(observed).toBe(true);expect(view).toMatchObject({status:'PENDING',version:0,action:null,task:{status:'OPEN',version:0}});
  expect(view.lines[0]).toMatchObject({available:0,reserved:0});expect(view.sources[0]!.lines[0]).toMatchObject({netPostedQuantity:0,batches:[]});expect(view.ledger).toEqual([]);
  expect(await db.inventoryAdjustment.findUniqueOrThrow({where:{id:p.id}})).toMatchObject({status:'POSTED'});
  expect(await db.inventoryBalance.findUniqueOrThrow({where:{skuId:f.skuId}})).toMatchObject({available:10});
 }finally{spy.mockRestore();}
});
it('IT09：所有本轮SKU余额与流水、来源净量与根更正对账相等',async()=>{
 const balances=await db.$queryRaw<{sku_id:string}[]>`SELECT b.sku_id FROM inventory_balance b LEFT JOIN inventory_ledger l ON l.sku_id=b.sku_id WHERE b.sku_id IN (SELECT own.sku_id FROM inventory_source_line own JOIN inventory_source src ON src.id=own.source_id WHERE src.created_by_id=${staff.actor.subjectId}::uuid) GROUP BY b.sku_id,b.available,b.reserved HAVING b.available::bigint<>COALESCE(sum(l.delta_a::bigint),0) OR b.reserved::bigint<>COALESCE(sum(l.delta_r::bigint),0)`;
 expect(balances).toEqual([]);
 const sources=await db.$queryRaw<{id:string}[]>`SELECT s.id FROM inventory_source_line s LEFT JOIN inventory_ledger l ON l.source_line_id=s.id GROUP BY s.id,s.source_id,s.net_posted_quantity HAVING s.net_posted_quantity::bigint<>COALESCE(sum(CASE WHEN (SELECT source_type FROM inventory_source WHERE id=s.source_id)='LOSS' THEN -l.delta_a::bigint ELSE l.delta_a::bigint END),0)`;
 expect(sources).toEqual([]);
});
