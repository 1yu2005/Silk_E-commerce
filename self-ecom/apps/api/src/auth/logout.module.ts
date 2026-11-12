// 作用：组装当前会话注销控制器、凭证守卫、事务服务与审计依赖。
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthSessionModule } from './auth-session.module.js';
import { JwtTokenModule } from './jwt-token.module.js';
import { LogoutController } from './logout.controller.js';
import { LogoutService } from './logout.service.js';
import { LogoutTokenGuard } from './logout-token.guard.js';

@Module({ imports: [PrismaModule, AuthSessionModule, JwtTokenModule, AuditModule],
  controllers: [LogoutController], providers: [LogoutService, LogoutTokenGuard] })
export class LogoutModule {}
