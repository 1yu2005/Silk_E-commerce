// 作用：校验任务查询及各动作输入；只有延期命令可提交新截止，不接受客户端指定经办、资格、原截止或状态。
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsString, IsUUID, Length, Max, Min, ValidateBy, ValidateIf } from 'class-validator';
import { TaskBusinessType, TaskStage, TaskStatus } from '@prisma/client';
import { PaginationDto } from '../common/http/pagination.dto.js';
import { strictBoolean } from '../common/http/dto-transforms.js';
import { parseTaskDueAt } from './task-deadline-input.js';
const provided = (_object: unknown, value: unknown) => value !== undefined;
export class TaskQueryDto extends PaginationDto {
  @IsIn(['mine', 'pool', 'reassign']) view: 'mine' | 'pool' | 'reassign' = 'mine';
  @ValidateIf(provided) @IsEnum(TaskStage) stage?: TaskStage;
  @ValidateIf(provided) @IsEnum(TaskStatus) status?: TaskStatus;
  @ValidateIf(provided) @IsEnum(TaskBusinessType) businessType?: TaskBusinessType;
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.toLowerCase() : value)
  @ValidateIf(provided) @IsUUID() businessId?: string;
  @Transform(({ value }: { value: unknown }) => strictBoolean(value))
  @ValidateIf(provided) @IsBoolean() overdue?: boolean;
}
export class TaskParamsDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.toLowerCase() : value)
  @IsUUID() id!: string;
}
export class ClaimTaskDto {
  @IsInt() @Min(0) @Max(2147483647) expectedVersion!: number;
}
export class ReleaseTaskDto extends ClaimTaskDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 500) reason!: string;
}
export class TransferTaskDto extends ReleaseTaskDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.toLowerCase() : value)
  @IsUUID() targetEmployeeId!: string;
}
export class ExtendTaskDeadlineDto extends ReleaseTaskDto {
  @ValidateBy({ name: 'isUtcDeadline', validator: { validate: (value: unknown) => parseTaskDueAt(value) !== null } })
  newDueAt!: string;
}
