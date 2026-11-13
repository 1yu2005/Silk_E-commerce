// 作用：提供审计关联的沟通、状态历史及真实业务适配器端口；不注册未实现业务的HTTP路由。
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthSessionModule } from '../auth/auth-session.module.js';
import { BusinessRecordAdapters } from './business-record-adapters.js';
import { CommunicationService } from './communication.service.js';
import { StateHistoryService } from './state-history.service.js';
import { FilesModule } from '../files/files.module.js';
import { CommunicationFilesAdapter } from './communication-files.adapter.js';

@Module({ imports: [AuditModule, AuthSessionModule, FilesModule], providers: [BusinessRecordAdapters, CommunicationService, StateHistoryService, CommunicationFilesAdapter],
  exports: [BusinessRecordAdapters, CommunicationService, StateHistoryService] })
export class RecordsModule {}
