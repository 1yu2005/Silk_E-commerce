// 作用：组装员工任务查询与领取/释放，导出阶段进入及真实业务端口；不注册通用完成/取消HTTP或假业务。
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthGuardModule } from '../auth/auth-guard.module.js';
import { TimeModule } from '../common/time/time.module.js';
import { PermissionModule } from '../permissions/permission.module.js';
import { StoreSettingsModule } from '../settings/store-settings.module.js';
import { TaskBusinessAdapters } from './task-business-adapters.js';
import { TaskEntryService } from './task-entry.service.js';
import { TaskLockService } from './task-lock.service.js';
import { TaskAccessService } from './task-access.service.js';
import { TaskQueryService } from './task-query.service.js';
import { TaskCommandService } from './task-command.service.js';
import { TasksController } from './tasks.controller.js';
import { TaskEligibilityService } from './task-eligibility.service.js';
import { TaskDeadlineService } from './task-deadline.service.js';
import { TaskDeadlineEventsService } from './task-deadline-events.service.js';
import { TaskLifecycleService } from './task-lifecycle.service.js';
import { TaskSourceService } from './task-source.service.js';
import { OrderTimerRepositories, OrderTimerService } from './order-timer.service.js';
import { TaskOverdueScanService } from './task-overdue-scan.service.js';
import { TaskSchedulerService } from './task-scheduler.service.js';
@Module({ imports: [AuthGuardModule, AuditModule, TimeModule, StoreSettingsModule, PermissionModule], controllers: [TasksController],
  providers: [TaskBusinessAdapters, TaskLockService, TaskEntryService, TaskAccessService, TaskQueryService, TaskCommandService, TaskEligibilityService,
    TaskDeadlineService, TaskDeadlineEventsService, TaskLifecycleService, TaskSourceService, OrderTimerRepositories, OrderTimerService, TaskOverdueScanService, TaskSchedulerService],
  exports: [TaskBusinessAdapters, TaskEntryService, TaskEligibilityService, TaskLifecycleService, TaskSourceService, OrderTimerRepositories, OrderTimerService, TaskOverdueScanService] })
export class TasksModule {}
