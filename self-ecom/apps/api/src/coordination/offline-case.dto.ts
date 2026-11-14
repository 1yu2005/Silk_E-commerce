// 作用：线下金额只接受整数分，拒绝客户端夹带系统退款、库存和操作者字段。
import {Transform} from 'class-transformer';
import {ArrayMaxSize,ArrayUnique,IsArray,IsBoolean,IsDateString,IsIn,IsInt,IsOptional,IsString,IsUUID,Length,Matches,Max,Min} from 'class-validator';
import {PaginationDto} from '../common/http/pagination.dto.js';
import {offlineCaseTypes,offlineCaseStatuses,offlineEventKinds,offlineChannels} from './offline-case.rules.js';
const trim=({value}:{value:unknown})=>typeof value==='string'?value.trim():value;
export class CreateOfflineCaseDto{
 @IsUUID() orderId!:string;
 @IsIn(offlineCaseTypes) type!:string;
 @IsOptional() @IsUUID() afterSaleId?:string;
 @IsOptional() @IsUUID() addressRequestId?:string;
 @IsOptional() @IsUUID() disputeDecisionId?:string;
 @Transform(trim) @IsString() @Length(1,100) subject!:string;
 @Transform(trim) @IsString() @Length(1,2000) description!:string;
 @Transform(trim) @IsString() @Length(1,1000) publicSummary!:string;
 @IsOptional() @IsDateString({strict:true}) nextFollowAt?:string;
 @IsUUID() commandKey!:string;
 @IsInt() @Min(0) @Max(2147483646) expectedOrderVersion!:number;
 @Transform(trim) @IsString() @Length(1,500) reason!:string;
}
export class OfflineCommandDto{
 @IsUUID() commandKey!:string;
 @IsInt() @Min(0) @Max(2147483646) expectedCaseVersion!:number;
 @IsInt() @Min(0) @Max(2147483646) expectedTaskVersion!:number;
 @Transform(trim) @IsString() @Length(1,500) reason!:string;
}
export class OfflineEventDto extends OfflineCommandDto{
 @IsIn(offlineEventKinds) kind!:string;
 @IsDateString({strict:true}) occurredAt!:string;
 @IsIn(offlineChannels) channel!:string;
 @Transform(trim) @IsString() @Length(1,2000) result!:string;
 @IsOptional() @Transform(trim) @IsString() @Length(1,1000) nextStep?:string;
 @IsOptional() @IsDateString({strict:true}) nextFollowAt?:string;
 @IsOptional() @Transform(trim) @IsString() @Length(1,1000) publicText?:string;
 @IsOptional() @IsInt() @Min(0) @Max(100000000) reportedAmountCents?:number;
 @IsOptional() @IsDateString({strict:true}) externalPaymentAt?:string;
 @IsOptional() @IsIn(['DECLARED','VERIFIED']) externalVerification?:string;
 @IsOptional() @Transform(trim) @IsString() @Length(1,60) carrier?:string;
 @IsOptional() @Transform(trim) @Matches(/^[A-Za-z0-9-]{1,100}$/) tracking?:string;
 @IsOptional() @IsUUID() correctsEventId?:string;
 @IsOptional() @IsBoolean() waitExternal?:boolean;
 @IsOptional() @IsIn(['REQUEST','APPROVED','DECLINED']) adminDecision?:string;
 @IsOptional() @IsUUID() basedAdminRequestEventId?:string;
 @IsOptional() @IsInt() @Min(0) @Max(2147483646) expectedAdminTaskVersion?:number;
 @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsUUID('all',{each:true}) evidenceFileIds!:string[];
}
export class ResolveOfflineCaseDto extends OfflineCommandDto{
 @Transform(trim) @IsString() @Length(1,2000) actualResult!:string;
 @Transform(trim) @IsString() @Length(1,1000) publicExplanation!:string;
}
export class CloseOfflineCaseDto extends OfflineCommandDto{
 @Transform(trim) @IsString() @Length(1,1000) publicExplanation!:string;
}
export class OfflineCaseQueryDto extends PaginationDto{
 @IsOptional() @IsIn(offlineCaseTypes) type?:string;
 @IsOptional() @IsIn(offlineCaseStatuses) status?:string;
 @IsOptional() @IsUUID() orderId?:string;
 @IsOptional() @Transform(trim) @IsString() @Length(1,40) orderNo?:string;
 @IsOptional() @IsUUID() assigneeId?:string;
}
