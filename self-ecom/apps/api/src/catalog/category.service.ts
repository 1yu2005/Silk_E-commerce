// 作用：分类写操作共享稳定树锁；移动校验完整子树并原子更新全部路径。
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Category } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { runAuthTransaction } from '../auth/auth-transaction.js';
import type { CurrentIdentity } from '../auth/current-identity.service.js';
import { CatalogAccess } from './catalog-access.service.js';
import { CatalogError } from './catalog.errors.js';
import { nameKey } from './catalog.rules.js';
import type { CategoryCreateDto, CategoryEditDto, CategoryMoveDto, ReasonDto } from './catalog.dto.js';
export function categoryTree(rows: Category[], publicView=false) {
  const nodes = rows.map(row => ({ id:row.id, name:row.name, parentId:row.parentId, iconKey:row.iconKey, sortOrder:row.sortOrder,
    ...(publicView ? {} : {depth:row.depth,pathIds:row.pathIds,version:row.version}), children: [] as unknown[] }));
  const map = new Map(nodes.map(n => [n.id,n])); const roots: typeof nodes = [];
  for (const n of nodes) { const parent=n.parentId ? map.get(n.parentId) : undefined; if(parent) parent.children.push(n); else roots.push(n); }
  return roots;
}
@Injectable()
export class CategoryService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService, @Inject(CatalogAccess) private readonly access: CatalogAccess,
    @Inject(AuditService) private readonly audit: AuditService) {}
  async tree() { return categoryTree(await this.db.category.findMany({where:{deletedAt:null},orderBy:[{sortOrder:'asc'},{nameKey:'asc'},{id:'asc'}]})); }
  async write(actor:CurrentIdentity,token:string,requestId:string,id:string|null,input:CategoryCreateDto|CategoryEditDto|CategoryMoveDto|ReasonDto,action:'create'|'edit'|'move'|'delete') {
    try {return await runAuthTransaction(this.db,async tx=>{
      const current=await this.access.actor(tx,actor,token,['category.manage']); await this.access.tree(tx);
      const existing=id ? await tx.category.findUnique({where:{id}}) : null;
      if(id && (!existing || existing.deletedAt)) throw new CatalogError('CATEGORY_NOT_FOUND');
      if(existing && (!('expectedVersion'in input)||existing.version!==input.expectedVersion))throw new CatalogError('VERSION_CONFLICT');
      if(existing?.version===2147483647)throw new CatalogError('VERSION_CONFLICT');
      const diff:{id:string;field:string;before:string|number|null;after:string|number|null}[]=[];
      let row:Category;let affected=1;
      if(action==='create'){
        const data=input as CategoryCreateDto; const parent=data.parentId ? await tx.category.findUnique({where:{id:data.parentId}}):null;
        if(data.parentId&&(!parent||parent.deletedAt))throw new CatalogError('CATEGORY_NOT_FOUND');
        if(parent&&parent.depth>=3)throw new CatalogError('CATEGORY_DEPTH_EXCEEDED');
        const key=randomUUID();row=await tx.category.create({data:{id:key,name:data.name,nameKey:nameKey(data.name),parentId:parent?.id??null,iconKey:data.iconKey??null,sortOrder:data.sortOrder??0,depth:(parent?.depth??0)+1,pathIds:[...(parent?.pathIds??[]),key]}});
      }else{
        row=existing!;
        if(action==='edit'){
          const data=input as CategoryEditDto; const patch={name:data.name??row.name,nameKey:nameKey(data.name??row.name),iconKey:data.iconKey===undefined?row.iconKey:data.iconKey,sortOrder:data.sortOrder??row.sortOrder};
          if(Object.entries(patch).every(([k,v])=>row[k as keyof Category]===v))return {...row,changed:false,affected:0};
          row=await tx.category.update({where:{id:row.id},data:{...patch,version:{increment:1}}});
        }else if(action==='delete'){
          if(await tx.category.count({where:{parentId:row.id,deletedAt:null}})||await tx.product.count({where:{categoryId:row.id}}))throw new CatalogError('CATEGORY_IN_USE');
          row=await tx.category.update({where:{id:row.id},data:{deletedAt:new Date(),version:{increment:1}}});
        }else{
          const data=input as CategoryMoveDto;const parent=data.parentId?await tx.category.findUnique({where:{id:data.parentId}}):null;
          if(data.parentId&&(!parent||parent.deletedAt))throw new CatalogError('CATEGORY_NOT_FOUND');
          if(parent?.pathIds.includes(row.id))throw new CatalogError('CATEGORY_CYCLE');
          const descendants=await tx.category.findMany({where:{deletedAt:null,pathIds:{has:row.id}}});
          const prefix=parent?.pathIds??[];const height=descendants.reduce((max,d)=>Math.max(max,d.depth-row.depth+1),0);
          if(prefix.length+height>3)throw new CatalogError('CATEGORY_DEPTH_EXCEEDED');
          if(row.parentId===data.parentId)return {...row,changed:false,affected:0};
          affected=descendants.length;
          if(descendants.some(d=>d.version===2147483647))throw new CatalogError('VERSION_CONFLICT');
          // 后代路径均由根的旧前缀到新前缀确定；单条更新避免大子树逐行往返超时，审计保存可复原的前缀与影响数。
          const prefixSql=prefix.length?Prisma.sql`ARRAY[${Prisma.join(prefix.map(key=>Prisma.sql`${key}::uuid`))}]::uuid[]`:Prisma.sql`ARRAY[]::uuid[]`;
          diff.push({id:row.id,field:'pathIds',before:JSON.stringify(row.pathIds),after:JSON.stringify([...prefix,row.id])});
          await tx.$executeRaw(Prisma.sql`UPDATE category SET path_ids=${prefixSql} || path_ids[${row.depth}:cardinality(path_ids)],
            depth=cardinality(path_ids)-${row.depth}+1+${prefix.length},
            parent_id=CASE WHEN id=${row.id}::uuid THEN ${data.parentId}::uuid ELSE parent_id END,
            version=version+1,updated_at=CURRENT_TIMESTAMP WHERE deleted_at IS NULL AND ${row.id}::uuid=ANY(path_ids)`);
          row=(await tx.category.findUnique({where:{id:row.id}}))!;
        }
      }
      for(const field of ['name','parentId','iconKey','sortOrder'] as const){const before=existing?.[field]??null;const after=row[field];if(before!==after)diff.push({id:row.id,field,before,after});}
      if(action==='delete')diff.push({id:row.id,field:'retiredAt',before:null,after:row.deletedAt!.toISOString()});
      await this.audit.appendAudit(tx,{actor:{type:'EMPLOYEE',id:current.subjectId},action:'category.change',targetId:row.id,requestId,reason:'reason'in input?input.reason:undefined,
        before:existing?{catalogVersion:existing.version}:undefined,after:{catalogVersion:row.version,catalogAction:action,affectedCount:affected,catalogChanges:diff}});
      return {...row,changed:true,affected};
    });}catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002')throw new CatalogError('CATEGORY_NAME_EXISTS');throw e;}
  }
}
