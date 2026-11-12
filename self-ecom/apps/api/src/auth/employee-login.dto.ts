// 作用：校验并规范化员工登录账号，使用共享密码规则保留密码原文。
import { Transform } from 'class-transformer';
import { IsString, Matches, ValidateBy } from 'class-validator';
import { validatePassword } from '@shop/shared';

export function normalizeEmployeeUsername(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}
export class EmployeeLoginDto {
  @Transform(({ value }: { value: unknown }) => normalizeEmployeeUsername(value))
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{3,31}$/)
  username!: string;

  @IsString()
  @ValidateBy({ name: 'passwordPolicy', validator: { validate: value => validatePassword(value) === null } })
  password!: string;
}
