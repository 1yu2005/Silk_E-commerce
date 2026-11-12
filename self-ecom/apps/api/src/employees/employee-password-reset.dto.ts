// 作用：校验重置其他员工密码的输入字段，限制格式、原因和并发版本。
import { Transform } from 'class-transformer';
import { IsInt, IsString, Length, Max, Min, ValidateBy } from 'class-validator';
import { validatePassword } from '@shop/shared';

export class EmployeePasswordResetDto {
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion!: number;

  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 500)
  reason!: string;

  @IsString()
  @ValidateBy({ name: 'passwordPolicy', validator: { validate: value => validatePassword(value) === null } })
  temporaryPassword!: string;
}
