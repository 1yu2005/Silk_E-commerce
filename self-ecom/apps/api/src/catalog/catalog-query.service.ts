// 作用：公开查询显式选列，成本及占用只在授权后台投影；聚合排序在数据库中完成。
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CurrentIdentity } from '../auth/current-identity.service.js';
import { CatalogError } from './catalog.errors.js';
import type { AdminProductsQueryDto, StoreProductsQueryDto, SchemePreviewDto } from './catalog.dto.js';
import { combinations, signature, validateScheme } from './catalog.rules.js';
import { categoryTree } from './category.service.js';
const imageUrl=(id:string)=>`/api/v1/files/${id}/content`;
const visibleWhere={status:'ON_SALE' as const,archivedAt:null};
@Injectable()
export class CatalogQueries {
  constructor(@Inject(PrismaService) private readonly db:PrismaService){}
  async preview(id:string,input:SchemePreviewDto){
    validateScheme(input.dimensions);
    return this.db.$transaction(async tx=>{
      if(!await tx.product.count({where:{id}}))throw new CatalogError('PRODUCT_NOT_FOUND');
      const stored=await tx.productSpecDimension.findMany({where:{productId:id},include:{values:true}});
      for(const d of input.dimensions){const previous=stored.find(v=>v.id===d.id);if(d.id&&!previous)throw new CatalogError('VALIDATION_FAILED');
        for(const v of d.values)if(v.id&&!previous?.values.some(x=>x.id===v.id))throw new CatalogError('VALIDATION_FAILED');}
      const rows=combinations(input.dimensions.map(d=>({id:d.id??d.clientKey!,values:d.values.map(v=>({id:v.id??v.clientKey!}))})));
      const skus=await tx.sku.findMany({where:{productId:id},select:{id:true,combinationSignature:true}});
      return {count:rows.length,maximum:200,combinations:rows.map(choices=>({choices,reusableSkuId:skus.find(s=>s.combinationSignature===signature(choices))?.id??null}))};
    },{isolationLevel:'RepeatableRead'});
  }
  async categories(){return this.db.$transaction(async tx=>{
    const rows=await tx.category.findMany({where:{deletedAt:null},orderBy:[{sortOrder:'asc'},{nameKey:'asc'},{id:'asc'}]});
    const products=await tx.product.findMany({where:visibleWhere,select:{categoryId:true}});
    const needed=new Set<string>();for(const p of products){const category=rows.find(r=>r.id===p.categoryId);for(const id of category?.pathIds??[])needed.add(id);}
    return categoryTree(rows.filter(r=>needed.has(r.id)),true);
  },{isolationLevel:'RepeatableRead'});}
  async list(q:StoreProductsQueryDto|AdminProductsQueryDto,actor?:CurrentIdentity){
    const admin=!!actor;const aq=q as AdminProductsQueryDto;
    if(aq.minPriceCents!==undefined&&aq.maxPriceCents!==undefined&&aq.minPriceCents>aq.maxPriceCents)throw new CatalogError('VALIDATION_FAILED');
    const conditions=[admin?Prisma.sql`p.archived_at ${aq.archived?Prisma.sql`IS NOT NULL`:Prisma.sql`IS NULL`}`:Prisma.sql`p.status='ON_SALE' AND p.archived_at IS NULL`];
    if(admin&&aq.status)conditions.push(Prisma.sql`p.status::text=${aq.status}`);
    if(q.keyword)conditions.push(Prisma.sql`p.name ILIKE ${'%'+q.keyword.replace(/[\\%_]/g,'\\$&')+'%'}`);
    if(q.categoryId)conditions.push(Prisma.sql`EXISTS(SELECT 1 FROM category c WHERE c.id=p.category_id AND c.deleted_at IS NULL AND ${q.categoryId}::uuid=ANY(c.path_ids))`);
    if(admin&&aq.minPriceCents!==undefined)conditions.push(Prisma.sql`a.price>=${aq.minPriceCents}`);
    if(admin&&aq.maxPriceCents!==undefined)conditions.push(Prisma.sql`a.price<=${aq.maxPriceCents}`);
    const order=q.sort==='PRICE_ASC'?Prisma.sql`a.price ASC NULLS LAST,p.id ASC`:q.sort==='PRICE_DESC'?Prisma.sql`a.price DESC NULLS LAST,p.id ASC`:q.sort==='SALES_DESC'?Prisma.sql`p.paid_sales_count DESC,p.id ASC`:Prisma.sql`p.created_at DESC,p.id ASC`;
    const from=Prisma.sql`FROM product p LEFT JOIN LATERAL (SELECT min(s.price_cents) AS price,COALESCE(sum(b.available::bigint),0)::text AS quantity,bool_or(s.price_cents IS NOT NULL AND b.available>0 AND NOT b.purchase_blocked) AS buy FROM sku s JOIN inventory_balance b ON b.sku_id=s.id WHERE s.product_id=p.id AND s.enabled AND s.retired_at IS NULL) a ON true WHERE ${Prisma.join(conditions,' AND ')}`;
    return this.db.$transaction(async tx=>{
      const [total]=await tx.$queryRaw<{count:bigint}[]>(Prisma.sql`SELECT count(*) ${from}`);
      const skip=BigInt(q.page-1)*BigInt(q.pageSize);const items=skip>=total!.count?[]:await tx.$queryRaw<{id:string;name:string;brand:string|null;mainImageId:string|null;priceFromCents:number|null;availableQuantity:string;paidSalesCount:string;purchasable:boolean;status:string;version:number;archivedAt:Date|null}[]>(Prisma.sql`
      SELECT p.id,p.name,p.brand,(SELECT asset_id FROM product_image i WHERE i.product_id=p.id AND slot='MAIN') AS "mainImageId",a.price AS "priceFromCents",a.quantity AS "availableQuantity",p.paid_sales_count::text AS "paidSalesCount",COALESCE(a.buy,false) AND p.status='ON_SALE' AND p.archived_at IS NULL AS purchasable,p.status,p.version,p.archived_at AS "archivedAt" ${from} ORDER BY ${order} LIMIT ${q.pageSize} OFFSET ${skip}`);
      return {items:items.map(({mainImageId,status,version,archivedAt,...p})=>({...p,mainImageUrl:mainImageId?imageUrl(mainImageId):null,...(admin?{status,version,archivedAt}:{})})),total:Number(total!.count),page:q.page,pageSize:q.pageSize};
    },{isolationLevel:'RepeatableRead'});
  }
  async detail(id:string,actor?:CurrentIdentity){return this.db.$transaction(tx=>this.detailTx(tx,id,actor),{isolationLevel:'RepeatableRead'});}
  async detailTx(tx:Prisma.TransactionClient,id:string,actor?:CurrentIdentity){
    const admin=actor?.subjectType==='EMPLOYEE';const cost=admin&&actor.effectivePermissions.includes('product.cost.read');const inventory=admin&&actor.effectivePermissions.includes('inventory.read');
    const p=await tx.product.findFirst({where:{id,...(admin?{}:visibleWhere)},select:{id:true,productCode:true,name:true,brand:true,description:true,categoryId:true,status:true,archivedAt:true,version:true,paidSalesCount:true,
      images:{select:{assetId:true,slot:true,sortOrder:true},orderBy:{sortOrder:'asc'}},
      category:{select:{id:true,pathIds:true}},
      skus:{where:admin?{}:{enabled:true,retiredAt:null},orderBy:{code:'asc'},select:{id:true,code:true,priceCents:true,...(cost?{costCents:true}:{}),enabled:true,retiredAt:true,
        balance:{select:{available:true,purchaseBlocked:true,...(inventory?{reserved:true,warningThreshold:true,version:true}:{})}},
        choices:{select:{dimensionId:true,valueId:true,value:{select:{name:true}},dimension:{select:{name:true,sortOrder:true}}}}}},
      dimensions:{where:{retiredAt:null},orderBy:{sortOrder:'asc'},select:{id:true,name:true,values:{where:{retiredAt:null},orderBy:{sortOrder:'asc'},select:{id:true,name:true}}}}}});
    if(!p)throw new CatalogError('PRODUCT_NOT_FOUND');
    const skus=p.skus.map(s=>({id:s.id,code:s.code,priceCents:s.priceCents,...(cost?{costCents:s.costCents}:{}),available:s.balance!.available,
      purchasable:p.status==='ON_SALE'&&!p.archivedAt&&s.enabled&&!s.retiredAt&&s.priceCents!==null&&s.balance!.available>0&&!s.balance!.purchaseBlocked,
      choices:s.choices.map(c=>({dimensionId:c.dimensionId,valueId:c.valueId,dimension:c.dimension.name,value:c.value.name})),
      ...(admin?{enabled:s.enabled,retiredAt:s.retiredAt,...(inventory?{reserved:s.balance!.reserved,purchaseBlocked:s.balance!.purchaseBlocked,warningThreshold:s.balance!.warningThreshold}:{})}:{})}));
    const effective=p.skus.filter(s=>s.enabled&&!s.retiredAt);const prices=effective.flatMap(s=>s.priceCents===null?[]:[s.priceCents]);
    const main=p.images.find(i=>i.slot==='MAIN')?.assetId??null;const path=p.category?await tx.category.findMany({where:{id:{in:p.category.pathIds}},select:{id:true,name:true,depth:true},orderBy:{depth:'asc'}}):[];
    return {id:p.id,name:p.name,brand:p.brand,description:p.description,mainImageUrl:main?imageUrl(main):null,galleryImageUrls:p.images.filter(i=>i.slot==='GALLERY').map(i=>imageUrl(i.assetId)),
      priceFromCents:prices.length?Math.min(...prices):null,availableQuantity:effective.reduce((n,s)=>n+BigInt(s.balance!.available),0n).toString(),paidSalesCount:p.paidSalesCount.toString(),purchasable:skus.some(s=>s.purchasable),
      categoryPath:path.map(({id,name})=>({id,name})),specDimensions:p.dimensions.map(d=>({...d,values:admin?d.values:d.values.filter(v=>p.skus.some(s=>s.choices.some(c=>c.valueId===v.id)))})).filter(d=>admin||d.values.length),skus,
      ...(admin?{productCode:p.productCode,categoryId:p.categoryId,status:p.status,archivedAt:p.archivedAt,version:p.version,mainImageId:main,galleryImageIds:p.images.filter(i=>i.slot==='GALLERY').map(i=>i.assetId),initialInventoryDraft:await tx.initialInventoryDraft.findFirst({where:{productId:id},orderBy:{createdAt:'desc'},select:{id:true,status:true,version:true,conversionKey:true}})}:{})};
  }
}
