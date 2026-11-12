// 作用：校验调整员工岗位并清空额外权限的输入字段，限制格式、原因和并发版本。
import { EmployeeRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsString, Length, Max, Min } from 'class-validator';

export class EmployeeRoleDto {
  @IsEnum(EmployeeRole)
  role!: EmployeeRole;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion!: number;

  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 500)
  reason!: string;
}
