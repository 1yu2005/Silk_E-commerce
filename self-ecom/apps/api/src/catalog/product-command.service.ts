// 作用：商品资料、规格、图片和销售命令共享商品锁、版本和事务审计，不提供余额更新入口。
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Product } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { runAuthTransaction } from '../auth/auth-transaction.js';
import type { CurrentIdentity } from '../auth/current-identity.service.js';
import { FileBindingService } from '../files/file-binding.service.js';
import { StateHistoryService } from '../records/state-history.service.js';
import { CatalogAccess } from './catalog-access.service.js';
import { CatalogQueries } from './catalog-query.service.js';
import { CatalogError } from './catalog.errors.js';
import { combinations, nameKey, signature, validateScheme } from './catalog.rules.js';
import { SkuReferences } from './sku-reference.service.js';
import type { BatchStatusDto, DraftSaveDto, DraftVoidDto, ProductCreateDto, ProductEditDto, ProductImagesDto, SchemeSaveDto, SkuBatchDto, SkuEditDto, SkuEnabledDto, ReasonDto } from './catalog.dto.js';
export interface CatalogContext { actor:CurrentIdentity;token:string;requestId:string }
interface Change {id:string;field:string;before:string|number|boolean|null;after:string|number|boolean|null}
function changes(id:string,before:Record<string,unknown>,after:Record<string,unknown>):Change[]{
  const scalar=(v:unknown):Change['before']=>v===undefined||v===null?null:typeof v==='string'||typeof v==='number'||typeof v==='boolean'?v:JSON.stringify(v);
  return Object.keys(after).filter(k=>JSON.stringify(before[k])!==JSON.stringify(after[k])).map(k=>({id,field:k,before:scalar(before[k]),after:scalar(after[k])}));
}
@Injectable()
export class ProductCommands {
  constructor(@Inject(PrismaService) private readonly db:PrismaService,@Inject(CatalogAccess) private readonly access:CatalogAccess,
    @Inject(AuditService) private readonly audit:AuditService,@Inject(CatalogQueries) private readonly queries:CatalogQueries,
    @Inject(FileBindingService) private readonly files:FileBindingService,@Inject(StateHistoryService) private readonly history:StateHistoryService,
    @Inject(SkuReferences) private readonly references:SkuReferences){}
  private async validCategory(tx:Prisma.TransactionClient,id:string|null|undefined){if(id&&!await tx.category.count({where:{id,deletedAt:null}}))throw new CatalogError('CATEGORY_NOT_FOUND');}
  private async guarded<T>(work:()=>Promise<T>,code:'SKU_CODE_EXISTS'|'SKU_COMBINATION_EXISTS'='SKU_COMBINATION_EXISTS',retries=0):Promise<T>{
    try{return await work();}catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002'){
      // 驱动适配器的meta形状并不统一；由命令的已知唯一写入映射错误，自动编码冲突只在新事务有限重试。
      if(retries>0)return this.guarded(work,code,retries-1);throw new CatalogError(code);
    }throw e;}
  }
  async create(ctx:CatalogContext,input:ProductCreateDto){return this.guarded(()=>runAuthTransaction(this.db,async tx=>{
    const actor=await this.access.actor(tx,ctx.actor,ctx.token,['product.manage']);await this.access.tree(tx);await this.validCategory(tx,input.categoryId);
    const p=await tx.product.create({data:{...input,productCode:'P-'+randomUUID().replaceAll('-','').toUpperCase(),createdById:actor.subjectId,updatedById:actor.subjectId}});
    await tx.sku.create({data:{productId:p.id,code:'S-'+randomUUID().replaceAll('-','').toUpperCase(),combinationSignature:'DEFAULT',balance:{create:{}}}});
    await this.audit.appendAudit(tx,{actor:{type:'EMPLOYEE',id:actor.subjectId},action:'product.change',targetId:p.id,requestId:ctx.requestId,after:{catalogVersion:0,catalogAction:'create',affectedCount:1,catalogChanges:changes(p.id,{},input as unknown as Record<string,unknown>)}});
    return {...await this.queries.detailTx(tx,p.id,actor),changed:true};
  }),'SKU_CODE_EXISTS',2);}
  private async command(ctx:CatalogContext,id:string,version:number,action:string,permissions:string[],tree:boolean,
    reason:string|undefined,work:(tx:Prisma.TransactionClient,p:Product,actor:Extract<CurrentIdentity,{subjectType:'EMPLOYEE'}>)=>Promise<{changes:Change[];extra?:Record<string,unknown>;skuTransition?:{id:string;from:boolean;to:boolean}}>){
    return this.guarded(()=>runAuthTransaction(this.db,async tx=>{
      const actor=await this.access.actor(tx,ctx.actor,ctx.token,permissions);if(tree)await this.access.tree(tx);const p=await this.access.product(tx,id,version);
      if(p.archivedAt&&action!=='profile')throw new CatalogError('PRODUCT_ARCHIVED');
      const result=await work(tx,p,actor);if(!result.changes.length)return {...await this.queries.detailTx(tx,id,actor),changed:false,...result.extra};
      const updated=await tx.product.update({where:{id},data:{version:{increment:1},updatedById:actor.subjectId}});
      // 已上架商品可自然缺货，但编辑不能清除主图、分类或启用款式的有效售价。
      if(updated.status==='ON_SALE')await this.publishable(tx,updated,false);
      if(['publish','unpublish','archive','sku.enabled'].includes(action))await this.history.appendStateHistory(tx,{type:'EMPLOYEE',id:actor.subjectId},{aggregateType:'PRODUCT',aggregateId:id,dimension:result.skuTransition?'sku:'+result.skuTransition.id:'sales',commandKey:action+':'+id+':'+updated.version,fromState:result.skuTransition?(result.skuTransition.from?'ENABLED':'DISABLED'):p.status,toState:result.skuTransition?(result.skuTransition.to?'ENABLED':'DISABLED'):updated.status,requestId:ctx.requestId,reason});
      await this.audit.appendAudit(tx,{actor:{type:'EMPLOYEE',id:actor.subjectId},action:'product.change',targetId:id,requestId:ctx.requestId,reason,before:{catalogVersion:p.version},after:{catalogVersion:updated.version,catalogAction:action,affectedCount:result.changes.length,catalogChanges:result.changes}});
      return {...await this.queries.detailTx(tx,id,actor),changed:true,...result.extra};
    }),action==='sku.prices'?'SKU_CODE_EXISTS':'SKU_COMBINATION_EXISTS',action==='sku.scheme'?2:0);
  }
  private async publishable(tx:Prisma.TransactionClient,p:Product,stock:boolean){
    const missing:string[]=[];if(!p.categoryId||!await tx.category.count({where:{id:p.categoryId,deletedAt:null}}))missing.push('category');
    if(!await tx.productImage.count({where:{productId:p.id,slot:'MAIN'}}))missing.push('mainImage');
    const skus=await tx.sku.findMany({where:{productId:p.id,enabled:true,retiredAt:null},include:{balance:true}});
    if(skus.some(s=>s.priceCents===null))missing.push('price');
    if(stock&&!skus.some(s=>s.priceCents!==null&&s.balance!.available>0&&!s.balance!.purchaseBlocked))missing.push('availableStock');
    if(missing.length)throw new CatalogError(stock?'PRODUCT_NOT_PUBLISHABLE':'PRODUCT_MUST_UNPUBLISH',{fields:missing,...(missing.includes('availableStock')?{hint:'可售库存不足，请完成库存登记确认'}:{})});
  }
  edit(ctx:CatalogContext,id:string,input:ProductEditDto){return this.command(ctx,id,input.expectedVersion,'profile',['product.manage'],true,undefined,async(tx,p)=>{
    const data={...(input.name!==undefined?{name:input.name}:{}),...(input.brand!==undefined?{brand:input.brand}:{}),...(input.description!==undefined?{description:input.description}:{}),...(input.categoryId!==undefined?{categoryId:input.categoryId}:{})};await this.validCategory(tx,data.categoryId);const diff=changes(id,p as unknown as Record<string,unknown>,data);
    if(diff.length)await tx.product.update({where:{id},data});return {changes:diff};
  });}
  status(ctx:CatalogContext,id:string,input:ReasonDto,action:'publish'|'unpublish'|'archive'){
    return this.command(ctx,id,input.expectedVersion,action,action==='archive'?['product.publish','product.manage']:['product.publish'],action==='publish',input.reason,async(tx,p)=>{
      if((action==='publish'&&p.status==='ON_SALE')||(action==='unpublish'&&p.status==='OFF_SALE'))return {changes:[]};
      if(action==='publish')await this.publishable(tx,p,true);
      const patch=action==='archive'?{status:'OFF_SALE' as const,archivedAt:new Date()}: {status:action==='publish'?'ON_SALE' as const:'OFF_SALE' as const};
      const diff=changes(id,{status:p.status,archivedAt:p.archivedAt},patch);if(diff.length)await tx.product.update({where:{id},data:patch});return {changes:diff};
    });
  }
  async batch(ctx:CatalogContext,input:BatchStatusDto){
    if(new Set(input.items.map(i=>i.id)).size!==input.items.length)throw new CatalogError('VALIDATION_FAILED');
    // 先确认全局授权，逐项事务中仍重新检查。中途撤权必须整体返回401/403，不伪装逐项失败。
    await runAuthTransaction(this.db,tx=>this.access.actor(tx,ctx.actor,ctx.token,['product.publish']));
    const items=[];for(const item of input.items){try{const result=await this.status(ctx,item.id,{expectedVersion:item.expectedVersion,reason:input.reason},input.action==='PUBLISH'?'publish':'unpublish');items.push({id:item.id,success:true,version:result.version});}
      catch(e){if(!(e instanceof CatalogError))throw e;items.push({id:item.id,success:false,code:e.code,message:e.message});}}
    return {items};
  }
  images(ctx:CatalogContext,id:string,input:ProductImagesDto){return this.command(ctx,id,input.expectedVersion,'images',['product.manage'],false,undefined,async(tx,p)=>{
    const previous=await tx.productImage.findMany({where:{productId:id},orderBy:[{slot:'asc'},{sortOrder:'asc'}]});
    const next=[...(input.mainImageId?[{assetId:input.mainImageId,slot:'MAIN',sortOrder:0}]:[]),...input.galleryImageIds.map((assetId,sortOrder)=>({assetId,slot:'GALLERY',sortOrder}))];
    const old=previous.map(({assetId,slot,sortOrder})=>({assetId,slot,sortOrder}));
    if(JSON.stringify(old)===JSON.stringify([...next].sort((a,b)=>a.slot.localeCompare(b.slot)||a.sortOrder-b.sortOrder)))return {changes:[]};
    const ids=[...new Set(next.map(i=>i.assetId))].sort();
    if(ids.length)await tx.$queryRaw(Prisma.sql`SELECT id FROM file_asset WHERE id IN (${Prisma.join(ids.map(v=>Prisma.sql`${v}::uuid`))}) ORDER BY id FOR UPDATE`);
    const access={identity:ctx.actor,token:ctx.token};
    if(input.mainImageId)await this.files.bindFiles(tx,access,{ownerType:'PRODUCT',ownerId:id,slot:'main',audience:'PUBLIC',fileIds:[input.mainImageId],commandKey:'images:'+id+':'+(p.version+1)});
    if(input.galleryImageIds.length)await this.files.bindFiles(tx,access,{ownerType:'PRODUCT',ownerId:id,slot:'gallery',audience:'PUBLIC',fileIds:input.galleryImageIds,commandKey:'images:'+id+':'+(p.version+1)});
    await tx.productImage.deleteMany({where:{productId:id}});if(next.length)await tx.productImage.createMany({data:next.map(i=>({...i,productId:id}))});
    return {changes:changes(id,{images:old},{images:next})};
  });}
  sku(ctx:CatalogContext,id:string,skuId:string,input:SkuEditDto){return this.prices(ctx,id,{skuIds:[skuId],expectedVersion:input.expectedVersion,priceCents:input.priceCents,costCents:input.costCents},input.code);}
  prices(ctx:CatalogContext,id:string,input:SkuBatchDto,code?:string){return this.command(ctx,id,input.expectedVersion,'sku.prices',['product.manage'],false,undefined,async(tx,p)=>{
    if(code!==undefined&&!/^[A-Z0-9_-]{1,64}$/.test(code))throw new CatalogError('VALIDATION_FAILED');
    await tx.$queryRaw(Prisma.sql`SELECT id FROM sku WHERE product_id=${id}::uuid AND id IN (${Prisma.join([...input.skuIds].sort().map(v=>Prisma.sql`${v}::uuid`))}) ORDER BY id FOR UPDATE`);
    const rows=await tx.sku.findMany({where:{productId:id,id:{in:input.skuIds},retiredAt:null}});if(rows.length!==input.skuIds.length)throw new CatalogError('SKU_NOT_FOUND');
    if(input.priceCents===null&&(p.status!=='DRAFT'||await this.references.referenced(tx,input.skuIds)))throw new CatalogError('SKU_PRICE_REQUIRED');
    const patch={...(input.priceCents!==undefined?{priceCents:input.priceCents}:{}),...(input.costCents!==undefined?{costCents:input.costCents}:{}),...(code?{code}:{})};
    const diff:Change[]=[];for(const row of rows){diff.push(...changes(row.id,row as unknown as Record<string,unknown>,patch));await tx.sku.update({where:{id:row.id},data:patch});}return {changes:diff};
  });}
  enabled(ctx:CatalogContext,id:string,skuId:string,input:SkuEnabledDto){return this.command(ctx,id,input.expectedVersion,'sku.enabled',['product.publish'],false,input.reason,async(tx,p)=>{
    const row=await tx.sku.findFirst({where:{id:skuId,productId:id}});if(!row)throw new CatalogError('SKU_NOT_FOUND');
    if(row.retiredAt)throw new CatalogError('SKU_SCHEME_REFERENCED');if(input.enabled&&p.status==='ON_SALE'&&row.priceCents===null)throw new CatalogError('SKU_PRICE_REQUIRED');
    if(row.enabled===input.enabled)return {changes:[]};await tx.sku.update({where:{id:skuId},data:{enabled:input.enabled}});return {changes:changes(skuId,{enabled:row.enabled},{enabled:input.enabled}),skuTransition:{id:skuId,from:row.enabled,to:input.enabled}};
  });}
  scheme(ctx:CatalogContext,id:string,input:SchemeSaveDto){validateScheme(input.dimensions);return this.command(ctx,id,input.expectedVersion,'sku.scheme',['product.manage'],false,input.reason,async(tx)=>{
    const current=await tx.productSpecDimension.findMany({where:{productId:id,retiredAt:null},include:{values:{where:{retiredAt:null},orderBy:{sortOrder:'asc'}}},orderBy:{sortOrder:'asc'}});
    const same=JSON.stringify(current.map(d=>({id:d.id,name:d.name,values:d.values.map(v=>({id:v.id,name:v.name}))})))===JSON.stringify(input.dimensions.map(d=>({id:d.id,name:d.name,values:d.values.map(v=>({id:v.id,name:v.name}))})));
    if(same)return {changes:[],extra:{clientKeyMap:{}}};
    const oldSkus=await tx.sku.findMany({where:{productId:id},include:{balance:true}});
    if(input.mode==='APPEND'){
      if(input.dimensions.length!==current.length||current.some((d,i)=>input.dimensions[i]?.id!==d.id||input.dimensions[i]?.name!==d.name||d.values.some(v=>!input.dimensions[i]!.values.some(x=>x.id===v.id&&x.name===v.name))))throw new CatalogError('SKU_SCHEME_REFERENCED');
    }else if(oldSkus.some(s=>s.balance!.available!==0||s.balance!.reserved!==0)||await this.references.referenced(tx,oldSkus.map(s=>s.id))||await tx.initialInventoryDraftLine.count({where:{draft:{productId:id,status:'EDITABLE'},quantity:{gt:0}}}))throw new CatalogError('SKU_SCHEME_REFERENCED');
    const all=await tx.productSpecDimension.findMany({where:{productId:id},include:{values:true}});const map:Record<string,string>={};const resolved: {id:string;name:string;values:{id:string;name:string}[]}[]=[];
    for(const d of input.dimensions){const old=d.id?all.find(x=>x.id===d.id):all.find(x=>x.nameKey===nameKey(d.name));if(d.id&&!old)throw new CatalogError('VALIDATION_FAILED');
      if(old&&input.mode==='APPEND'&&(old.retiredAt||old.name!==d.name))throw new CatalogError('SKU_SCHEME_REFERENCED');
      const dimensionId=old?.id??randomUUID();if(d.clientKey)map[d.clientKey]=dimensionId;const values=[];
      for(const v of d.values){const previous=v.id?old?.values.find(x=>x.id===v.id):old?.values.find(x=>x.nameKey===nameKey(v.name));if(v.id&&!previous)throw new CatalogError('VALIDATION_FAILED');
        if(previous&&input.mode==='APPEND'&&(previous.retiredAt||previous.name!==v.name))throw new CatalogError('SKU_SCHEME_REFERENCED');const valueId=previous?.id??randomUUID();if(v.clientKey)map[v.clientKey]=valueId;values.push({id:valueId,name:v.name});}
      resolved.push({id:dimensionId,name:d.name,values});
    }
    const diff=changes(id,{dimensions:current.map(d=>({id:d.id,name:d.name,values:d.values.map(v=>({id:v.id,name:v.name}))}))},{dimensions:resolved});
    if(!diff.length)return {changes:[],extra:{clientKeyMap:map}};
    // 先退休整个旧方案再恢复保留身份，避免当前名称/位置部分唯一索引的交换冲突。
    const now=new Date();await tx.productSpecValue.updateMany({where:{dimension:{productId:id}},data:{retiredAt:now}});await tx.productSpecDimension.updateMany({where:{productId:id},data:{retiredAt:now}});
    for(const [i,d]of resolved.entries()){await tx.productSpecDimension.upsert({where:{id:d.id},create:{id:d.id,productId:id,name:d.name,nameKey:nameKey(d.name),sortOrder:i},update:{name:d.name,nameKey:nameKey(d.name),sortOrder:i,retiredAt:null}});
      for(const [j,v]of d.values.entries())await tx.productSpecValue.upsert({where:{id:v.id},create:{id:v.id,dimensionId:d.id,name:v.name,nameKey:nameKey(v.name),sortOrder:j},update:{name:v.name,nameKey:nameKey(v.name),sortOrder:j,retiredAt:null}});}
    const combos=combinations(resolved);const signatures=combos.map(signature);
    await tx.sku.updateMany({where:{productId:id,combinationSignature:{notIn:signatures}},data:{enabled:false,retiredAt:now}});
    for(const choice of combos){const sig=signature(choice);const old=oldSkus.find(s=>s.combinationSignature===sig);
      if(old){await tx.sku.update({where:{id:old.id},data:{retiredAt:null,enabled:old.retiredAt?true:old.enabled}});}
      else{const sku=await tx.sku.create({data:{productId:id,code:'S-'+randomUUID().replaceAll('-','').toUpperCase(),combinationSignature:sig,balance:{create:{}}}});if(choice.length)await tx.skuSpecChoice.createMany({data:choice.map(c=>({...c,skuId:sku.id}))});}}
    return {changes:diff,extra:{clientKeyMap:map}};
  });}
  async draft(id:string){if(!await this.db.product.count({where:{id}}))throw new CatalogError('PRODUCT_NOT_FOUND');return this.db.initialInventoryDraft.findFirst({where:{productId:id},orderBy:{createdAt:'desc'},include:{lines:{select:{skuId:true,quantity:true}}}});}
  draftSave(ctx:CatalogContext,id:string,input:DraftSaveDto){return this.command(ctx,id,input.expectedProductVersion,'initial-draft.save',['product.manage'],false,undefined,async tx=>{
    if(new Set(input.lines.map(l=>l.skuId)).size!==input.lines.length)throw new CatalogError('VALIDATION_FAILED');
    const previous=await tx.initialInventoryDraft.findFirst({where:{productId:id,status:'EDITABLE'},include:{lines:true}});
    if(!previous&&await tx.initialInventoryDraft.count({where:{productId:id,status:'CONVERTED'}}))throw new CatalogError('INITIAL_DRAFT_NOT_EDITABLE');
    if((previous?.version??null)!==input.expectedDraftVersion)throw new CatalogError('VERSION_CONFLICT');
    if(await tx.sku.count({where:{productId:id,id:{in:input.lines.map(l=>l.skuId)},retiredAt:null}})!==input.lines.length)throw new CatalogError('SKU_NOT_FOUND');
    const sort=(lines:{skuId:string;quantity:number}[])=>lines.map(({skuId,quantity})=>({skuId,quantity})).sort((a,b)=>a.skuId.localeCompare(b.skuId));
    if(previous&&JSON.stringify(sort(previous.lines))===JSON.stringify(sort(input.lines)))return {changes:[]};
    const draft=previous?await tx.initialInventoryDraft.update({where:{id:previous.id},data:{version:{increment:1}}}):await tx.initialInventoryDraft.create({data:{productId:id,createdById:ctx.actor.subjectId}});
    await tx.initialInventoryDraftLine.deleteMany({where:{draftId:draft.id}});if(input.lines.length)await tx.initialInventoryDraftLine.createMany({data:input.lines.map(l=>({...l,draftId:draft.id}))});
    return {changes:[...(!previous?changes(draft.id,{status:null},{status:'EDITABLE'}):[]),...changes(draft.id,{quantity:sort(previous?.lines??[])},{quantity:sort(input.lines)})],extra:{draft:{...draft,lines:input.lines}}};
  });}
  draftVoid(ctx:CatalogContext,id:string,input:DraftVoidDto){return this.command(ctx,id,input.expectedProductVersion,'initial-draft.void',['product.manage'],false,input.reason,async tx=>{
    const previous=await tx.initialInventoryDraft.findFirst({where:{productId:id,status:'EDITABLE'}});if(!previous)throw new CatalogError('INITIAL_DRAFT_NOT_EDITABLE');if(previous.version!==input.expectedDraftVersion)throw new CatalogError('VERSION_CONFLICT');
    await tx.initialInventoryDraft.update({where:{id:previous.id},data:{status:'VOID',version:{increment:1}}});return {changes:changes(previous.id,{status:'EDITABLE'},{status:'VOID'})};
  });}
}
