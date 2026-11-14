// 作用：库存HTTP请求严格校验；数量和来源关系仍由事务内领域规则复核。
import { Type } from 'class-transformer';
import type { InventoryAdjustmentType } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested } from 'class-validator';
export class InventoryIdDto { @IsUUID() id!:string; }
export class InventorySkuIdDto { @IsUUID() skuId!:string; }
export class InventoryVersionDto { @IsInt() @Min(0) @Max(2147483646) expectedVersion!:number; }
export class InventoryReasonDto extends InventoryVersionDto { @IsString() @Length(1,500) reason!:string; }
export class InventoryEvidenceDto {
 @IsOptional() @IsString() @Length(1,2000) evidenceNote?:string;
 @IsOptional() @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsUUID('all',{each:true}) evidenceFileIds?:string[];
}
export class SourceLineDto {
 @IsString() @Length(1,64) lineKey!:string; @IsUUID() skuId!:string;
 @IsInt() @Min(1) @Max(2147483647) verifiedQuantity!:number;
}
export class SourceCreateDto {
 @IsIn(['RECEIPT','LOSS']) sourceType!:'RECEIPT'|'LOSS';
 @IsString() @Length(1,80) namespace!:string; @IsOptional() @IsString() @Length(1,100) reference?:string;
 @IsOptional() @IsString() @Length(1,2000) note?:string;
 @IsOptional() @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsUUID('all',{each:true}) evidenceFileIds?:string[];
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({each:true}) @Type(()=>SourceLineDto) lines!:SourceLineDto[];
}
export class SourceAddLineDto extends SourceLineDto {
 @IsInt() @Min(0) @Max(2147483646) expectedSourceVersion!:number;
 @IsString() @Length(1,500) reason!:string;
}
export class SourceVerifyDto extends InventoryReasonDto {
 @IsInt() @Min(1) @Max(2147483647) verifiedQuantity!:number;
 @IsString() @Length(1,2000) evidenceNote!:string;
 @IsOptional() @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsUUID('all',{each:true}) evidenceFileIds?:string[];
}
export class AdjustmentLineDto {
 @IsUUID() skuId!:string; @IsUUID() sourceLineId!:string;
 @IsOptional() @IsString() @Length(1,80) batchKey?:string;
 @IsInt() @Min(1) @Max(2147483647) quantity!:number;
}
export class AdjustmentCreateDto extends InventoryEvidenceDto {
 @IsIn(['INITIALIZATION','ARRIVAL','AVAILABLE_LOSS']) type!:'INITIALIZATION'|'ARRIVAL'|'AVAILABLE_LOSS';
 @IsString() @Length(1,500) reason!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>AdjustmentLineDto) lines!:AdjustmentLineDto[];
}
export class AdjustmentEditLineDto {
 @IsOptional() @IsUUID() skuId?:string; @IsOptional() @IsUUID() sourceLineId?:string;
 @IsOptional() @IsString() @Length(1,80) batchKey?:string;
 @IsOptional() @IsInt() @Min(1) @Max(2147483647) quantity?:number;
 @IsOptional() @IsUUID() rootLineId?:string;
 @IsOptional() @IsInt() @Min(-2147483647) @Max(2147483647) signedDeltaA?:number;
}
export class AdjustmentEditDto extends InventoryEvidenceDto {
 @IsInt() @Min(0) @Max(2147483646) expectedVersion!:number;
 @IsString() @Length(1,500) reason!:string;
 @IsIn(['INITIALIZATION','ARRIVAL','AVAILABLE_LOSS','CORRECTION']) type!:InventoryAdjustmentType;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({each:true}) @Type(()=>AdjustmentEditLineDto) lines!:AdjustmentEditLineDto[];
}
export class CorrectionLineDto { @IsUUID() rootLineId!:string; @IsInt() @Min(-2147483647) @Max(2147483647) signedDeltaA!:number; }
export class CorrectionCreateDto extends InventoryEvidenceDto {
 @IsString() @Length(1,500) reason!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>CorrectionLineDto) lines!:CorrectionLineDto[];
}
export class AdjustmentCommandDto extends InventoryVersionDto { @IsInt() @Min(0) @Max(2147483646) expectedTaskVersion!:number; }
export class AdjustmentVoidDto extends AdjustmentCommandDto { @IsString() @Length(1,500) reason!:string; }
export class AdjustmentResolveDto extends AdjustmentVoidDto {
 @IsString() @Length(1,2000) evidenceNote!:string;
 @IsOptional() @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsUUID('all',{each:true}) evidenceFileIds?:string[];
}
export class InitialMappingDto { @IsUUID() skuId!:string; @IsUUID() sourceLineId!:string; @IsString() @Length(1,80) batchKey!:string; }
export class InitialConvertDto extends InventoryEvidenceDto {
 @IsInt() @Min(0) @Max(2147483646) expectedProductVersion!:number;
 @IsInt() @Min(0) @Max(2147483646) expectedDraftVersion!:number;
 @IsUUID() sourceId!:string; @IsString() @Length(1,500) reason!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({each:true}) @Type(()=>InitialMappingDto) mappings!:InitialMappingDto[];
}
export class InventoryThresholdDto extends InventoryReasonDto { @IsInt() @Min(0) @Max(2147483647) threshold!:number; }
export class InventoryQueryDto {
 @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(1000000) page=1;
 @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(100) pageSize=20;
 @IsOptional() @IsString() @Length(1,120) keyword?:string;
 @IsOptional() @IsUUID() skuId?:string;
 @IsOptional() @IsIn(['true','false']) lowStock?:string;
 @IsOptional() @IsIn(['true','false']) purchaseBlocked?:string;
 @IsOptional() @IsIn(['RECEIPT','LOSS']) sourceType?:'RECEIPT'|'LOSS';
 @IsOptional() @IsIn(['PENDING','POSTED','VOID']) status?:'PENDING'|'POSTED'|'VOID';
 @IsOptional() @IsIn(['INITIALIZATION','ARRIVAL','AVAILABLE_LOSS','CORRECTION']) type?:'INITIALIZATION'|'ARRIVAL'|'AVAILABLE_LOSS'|'CORRECTION';
 @IsOptional() @IsUUID() assigneeId?:string;
 @IsOptional() @IsIn(['INITIALIZATION','ARRIVAL','AVAILABLE_LOSS','CORRECTION','RESERVE','PAY','CLOSE','RETURN_RESTOCK','UNSHIPPED_REFUND_RESTOCK','PAID_PREPARATION_LOSS','ALLOCATE_REPLACEMENT']) eventType?:string;
 @IsOptional() @IsString() @Length(1,64) businessNumber?:string;
 @IsOptional() @IsUUID() actorEmployeeId?:string;
 @IsOptional() @IsISO8601({strict:true}) from?:string;
 @IsOptional() @IsISO8601({strict:true}) to?:string;
}
