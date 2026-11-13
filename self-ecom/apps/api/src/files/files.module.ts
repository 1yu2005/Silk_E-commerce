// 作用：装配文件HTTP入口与可复用内部服务；只有真实顾客头像解析器默认注册。
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthGuardModule } from '../auth/auth-guard.module.js';
import { ConfigModule } from '../config/config.module.js';
import { FileAccessService } from './file-access.service.js';
import { FileBindingService } from './file-binding.service.js';
import { FileBusinessAdapters } from './file-business-adapters.js';
import { FileCleanupService } from './file-cleanup.service.js';
import { FILE_CONFIG, loadFileConfiguration } from './file-configuration.js';
import { FileStorageService } from './file-storage.service.js';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';

@Module({ imports: [ConfigModule, AuthGuardModule, AuditModule], controllers: [FilesController],
  providers: [{ provide: FILE_CONFIG, useFactory: () => loadFileConfiguration() }, FileAccessService, FileStorageService,
    FilesService, FileBindingService, FileBusinessAdapters, FileCleanupService],
  exports: [FilesService, FileStorageService, FileBindingService, FileBusinessAdapters, FileAccessService, FileCleanupService] })
export class FilesModule {}
