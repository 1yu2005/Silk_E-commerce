// 作用：装配正式售后领域及前序履约读取器，不包含退款或验收替身。
import {Module} from '@nestjs/common';
import {AuthGuardModule} from '../auth/auth-guard.module.js';
import {AuditModule} from '../audit/audit.module.js';
import {TimeModule} from '../common/time/time.module.js';
import {StoreSettingsModule} from '../settings/store-settings.module.js';
import {TasksModule} from '../tasks/tasks.module.js';
import {FilesModule} from '../files/files.module.js';
import {RecordsModule} from '../records/records.module.js';
import {OrdersModule} from '../orders/orders.module.js';
import {CatalogModule} from '../catalog/catalog.module.js';
import {AfterSaleService} from './after-sale.service.js';
import {AfterSaleQueries} from './after-sale-query.service.js';
import {AfterSaleAdapters} from './after-sale.adapters.js';
import {AfterSaleCloseFacts} from './after-sale-close-facts.js';
import {StoreAfterSalesController,AdminAfterSalesController} from './after-sale.controller.js';
import {StoreAfterSaleCommunicationController} from '../orders/order-communication.controller.js';
@Module({imports:[AuthGuardModule,AuditModule,TimeModule,StoreSettingsModule,TasksModule,FilesModule,RecordsModule,OrdersModule,CatalogModule],controllers:[StoreAfterSalesController,AdminAfterSalesController,StoreAfterSaleCommunicationController],providers:[AfterSaleService,AfterSaleQueries,AfterSaleAdapters,AfterSaleCloseFacts],exports:[AfterSaleService,AfterSaleQueries,AfterSaleCloseFacts]})
export class AfterSalesModule{}
