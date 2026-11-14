// 作用：只接入真实协作领域；核实、线下记录和系统退款各自保持事实边界。
import {Module} from '@nestjs/common';
import {AuthGuardModule} from '../auth/auth-guard.module.js';
import {AuditModule} from '../audit/audit.module.js';
import {TimeModule} from '../common/time/time.module.js';
import {TasksModule} from '../tasks/tasks.module.js';
import {FilesModule} from '../files/files.module.js';
import {RecordsModule} from '../records/records.module.js';
import {OrdersModule} from '../orders/orders.module.js';
import {AfterSalesModule} from '../after-sales/after-sales.module.js';
import {CustomersModule} from '../customers/customers.module.js';
import {CoordinationService} from './coordination.service.js';
import {CoordinationQueries} from './coordination-query.service.js';
import {CoordinationController} from './coordination.controller.js';
import {OfflineCaseService} from './offline-case.service.js';
import {OfflineCaseAdapters} from './offline-case.adapters.js';
import {OfflineCaseController} from './offline-case.controller.js';
import {ProxyInputService} from './proxy-input.service.js';
import {ProxyController} from './proxy.controller.js';
import {ProxyInputScheduler} from './proxy-scanner.service.js';
import {DisputeService} from './dispute.service.js';
import {CustodyService} from './custody.service.js';
import {CustodyAdapters} from './custody.adapters.js';
import {DisputeController,CustodyController} from './dispute.controller.js';
@Module({imports:[AuthGuardModule,AuditModule,TimeModule,TasksModule,FilesModule,RecordsModule,OrdersModule,AfterSalesModule,CustomersModule],
 controllers:[CoordinationController,OfflineCaseController,ProxyController,DisputeController,CustodyController],
 providers:[CoordinationService,CoordinationQueries,OfflineCaseService,OfflineCaseAdapters,ProxyInputService,ProxyInputScheduler,DisputeService,CustodyService,CustodyAdapters],
 exports:[CoordinationService,CoordinationQueries,OfflineCaseService,ProxyInputService,DisputeService,CustodyService]})
export class CoordinationModule{}
