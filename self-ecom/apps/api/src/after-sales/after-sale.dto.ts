// 作用：严格白名单输入；金额、数量与操作者由服务端读取。
import {Transform} from 'class-transformer';
import {ArrayMaxSize,ArrayUnique,IsArray,IsBoolean,IsDateString,IsIn,IsInt,IsOptional,IsString,IsUUID,Length,Matches,Max,Min} from 'class-validator';
import {PaginationDto} from '../common/http/pagination.dto.js';
import {afterSaleStatuses} from './after-sale.rules.js';
const trim=({value}:{value:unknown})=>typeof value==='string'?value.trim():value;
export class ApplyAfterSaleDto{
 @IsUUID() orderId!:string;
 @IsIn(['REFUND_ONLY','RETURN_REFUND']) type!:'REFUND_ONLY'|'RETURN_REFUND';
 @IsIn(['NOT_WANTED','QUALITY','WRONG_ITEM','DAMAGED','OTHER']) reasonCode!:string;
 @Transform(trim) @IsString() @Length(1,2000) description!:string;
 @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsUUID('all',{each:true}) evidenceFileIds!:string[];
 @IsUUID() commandKey!:string;
}
export class AfterSaleCommandDto{
 @IsUUID() commandKey!:string;
 @IsInt() @Min(0) @Max(2147483646) expectedAfterSaleVersion!:number;
}
export class AfterSaleStaffCommandDto extends AfterSaleCommandDto{
 @IsInt() @Min(0) @Max(2147483646) expectedTaskVersion!:number;
}
export class SupplementDto extends AfterSaleCommandDto{
 @IsUUID() supplementRequestId!:string;
 @Transform(trim) @IsString() @Length(1,2000) description!:string;
 @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsUUID('all',{each:true}) evidenceFileIds!:string[];
}
export class ReviewDto extends AfterSaleStaffCommandDto{
 @IsIn(['APPROVE','REJECT','REQUEST_SUPPLEMENT']) decision!:'APPROVE'|'REJECT'|'REQUEST_SUPPLEMENT';
 @Transform(trim) @IsString() @Length(1,1000) publicExplanation!:string;
 @IsOptional() @Transform(trim) @IsString() @Length(1,1000) requirement?:string;
 @IsOptional() @Transform(trim) @IsString() @Length(1,2000) internalNote?:string;
 @IsOptional() @IsIn(['CUSTOMER','MERCHANT','UNDETERMINED']) returnFreightResponsibility?:string;
 @IsOptional() @Transform(trim) @IsString() @Length(1,1000) responsibilityNote?:string;
}
export class ReturnLogisticsDto extends AfterSaleCommandDto{
 @IsOptional() @IsUUID() parcelId?:string;
 @IsOptional() @IsInt() @Min(1) expectedParcelRevision?:number;
 @Transform(trim) @IsString() @Length(1,60) carrierName!:string;
 @Transform(trim) @Matches(/^[A-Za-z0-9-]{1,100}$/) trackingNumber!:string;
 @IsIn(['NOT_YET_SENT','DECLARED_SENT']) dispatchDeclaration!:'NOT_YET_SENT'|'DECLARED_SENT';
 @IsOptional() @IsDateString({strict:true}) actualDispatchedAt?:string;
 @Transform(trim) @IsString() @Length(1,2000) description!:string;
 @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsUUID('all',{each:true}) dispatchEvidenceFileIds!:string[];
}
export class ReturnVerificationDto extends AfterSaleStaffCommandDto{
 @IsOptional() @IsUUID() parcelId?:string;
 @IsOptional() @IsUUID() basedLogisticsRevisionId?:string;
 @IsIn(['NOT_SENT','IN_TRANSIT','UNCERTAIN']) outcome!:'NOT_SENT'|'IN_TRANSIT'|'UNCERTAIN';
 @IsIn(['PHONE','OTHER_OFFLINE']) channel!:'PHONE'|'OTHER_OFFLINE';
 @IsDateString({strict:true}) verifiedAt!:string;
 @Transform(trim) @IsString() @Length(1,2000) sourceDescription!:string;
 @Transform(trim) @IsString() @Length(1,2000) contactResult!:string;
 @Transform(trim) @IsString() @Length(1,1000) nextStep!:string;
 @Transform(trim) @IsString() @Length(1,1000) publicExplanation!:string;
 @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsUUID('all',{each:true}) evidenceFileIds!:string[];
}
export class CloseAfterSaleDto extends AfterSaleStaffCommandDto{
 @IsOptional() @IsUUID() dispatchVerificationId?:string;
 @Transform(trim) @IsString() @Length(1,500) reason!:string;
 @Transform(trim) @IsString() @Length(1,1000) publicExplanation!:string;
 @IsOptional() @IsUUID() contactRecordId?:string;
}
export class ConfirmNoReturnDto extends AfterSaleStaffCommandDto{
 @IsUUID() relatedHandoverAttemptId!:string;
 @IsUUID() communicationId!:string;
 @Transform(trim) @IsString() @Length(1,1000) publicExplanation!:string;
 @Transform(trim) @IsString() @Length(1,500) reason!:string;
}
export class AfterSaleQueryDto extends PaginationDto{
 @IsOptional() @IsIn(afterSaleStatuses) status?:string;
 @IsOptional() @IsIn(['REFUND_ONLY','RETURN_REFUND']) type?:string;
 @IsOptional() @IsUUID() orderId?:string;
 @IsOptional() @IsUUID() assigneeId?:string;
 @IsOptional() @IsString() @Length(1,64) orderNo?:string;
 @IsOptional() @Transform(({value})=>value==='true'?true:value==='false'?false:value) @IsBoolean() overdue?:boolean;
}
