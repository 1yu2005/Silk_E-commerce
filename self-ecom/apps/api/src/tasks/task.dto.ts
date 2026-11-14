// 作用：校验任务查询及各动作输入；只有延期命令可提交新截止，不接受客户端指定经办、资格、原截止或状态。
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsString, IsUUID, Length, Max, Min, ValidateBy, ValidateIf, ValidateNested } from 'class-validator';
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
export class HandoffLineDto {
  @IsUUID() orderItemId!:string;
  @IsInt() @Min(1) @Max(99) checkedQuantity!:number;
}
export class TaskHandoffDto {
  @IsInt() @Min(0) @Max(2147483646) physicalVersion!:number;
  @IsString() @Length(1,200) goodsLocation!:string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>HandoffLineDto) items!:HandoffLineDto[];
}
export class TransferTaskDto extends ReleaseTaskDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.toLowerCase() : value)
  @IsUUID() targetEmployeeId!: string;
  @ValidateIf(provided) @ValidateNested() @Type(()=>TaskHandoffDto) physicalHandoff?:TaskHandoffDto;
}
export class ExtendTaskDeadlineDto extends ReleaseTaskDto {
  @ValidateBy({ name: 'isUtcDeadline', validator: { validate: (value: unknown) => parseTaskDueAt(value) !== null } })
  newDueAt!: string;
}
