// 作用：校验本人改密请求的旧密码、新密码及两者不得相同的规则。
import { IsString, ValidateBy } from 'class-validator';
import { validatePassword } from '@shop/shared';

/** 新旧密码均保留原文；相等性由共享改密规则统一检查。 */
export class ChangePasswordDto {
  @IsString()
  @ValidateBy({ name: 'passwordPolicy', validator: { validate: value => validatePassword(value) === null } })
  oldPassword!: string;

  @IsString()
  @ValidateBy({ name: 'passwordPolicy', validator: { validate: value => validatePassword(value) === null } })
  newPassword!: string;
}
