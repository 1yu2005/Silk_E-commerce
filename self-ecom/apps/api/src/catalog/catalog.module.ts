// 作用：组装分类商品命令、公开查询及真实公共能力适配器。
import { Module } from '@nestjs/common';
import { AuthGuardModule } from '../auth/auth-guard.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { FilesModule } from '../files/files.module.js';
import { RecordsModule } from '../records/records.module.js';
import { CatalogAccess } from './catalog-access.service.js';
import { CatalogQueries } from './catalog-query.service.js';
import { CategoryService } from './category.service.js';
import { ProductCommands } from './product-command.service.js';
import { SkuReferences } from './sku-reference.service.js';
import { CatalogAdapters } from './catalog.adapters.js';
import { CategoryController, ProductController, StoreCatalogController } from './catalog.controller.js';
@Module({imports:[AuthGuardModule,AuditModule,FilesModule,RecordsModule],controllers:[CategoryController,ProductController,StoreCatalogController],
  providers:[CatalogAccess,CatalogQueries,CategoryService,ProductCommands,SkuReferences,CatalogAdapters],exports:[SkuReferences]})
export class CatalogModule{}
