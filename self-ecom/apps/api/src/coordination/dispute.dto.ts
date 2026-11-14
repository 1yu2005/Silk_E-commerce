// 作用：受限结案的版本、当前实物和任务输入；不接受force或自报终态。
import {Type,Transform} from 'class-transformer';
import {ArrayMaxSize,ArrayUnique,IsArray,IsDateString,IsIn,IsInt,IsOptional,IsString,IsUUID,Length,Max,Min,ValidateNested} from 'class-validator';
const trim=({value}:{value:unknown})=>typeof value==='string'?value.trim():value;
export class DisputeCommandDto{
 @IsUUID() commandKey!:string;
 @IsInt() @Min(0) @Max(2147483646) expectedAfterSaleVersion!:number;
 @IsInt() @Min(0) @Max(2147483646) expectedOrderVersion!:number;
 @Transform(trim) @IsString() @Length(1,500) reason!:string;
}
export class DisputeRequestDto extends DisputeCommandDto{
 @IsIn(['CLOSE_WITH_CUSTODY','STOP_UNSHIPPED_REFUND','OTHER_DISPUTE']) kind!:string;
 @IsUUID() communicationId!:string;
 @IsInt() @Min(0) @Max(2147483646) expectedTaskVersion!:number;
 @IsInt() @Min(0) @Max(2147483646) expectedPhysicalVersion!:number;
 @IsInt() @Min(0) @Max(2147483646) expectedReturnPhysicalVersion!:number;
 @Transform(trim) @IsString() @Length(1,2000) proposal!:string;
 @Transform(trim) @IsString() @Length(1,1000) publicExplanation!:string;
}
export class CustodyItemDto{
 @IsOptional() @IsUUID() orderItemId?:string;
 @IsOptional() @IsUUID() returnReceiptId?:string;
 @IsOptional() @IsUUID() unmatchedItemId?:string;
 @Transform(trim) @IsString() @Length(1,1000) description!:string;
 @IsInt() @Min(0) @Max(2147483647) quantity!:number;
 @IsIn(['KEEP_IN_CUSTODY','RETURN_TO_CUSTOMER','IN_TRANSIT_UNRECEIVED','NO_GOODS']) disposition!:string;
 @IsOptional() @IsUUID() custodianEmployeeId?:string;
 @Transform(trim) @IsString() @Length(0,200) location!:string;
 @Transform(trim) @IsString() @Length(1,1000) plannedAction!:string;
 @IsOptional() @IsDateString({strict:true}) nextFollowAt?:string;
}
export class CloseDecisionDto extends DisputeCommandDto{
 @IsUUID() disputeRequestId!:string;
 @IsIn(['CLOSE_BEFORE_FINAL_INSPECTION','STOP_UNSHIPPED_REFUND']) decision!:string;
 @IsInt() @Min(0) @Max(2147483646) expectedTaskVersion!:number;
 @IsInt() @Min(0) @Max(2147483646) expectedPhysicalVersion!:number;
 @IsInt() @Min(0) @Max(2147483646) expectedReturnPhysicalVersion!:number;
 @IsOptional() @IsUUID() physicalCheckId?:string;
 @IsOptional() @IsUUID() approvalId?:string;
 @IsArray() @ArrayMaxSize(300) @ValidateNested({each:true}) @Type(()=>CustodyItemDto) custodyItems!:CustodyItemDto[];
 @Transform(trim) @IsString() @Length(1,1000) publicExplanation!:string;
 @Transform(trim) @IsString() @Length(1,2000) evidenceSummary!:string;
 @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsUUID('all',{each:true}) evidenceFileIds!:string[];
}
export class CustodyCorrectionFollowupDto{
 @IsUUID() commandKey!:string;
 @IsInt() @Min(0) @Max(2147483646) expectedArrangementVersion!:number;
 @Transform(trim) @IsString() @Length(1,500) reason!:string;
}
export class CustodyEventDto{
 @IsUUID() commandKey!:string;
 @IsInt() @Min(0) @Max(2147483646) expectedArrangementVersion!:number;
 @IsInt() @Min(0) @Max(2147483646) expectedTaskVersion!:number;
 @IsIn(['HANDOVER','RETURN_DISPATCH','RECEIPT_CONFIRMED','LOCATION_CHANGED','EXCEPTION','CORRECTION']) kind!:string;
 @IsDateString({strict:true}) occurredAt!:string;
 @IsInt() @Min(0) @Max(2147483647) quantity!:number;
 @IsOptional() @Transform(trim) @IsString() @Length(1,60) carrier?:string;
 @IsOptional() @Transform(trim) @IsString() @Length(1,100) tracking?:string;
 @IsOptional() @Transform(trim) @IsString() @Length(1,200) location?:string;
 @IsOptional() @IsUUID() correctsEventId?:string;
 @Transform(trim) @IsString() @Length(1,2000) evidenceNote!:string;
 @IsOptional() @Transform(trim) @IsString() @Length(1,1000) publicText?:string;
 @Transform(trim) @IsString() @Length(1,500) reason!:string;
 @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsUUID('all',{each:true}) evidenceFileIds!:string[];
}
