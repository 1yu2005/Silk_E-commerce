// 作用：定义列表接口共用的严格分页输入、默认值及安全整数范围。
import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { strictInteger } from './dto-transforms.js';

export class PaginationDto {
  @Transform(({ value }: { value: unknown }) => strictInteger(value))
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page = 1;

  @Transform(({ value }: { value: unknown }) => strictInteger(value))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
