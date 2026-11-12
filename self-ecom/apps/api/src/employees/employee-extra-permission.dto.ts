// 作用：校验替换员工个人额外权限的输入字段，限制格式、原因和并发版本。
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsString, Length, Max, MaxLength, Min } from 'class-validator';

export class EmployeeExtraPermissionDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  permissions!: string[];

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion!: number;

  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 500)
  reason!: string;
}
