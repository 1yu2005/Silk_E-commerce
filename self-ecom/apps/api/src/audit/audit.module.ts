// 作用：向业务模块提供必须使用同一事务写入的最小审计服务。
import { Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';

@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
