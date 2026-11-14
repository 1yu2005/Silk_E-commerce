// 作用：代录只接受单动作与固定目标，真实操作者和冻结版本由服务端重验。
import {Transform} from 'class-transformer';
import {IsIn,IsInt,IsOptional,IsString,IsUUID,Length,Max,Min} from 'class-validator';
import {ApplyAfterSaleDto,SupplementDto,ReturnLogisticsDto} from '../after-sales/after-sale.dto.js';
import {OfflineEventDto} from './offline-case.dto.js';
import {proxyActions,type ProxyAction} from './proxy.rules.js';
const trim=({value}:{value:unknown})=>typeof value==='string'?value.trim():value;
export class CreateProxyContextDto {
 @IsUUID() orderId!:string;
 @IsIn(proxyActions) action!:ProxyAction;
 @IsOptional() @IsUUID() afterSaleId?:string;
 @IsOptional() @IsUUID() parcelId?:string;
 @IsOptional() @IsUUID() supplementRequestId?:string;
 @IsOptional() @IsUUID() offlineCaseId?:string;
 @IsIn(['PHONE_CALLBACK','ORDER_INFORMATION_CROSS_CHECK','OTHER_OFFLINE']) method!:string;
 @Transform(trim) @IsString() @Length(1,2000) verificationSummary!:string;
 @IsUUID() sourceCommunicationId!:string;
 @IsInt() @Min(0) @Max(2147483646) expectedCustomerStatusVersion!:number;
 @IsInt() @Min(0) @Max(2147483646) expectedOrderVersion!:number;
 @IsUUID() commandKey!:string;
 @Transform(trim) @IsString() @Length(1,500) reason!:string;
}
export class ProxyApplyDto extends ApplyAfterSaleDto {
 @IsInt() @Min(0) @Max(2147483646) expectedProxyTaskVersion!:number;
}
export class ProxySupplementDto extends SupplementDto {
 @IsInt() @Min(0) @Max(2147483646) expectedProxyTaskVersion!:number;
}
export class ProxyReturnLogisticsDto extends ReturnLogisticsDto {
 @IsInt() @Min(0) @Max(2147483646) expectedProxyTaskVersion!:number;
}
export class ProxyOfflineResultDto extends OfflineEventDto {
 @IsUUID() offlineCaseId!:string;
 @IsInt() @Min(0) @Max(2147483646) expectedProxyTaskVersion!:number;
}
