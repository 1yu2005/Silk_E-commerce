// 作用：严格验证本人地址、购物车和管理员顾客查询/状态命令；JSON布尔及数量不做宽松转换。
import { Transform,Type } from 'class-transformer';
import { ArrayMaxSize,ArrayMinSize,IsArray,IsBoolean,IsIn,IsInt,IsISO8601,IsString,IsUUID,Length,Matches,Max,Min,ValidateIf,ValidateNested } from 'class-validator';
import { PaginationDto } from '../common/http/pagination.dto.js';
const trim=({value}:{value:unknown})=>typeof value==='string'?value.normalize('NFC').trim():value;
const optional=(_object:unknown,value:unknown)=>value!==undefined;
export class CustomerIdDto { @IsUUID() id!:string; }
export class VersionDto { @IsInt() @Min(0) @Max(2147483646) expectedVersion!:number; }
export class CustomerStatusDto extends VersionDto { @Transform(trim) @IsString() @Length(1,500) reason!:string; }
export class CustomerQueryDto extends PaginationDto {
 @ValidateIf(optional) @Transform(trim) @Matches(/^1[3-9][0-9]{9}$/) phone?:string;
 @ValidateIf(optional) @Transform(trim) @IsString() @Length(1,40) nickname?:string;
 @ValidateIf(optional) @IsIn(['NORMAL','TRADE_RESTRICTED','LOGIN_FROZEN']) status?:'NORMAL'|'TRADE_RESTRICTED'|'LOGIN_FROZEN';
 @ValidateIf(optional) @IsISO8601({strict:true}) registeredFrom?:string;
 @ValidateIf(optional) @IsISO8601({strict:true}) registeredTo?:string;
}
export class AddressCreateDto {
 @Transform(trim) @IsString() @Length(1,40) receiver!:string;
 @Transform(({value}:{value:unknown})=>typeof value==='string'?value.trim().replace(/[\s-]/g,''):value)
 @IsString() @Length(3,30) @Matches(/^\+?[0-9]+$/) phone!:string;
 @Transform(trim) @IsString() @Length(1,50) province!:string;
 @Transform(trim) @IsString() @Length(1,50) city!:string;
 @Transform(trim) @IsString() @Length(1,50) district!:string;
 @Transform(trim) @IsString() @Length(1,200) detail!:string;
 @ValidateIf(optional) @IsBoolean() isDefault?:boolean;
}
export class AddressUpdateDto extends VersionDto {
 @ValidateIf(optional) @Transform(trim) @IsString() @Length(1,40) receiver?:string;
 @ValidateIf(optional) @Transform(({value}:{value:unknown})=>typeof value==='string'?value.trim().replace(/[\s-]/g,''):value)
 @IsString() @Length(3,30) @Matches(/^\+?[0-9]+$/) phone?:string;
 @ValidateIf(optional) @Transform(trim) @IsString() @Length(1,50) province?:string;
 @ValidateIf(optional) @Transform(trim) @IsString() @Length(1,50) city?:string;
 @ValidateIf(optional) @Transform(trim) @IsString() @Length(1,50) district?:string;
 @ValidateIf(optional) @Transform(trim) @IsString() @Length(1,200) detail?:string;
 @ValidateIf(optional) @IsBoolean() isDefault?:boolean;
}
export class CartAddDto { @IsUUID() skuId!:string; @IsInt() @Min(1) @Max(99) quantity!:number; }
export class CartUpdateDto extends VersionDto {
 @ValidateIf(optional) @IsInt() @Min(1) @Max(99) quantity?:number;
 @ValidateIf(optional) @IsBoolean() selected?:boolean;
}
export class CartBatchItemDto extends VersionDto { @IsUUID() id!:string; }
export class CartBatchDto {
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>CartBatchItemDto) items!:CartBatchItemDto[];
}
export class CartSelectionDto extends CartBatchDto { @IsBoolean() selected!:boolean; }
