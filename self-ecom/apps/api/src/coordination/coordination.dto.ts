// 作用：改址和协助申请仅接受业务诉求，禁止修改订单地址、金额、状态或操作者。
import {Type,Transform} from 'class-transformer';
import {ArrayMaxSize,ArrayUnique,IsArray,IsIn,IsInt,IsOptional,IsString,IsUUID,Length,Max,Min,ValidateNested} from 'class-validator';
import {PackingLineDto} from '../orders/fulfillment.dto.js';
const trim=({value}:{value:unknown})=>typeof value==='string'?value.trim():value;
export class CoordinationCommandDto {
 @IsUUID() commandKey!:string;
 @IsInt() @Min(0) @Max(2147483646) expectedOrderVersion!:number;
 @Transform(trim) @IsString() @Length(1,500) reason!:string;
}
export class ProposedAddressDto {
 @Transform(trim) @IsString() @Length(1,40) receiver!:string;
 @Transform(trim) @IsString() @Length(1,30) phone!:string;
 @Transform(trim) @IsString() @Length(1,40) province!:string;
 @Transform(trim) @IsString() @Length(1,40) city!:string;
 @Transform(trim) @IsString() @Length(1,40) district!:string;
 @Transform(trim) @IsString() @Length(1,200) detail!:string;
}
export class CreateAddressRequestDto extends CoordinationCommandDto {
 @IsUUID() communicationId!:string;
 @IsOptional() @ValidateNested() @Type(()=>ProposedAddressDto) proposedAddress?:ProposedAddressDto;
}
export class AddressCommandDto extends CoordinationCommandDto {
 @IsInt() @Min(0) @Max(2147483646) expectedRequestVersion!:number;
 @IsInt() @Min(0) @Max(2147483646) expectedTaskVersion!:number;
 @IsUUID() communicationId!:string;
}
export class VerifyAddressPhysicalDto extends CoordinationCommandDto {
 @IsInt() @Min(0) @Max(2147483646) expectedRequestVersion!:number;
 @IsInt() @Min(0) @Max(2147483646) expectedTaskVersion!:number;
 @IsInt() @Min(0) @Max(2147483646) expectedPhysicalVersion!:number;
 @Transform(trim) @IsString() @Length(1,200) goodsLocation!:string;
 @IsArray() @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>PackingLineDto) items!:PackingLineDto[];
}
export class ContinueAddressDto extends AddressCommandDto {
 @IsUUID() physicalVerificationId!:string;
 @IsIn(['CONTINUE_ORIGINAL']) customerConsent!:'CONTINUE_ORIGINAL';
}
export class AddressOfflineDto extends AddressCommandDto {
 @IsIn(['FORWARDING']) caseType!:'FORWARDING';
 @Transform(trim) @IsString() @Length(1,1000) publicSummary!:string;
}
export class AssistedAfterSaleDto extends CoordinationCommandDto {
 @IsInt() @Min(0) @Max(2147483646) expectedTaskVersion!:number;
 @IsUUID() communicationId!:string;
 @IsIn(['REFUND_FULL']) customerConsent!:'REFUND_FULL';
 @IsIn(['REFUND_ONLY','RETURN_REFUND']) type!:'REFUND_ONLY'|'RETURN_REFUND';
 @IsIn(['NOT_WANTED','QUALITY','WRONG_ITEM','DAMAGED','OTHER']) reasonCode!:string;
 @Transform(trim) @IsString() @Length(1,2000) description!:string;
 @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsUUID('all',{each:true}) evidenceFileIds!:string[];
 @IsOptional() @IsUUID() proxyContextId?:string;
 @IsOptional() @IsInt() @Min(0) @Max(2147483646) expectedProxyTaskVersion?:number;
 @IsOptional() @IsUUID() physicalVerificationId?:string;
 @IsOptional() @IsInt() @Min(0) @Max(2147483646) expectedRequestVersion?:number;
 @IsOptional() @IsInt() @Min(0) @Max(2147483646) expectedExceptionVersion?:number;
 @IsOptional() @IsUUID() exceptionId?:string;
}
export class CoordinationFollowupDto extends CoordinationCommandDto {
 @IsIn(['ADDRESS_REQUEST','SHIPMENT_EXCEPTION','STOCK_EXCEPTION']) sourceType!:'ADDRESS_REQUEST'|'SHIPMENT_EXCEPTION'|'STOCK_EXCEPTION';
 @IsUUID() sourceId!:string;
}
