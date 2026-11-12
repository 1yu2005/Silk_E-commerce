// 作用：校验启用或停用员工的输入字段，限制格式、原因和并发版本。
import { Transform } from 'class-transformer';
import { IsInt, IsString, Length, Max, Min } from 'class-validator';

export class EmployeeStatusDto {
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion!: number;

  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 500)
  reason!: string;
}
