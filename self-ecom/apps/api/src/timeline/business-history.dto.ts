// 作用：员工时间线只接受固定事件种类，沿用严格分页和大页边界。
import { IsIn, IsOptional } from 'class-validator';
import { PaginationDto } from '../common/http/pagination.dto.js';
export const historyKinds = ['STATE_CHANGE','TASK_CHANGE','DEADLINE_EVENT','COMMUNICATION','PAYMENT','REFUND_ATTEMPT','INVENTORY_ACTION','HANDOVER','INSPECTION','OFFLINE_EVENT'] as const;
export type HistoryKind = typeof historyKinds[number];
export class BusinessHistoryQueryDto extends PaginationDto {
  @IsOptional() @IsIn(historyKinds) kind?: HistoryKind;
}
