// 作用：分批锁定无引用过期图，先提交清理标记再删磁盘，删除失败保留待重试；只扫描受控目录。
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { APP_CONFIG, type EnvironmentConfig } from '../config/environment.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FILE_CONFIG, type FileConfiguration } from './file-configuration.js';
import { FileStorageService } from './file-storage.service.js';
import { fileNow } from './file-binding.service.js';

@Injectable()
export class FileCleanupService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(FileCleanupService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FileStorageService) private readonly storage: FileStorageService,
    @Inject(APP_CONFIG) private readonly environment: EnvironmentConfig,
    @Inject(FILE_CONFIG) private readonly config: FileConfiguration) {}
  onApplicationBootstrap() {
    if (this.environment.nodeEnv === 'test') return;
    this.timer = setInterval(() => {
      if (!this.running) this.running = this.runBatch().catch(() => { this.logger.error('文件清理本轮失败，下轮重试'); })
        .finally(() => { this.running = undefined; });
    }, this.config.cleanupIntervalSeconds * 1000);
    this.timer.unref();
  }
  async onApplicationShutdown() { if (this.timer) clearInterval(this.timer); await this.running; }
  async runBatch(limit = 50) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('清理批量范围不合法');
    const ids = await this.prisma.$transaction(async tx => {
      const candidates = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT f.id FROM file_asset f WHERE ((f.state='STAGED' AND f.expires_at<=clock_timestamp()) OR f.state='PURGE_PENDING')
        AND NOT EXISTS(SELECT 1 FROM file_reference r WHERE r.file_asset_id=f.id)
        AND NOT EXISTS(SELECT 1 FROM customer c WHERE c.avatar_asset_id=f.id)
        ORDER BY f.id LIMIT ${limit} FOR UPDATE OF f SKIP LOCKED`);
      const ids = candidates.map(row => row.id);
      if (ids.length) await tx.fileAsset.updateMany({ where: { id: { in: ids }, state: 'STAGED' },
        data: { state: 'PURGE_PENDING', purgeStartedAt: await fileNow(tx), version: { increment: 1 } } });
      return ids;
    });
    for (const id of ids) {
      try {
        await this.prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM file_asset WHERE id=${id}::uuid FOR UPDATE`;
          const asset = await tx.fileAsset.findUniqueOrThrow({ where: { id }, include: { _count: { select: { references: true, currentAvatars: true } } } });
          if (asset.state !== 'PURGE_PENDING' || asset._count.references || asset._count.currentAvatars) return;
          await this.storage.remove(asset.storageKey);
          await tx.fileAsset.update({ where: { id }, data: { state: 'PURGED', purgedAt: await fileNow(tx), version: { increment: 1 } } });
        });
      } catch { this.logger.warn('待清理图片删除失败，保留标记供下轮重试'); }
    }
    // 输入24h后才转最终文件；48h保守窗口避开正常最长上传/事务时长，数据库二次核对后才删除。
    for (const key of await this.storage.orphanCandidates(new Date(Date.now() - 172800000))) {
      if (!await this.prisma.fileAsset.findUnique({ where: { storageKey: key }, select: { id: true } })) await this.storage.compensate(key);
    }
  }
}
