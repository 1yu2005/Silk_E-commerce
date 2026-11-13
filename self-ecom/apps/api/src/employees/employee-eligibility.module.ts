// 作用：导出员工业务资格变更入口，供启停、调岗和授权事务复用。
import { Module } from '@nestjs/common';
import { EmployeeEligibilityService } from './employee-eligibility.service.js';
import { TasksModule } from '../tasks/tasks.module.js';

@Module({ imports: [TasksModule], providers: [EmployeeEligibilityService], exports: [EmployeeEligibilityService] })
export class EmployeeEligibilityModule {}
