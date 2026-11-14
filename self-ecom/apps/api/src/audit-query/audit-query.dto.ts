// 作用：严格校验管理员审计筛选；重复、未知和空筛选值不能默默扩为全店查询。
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { PaginationDto } from '../common/http/pagination.dto.js';
import { strictInteger } from '../common/http/dto-transforms.js';
import { auditActionNames, auditActorTypes, auditBusinessTypes, auditTargetTypes } from './audit-query.policy.js';
const trim = ({value}:{value:unknown}) => typeof value==='string' ? value.trim() : value;
const normalizeId = ({value}:{value:unknown}) => typeof value==='string' ? value.toLowerCase() : value;
export class AuditListQueryDto extends PaginationDto {
  @IsOptional() @IsIn(auditActorTypes) actorType?: 'EMPLOYEE'|'CUSTOMER'|'SYSTEM';
  @IsOptional() @Transform(normalizeId) @IsUUID() actorEmployeeId?: string;
  @IsOptional() @Transform(normalizeId) @IsUUID() actorCustomerId?: string;
  @IsOptional() @IsIn(auditActionNames) action?: string;
  @IsOptional() @IsIn(auditTargetTypes) targetType?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1,100) targetId?: string;
  @IsOptional() @IsIn(auditBusinessTypes) businessType?: typeof auditBusinessTypes[number];
  @IsOptional() @Transform(trim) @IsString() @Length(1,100) businessNo?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1,64) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/) requestId?: string;
  @IsOptional() @IsISO8601({strict:true}) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/i) from?: string;
  @IsOptional() @IsISO8601({strict:true}) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/i) to?: string;
}
export class AuditIdDto { @Transform(normalizeId) @IsUUID() id!: string; }
export class AuditFilterOptionsDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(50) actorKeyword?: string;
  @Transform(({value}:{value:unknown})=>strictInteger(value)) @IsInt() @Min(1) @Max(100) limit=20;
}
