// 作用：履约命令白名单；版本、UUID、全量整数数量及证据上限由后端验证。
import {Transform,Type} from 'class-transformer';
import {ArrayMaxSize,ArrayMinSize,IsArray,IsIn,IsInt,IsISO8601,IsString,IsUUID,Matches,Max,MaxLength,Min,MinLength,ValidateIf,ValidateNested} from 'class-validator';
const optional=(_o:unknown,v:unknown)=>v!==undefined;
const trim=({value}:{value:unknown})=>typeof value==='string'?value.trim():value;
export class FulfillmentCommandDto {
 @IsUUID() commandKey!:string;
 @IsInt() @Min(0) @Max(2147483646) expectedOrderVersion!:number;
 @IsInt() @Min(0) @Max(2147483646) expectedTaskVersion!:number;
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(500) reason!:string;
}
export class PackingLineDto {
 @IsUUID() orderItemId!:string;
 @IsInt() @Min(1) @Max(99) checkedQuantity!:number;
}
export class PackDto extends FulfillmentCommandDto {
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>PackingLineDto) items!:PackingLineDto[];
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) goodsLocation!:string;
 @IsInt() @Min(0) @Max(2147483646) expectedPhysicalVersion!:number;
}
export class PrepareShipmentDto extends FulfillmentCommandDto {
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(60) carrierName!:string;
 @Transform(trim) @IsString() @Matches(/^[A-Za-z0-9-]{1,100}$/) trackingNumber!:string;
}
export class StartHandoverDto extends FulfillmentCommandDto {
 @IsUUID() shipmentId!:string;
 @IsUUID() packingCheckId!:string;
 @IsInt() @Min(0) @Max(2147483646) expectedPhysicalVersion!:number;
}
export class AttemptCommandDto extends FulfillmentCommandDto {
 @IsUUID() attemptId!:string;
 @IsInt() @Min(0) @Max(2147483646) expectedAttemptVersion!:number;
}
export class ConfirmHandoverDto extends AttemptCommandDto {
 @IsISO8601({strict:true}) actualHandoverAt!:string;
}
export class EvidenceDto extends FulfillmentCommandDto {
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(2000) evidenceNote!:string;
 @ValidateIf(optional) @IsArray() @ArrayMaxSize(5) @IsUUID(undefined,{each:true}) evidenceFileIds?:string[];
}
export class AttemptEvidenceDto extends EvidenceDto {
 @IsUUID() attemptId!:string;
 @IsInt() @Min(0) @Max(2147483646) expectedAttemptVersion!:number;
}
export class ResolveHandoverDto extends EvidenceDto {
 @IsUUID() attemptId!:string;
 @IsInt() @Min(0) @Max(2147483646) expectedAttemptVersion!:number;
 @IsIn(['HANDED_OVER','NOT_HANDED_OVER','STILL_UNCERTAIN']) conclusion!:'HANDED_OVER'|'NOT_HANDED_OVER'|'STILL_UNCERTAIN';
 @ValidateIf(optional) @IsISO8601({strict:true}) actualHandoverAt?:string;
 @ValidateIf(optional) @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) goodsLocation?:string;
 @ValidateIf(optional) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>PackingLineDto) items?:PackingLineDto[];
 @ValidateIf(optional) @IsInt() @Min(0) @Max(2147483646) expectedPhysicalVersion?:number;
}
export class ShipmentExceptionDto extends EvidenceDto {
 @Transform(trim) @IsString() @MinLength(16) @MaxLength(128) incidentKey!:string;
 @IsIn(['SHORTAGE','DAMAGED','WRONG_VARIANT','OTHER']) type!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID(undefined,{each:true}) orderItemIds!:string[];
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) goodsLocation!:string;
 @ValidateIf(optional) @IsUUID() stockIncidentId?:string;
}
export class ExceptionCommandDto extends EvidenceDto {
 @IsInt() @Min(0) @Max(2147483646) expectedExceptionVersion!:number;
 @IsInt() @Min(0) @Max(2147483646) currentPhysicalVersion!:number;
}
export class CustomerConfirmationDto extends ExceptionCommandDto {
 @IsIn(['WAIT','CONTINUE','REQUEST_REFUND']) choice!:'WAIT'|'CONTINUE'|'REQUEST_REFUND';
}
export class WarehouseReadyDto extends ExceptionCommandDto {
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>PackingLineDto) items!:PackingLineDto[];
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) goodsLocation!:string;
}
export class TrackingCorrectionDto extends PrepareShipmentDto {
 @ValidateIf(optional) @Transform(trim) @IsString() @MinLength(1) @MaxLength(2000) evidenceNote?:string;
 @ValidateIf(optional) @IsArray() @ArrayMaxSize(5) @IsUUID(undefined,{each:true}) evidenceFileIds?:string[];
}
export class ClaimShipmentDto {
 @IsInt() @Min(0) @Max(2147483646) expectedOrderVersion!:number;
 @IsInt() @Min(0) @Max(2147483646) expectedTaskVersion!:number;
}
