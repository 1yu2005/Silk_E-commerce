import {Module} from '@nestjs/common';
import {AuthGuardModule} from '../auth/auth-guard.module.js';
import {TimeModule} from '../common/time/time.module.js';
import {OrderAccess} from '../orders/order-access.service.js';
import {ReportingService} from './reporting.service.js';
import {ReportingController} from './reporting.controller.js';
@Module({imports:[AuthGuardModule,TimeModule],providers:[OrderAccess,ReportingService],controllers:[ReportingController],exports:[ReportingService]})
export class ReportingModule{}
