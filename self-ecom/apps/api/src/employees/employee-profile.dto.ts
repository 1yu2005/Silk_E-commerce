// 作用：校验修改员工显示名的输入字段，限制格式、原因和并发版本。
import { Transform } from 'class-transformer';
import { IsInt, IsString, Length, Max, Min } from 'class-validator';

const trimText = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
export class EmployeeProfileDto {
  @Transform(trimText)
  @IsString()
  @Length(1, 40)
  displayName!: string;

  // JSON正文要求数字，不将字符串、布尔值或小数宽松转换成版本。
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion!: number;

  @Transform(trimText)
  @IsString()
  @Length(1, 500)
  reason!: string;
}
