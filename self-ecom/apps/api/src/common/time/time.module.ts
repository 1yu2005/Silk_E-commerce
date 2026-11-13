// 作用：导出服务器时钟供后续配置、任务及订单模块显式注入，不注册路由或定时器。
import { Module } from '@nestjs/common';
import { Clock, SystemClock } from './clock.js';

@Module({ providers: [{ provide: Clock, useClass: SystemClock }], exports: [Clock] })
export class TimeModule {}
