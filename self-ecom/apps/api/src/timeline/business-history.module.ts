import { Module } from '@nestjs/common';
import { AuthGuardModule } from '../auth/auth-guard.module.js';
import { BusinessHistoryService } from './business-history.service.js';
import { OrderHistoryController,AfterSaleHistoryController } from './business-history.controller.js';
@Module({imports:[AuthGuardModule],providers:[BusinessHistoryService],controllers:[OrderHistoryController,AfterSaleHistoryController],exports:[BusinessHistoryService]})
export class BusinessHistoryModule {}
