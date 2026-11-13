// 作用：组装全店设置接口、版本服务、服务器时钟及既有认证和事务审计依赖。
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthGuardModule } from '../auth/auth-guard.module.js';
import { TimeModule } from '../common/time/time.module.js';
import { StoreContactController, StoreSettingsController } from './store-settings.controller.js';
import { StoreSettingsService } from './store-settings.service.js';
@Module({ imports: [AuthGuardModule, AuditModule, TimeModule], controllers: [StoreSettingsController, StoreContactController],
  providers: [StoreSettingsService], exports: [StoreSettingsService] })
export class StoreSettingsModule {}
