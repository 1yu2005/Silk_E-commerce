// 作用：校验员工列表筛选、分页和详情 UUID，统一员工编号的小写形式。
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { EmployeeRole, EmployeeStatus } from '@prisma/client';
import { PaginationDto } from '../common/http/pagination.dto.js';

export class EmployeeListQueryDto extends PaginationDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MaxLength(50)
  keyword?: string;

  @IsOptional()
  @IsEnum(EmployeeRole)
  role?: EmployeeRole;

  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;
}

export class EmployeeIdParamsDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.toLowerCase() : value)
  @IsUUID()
  id!: string;
}
