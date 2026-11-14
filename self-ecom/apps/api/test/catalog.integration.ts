// 作用：在本轮独占库验证分类并发、实体保护、真实图片、严格HTTP、字段权限及事务回滚。
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';
import sharp from 'sharp';
import type { Prisma } from '@prisma/client';
import { assertSafeTestDatabase } from '../scripts/database-env.js';
import { AppModule } from '../src/app.module.js';
import { APP_CONFIG, loadConfiguration } from '../src/config/environment.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuditService, type AuditPayload } from '../src/audit/audit.service.js';
import { JwtTokenService } from '../src/auth/jwt-token.service.js';
import { CurrentIdentityService } from '../src/auth/current-identity.service.js';
import { configureApp } from '../src/common/configure-app.js';
import { seedPermissionCatalog } from '../src/permissions/permission-seed.js';
import { CategoryController, ProductController, StoreCatalogController } from '../src/catalog/catalog.controller.js';
import * as D from '../src/catalog/catalog.dto.js';
import { CategoryService } from '../src/catalog/category.service.js';
import { ProductCommands, type CatalogContext } from '../src/catalog/product-command.service.js';
import { CatalogQueries } from '../src/catalog/catalog-query.service.js';
import { SkuReferences } from '../src/catalog/sku-reference.service.js';
import { signature } from '../src/catalog/catalog.rules.js';
import { FILE_CONFIG } from '../src/files/file-configuration.js';
assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL,process.env.DATABASE_URL);
if(process.env.NODE_ENV!=='test'||!/^\/m105_[a-f0-9]{32}_test$/.test(new URL(process.env.DATABASE_URL!).pathname))throw new Error('本文件只运行在verify-module5创建的独占库');
const metadata=(controller:object,rows:Record<string,unknown[]>)=>{for(const [key,types]of Object.entries(rows))Reflect.defineMetadata('design:paramtypes',types,controller,key);};
metadata(CategoryController.prototype,{create:[D.CategoryCreateDto,Object,Object],edit:[D.CatalogIdDto,D.CategoryEditDto,Object,Object],move:[D.CatalogIdDto,D.CategoryMoveDto,Object,Object],remove:[D.CatalogIdDto,D.ReasonDto,Object,Object]});
metadata(ProductController.prototype,{list:[D.AdminProductsQueryDto,Object],detail:[D.CatalogIdDto,Object],create:[D.ProductCreateDto,Object,Object],edit:[D.CatalogIdDto,D.ProductEditDto,Object,Object],images:[D.CatalogIdDto,D.ProductImagesDto,Object,Object],publish:[D.CatalogIdDto,D.ReasonDto,Object,Object],unpublish:[D.CatalogIdDto,D.ReasonDto,Object,Object],archive:[D.CatalogIdDto,D.ReasonDto,Object,Object],batch:[D.BatchStatusDto,Object,Object],preview:[D.CatalogIdDto,D.SchemePreviewDto],scheme:[D.CatalogIdDto,D.SchemeSaveDto,Object,Object],sku:[D.SkuIdDto,D.SkuEditDto,Object,Object],fill:[D.CatalogIdDto,D.SkuBatchDto,Object,Object],enabled:[D.SkuIdDto,D.SkuEnabledDto,Object,Object],draft:[D.CatalogIdDto],saveDraft:[D.CatalogIdDto,D.DraftSaveDto,Object,Object],voidDraft:[D.CatalogIdDto,D.DraftVoidDto,Object,Object]});
metadata(StoreCatalogController.prototype,{list:[D.StoreProductsQueryDto],detail:[D.CatalogIdDto]});
class ControlledAudit extends AuditService{
  fail=false;
  checkpoint:((tx:Prisma.TransactionClient,payload:AuditPayload)=>Promise<void>)|undefined;
  override async appendAudit(tx:Prisma.TransactionClient,payload:AuditPayload){await super.appendAudit(tx,payload);await this.checkpoint?.(tx,payload);if(this.fail&&['category.change','product.change'].includes(payload.action))throw new Error('商品测试审计故障');}
}
const audit=new ControlledAudit();let app:INestApplication,db:PrismaService,commands:ProductCommands,categories:CategoryService,queries:CatalogQueries;
let base='',directory='',staff:CatalogContext,peer:CatalogContext,service:CatalogContext;
const responses:{path:string;method:string;status:number;code?:string;requestId:string|null}[]=[];
async function actor(role:'SUPER_ADMIN'|'MERCH_WAREHOUSE'|'CUSTOMER_SERVICE'='MERCH_WAREHOUSE'){
  const id=randomUUID(),sid=randomUUID();const e=await db.employee.create({data:{id,username:'ct_'+id.replaceAll('-','').slice(0,20),displayName:'商品隔离测试员工',role,mustChangePassword:false,passwordHash:'隔离测试会话，不用于密码登录'}});
  const issued=await app.get(JwtTokenService).issue({subjectType:'EMPLOYEE',subjectId:id,sessionId:sid,tokenVersion:e.tokenVersion});
  await db.authSession.create({data:{id:sid,subjectType:'EMPLOYEE',employeeId:id,tokenVersion:e.tokenVersion,createdAt:issued.issuedAt,expiresAt:issued.expiresAt}});
  return {actor:await app.get(CurrentIdentityService).authenticate(db,issued.accessToken,'EMPLOYEE'),token:issued.accessToken,requestId:randomUUID()};
}
beforeAll(async()=>{
  directory=await mkdtemp(join(tmpdir(),'self-ecom-catalog-'));
  const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(APP_CONFIG).useValue({...loadConfiguration({...process.env,LOG_LEVEL:'silent'}),uploadDir:directory})
    .overrideProvider(AuditService).useValue(audit).overrideProvider(FILE_CONFIG).useValue({stagedQuota:1000,uploadsPerMinute:100,cleanupIntervalSeconds:86400}).compile();
  app=module.createNestApplication();configureApp(app);await app.listen(0,'127.0.0.1');base=await app.getUrl();db=app.get(PrismaService);
  await seedPermissionCatalog(db);commands=app.get(ProductCommands);categories=app.get(CategoryService);queries=app.get(CatalogQueries);
  staff=await actor();peer=await actor();service=await actor('CUSTOMER_SERVICE');
},30000);
afterAll(async()=>{await app?.close();console.log('保留测试图片目录：'+directory);await writeFile(resolve('../../docs/verification/evidence/M1-05',`catalog-http-${Date.now()}.json`),JSON.stringify(responses,null,2));});
async function call(path:string,method='GET',body?:unknown,who:CatalogContext|null=staff){
  const r=await fetch(base+'/api/v1'+path,{method,headers:{'Content-Type':'application/json',...(who?{Authorization:'Bearer '+who.token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const json=await r.json();responses.push({path,method,status:r.status,code:json.code,requestId:r.headers.get('x-request-id')});expect(json.requestId).toBe(r.headers.get('x-request-id'));return {r,json};
}
async function ok(path:string,method='GET',body?:unknown,who:CatalogContext|null=staff){const {r,json}=await call(path,method,body,who);expect([200,201],JSON.stringify(json)).toContain(r.status);return json.data;}
async function bad(path:string,method:string,body:unknown,status:number,code:string,who:CatalogContext|null=staff){const {r,json}=await call(path,method,body,who);expect(r.status,JSON.stringify(json)).toBe(status);expect(json.code).toBe(code);return json;}
const create=(name='隔离款式')=>commands.create({...staff,requestId:randomUUID()},{name});
const category=(name:string,parentId?:string)=>categories.write(staff.actor,staff.token,randomUUID(),null,{name,parentId},'create');
function scheme(names=[['黑色','白色'],['S','M','L']]){return names.map((values,i)=>({clientKey:randomUUID(),name:['颜色','尺码','版型'][i]!,values:values.map(name=>({clientKey:randomUUID(),name}))}));}
async function upload(who=staff,purpose='PRODUCT_IMAGE'){
  const png=await sharp({create:{width:30,height:40,channels:3,background:'#765a49'}}).png().toBuffer();const body=new FormData();body.append('purpose',purpose);body.append('file',new Blob([new Uint8Array(png)]),'fixture.png');
  const r=await fetch(base+'/api/v1/files',{method:'POST',headers:{Authorization:'Bearer '+who.token},body});expect(r.status).toBe(201);return (await r.json()).data.id as string;
}
async function ready(stock=2){
  let p=await create('上架验证'+randomUUID().slice(0,8));const c=await category('分类'+randomUUID().slice(0,8));
  p=await commands.edit(staff,p.id,{expectedVersion:p.version!,categoryId:c.id});
  p=await commands.prices(staff,p.id,{expectedVersion:p.version!,skuIds:[p.skus[0]!.id],priceCents:9900,costCents:5000});
  const image=await upload();p=await commands.images(staff,p.id,{expectedVersion:p.version!,mainImageId:image,galleryImageIds:[]});
  // 本文件只能连接本轮独占测试库；正余额仅为销售规则夹具，生产无此命令。
  await db.inventoryBalance.update({where:{skuId:p.skus[0]!.id},data:{available:stock}});return p;
}
it('SW01/IT01：根和子名称规范化、三级、版本与删除保护',async()=>{
  const root=await category('ÉTÉ');await expect(category(' e\u0301te\u0301 ')).rejects.toMatchObject({code:'CATEGORY_NAME_EXISTS'});
  const child=await category('上衣',root.id),leaf=await category('T恤',child.id);await expect(category('第四级',leaf.id)).rejects.toMatchObject({code:'CATEGORY_DEPTH_EXCEEDED'});
  await expect(categories.write(staff.actor,staff.token,randomUUID(),root.id,{expectedVersion:0,reason:'删除'},'delete')).rejects.toMatchObject({code:'CATEGORY_IN_USE'});
  const p=await commands.create(staff,{name:'父分类可关联',categoryId:leaf.id});await commands.status(staff,p.id,{expectedVersion:0,reason:'归档'},'archive');
  await expect(categories.write(staff.actor,staff.token,randomUUID(),leaf.id,{expectedVersion:0,reason:'删除'},'delete')).rejects.toMatchObject({code:'CATEGORY_IN_USE'});
  await categories.write(staff.actor,staff.token,randomUUID(),child.id,{expectedVersion:0,sortOrder:9},'edit');
  await expect(categories.write(staff.actor,staff.token,randomUUID(),child.id,{expectedVersion:0,name:'旧提交'},'edit')).rejects.toMatchObject({code:'VERSION_CONFLICT'});
});
it('SW02/IT01：完整子树深度、防环和路径同步',async()=>{
  const a=await category('移动A'),b=await category('移动B',a.id),c=await category('移动C',b.id),d=await category('移动D'),e=await category('移动E',d.id);
  await expect(categories.write(staff.actor,staff.token,randomUUID(),b.id,{expectedVersion:0,parentId:e.id,reason:'整树深度'},'move')).rejects.toMatchObject({code:'CATEGORY_DEPTH_EXCEEDED'});
  await expect(categories.write(staff.actor,staff.token,randomUUID(),a.id,{expectedVersion:0,parentId:c.id,reason:'成环'},'move')).rejects.toMatchObject({code:'CATEGORY_CYCLE'});
  await categories.write(staff.actor,staff.token,randomUUID(),b.id,{expectedVersion:0,parentId:null,reason:'移根'},'move');
  expect((await db.category.findUniqueOrThrow({where:{id:c.id}})).pathIds).toEqual([b.id,c.id]);
});
it('IT01：超过千条的子树移动保持完整路径与有界审计',async()=>{
  const parent=await category('大树父级'),root=await category('大树根',parent.id);
  const children=Array.from({length:1001},(_,i)=>{const id=randomUUID();return {id,parentId:root.id,name:'子类'+i,nameKey:'子类'+i,depth:3,pathIds:[parent.id,root.id,id]};});
  await db.category.createMany({data:children});
  const moved=await categories.write(staff.actor,staff.token,randomUUID(),root.id,{expectedVersion:0,parentId:null,reason:'大树移根'},'move');
  expect(moved.affected).toBe(1002);expect(await db.category.count({where:{parentId:root.id,depth:2,version:1}})).toBe(1001);
  expect((await db.category.findUniqueOrThrow({where:{id:children[0]!.id}})).pathIds).toEqual([root.id,children[0]!.id]);
});
it('IT01：不同员工并发互移只能成功一个，不能共同成环',async()=>{
  const a=await category('并发根A'),b=await category('并发根B');
  const results=await Promise.allSettled([categories.write(staff.actor,staff.token,randomUUID(),a.id,{expectedVersion:0,parentId:b.id,reason:'并发A'},'move'),categories.write(peer.actor,peer.token,randomUUID(),b.id,{expectedVersion:0,parentId:a.id,reason:'并发B'},'move')]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{code:'CATEGORY_CYCLE'}});
});
it('SW03/04：默认SKU零账户，预览只读，6组合映射与重复无新增',async()=>{
  const p=await create(),dimensions=scheme();expect(p.status).toBe('DRAFT');expect(p.skus[0]).toMatchObject({available:0,reserved:0,priceCents:null,costCents:null});
  const preview=await queries.preview(p.id,{dimensions});expect(preview.count).toBe(6);expect(await db.sku.count({where:{productId:p.id}})).toBe(1);
  const saved=await commands.scheme(staff,p.id,{expectedVersion:0,mode:'REBUILD',reason:'颜色尺码',dimensions});expect(Object.keys((saved as unknown as {clientKeyMap:object}).clientKeyMap)).toHaveLength(7);
  expect(saved.skus.filter(s=>!s.retiredAt)).toHaveLength(6);expect(saved.skus.filter(s=>s.retiredAt)).toHaveLength(1);expect(saved.skus.every(s=>s.available===0&&s.reserved===0)).toBe(true);
  const dimensions2=saved.specDimensions.map(d=>({id:d.id,name:d.name,values:d.values.map(v=>({name:v.name,id:v.id}))}));
  const again=await commands.scheme(staff,p.id,{expectedVersion:saved.version!,mode:'REBUILD',reason:'相同方案',dimensions:dimensions2});expect(again.changed).toBe(false);expect(again.version).toBe(saved.version);
  expect(await db.inventoryBalance.count({where:{sku:{productId:p.id}}})).toBe(7);
});
it('IT02：容量提前拒绝、跨商品ID拒绝、签名不受选择顺序影响',async()=>{
  const p=await create();await expect(queries.preview(p.id,{dimensions:scheme([Array.from({length:20},(_,i)=>''+i),Array.from({length:20},(_,i)=>''+i)])})).rejects.toMatchObject({code:'SKU_COMBINATION_LIMIT'});
  const other=await create();const s=await commands.scheme(staff,other.id,{expectedVersion:0,mode:'REBUILD',reason:'另一件',dimensions:scheme([['红']])});
  await expect(commands.scheme(staff,p.id,{expectedVersion:0,mode:'REBUILD',reason:'跨商品',dimensions:s.specDimensions})).rejects.toMatchObject({code:'VALIDATION_FAILED'});
  const choices=[{dimensionId:randomUUID(),valueId:randomUUID()},{dimensionId:randomUUID(),valueId:randomUUID()}];expect(signature(choices)).toBe(signature([...choices].reverse()));
});
it('IT02：三维200组合边界实际保存、账户与重复提交稳定',async()=>{
  const p=await create(),dimensions=scheme([Array.from({length:10},(_,i)=>'颜色'+i),Array.from({length:10},(_,i)=>'尺码'+i),['常规','修身']]);
  const saved=await commands.scheme(staff,p.id,{expectedVersion:0,mode:'REBUILD',reason:'容量边界',dimensions});
  expect(saved.skus.filter(s=>!s.retiredAt)).toHaveLength(200);expect(await db.inventoryBalance.count({where:{sku:{productId:p.id},available:0,reserved:0}})).toBe(201);
  const again=await commands.scheme(staff,p.id,{expectedVersion:saved.version!,mode:'REBUILD',reason:'重复边界',dimensions:saved.specDimensions});expect(again.changed).toBe(false);expect(again.version).toBe(saved.version);
});
it('SW05：严格金额与余额/状态白名单、批量归属失败整体不写',async()=>{
  const p=await create();for(const priceCents of [0,-1,1000001,99.9,'9900'])await bad(`/admin/products/${p.id}/skus/${p.skus[0]!.id}`,'PATCH',{expectedVersion:0,priceCents},400,'VALIDATION_FAILED');
  await bad('/admin/products/'+p.id,'PATCH',{expectedVersion:0,available:10,reserved:10,status:'ON_SALE'},400,'VALIDATION_FAILED');
  const other=await create();await expect(commands.prices(staff,p.id,{expectedVersion:0,skuIds:[p.skus[0]!.id,other.skus[0]!.id],priceCents:1})).rejects.toMatchObject({code:'SKU_NOT_FOUND'});
  expect((await db.sku.findUniqueOrThrow({where:{id:p.skus[0]!.id}})).priceCents).toBeNull();
  const filled=await commands.prices(staff,p.id,{expectedVersion:0,skuIds:[p.skus[0]!.id],priceCents:1000000,costCents:0});expect(filled.skus[0]).toMatchObject({priceCents:1000000,costCents:0});
});
it('SW06：本人上传绑定、同商品重排、跨商品和他人暂存拒绝、旧图保留',async()=>{
  let p=await create();const image=await upload(),foreign=await upload(peer);
  await bad('/admin/products/'+p.id+'/images','PUT',{expectedVersion:0,mainImageId:foreign,galleryImageIds:[]},404,'FILE_NOT_FOUND');
  p=await commands.images(staff,p.id,{expectedVersion:0,mainImageId:image,galleryImageIds:[image]});expect((await fetch(base+p.mainImageUrl)).status).toBe(200);
  await bad('/store/products/'+p.id,'GET',undefined,404,'PRODUCT_NOT_FOUND',null);
  const replacement=await upload();p=await commands.images(staff,p.id,{expectedVersion:p.version!,mainImageId:replacement,galleryImageIds:[]});
  expect(await db.fileReference.count({where:{ownerId:p.id,fileAssetId:image}})).toBe(2);expect((await fetch(base+`/api/v1/files/${image}/content`)).status).toBe(200);
  const other=await create();await expect(commands.images(staff,other.id,{expectedVersion:0,mainImageId:image,galleryImageIds:[]})).rejects.toMatchObject({code:'FILE_NOT_BINDABLE'});
  await bad('/admin/products/'+p.id+'/images','PUT',{expectedVersion:p.version,mainImageId:image,galleryImageIds:Array.from({length:11},()=>randomUUID())},400,'VALIDATION_FAILED');
});
it('SW07：逐项上架条件、隔离正例和销售中资料保护',async()=>{
  const p=await create();const failure=await bad('/admin/products/'+p.id+'/publish','POST',{expectedVersion:0,reason:'校验'},409,'PRODUCT_NOT_PUBLISHABLE');expect(failure.details.map((f:{field:string})=>f.field)).toEqual(expect.arrayContaining(['category','mainImage','price','availableStock']));
  let valid=await ready(0);const zero=await bad('/admin/products/'+valid.id+'/publish','POST',{expectedVersion:valid.version,reason:'零库存'},409,'PRODUCT_NOT_PUBLISHABLE');expect(zero.details.find((f:{field:string})=>f.field==='availableStock').message).toContain('库存登记');
  await db.inventoryBalance.update({where:{skuId:valid.skus[0]!.id},data:{available:2}});valid=await commands.status(staff,valid.id,{expectedVersion:valid.version!,reason:'隔离正例'},'publish');
  await bad('/admin/products/'+valid.id+'/images','PUT',{expectedVersion:valid.version,mainImageId:null,galleryImageIds:[]},409,'PRODUCT_MUST_UNPUBLISH');
  await bad('/admin/products/'+valid.id,'PATCH',{expectedVersion:valid.version,categoryId:null},409,'PRODUCT_MUST_UNPUBLISH');
  await bad(`/admin/products/${valid.id}/skus/${valid.skus[0]!.id}`,'PATCH',{expectedVersion:valid.version,priceCents:null},409,'SKU_PRICE_REQUIRED');
  const visible=await ok('/store/products/'+valid.id,'GET',undefined,null);expect(visible.purchasable).toBe(true);expect(JSON.stringify(visible)).not.toMatch(/costCents|reserved|purchaseBlocked|createdById|updatedById/);
  await db.inventoryBalance.update({where:{skuId:valid.skus[0]!.id},data:{available:0}});const edited=await commands.edit(staff,valid.id,{expectedVersion:valid.version!,brand:'售罄仍可维护'});expect(edited.status).toBe('ON_SALE');
});
it('SW08/IT04：后代筛选、null最后、稳定分页、售罄/全部停用公开裁剪',async()=>{
  const root=await category('查询根'),leaf=await category('查询叶',root.id);let a=await ready(),b=await ready();
  a=await commands.edit(staff,a.id,{expectedVersion:a.version!,categoryId:leaf.id,name:'查询唯一A'});b=await commands.edit(staff,b.id,{expectedVersion:b.version!,categoryId:root.id,name:'查询唯一B'});
  a=await commands.status(staff,a.id,{expectedVersion:a.version!,reason:'上架'},'publish');b=await commands.status(staff,b.id,{expectedVersion:b.version!,reason:'上架'},'publish');
  b=await commands.enabled(staff,b.id,b.skus[0]!.id,{expectedVersion:b.version!,enabled:false,reason:'停止新购'});
  const q={page:1,pageSize:1,categoryId:root.id,sort:'PRICE_DESC' as const};const first=await queries.list(q),second=await queries.list({...q,page:2});expect(first.items[0]!.id).toBe(a.id);expect(second.items[0]!.id).toBe(b.id);expect(second.items[0]!.priceFromCents).toBeNull();
  const detail=await queries.detail(b.id);expect(detail.skus).toEqual([]);expect(detail.purchasable).toBe(false);expect(detail.availableQuantity).toBe('0');
  expect((await queries.list({page:1,pageSize:100,keyword:'查询唯一',sort:'SALES_DESC'})).items.map(v=>v.id)).toEqual([a.id,b.id].sort());
});
it('SW09：批量独立结果、归档保留、retired不能启用',async()=>{
  const valid=await ready(),invalid=await create();const result=await ok('/admin/products/batch-status','POST',{action:'PUBLISH',reason:'批量上架',items:[{id:valid.id,expectedVersion:valid.version},{id:invalid.id,expectedVersion:0},{id:randomUUID(),expectedVersion:0}]});
  expect(result.items.map((i:{success:boolean})=>i.success)).toEqual([true,false,false]);const p=await queries.detail(valid.id,staff.actor);
  await commands.status(staff,p.id,{expectedVersion:p.version!,reason:'归档'},'archive');await bad('/store/products/'+p.id,'GET',undefined,404,'PRODUCT_NOT_FOUND',null);
  expect(await db.sku.count({where:{productId:p.id}})).toBe(1);await expect(commands.status(staff,p.id,{expectedVersion:p.version!+1,reason:'重上'},'publish')).rejects.toMatchObject({code:'PRODUCT_ARCHIVED'});
});
it('SW10/IT06：空草稿创建、数量保存/作废不入账，双版本与转换保护',async()=>{
  let p=await create();const tasks=await db.task.count();p=await commands.draftSave(staff,p.id,{expectedProductVersion:0,expectedDraftVersion:null,lines:[]});expect(p.changed).toBe(true);expect(p.version).toBe(1);
  const d=await commands.draft(p.id);p=await commands.draftSave(staff,p.id,{expectedProductVersion:1,expectedDraftVersion:d!.version,lines:[{skuId:p.skus[0]!.id,quantity:999}]});
  expect(p.skus[0]).toMatchObject({available:0,reserved:0});expect(await db.task.count()).toBe(tasks);
  await expect(commands.scheme(staff,p.id,{expectedVersion:p.version!,mode:'REBUILD',reason:'不可重建',dimensions:scheme()})).rejects.toMatchObject({code:'SKU_SCHEME_REFERENCED'});
  await bad('/admin/products/'+p.id+'/initial-inventory-draft','PUT',{expectedProductVersion:p.version,expectedDraftVersion:0,lines:[]},409,'VERSION_CONFLICT');
  p=await commands.draftVoid(staff,p.id,{expectedProductVersion:p.version!,expectedDraftVersion:1,reason:'不用该草稿'});expect((await commands.draft(p.id))!.status).toBe('VOID');expect(p.skus[0]!.available).toBe(0);
  await db.initialInventoryDraft.update({where:{id:d!.id},data:{status:'CONVERTED'}});
  await expect(commands.draftSave(staff,p.id,{expectedProductVersion:p.version!,expectedDraftVersion:null,lines:[]})).rejects.toMatchObject({code:'INITIAL_DRAFT_NOT_EDITABLE'});
});
it('SW11/IT05：客服403、只读裁剪、同版本并发仅一次提交、停用旧token拒绝',async()=>{
  await bad('/admin/products','GET',undefined,403,'FORBIDDEN',service);await bad('/admin/categories/tree','GET',undefined,403,'FORBIDDEN',service);
  const reader=await actor('CUSTOMER_SERVICE');await db.employeeExtraPermission.createMany({data:['category.read','product.read'].map(permissionCode=>({employeeId:reader.actor.subjectId,permissionCode,grantedById:staff.actor.subjectId}))});
  let p=await create();await queries.detail(p.id,await app.get(CurrentIdentityService).authenticate(db,reader.token,'EMPLOYEE'));const read=await ok('/admin/products/'+p.id,'GET',undefined,reader);expect(JSON.stringify(read)).not.toMatch(/costCents|reserved|purchaseBlocked|warningThreshold/);
  const results=await Promise.allSettled([commands.edit(staff,p.id,{expectedVersion:0,name:'并发甲'}),commands.edit(peer,p.id,{expectedVersion:0,name:'并发乙'})]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);const rejected=results.find(r=>r.status==='rejected');expect(rejected,JSON.stringify(rejected)).toMatchObject({reason:{code:'VERSION_CONFLICT'}});
  const disabled=await actor();await db.employee.update({where:{id:disabled.actor.subjectId},data:{status:'DISABLED'}});p={...await queries.detail(p.id,staff.actor),changed:false};
  await bad('/admin/products/'+p.id,'PATCH',{expectedVersion:p.version,name:'不允许'},401,'ACCOUNT_UNAVAILABLE',disabled);
});
it('IT02：业务引用检查器接入后阻止改方案/清价，未注册已安装领域明确失败',async()=>{
  const p=await create();const refs=new SkuReferences();await expect(refs.referenced(db as unknown as Prisma.TransactionClient,[p.skus[0]!.id])).rejects.toMatchObject({code:'SKU_REFERENCE_NOT_READY'});refs.register({domain:'inventory',async referenced(){return false;}});refs.register({domain:'order',async referenced(){return true;}});expect(await refs.referenced(db as unknown as Prisma.TransactionClient,[p.skus[0]!.id])).toBe(true);
  // 订单领域现已真实安装：独立检查器遗漏订单适配器必须失败，应用注册器可查询真实订单引用。
  const missingOrder=new SkuReferences();missingOrder.register({domain:'inventory',async referenced(){return false;}});
  await expect(missingOrder.referenced(db as unknown as Prisma.TransactionClient,[p.skus[0]!.id])).rejects.toMatchObject({code:'SKU_REFERENCE_NOT_READY'});
  expect(await app.get(SkuReferences).referenced(db as unknown as Prisma.TransactionClient,[p.skus[0]!.id])).toBe(false);
  const d=await db.initialInventoryDraft.create({data:{productId:p.id,createdById:staff.actor.subjectId,status:'CONVERTED',lines:{create:{skuId:p.skus[0]!.id,quantity:1}}}});expect(d.status).toBe('CONVERTED');
  await expect(commands.prices(staff,p.id,{expectedVersion:0,skuIds:[p.skus[0]!.id],priceCents:null})).rejects.toMatchObject({code:'SKU_PRICE_REQUIRED'});
});
it('IT03：创建、方案、分类子树、图片和上架审计失败全部回滚',async()=>{
  const count=await db.product.count();audit.fail=true;try{await expect(create('失败创建')).rejects.toThrow('审计故障');}finally{audit.fail=false;}expect(await db.product.count()).toBe(count);
  const p=await ready(),image=await upload();const root=await category('回滚根'),child=await category('回滚子',root.id);const audits=await db.auditLog.count(),histories=await db.businessStateHistory.count();
  const actions=[()=>commands.scheme(staff,p.id,{expectedVersion:p.version!,mode:'REBUILD',reason:'失败方案',dimensions:scheme()}),()=>commands.images(staff,p.id,{expectedVersion:p.version!,mainImageId:image,galleryImageIds:[]}),()=>commands.status(staff,p.id,{expectedVersion:p.version!,reason:'失败上架'},'publish'),()=>categories.write(staff.actor,staff.token,randomUUID(),child.id,{expectedVersion:0,parentId:null,reason:'失败移动'},'move')];
  // 方案要求零余额，先在独占夹具中设0，方案失败后再恢复上架夹具。
  await db.inventoryBalance.update({where:{skuId:p.skus[0]!.id},data:{available:0}});
  for(const [i,action]of actions.entries()){if(i===2)await db.inventoryBalance.update({where:{skuId:p.skus[0]!.id},data:{available:2}});audit.fail=true;try{await expect(action()).rejects.toThrow('审计故障');}finally{audit.fail=false;}}
  expect((await db.product.findUniqueOrThrow({where:{id:p.id}})).version).toBe(p.version);expect(await db.sku.count({where:{productId:p.id}})).toBe(1);
  expect(await db.fileReference.count({where:{fileAssetId:image}})).toBe(0);expect((await db.category.findUniqueOrThrow({where:{id:child.id}})).parentId).toBe(root.id);expect(await db.auditLog.count()).toBe(audits);expect(await db.businessStateHistory.count()).toBe(histories);
});
it('IT04：数据库CHECK和跨商品组合/数量外键拒绝不合法直接写入',async()=>{
  const c=await category('路径约束');
  await expect(db.$executeRaw`UPDATE category SET path_ids=NULL WHERE id=${c.id}::uuid`).rejects.toThrow();
  await expect(db.category.update({where:{id:c.id},data:{depth:2,parentId:c.id,pathIds:[c.id,c.id]}})).rejects.toThrow();
  await expect(db.category.update({where:{id:c.id},data:{pathIds:[randomUUID()]}})).rejects.toThrow();
  const p=await create(),other=await create();await expect(db.sku.update({where:{id:p.skus[0]!.id},data:{priceCents:0}})).rejects.toThrow();await expect(db.inventoryBalance.update({where:{skuId:p.skus[0]!.id},data:{available:-1}})).rejects.toThrow();
  const draft=await db.initialInventoryDraft.create({data:{productId:p.id,createdById:staff.actor.subjectId}});await expect(db.initialInventoryDraftLine.create({data:{draftId:draft.id,skuId:other.skus[0]!.id,quantity:1}})).rejects.toThrow();
  const s=await commands.scheme(staff,other.id,{expectedVersion:0,mode:'REBUILD',reason:'外键',dimensions:scheme([['蓝']])});const dimension=s.specDimensions[0]!;
  await expect(db.skuSpecChoice.create({data:{skuId:p.skus[0]!.id,dimensionId:dimension.id,valueId:dimension.values[0]!.id}})).rejects.toThrow();
});
it('IT02：有引用时追加保留旧身份/价格，改已有显示含义拒绝；编码全局并发唯一',async()=>{
  let p=await create();p=await commands.scheme(staff,p.id,{expectedVersion:0,mode:'REBUILD',reason:'原方案',dimensions:scheme([['黑']])});
  const old=p.skus.find(s=>!s.retiredAt)!;p=await commands.prices(staff,p.id,{expectedVersion:p.version!,skuIds:[old.id],priceCents:5000});
  await db.initialInventoryDraft.create({data:{productId:p.id,createdById:staff.actor.subjectId,status:'CONVERTED',lines:{create:{skuId:old.id,quantity:1}}}});
  const d=p.specDimensions[0]!;const appended=await commands.scheme(staff,p.id,{expectedVersion:p.version!,mode:'APPEND',reason:'追加白',dimensions:[{...d,values:[...d.values,{clientKey:randomUUID(),name:'白'}]}]});
  expect(appended.skus.find(s=>s.id===old.id)).toMatchObject({priceCents:5000,retiredAt:null});expect(appended.skus.filter(s=>!s.retiredAt)).toHaveLength(2);
  await expect(commands.scheme(staff,p.id,{expectedVersion:appended.version!,mode:'APPEND',reason:'改含义',dimensions:appended.specDimensions.map(d=>({...d,values:d.values.map(v=>({...v,name:'改名'+v.name}))}))})).rejects.toMatchObject({code:'SKU_SCHEME_REFERENCED'});
  const a=await create(),b=await create(),code='UNIQUE_'+randomUUID().replaceAll('-','').toUpperCase();const result=await Promise.allSettled([commands.sku(staff,a.id,a.skus[0]!.id,{expectedVersion:0,code}),commands.sku(peer,b.id,b.skus[0]!.id,{expectedVersion:0,code})]);expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(result.find(r=>r.status==='rejected')).toMatchObject({reason:{code:'SKU_CODE_EXISTS'}});
});
it('IT01：删除与新增关联并发，不能留下指向已删除分类的商品',async()=>{
  const c=await category('删除关联竞争');const results=await Promise.allSettled([categories.write(staff.actor,staff.token,randomUUID(),c.id,{expectedVersion:0,reason:'删除'},'delete'),commands.create(peer,{name:'关联竞争款',categoryId:c.id})]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);const row=await db.category.findUniqueOrThrow({where:{id:c.id}});expect(row.deletedAt?await db.product.count({where:{categoryId:c.id}}):1).toBe(row.deletedAt?0:1);
});
it('IT05：撤权先提交则拒绝，命令先锁员工则撤权等待并保留合法审计',async()=>{
  const manager=await actor('CUSTOMER_SERVICE');const codes=['category.read','product.read','product.cost.read','product.manage'];await db.employeeExtraPermission.createMany({data:codes.map(permissionCode=>({employeeId:manager.actor.subjectId,permissionCode,grantedById:staff.actor.subjectId}))});
  manager.actor=await app.get(CurrentIdentityService).authenticate(db,manager.token,'EMPLOYEE');const p=await create();
  await db.employeeExtraPermission.delete({where:{employeeId_permissionCode:{employeeId:manager.actor.subjectId,permissionCode:'product.manage'}}});
  await expect(commands.edit(manager,p.id,{expectedVersion:0,name:'撤权后'})).rejects.toMatchObject({code:'FORBIDDEN'});
  await db.employeeExtraPermission.create({data:{employeeId:manager.actor.subjectId,permissionCode:'product.manage',grantedById:staff.actor.subjectId}});
  let release!:()=>void,signal!:(pid:number)=>void;const held=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<number>(resolve=>{signal=resolve;});
  audit.checkpoint=async(tx,payload)=>{if(payload.targetId!==p.id)return;const [row]=await tx.$queryRaw<{pid:number}[]>`SELECT pg_backend_pid() AS pid`;signal(row!.pid);await held;};
  const write=commands.edit(manager,p.id,{expectedVersion:0,name:'锁内合法提交'});const pid=await ready;
  const revoke=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM employee WHERE id=${manager.actor.subjectId}::uuid FOR UPDATE`;await tx.employeeExtraPermission.delete({where:{employeeId_permissionCode:{employeeId:manager.actor.subjectId,permissionCode:'product.manage'}}});});
  try{let blocked=false;const until=performance.now()+1500;while(performance.now()<until&&!blocked){const [r]=await db.$queryRaw<{blocked:boolean}[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${pid}=ANY(pg_blocking_pids(pid))) AS blocked`;blocked=r!.blocked;}expect(blocked).toBe(true);}finally{release();audit.checkpoint=undefined;}
  await write;await revoke;expect((await db.product.findUniqueOrThrow({where:{id:p.id}})).name).toBe('锁内合法提交');expect(await db.auditLog.count({where:{targetId:p.id,actorEmployeeId:manager.actor.subjectId}})).toBe(1);
  await expect(commands.edit(manager,p.id,{expectedVersion:1,name:'撤权后再改'})).rejects.toMatchObject({code:'FORBIDDEN'});
});
