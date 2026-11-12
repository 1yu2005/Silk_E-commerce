// 作用：校验员工创建的账号、显示名、固定岗位和原文临时密码。
import { EmployeeRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsString, Length, Matches, ValidateBy } from 'class-validator';
import { validatePassword } from '@shop/shared';
import { normalizeEmployeeUsername } from '../auth/employee-login.dto.js';

const trimText = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
export class EmployeeCreateDto {
  @Transform(({ value }: { value: unknown }) => normalizeEmployeeUsername(value))
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{3,31}$/)
  username!: string;

  @Transform(trimText)
  @IsString()
  @Length(1, 40)
  displayName!: string;

  @IsEnum(EmployeeRole)
  role!: EmployeeRole;

  @IsString()
  @ValidateBy({ name: 'passwordPolicy', validator: { validate: value => validatePassword(value) === null } })
  initialPassword!: string;

  @Transform(trimText)
  @IsString()
  @Length(1, 500)
  reason!: string;
}
