// 作用：装配板块8＋9交易和板块10履约领域；售后/退款由后续板块接入。
import {Module} from '@nestjs/common';
import {AuthGuardModule} from '../auth/auth-guard.module.js';
import {AuditModule} from '../audit/audit.module.js';
import {TimeModule} from '../common/time/time.module.js';
import {CustomersModule} from '../customers/customers.module.js';
import {StoreSettingsModule} from '../settings/store-settings.module.js';
import {InventoryModule} from '../inventory/inventory.module.js';
import {TasksModule} from '../tasks/tasks.module.js';
import {FilesModule} from '../files/files.module.js';
import {RecordsModule} from '../records/records.module.js';
import {CatalogModule} from '../catalog/catalog.module.js';
import {OrderService} from './order.service.js';
import {OrderAccess} from './order-access.service.js';
import {OrderAdapters} from './order.adapters.js';
import {OrderTimerAdapter} from './order-timer.adapter.js';
import {OrderCommands} from './order-command.service.js';
import {OrderQueries} from './order-query.service.js';
import {StockIncidents} from './stock-incident.service.js';
import {OrderScanner,OrderScheduler} from './order-scanner.service.js';
import {CheckoutController,StoreOrdersController,AdminOrdersController,StockIncidentsController} from './order.controller.js';
import {OrderCommunicationController,StoreOrderCommunicationController} from './order-communication.controller.js';
import {FulfillmentService} from './fulfillment.service.js';
import {FulfillmentTaskPolicy} from './fulfillment-task.policy.js';
import {FulfillmentAfterSales} from './fulfillment-after-sales.js';
import {FulfillmentController,ReceiptController} from './fulfillment.controller.js';
import {FulfillmentQueries} from './fulfillment-query.service.js';
import {FulfillmentScanner,FulfillmentScheduler} from './fulfillment-scanner.service.js';
@Module({imports:[AuthGuardModule,AuditModule,TimeModule,CustomersModule,StoreSettingsModule,InventoryModule,TasksModule,FilesModule,RecordsModule,CatalogModule],
 controllers:[CheckoutController,StoreOrdersController,AdminOrdersController,StockIncidentsController,OrderCommunicationController,StoreOrderCommunicationController,FulfillmentController,ReceiptController],
 providers:[OrderService,OrderAccess,OrderAdapters,OrderTimerAdapter,OrderCommands,OrderQueries,StockIncidents,OrderScanner,OrderScheduler,FulfillmentService,FulfillmentTaskPolicy,FulfillmentAfterSales,FulfillmentQueries,FulfillmentScanner,FulfillmentScheduler],exports:[OrderService,OrderCommands,OrderQueries,StockIncidents,OrderScanner,FulfillmentService,FulfillmentAfterSales,FulfillmentQueries,FulfillmentScanner]})
export class OrdersModule{}
