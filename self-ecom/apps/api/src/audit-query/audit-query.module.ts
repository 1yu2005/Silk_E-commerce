// 作用：独立组装只读审计查询，不改变原审计写入模块和业务事务。
import {Module} from '@nestjs/common';
import {AuthGuardModule} from '../auth/auth-guard.module.js';
import {TimeModule} from '../common/time/time.module.js';
import {OrderAccess} from '../orders/order-access.service.js';
import {AuditQueryController} from './audit-query.controller.js';
import {AuditQueryService} from './audit-query.service.js';
@Module({imports:[AuthGuardModule,TimeModule],controllers:[AuditQueryController],providers:[OrderAccess,AuditQueryService],exports:[AuditQueryService]})
export class AuditQueryModule {}
