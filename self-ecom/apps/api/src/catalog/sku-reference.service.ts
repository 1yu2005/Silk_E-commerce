// 作用：统一SKU实体保护；未来领域一旦有真实表就必须注册检查器，不以缺失适配器冒充无引用。
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { CatalogError } from './catalog.errors.js';
export interface SkuReferenceAdapter { domain:'inventory'|'order'|'after-sale'; referenced(tx:Prisma.TransactionClient,skuIds:string[]):Promise<boolean> }
@Injectable()
export class SkuReferences {
  private readonly adapters=new Map<string,SkuReferenceAdapter>();
  register(adapter:SkuReferenceAdapter) { if(this.adapters.has(adapter.domain))throw new Error('SKU引用检查器重复注册');this.adapters.set(adapter.domain,adapter); }
  async referenced(tx:Prisma.TransactionClient,ids:string[]) {
    const [tables]=await tx.$queryRaw<{inventory:boolean;order:boolean;'after-sale':boolean}[]>`SELECT to_regclass('public.inventory_adjustment') IS NOT NULL AS inventory, to_regclass('public.order_item') IS NOT NULL AS "order",to_regclass('public.after_sale') IS NOT NULL AS "after-sale"`;
    for(const [domain,exists]of Object.entries(tables!)) if(exists&&!this.adapters.has(domain))throw new CatalogError('SKU_REFERENCE_NOT_READY');
    if(await tx.initialInventoryDraftLine.count({where:{skuId:{in:ids},draft:{status:'CONVERTED'}}}))return true;
    for(const adapter of this.adapters.values())if(await adapter.referenced(tx,ids))return true;
    return false;
  }
}
