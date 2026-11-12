// 作用：将顾客本人资料修改限制为合法昵称，禁止修改账号或状态字段。
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

export class CustomerProfileDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 40)
  nickname!: string;
}
