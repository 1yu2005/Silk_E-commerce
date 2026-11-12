// 作用：组装公开健康检查控制器及数据库就绪探测依赖。
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({ imports: [PrismaModule], controllers: [HealthController] })
export class HealthModule {}
