// 作用：商品接口的严格白名单；数量、金额不从字符串强制转换，查询参数单独转换。
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { PaginationDto } from '../common/http/pagination.dto.js';
import { strictBoolean, strictInteger } from '../common/http/dto-transforms.js';
import { catalogIcons } from './catalog.rules.js';
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
const present = (_: unknown, v: unknown) => v !== undefined;
const nonnull = (_: unknown, v: unknown) => v !== undefined && v !== null;
export class CatalogIdDto { @IsUUID() id!: string }
export class SkuIdDto extends CatalogIdDto { @IsUUID() skuId!: string }
export class VersionDto { @IsInt() @Min(0) @Max(2147483646) expectedVersion!: number }
export class ReasonDto extends VersionDto { @Transform(trim) @IsString() @Length(1,500) reason!: string }
export class CategoryCreateDto {
  @Transform(trim) @IsString() @Length(1,50) name!: string;
  @ValidateIf(nonnull) @IsUUID() parentId?: string | null;
  @ValidateIf(nonnull) @IsIn(catalogIcons) iconKey?: string | null;
  @ValidateIf(present) @IsInt() @Min(0) @Max(1000000) sortOrder?: number;
}
export class CategoryEditDto extends VersionDto {
  @ValidateIf(present) @Transform(trim) @IsString() @Length(1,50) name?: string;
  @ValidateIf(nonnull) @IsIn(catalogIcons) iconKey?: string | null;
  @ValidateIf(present) @IsInt() @Min(0) @Max(1000000) sortOrder?: number;
}
export class CategoryMoveDto extends ReasonDto { @ValidateIf((_,v) => v !== null) @IsUUID() parentId!: string | null }
export class ProductCreateDto {
  @Transform(trim) @IsString() @Length(1,120) name!: string;
  @ValidateIf(nonnull) @Transform(trim) @IsString() @MaxLength(80) brand?: string | null;
  @ValidateIf(nonnull) @Transform(trim) @IsString() @MaxLength(20000) description?: string | null;
  @ValidateIf(nonnull) @IsUUID() categoryId?: string | null;
}
export class ProductEditDto extends VersionDto {
  @ValidateIf(present) @Transform(trim) @IsString() @Length(1,120) name?: string;
  @ValidateIf(nonnull) @Transform(trim) @IsString() @MaxLength(80) brand?: string | null;
  @ValidateIf(nonnull) @Transform(trim) @IsString() @MaxLength(20000) description?: string | null;
  @ValidateIf(nonnull) @IsUUID() categoryId?: string | null;
}
export class ProductImagesDto extends VersionDto {
  @ValidateIf((_,v) => v !== null) @IsUUID() mainImageId!: string | null;
  @IsArray() @ArrayMaxSize(10) @ArrayUnique() @IsUUID(undefined,{each:true}) galleryImageIds!: string[];
}
export class SpecValueDto {
  @ValidateIf(present) @IsUUID() id?: string;
  @ValidateIf(present) @IsUUID() clientKey?: string;
  @Transform(trim) @IsString() @Length(1,30) name!: string;
}
export class SpecDimensionDto extends SpecValueDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({each:true}) @Type(() => SpecValueDto) values!: SpecValueDto[];
}
export class SchemePreviewDto { @IsArray() @ArrayMaxSize(3) @ValidateNested({each:true}) @Type(() => SpecDimensionDto) dimensions!: SpecDimensionDto[] }
export class SchemeSaveDto extends ReasonDto {
  @IsIn(['APPEND','REBUILD']) mode!: 'APPEND'|'REBUILD';
  @IsArray() @ArrayMaxSize(3) @ValidateNested({each:true}) @Type(() => SpecDimensionDto) dimensions!: SpecDimensionDto[];
}
export class SkuEditDto extends VersionDto {
  @ValidateIf(present) @Transform(({value}:{value:unknown}) => typeof value==='string' ? value.trim().toUpperCase() : value) @IsString() @Length(1,64) code?: string;
  @ValidateIf(nonnull) @IsInt() @Min(1) @Max(1000000) priceCents?: number|null;
  @ValidateIf(nonnull) @IsInt() @Min(0) @Max(1000000) costCents?: number|null;
}
export class SkuBatchDto extends VersionDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ArrayUnique() @IsUUID(undefined,{each:true}) skuIds!: string[];
  @ValidateIf(nonnull) @IsInt() @Min(1) @Max(1000000) priceCents?: number|null;
  @ValidateIf(nonnull) @IsInt() @Min(0) @Max(1000000) costCents?: number|null;
}
export class SkuEnabledDto extends ReasonDto { @IsBoolean() enabled!: boolean }
export class DraftLineDto { @IsUUID() skuId!: string; @IsInt() @Min(0) @Max(2147483647) quantity!: number }
export class DraftSaveDto {
  @IsInt() @Min(0) @Max(2147483646) expectedProductVersion!: number;
  @ValidateIf((_,v) => v !== null) @IsInt() @Min(0) @Max(2147483646) expectedDraftVersion!: number|null;
  @IsArray() @ArrayMaxSize(200) @ValidateNested({each:true}) @Type(() => DraftLineDto) lines!: DraftLineDto[];
}
export class DraftVoidDto {
  @IsInt() @Min(0) @Max(2147483646) expectedProductVersion!: number;
  @IsInt() @Min(0) @Max(2147483646) expectedDraftVersion!: number;
  @Transform(trim) @IsString() @Length(1,500) reason!: string;
}
export class BatchItemDto extends VersionDto { @IsUUID() id!: string }
export class BatchStatusDto {
  @IsIn(['PUBLISH','UNPUBLISH']) action!: 'PUBLISH'|'UNPUBLISH';
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(() => BatchItemDto) items!: BatchItemDto[];
  @Transform(trim) @IsString() @Length(1,500) reason!: string;
}
export class StoreProductsQueryDto extends PaginationDto {
  @ValidateIf(present) @Transform(trim) @IsString() @MaxLength(50) keyword?: string;
  @ValidateIf(present) @IsUUID() categoryId?: string;
  @ValidateIf(present) @IsIn(['NEWEST','PRICE_ASC','PRICE_DESC','SALES_DESC']) sort?: 'NEWEST'|'PRICE_ASC'|'PRICE_DESC'|'SALES_DESC';
}
export class AdminProductsQueryDto extends StoreProductsQueryDto {
  @ValidateIf(present) @IsIn(['DRAFT','ON_SALE','OFF_SALE']) status?: 'DRAFT'|'ON_SALE'|'OFF_SALE';
  @ValidateIf(present) @Transform(({value}:{value:unknown}) => strictBoolean(value)) @IsBoolean() archived?: boolean;
  @ValidateIf(present) @Transform(({value}:{value:unknown}) => strictInteger(value)) @IsInt() @Min(1) @Max(1000000) minPriceCents?: number;
  @ValidateIf(present) @Transform(({value}:{value:unknown}) => strictInteger(value)) @IsInt() @Min(1) @Max(1000000) maxPriceCents?: number;
}
