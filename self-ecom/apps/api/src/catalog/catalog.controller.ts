// 作用：公开只读浏览与后台权限路由分开，命令全部复用领域事务，不开放库存覆盖接口。
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EmployeeAccess } from '../auth/auth.decorators.js';
import { CurrentActor, readBearerToken, type AuthHttpRequest } from '../auth/auth-request-context.js';
import type { CurrentIdentity } from '../auth/current-identity.service.js';
import { CategoryService } from './category.service.js';
import { ProductCommands } from './product-command.service.js';
import { CatalogQueries } from './catalog-query.service.js';
import { AdminProductsQueryDto, BatchStatusDto, CatalogIdDto, CategoryCreateDto, CategoryEditDto, CategoryMoveDto, DraftSaveDto, DraftVoidDto, ProductCreateDto, ProductEditDto, ProductImagesDto, ReasonDto, SchemePreviewDto, SchemeSaveDto, SkuBatchDto, SkuEditDto, SkuEnabledDto, SkuIdDto, StoreProductsQueryDto } from './catalog.dto.js';
import * as O from './catalog.openapi.js';
const ctx=(actor:CurrentIdentity,r:AuthHttpRequest)=>({actor,token:readBearerToken(r),requestId:r.requestId});
@Controller('admin/categories') @ApiTags('Categories') @O.CatalogProtected()
export class CategoryController {
  constructor(@Inject(CategoryService) private readonly service:CategoryService){}
  @Get('tree') @EmployeeAccess('category.read') @O.CatalogEndpoint('getAdminCategoryTree','后台分类树',O.treeSchema(true))
  tree(){return this.service.tree();}
  @Post() @EmployeeAccess('category.manage') @O.CatalogEndpoint('createCategory','新增分类',O.categoryWrite,O.object(O.categoryFields,['name']),true)
  create(@Body() body:CategoryCreateDto,@CurrentActor() actor:CurrentIdentity,@Req() r:AuthHttpRequest){return this.service.write(actor,readBearerToken(r),r.requestId,null,body,'create');}
  @Patch(':id') @EmployeeAccess('category.manage') @O.CatalogParams() @O.CatalogEndpoint('updateCategory','修改分类',O.categoryWrite,O.object({...O.versionFields,name:O.categoryFields.name,iconKey:O.categoryFields.iconKey,sortOrder:O.categoryFields.sortOrder},['expectedVersion']))
  edit(@Param() p:CatalogIdDto,@Body() body:CategoryEditDto,@CurrentActor() actor:CurrentIdentity,@Req() r:AuthHttpRequest){return this.service.write(actor,readBearerToken(r),r.requestId,p.id,body,'edit');}
  @Post(':id/move') @HttpCode(200) @EmployeeAccess('category.manage') @O.CatalogParams() @O.CatalogEndpoint('moveCategory','移动完整分类子树',O.categoryWrite,O.object({...O.reasonFields,parentId:O.categoryFields.parentId}))
  move(@Param() p:CatalogIdDto,@Body() body:CategoryMoveDto,@CurrentActor() actor:CurrentIdentity,@Req() r:AuthHttpRequest){return this.service.write(actor,readBearerToken(r),r.requestId,p.id,body,'move');}
  @Delete(':id') @EmployeeAccess('category.manage') @O.CatalogParams() @O.CatalogEndpoint('deleteCategory','软删除空分类',O.categoryWrite,O.object(O.reasonFields))
  remove(@Param() p:CatalogIdDto,@Body() body:ReasonDto,@CurrentActor() actor:CurrentIdentity,@Req() r:AuthHttpRequest){return this.service.write(actor,readBearerToken(r),r.requestId,p.id,body,'delete');}
}
@Controller('admin/products') @ApiTags('Products') @O.CatalogProtected()
export class ProductController {
  constructor(@Inject(ProductCommands) private readonly commands:ProductCommands,@Inject(CatalogQueries) private readonly queries:CatalogQueries){}
  @Get() @EmployeeAccess('product.read') @O.CatalogListQuery(true) @O.CatalogEndpoint('listAdminProducts','筛选后台商品',O.listSchema(true))
  list(@Query() q:AdminProductsQueryDto,@CurrentActor() actor:CurrentIdentity){return this.queries.list(q,actor);}
  @Get(':id') @EmployeeAccess('product.read') @O.CatalogParams() @O.CatalogEndpoint('getAdminProduct','后台商品和授权SKU字段',O.detailSchema(true))
  detail(@Param() p:CatalogIdDto,@CurrentActor() actor:CurrentIdentity){return this.queries.detail(p.id,actor);}
  @Post() @EmployeeAccess('product.manage') @O.CatalogEndpoint('createProduct','新建草稿和默认SKU零账户',O.detailSchema(true,true),O.object(O.profileFields,['name']),true)
  create(@Body() b:ProductCreateDto,@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){return this.commands.create(ctx(a,r),b);}
  @Patch(':id') @EmployeeAccess('product.manage') @O.CatalogParams() @O.CatalogEndpoint('updateProduct','保存商品资料',O.detailSchema(true,true),O.object({...O.versionFields,...O.profileFields},['expectedVersion']))
  edit(@Param() p:CatalogIdDto,@Body() b:ProductEditDto,@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){return this.commands.edit(ctx(a,r),p.id,b);}
  @Put(':id/images') @EmployeeAccess('product.manage') @O.CatalogParams() @O.CatalogEndpoint('setProductImages','替换当前图片并保留历史引用',O.detailSchema(true,true),O.object(O.imagesFields))
  images(@Param() p:CatalogIdDto,@Body() b:ProductImagesDto,@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){return this.commands.images(ctx(a,r),p.id,b);}
  @Post(':id/publish') @HttpCode(200) @EmployeeAccess('product.publish') @O.CatalogParams() @O.CatalogEndpoint('publishProduct','校验资料和可售库存后上架',O.detailSchema(true,true),O.object(O.reasonFields))
  publish(@Param() p:CatalogIdDto,@Body() b:ReasonDto,@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){return this.commands.status(ctx(a,r),p.id,b,'publish');}
  @Post(':id/unpublish') @HttpCode(200) @EmployeeAccess('product.publish') @O.CatalogParams() @O.CatalogEndpoint('unpublishProduct','商品下架',O.detailSchema(true,true),O.object(O.reasonFields))
  unpublish(@Param() p:CatalogIdDto,@Body() b:ReasonDto,@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){return this.commands.status(ctx(a,r),p.id,b,'unpublish');}
  @Post(':id/archive') @HttpCode(200) @EmployeeAccess('product.publish','product.manage') @O.CatalogParams() @O.CatalogEndpoint('archiveProduct','下架并归档保留历史',O.detailSchema(true,true),O.object(O.reasonFields))
  archive(@Param() p:CatalogIdDto,@Body() b:ReasonDto,@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){return this.commands.status(ctx(a,r),p.id,b,'archive');}
  @Post('batch-status') @HttpCode(200) @EmployeeAccess('product.publish') @O.CatalogEndpoint('batchProductStatus','逐项上下架结果',O.batchResult,O.batchBody)
  batch(@Body() b:BatchStatusDto,@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){return this.commands.batch(ctx(a,r),b);}
  @Post(':id/sku-combinations/preview') @HttpCode(200) @EmployeeAccess('product.manage') @O.CatalogParams() @O.CatalogEndpoint('previewProductSkus','只读预览组合与复用建议',O.previewSchema,O.object({dimensions:O.dimensions}))
  preview(@Param() p:CatalogIdDto,@Body() b:SchemePreviewDto){return this.queries.preview(p.id,b);}
  @Put(':id/sku-scheme') @EmployeeAccess('product.manage') @O.CatalogParams() @O.CatalogEndpoint('saveProductSkuScheme','保存规格方案和零账户',O.detailSchema(true,true),O.object({...O.reasonFields,mode:{type:'string',enum:['APPEND','REBUILD']},dimensions:O.dimensions}))
  scheme(@Param() p:CatalogIdDto,@Body() b:SchemeSaveDto,@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){return this.commands.scheme(ctx(a,r),p.id,b);}
  @Patch(':id/skus/:skuId') @EmployeeAccess('product.manage') @O.CatalogParams(true) @O.CatalogEndpoint('updateProductSku','修改SKU编码售价成本',O.detailSchema(true,true),O.object({...O.versionFields,code:{...O.text(64,1),pattern:'^[A-Za-z0-9_-]+$'},...O.priceFields},['expectedVersion']))
  sku(@Param() p:SkuIdDto,@Body() b:SkuEditDto,@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){return this.commands.sku(ctx(a,r),p.id,p.skuId,b);}
  @Post(':id/skus/batch-fill') @HttpCode(200) @EmployeeAccess('product.manage') @O.CatalogParams() @O.CatalogEndpoint('batchFillProductSkus','原子批量填价',O.detailSchema(true,true),O.object({...O.versionFields,skuIds:{...O.array(O.uuid,200),minItems:1,uniqueItems:true},...O.priceFields},['expectedVersion','skuIds']))
  fill(@Param() p:CatalogIdDto,@Body() b:SkuBatchDto,@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){return this.commands.prices(ctx(a,r),p.id,b);}
  @Post(':id/skus/:skuId/set-enabled') @HttpCode(200) @EmployeeAccess('product.publish') @O.CatalogParams(true) @O.CatalogEndpoint('setProductSkuEnabled','启停当前SKU',O.detailSchema(true,true),O.object({...O.reasonFields,enabled:{type:'boolean'}}))
  enabled(@Param() p:SkuIdDto,@Body() b:SkuEnabledDto,@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){return this.commands.enabled(ctx(a,r),p.id,p.skuId,b);}
  @Get(':id/initial-inventory-draft') @EmployeeAccess('product.manage') @O.CatalogParams() @O.CatalogEndpoint('getInitialInventoryDraft','读取数量草稿及转换状态',{...O.draftSchema,nullable:true})
  draft(@Param() p:CatalogIdDto){return this.commands.draft(p.id);}
  @Put(':id/initial-inventory-draft') @EmployeeAccess('product.manage') @O.CatalogParams() @O.CatalogEndpoint('saveInitialInventoryDraft','保存非记账数量草稿',O.detailSchema(true,true),O.object(O.draftFields))
  saveDraft(@Param() p:CatalogIdDto,@Body() b:DraftSaveDto,@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){return this.commands.draftSave(ctx(a,r),p.id,b);}
  @Post(':id/initial-inventory-draft/void') @HttpCode(200) @EmployeeAccess('product.manage') @O.CatalogParams() @O.CatalogEndpoint('voidInitialInventoryDraft','原因作废数量草稿',O.detailSchema(true,true),O.object({expectedProductVersion:O.int(2147483646),expectedDraftVersion:O.int(2147483646),reason:O.text(500,1)}))
  voidDraft(@Param() p:CatalogIdDto,@Body() b:DraftVoidDto,@CurrentActor() a:CurrentIdentity,@Req() r:AuthHttpRequest){return this.commands.draftVoid(ctx(a,r),p.id,b);}
}
@Controller('store') @ApiTags('StoreCatalog')
export class StoreCatalogController {
  constructor(@Inject(CatalogQueries) private readonly queries:CatalogQueries){}
  @Get('categories') @O.CatalogEndpoint('getStoreCategoryTree','有公开商品的分类和祖先',O.treeSchema(false)) categories(){return this.queries.categories();}
  @Get('products') @O.CatalogListQuery() @O.CatalogEndpoint('listStoreProducts','公开商品搜索排序',O.listSchema(false)) list(@Query() q:StoreProductsQueryDto){return this.queries.list(q);}
  @Get('products/:id') @O.CatalogParams() @O.CatalogEndpoint('getStoreProduct','公开商品与有效可选SKU',O.detailSchema(false)) detail(@Param() p:CatalogIdDto){return this.queries.detail(p.id);}
}
