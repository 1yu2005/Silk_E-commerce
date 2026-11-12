// 作用：校验注册手机号、密码及可选昵称，不接受额外身份或状态字段。
import { Transform } from 'class-transformer';
import { IsString, Length, Matches, ValidateBy, ValidateIf } from 'class-validator';
import { validatePassword } from '@shop/shared';

export class CustomerRegisterDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Matches(/^1[3-9][0-9]{9}$/)
  phone!: string;

  @IsString()
  @ValidateBy({ name: 'passwordPolicy', validator: { validate: value => validatePassword(value) === null } })
  password!: string;

  // 只允许省略；显式null、空白及非字符串仍须校验失败。
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 40)
  nickname?: string;
}
