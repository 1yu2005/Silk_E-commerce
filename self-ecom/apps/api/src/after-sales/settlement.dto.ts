// 作用：板块12严格命令；金额、操作者、状态与模拟结果均不接受客户端输入。
import {Transform,Type} from 'class-transformer';
import {ArrayMaxSize,ArrayMinSize,ArrayUnique,IsArray,IsBoolean,IsDateString,IsIn,IsInt,IsOptional,IsString,IsUUID,Length,Max,Min,ValidateNested} from 'class-validator';
import {AfterSaleCommandDto} from './after-sale.dto.js';
const trim=({value}:{value:unknown})=>typeof value==='string'?value.trim():value;
export class SettlementCommandDto extends AfterSaleCommandDto{
 @Transform(trim) @IsString() @Length(1,500) reason!:string;
}
export class SettlementStaffDto extends SettlementCommandDto{
 @IsInt() @Min(0) @Max(2147483646) expectedTaskVersion!:number;
}
export class PrepareReceiptDto extends SettlementCommandDto{
 @IsOptional() @IsUUID() parcelId?:string;
 @Transform(trim) @IsString() @Length(1,80) sourceNamespace!:string;
 @Transform(trim) @IsString() @Length(1,200) sourceReference!:string;
}
export class ReceiveDto extends SettlementStaffDto{
 @IsUUID() parcelId!:string;
 @IsDateString({strict:true}) receivedAt!:string;
 @Transform(trim) @IsString() @Length(1,200) goodsLocation!:string;
 @Transform(trim) @IsString() @Length(1,1000) sourceNote!:string;
 @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsUUID('all',{each:true}) evidenceFileIds!:string[];
}
export class InspectionLineDto{
 @IsUUID() orderItemId!:string;
 @IsInt() @Min(0) @Max(99) matchedReceivedQty!:number;
 @IsInt() @Min(0) @Max(99) sellableQty!:number;
 @IsInt() @Min(0) @Max(99) unsellableQty!:number;
 @Transform(trim) @IsString() @Length(1,1000) conditionNote!:string;
}
export class UnmatchedDto{
 @Transform(trim) @IsString() @Length(1,1000) description!:string;
 @IsInt() @Min(1) @Max(2147483647) quantity!:number;
 @IsIn(['WRONG_VARIANT','EXCESS','UNRELATED','UNKNOWN']) kind!:string;
 @Transform(trim) @IsString() @Length(1,200) custodyLocation!:string;
}
export class DraftDto extends SettlementStaffDto{
 @IsUUID() receiptId!:string;
 @IsInt() @Min(0) @Max(2147483646) expectedReceiptVersion!:number;
 @IsInt() @Min(0) @Max(2147483646) expectedReturnPhysicalVersion!:number;
 @IsBoolean() inspectionComplete!:boolean;
 @IsArray() @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>InspectionLineDto) items!:InspectionLineDto[];
 @IsArray() @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>UnmatchedDto) unmatchedItems!:UnmatchedDto[];
 @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsUUID('all',{each:true}) evidenceFileIds!:string[];
}
export class InspectionRefsDto extends SettlementStaffDto{
 @IsInt() @Min(0) @Max(2147483646) expectedReturnPhysicalVersion!:number;
 @IsArray() @ArrayMaxSize(200) @ArrayUnique() @IsUUID('all',{each:true}) currentRevisionRefs!:string[];
}
export class InspectionExceptionDto extends InspectionRefsDto{
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @ArrayUnique() @IsIn(['SHORTAGE','WRONG_ITEM','EMPTY_PACKAGE','UNKNOWN_QUANTITY','DAMAGED'],{each:true}) exceptionTypes!:string[];
 @Transform(trim) @IsString() @Length(1,1000) publicExplanation!:string;
}
export class MissingItemDto{
 @IsUUID() orderItemId!:string;
 @IsInt() @Min(1) @Max(99) remainingQty!:number;
}
export class ReshipmentDto extends SettlementStaffDto{
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>MissingItemDto) missingItems!:MissingItemDto[];
 @IsUUID() communicationId!:string;
 @Transform(trim) @IsString() @Length(1,1000) publicExplanation!:string;
}
export class ExceptionRefundRequestDto extends SettlementStaffDto{
 @IsUUID() communicationId!:string;
 @Transform(trim) @IsString() @Length(1,1000) publicExplanation!:string;
}
export class ApproveExceptionDto extends InspectionRefsDto{
 @IsIn(['APPROVE_FULL_REFUND']) decision!:'APPROVE_FULL_REFUND';
 @Transform(trim) @IsString() @Length(1,1000) publicExplanation!:string;
 @Transform(trim) @IsString() @Length(1,1000) responsibilityNote!:string;
}
export class FinalizeExceptionDto extends InspectionRefsDto{
 @IsUUID() approvalId!:string;
}
export class PhysicalEventDto extends SettlementStaffDto{
 @IsUUID() receiptId!:string;
 @IsInt() @Min(0) @Max(2147483646) expectedReturnPhysicalVersion!:number;
 @IsIn(['MOVE','DAMAGE','CORRECTION']) kind!:string;
 @Transform(trim) @IsString() @Length(1,200) goodsLocation!:string;
}
export class PhysicalLineDto{
 @IsUUID() orderItemId!:string;
 @IsInt() @Min(0) @Max(99) sellableQty!:number;
 @IsInt() @Min(0) @Max(99) damagedQty!:number;
 @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsUUID('all',{each:true}) incidentItemIds!:string[];
}
export class PhysicalCheckDto extends SettlementStaffDto{
 @IsInt() @Min(0) @Max(2147483646) expectedPhysicalVersion!:number;
 @IsDateString({strict:true}) stoppedAt!:string;
 @Transform(trim) @IsString() @Length(1,200) goodsLocation!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>PhysicalLineDto) items!:PhysicalLineDto[];
 @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsUUID('all',{each:true}) evidenceFileIds!:string[];
}
export class RefundDto extends SettlementStaffDto{
 @IsOptional() @IsUUID() physicalCheckId?:string;
 @IsOptional() @IsInt() @Min(0) @Max(2147483646) expectedPhysicalVersion?:number;
 @IsOptional() @IsUUID() expectedFinalInspectionId?:string;
}
export class RefundRetryDto extends RefundDto{
 @IsUUID() refundId!:string;
 @IsInt() @Min(0) @Max(2147483646) expectedRefundVersion!:number;
}
