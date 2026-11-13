// 作用：严格校验全店完整设置；只对文本做规范化，不把字符串或布尔值转为数字。
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsInt, IsObject, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { PaginationDto } from '../common/http/pagination.dto.js';

const trimText = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
const phoneText = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  // 先限制原输入的长度和字符，再移除排版分隔符，避免规范化掩盖超长或非法输入。
  return text.length <= 30 && /^\+?[0-9][0-9 -]*$/.test(text) ? text.replace(/[ -]/g, '') : text;
};
export class ReturnAddressDto {
  @Transform(trimText) @IsString() @Length(1, 40) receiver!: string;
  @Transform(phoneText) @IsString() @Length(3, 30) @Matches(/^\+?[0-9]+$/) phone!: string;
  @Transform(trimText) @IsString() @Length(1, 50) province!: string;
  @Transform(trimText) @IsString() @Length(1, 50) city!: string;
  @Transform(trimText) @IsString() @Length(1, 50) district!: string;
  @Transform(trimText) @IsString() @Length(1, 200) detail!: string;
}
export class ServiceContactDto {
  @Transform(phoneText) @IsString() @Length(3, 30) @Matches(/^\+?[0-9]+$/) phone!: string;
  // 完整替换时省略、null和空白均表示清除可选服务时间，不保留上版的值。
  @Transform(trimText) @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString() @MaxLength(100) serviceHours?: string | null;
}
export class SettingDeadlinesDto {
  @IsInt() @Min(1) @Max(1440) paymentMinutes!: number;
  @IsInt() @Min(1) @Max(365) autoReceiptDays!: number;
  @IsInt() @Min(1) @Max(365) afterSaleWindowDays!: number;
  @IsInt() @Min(1) @Max(30) reviewWorkdays!: number;
  @IsInt() @Min(1) @Max(90) supplementDays!: number;
  @IsInt() @Min(1) @Max(90) returnShipDays!: number;
  @IsInt() @Min(1) @Max(30) inspectionWorkdays!: number;
  @IsInt() @Min(1) @Max(30) refundWorkdays!: number;
}
export class UpdateStoreSettingsDto {
  @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) expectedVersion!: number;
  @Transform(trimText) @IsString() @Length(1, 500) reason!: string;
  @IsInt() @Min(0) @Max(1000000) shippingFeeCents!: number;
  @IsBoolean() freeShippingEnabled!: boolean;
  @IsInt() @Min(0) @Max(100000000) freeShippingThresholdCents!: number;
  @IsDefined() @IsObject() @ValidateNested() @Type(() => ReturnAddressDto) returnAddress!: ReturnAddressDto;
  @IsDefined() @IsObject() @ValidateNested() @Type(() => ServiceContactDto) serviceContact!: ServiceContactDto;
  @IsDefined() @IsObject() @ValidateNested() @Type(() => SettingDeadlinesDto) deadlines!: SettingDeadlinesDto;
}
export class SettingVersionsQueryDto extends PaginationDto {}
export class SettingVersionParamsDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.toLowerCase() : value)
  @IsUUID() id!: string;
}
