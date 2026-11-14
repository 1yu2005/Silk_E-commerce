// 作用：注册真实顾客、地址和购物车业务；消费及按量扣减端口供后续真实订单接入。
import {Module} from '@nestjs/common';
import {AuthGuardModule} from '../auth/auth-guard.module.js';
import {AuditModule} from '../audit/audit.module.js';
import {CustomerAccessService} from './customer-access.service.js';
import {CustomerService} from './customer.service.js';
import {CustomerConsumptionService} from './customer-consumption.service.js';
import {AddressService} from './address.service.js';
import {CartService} from './cart.service.js';
import {CustomerController,AddressController,CartController} from './customer.controller.js';
@Module({imports:[AuthGuardModule,AuditModule],controllers:[CustomerController,AddressController,CartController],providers:[CustomerAccessService,CustomerService,CustomerConsumptionService,AddressService,CartService],exports:[CartService,CustomerConsumptionService,CustomerAccessService]})
export class CustomersModule{}
