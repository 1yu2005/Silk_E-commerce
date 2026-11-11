import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { EnvironmentConfig } from '../config/environment.js';

export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private pendingPing: Promise<void> | undefined;

  constructor(config: EnvironmentConfig) {
    super({ adapter: new PrismaPg({
      connectionString: config.databaseUrl,
      max: 10,
      connectionTimeoutMillis: 750,
      idleTimeoutMillis: 10_000,
      statement_timeout: 750,
      query_timeout: 1000,
      options: '-c timezone=UTC',
    }) });
  }

  async onModuleInit() {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.$connect();
        await this.ping();
        return;
      } catch {
        if (attempt === 3) {
          await this.$disconnect();
          throw new Error('数据库连接失败，已达到启动重试上限');
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
  }

  ping(): Promise<void> {
    // 复用尚未结束的检查，不缓存检查结果，避免重复探针导致
    // 查询无限排队，并确保后续检查获取数据库的当前状态。
    this.pendingPing ??= this.$queryRaw`SELECT 1`
      .then(() => undefined)
      .finally(() => { this.pendingPing = undefined; });
    return this.pendingPing;
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
