// 作用：组装库存真实领域；未来订单事实端口保持默认拒绝，不注册任意余额修改HTTP。
import { Module } from '@nestjs/common';
import { AuthGuardModule } from '../auth/auth-guard.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { FilesModule } from '../files/files.module.js';
import { RecordsModule } from '../records/records.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { InventoryAccess } from './inventory-access.service.js';
import { InventoryEvidence } from './inventory-evidence.service.js';
import { InventoryKernel } from './inventory-kernel.service.js';
import { InventorySources } from './inventory-source.service.js';
import { InventoryAdjustments } from './inventory-adjustment.service.js';
import { InventoryPosting } from './inventory-posting.service.js';
import { InventoryBlocks } from './inventory-block.service.js';
import { InventoryConversion } from './inventory-conversion.service.js';
import { InventoryAdapters } from './inventory.adapters.js';
import { InventoryAutomatic, InventoryDomainPorts } from './inventory-automatic.service.js';
import { InventoryQueries } from './inventory-query.service.js';
import { InventoryController, InventoryConversionController } from './inventory.controller.js';
@Module({imports:[AuthGuardModule,AuditModule,CatalogModule,FilesModule,RecordsModule,TasksModule],
 controllers:[InventoryController,InventoryConversionController],
 providers:[InventoryAccess,InventoryEvidence,InventoryKernel,InventorySources,InventoryAdjustments,InventoryPosting,InventoryBlocks,InventoryConversion,InventoryAdapters,InventoryAutomatic,InventoryDomainPorts,InventoryQueries],
 exports:[InventoryKernel,InventoryBlocks,InventoryAutomatic,InventoryDomainPorts]})
export class InventoryModule{}
