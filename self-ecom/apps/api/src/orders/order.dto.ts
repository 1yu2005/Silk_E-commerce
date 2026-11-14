// 作用：写命令只接受明确业务字段，不接受客户端金额/状态/操作者/库存差额。
import {Transform,Type} from 'class-transformer';
import {ArrayMaxSize,ArrayMinSize,ArrayUnique,IsArray,IsBoolean,IsIn,IsInt,IsISO8601,IsString,IsUUID,Length,Max,Min,ValidateIf,ValidateNested} from 'class-validator';
import {PaginationDto} from '../common/http/pagination.dto.js';
import {ORDER_STATUSES} from './order.rules.js';
const optional=(_o:unknown,v:unknown)=>v!==undefined;
const trim=({value}:{value:unknown})=>typeof value==='string'?value.normalize('NFC').trim():value;
export class OrderIdDto {@IsUUID() id!:string;}
export class PurchaseItemDto {@IsUUID() cartItemId!:string;@IsUUID() skuId!:string;@IsInt() @Min(1) @Max(99) quantity!:number;}
export class PreviewDto {@IsUUID() addressId!:string;@IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>PurchaseItemDto) items!:PurchaseItemDto[];}
export class CreateOrderDto extends PreviewDto {@IsUUID() quoteId!:string;}
export class SkuIdDto {@IsUUID() skuId!:string;}
export class IncidentQueryDto extends PaginationDto {@ValidateIf(optional) @IsUUID() skuId?:string;}
export class CommunicationAttachmentDto {@IsUUID() fileId!:string;@IsIn(['INTERNAL','CUSTOMER_VISIBLE']) audience!:'INTERNAL'|'CUSTOMER_VISIBLE';}
export class CommunicationDto {
 @IsIn(['ORDER','AFTER_SALE']) scopeType!:'ORDER'|'AFTER_SALE';@IsUUID() scopeId!:string;
 @IsIn(['PHONE','EXTERNAL_MESSAGE','IN_PERSON','OTHER']) channel!:'PHONE'|'EXTERNAL_MESSAGE'|'IN_PERSON'|'OTHER';@IsISO8601({strict:true}) occurredAt!:string;
 @Transform(trim) @IsString() @Length(1,4000) result!:string;
 @ValidateIf(optional) @Transform(trim) @IsString() @Length(1,1000) nextStep?:string;
 @ValidateIf(optional) @Transform(trim) @IsString() @Length(1,2000) publicText?:string;
 @ValidateIf(optional) @IsUUID() correctsId?:string;@ValidateIf(optional) @Transform(trim) @IsString() @Length(1,500) correctionReason?:string;
 @ValidateIf(optional) @IsArray() @ArrayMaxSize(5) @ValidateNested({each:true}) @Type(()=>CommunicationAttachmentDto) attachments?:CommunicationAttachmentDto[];
}
export class CancelOrderDto {@ValidateIf(optional) @Transform(trim) @IsString() @Length(1,500) reason?:string;}
export class CloseOrderDto {@IsInt() @Min(0) @Max(2147483646) expectedVersion!:number;@Transform(trim) @IsString() @Length(1,500) reason!:string;}
export class OrderQueryDto extends PaginationDto {
 @ValidateIf(optional) @IsIn(ORDER_STATUSES) status?:string;
 @ValidateIf(optional) @Transform(({value}:{value:unknown})=>value==='true'?true:value==='false'?false:value) @IsBoolean() afterSaleOnly?:boolean;
 @ValidateIf(optional) @IsString() @Length(1,64) number?:string;
 @ValidateIf(optional) @IsUUID() customerId?:string;
 @ValidateIf(optional) @Transform(trim) @IsString() @Length(1,100) receiverKeyword?:string;
 @ValidateIf(optional) @IsISO8601({strict:true}) from?:string;
 @ValidateIf(optional) @IsISO8601({strict:true}) to?:string;
}
export class IncidentLineDto {@IsUUID() orderItemId!:string;@ValidateIf(optional) @IsInt() @Min(0) @Max(99) damagedQuantity?:number;}
export class IncidentCreateDto {
 @IsString() @Length(16,128) incidentKey!:string;@IsUUID() skuId!:string;
 @ValidateIf(optional) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>IncidentLineDto) items?:IncidentLineDto[];
 @Transform(trim) @IsString() @Length(1,500) reason!:string;@Transform(trim) @IsString() @Length(1,2000) evidenceNote!:string;
 @ValidateIf(optional) @IsArray() @ArrayMaxSize(5) @IsUUID('all',{each:true}) evidenceFileIds?:string[];
}
export class IncidentVerifyLineDto extends IncidentLineDto {@IsInt() @Min(0) @Max(99) declare damagedQuantity:number;@IsIn(['DAMAGED','INTACT','WAIT_REPLACEMENT']) conclusion!:'DAMAGED'|'INTACT'|'WAIT_REPLACEMENT';}
export class IncidentTaskVersionDto {@IsUUID() taskId!:string;@IsInt() @Min(0) @Max(2147483646) expectedVersion!:number;}
export class IncidentCommandDto extends CloseOrderDto {
 @IsUUID() commandKey!:string;@IsInt() @Min(0) @Max(2147483646) expectedTaskVersion!:number;
 @ValidateIf(optional) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10000) @ArrayUnique((v:IncidentTaskVersionDto)=>v.taskId) @ValidateNested({each:true}) @Type(()=>IncidentTaskVersionDto) taskVersions?:IncidentTaskVersionDto[];
 @Transform(trim) @IsString() @Length(1,2000) evidenceNote!:string;
}
export class IncidentVerifyDto extends IncidentCommandDto {@IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>IncidentVerifyLineDto) items!:IncidentVerifyLineDto[];}
export class ReplenishmentDto {
 @IsUUID() orderItemId!:string;@IsUUID() commandKey!:string;@IsInt() @Min(1) @Max(99) quantity!:number;
 @IsInt() @Min(0) @Max(2147483646) expectedIncidentVersion!:number;@IsInt() @Min(0) @Max(2147483646) expectedOrderVersion!:number;
 @IsInt() @Min(0) @Max(2147483646) expectedPhysicalVersion!:number;@IsInt() @Min(0) @Max(2147483646) expectedTaskVersion!:number;
 @Transform(trim) @IsString() @Length(1,500) goodsLocation!:string;@Transform(trim) @IsString() @Length(1,500) reason!:string;
 @Transform(trim) @IsString() @Length(1,2000) evidenceNote!:string;
}
