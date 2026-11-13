// 作用：只注册一个每分钟扫描入口；启动补扫，停机等待在途任务，test环境由测试显式调用。
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { APP_CONFIG, type EnvironmentConfig } from '../config/environment.js';
import { TaskOverdueScanService } from './task-overdue-scan.service.js';
@Injectable()
export class TaskSchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TaskSchedulerService.name);
  private timer?: ReturnType<typeof setInterval>; private running?: Promise<void>;
  constructor(@Inject(TaskOverdueScanService) private readonly scanner: TaskOverdueScanService, @Inject(APP_CONFIG) private readonly config: EnvironmentConfig) {}
  onApplicationBootstrap() {
    if (this.config.nodeEnv === 'test' || this.timer) return;
    this.tick(); this.timer = setInterval(() => this.tick(), 60_000); this.timer.unref();
  }
  private tick() {
    if (!this.running) this.running = this.scanner.scan().then(() => undefined).catch(() => this.logger.error('任务超期扫描运行失败，下轮补扫'))
      .finally(() => { this.running = undefined; });
  }
  async onApplicationShutdown() { if (this.timer) clearInterval(this.timer); await this.running; }
}
