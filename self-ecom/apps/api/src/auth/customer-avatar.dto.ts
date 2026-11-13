// 作用：头像设置只接受一个文件UUID，不接受目标顾客ID、任意URL或文件公开性。
import { IsUUID } from 'class-validator';
export class CustomerAvatarDto {
  @IsUUID('all')
  fileId!: string;
}
