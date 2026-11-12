// 作用：校验顾客登录手机号与保留原文的密码输入。
import { Transform } from 'class-transformer';
import { IsString, Matches, ValidateBy } from 'class-validator';
import { validatePassword } from '@shop/shared';

export class CustomerLoginDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Matches(/^1[3-9][0-9]{9}$/)
  phone!: string;

  @IsString()
  @ValidateBy({ name: 'passwordPolicy', validator: { validate: value => validatePassword(value) === null } })
  password!: string;
}
