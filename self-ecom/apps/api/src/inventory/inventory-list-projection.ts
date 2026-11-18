// 作用：库存列表批量补齐商品、分类和规格名称，历史规格仍使用原 SKU 身份。
import type { Prisma } from '@prisma/client';

export async function inventorySkuLabels(tx:Prisma.TransactionClient,ids:string[]){
 const skus=await tx.sku.findMany({where:{id:{in:[...new Set(ids)]}},select:{id:true,code:true,retiredAt:true,product:{select:{id:true,name:true,productCode:true,category:{select:{pathIds:true}}}},choices:{orderBy:[{dimension:{sortOrder:'asc'}},{dimensionId:'asc'}],select:{dimension:{select:{name:true}},value:{select:{name:true}}}}}});
 const categories=await tx.category.findMany({where:{id:{in:[...new Set(skus.flatMap(s=>s.product.category?.pathIds??[]))]}},select:{id:true,name:true}});
 const names=new Map(categories.map(c=>[c.id,c.name]));
 return new Map(skus.map(s=>[s.id,{skuCode:s.code,skuRetired:s.retiredAt!==null,productId:s.product.id,productName:s.product.name,productCode:s.product.productCode,
  categoryPath:(s.product.category?.pathIds??[]).map(id=>names.get(id)??'未知分类'),choices:s.choices.map(c=>`${c.dimension.name}：${c.value.name}`)}]));
}

export async function inventoryEmployeeNames(tx:Prisma.TransactionClient,ids:(string|null)[]){
 const employees=await tx.employee.findMany({where:{id:{in:[...new Set(ids.filter((id):id is string=>id!==null))]}},select:{id:true,displayName:true}});
 return new Map(employees.map(e=>[e.id,e.displayName]));
}
