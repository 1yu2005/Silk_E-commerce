// 作用：在同一短只读快照内筛选审计及业务引用，列表与详情只输出安全投影。
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Clock } from '../common/time/clock.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessDeniedError } from '../auth/access-denied.error.js';
import type {CustomerContext} from '../customers/customer-access.service.js';
import {OrderAccess} from '../orders/order-access.service.js';
import { AuditFilterOptionsDto, AuditListQueryDto } from './audit-query.dto.js';
import { AuditQueryError } from './audit-query.errors.js';
import { auditActorTypes, auditBusinessTypes, auditDisplayPolicies, auditTargetTypes, projectAuditDetails, safeAuditId, safeAuditRequestId, safeBusinessNo, safeEmployeeIdentity } from './audit-query.policy.js';
const DAY=86_400_000;
const readOptions={isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:5000};
const employeeSelect={id:true,username:true,status:true} satisfies Prisma.EmployeeSelect;
const auditSelect={id:true,actorType:true,actorEmployeeId:true,actorCustomerId:true,action:true,targetType:true,targetId:true,
  reason:true,beforeData:true,afterData:true,requestId:true,createdAt:true,
  actorEmployee:{select:employeeSelect},businessReferences:{select:{businessType:true,businessId:true,businessNo:true},orderBy:[{businessType:'asc'},{businessId:'asc'}]},
} satisfies Prisma.AuditLogSelect;
type AuditRow=Prisma.AuditLogGetPayload<{select:typeof auditSelect}>;
export function auditQueryRange(query:AuditListQueryDto,asOf:Date) {
  if(query.actorEmployeeId&&query.actorCustomerId || query.actorEmployeeId&&query.actorType&&query.actorType!=='EMPLOYEE'
    ||query.actorCustomerId&&query.actorType&&query.actorType!=='CUSTOMER')throw new AuditQueryError('VALIDATION_FAILED');
  if(BigInt(query.page)*BigInt(query.pageSize)>10000n)throw new AuditQueryError('QUERY_RANGE_TOO_LARGE');
  const dayStart=Math.floor((asOf.getTime()+8*3_600_000)/DAY)*DAY-8*3_600_000;
  const from=query.from?new Date(query.from):new Date(dayStart-6*DAY),requestedTo=query.to?new Date(query.to):asOf;
  if(!Number.isFinite(from.getTime())||!Number.isFinite(requestedTo.getTime())||from>=requestedTo)throw new AuditQueryError('VALIDATION_FAILED');
  if(requestedTo.getTime()-from.getTime()>366*DAY)throw new AuditQueryError('QUERY_RANGE_TOO_LARGE');
  const to=new Date(Math.min(requestedTo.getTime(),asOf.getTime()));
  if(from>=to)throw new AuditQueryError('VALIDATION_FAILED');
  return {from,to};
}
function project(row:AuditRow) {
  const details=projectAuditDetails(row.action,row.targetType,row.beforeData,row.afterData,row.reason);
  return {id:row.id,actor:{type:row.actorType,id:row.actorEmployeeId??row.actorCustomerId,
    employee:row.actorEmployee?safeEmployeeIdentity(row.actorEmployee):null},...details,
    targetType:auditTargetTypes.includes(row.targetType)?row.targetType:'UNKNOWN',targetId:safeAuditId(row.targetId),
    requestId:safeAuditRequestId(row.requestId),createdAt:row.createdAt.toISOString(),
    businessReferences:row.businessReferences.filter(r=>auditBusinessTypes.includes(r.businessType as typeof auditBusinessTypes[number])).map(r=>({
      businessType:r.businessType,businessId:safeAuditId(r.businessId),businessNo:safeBusinessNo(r.businessNo,r.businessType),
    }))};
}
@Injectable()
export class AuditQueryService {
  constructor(@Inject(PrismaService) private readonly prisma:PrismaService,@Inject(Clock) private readonly clock:Clock,@Inject(OrderAccess) private readonly access:OrderAccess){}
  private async authorize(tx:Prisma.TransactionClient,ctx:CustomerContext){
    // 和业务数据同一只读快照复核会话、主体、密码状态与权限，不能沿用Guard早先的身份。
    const actor=await this.access.current(tx,ctx,false);
    if(actor.subjectType!=='EMPLOYEE'||actor.role!=='SUPER_ADMIN'||!actor.effectivePermissions.includes('audit.read'))throw new AccessDeniedError('FORBIDDEN');
  }
  async list(ctx:CustomerContext,query:AuditListQueryDto) {
    const asOf=this.clock.now(),{from,to}=auditQueryRange(query,asOf);
    const where:Prisma.AuditLogWhereInput={createdAt:{gte:from,lt:to},
      ...(query.actorType?{actorType:query.actorType}:{}),...(query.actorEmployeeId?{actorEmployeeId:query.actorEmployeeId}:{}),
      ...(query.actorCustomerId?{actorCustomerId:query.actorCustomerId}:{}),...(query.action?{action:query.action}:{}),
      ...(query.targetType?{targetType:query.targetType}:{}),...(query.targetId?{targetId:query.targetId}:{}),...(query.requestId?{requestId:query.requestId}:{}),
      ...(query.businessType||query.businessNo?{businessReferences:{some:{...(query.businessType?{businessType:query.businessType}:{}),...(query.businessNo?{businessNo:query.businessNo}:{})}}}:{}),
    };
    return this.prisma.$transaction(async tx=>{
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await this.authorize(tx,ctx);
      const total=await tx.auditLog.count({where});
      const rows=await tx.auditLog.findMany({where,select:auditSelect,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(query.page-1)*query.pageSize,take:query.pageSize});
      return {items:rows.map(project),total,page:query.page,pageSize:query.pageSize,asOf:asOf.toISOString(),timeZone:'Asia/Shanghai' as const,from:from.toISOString(),to:to.toISOString(),
        coverageNotice:'按业务号仅检索已建立确定引用的历史；未能确定的旧关联不作推断'};
    },readOptions);
  }
  async detail(ctx:CustomerContext,id:string) {
    const asOf=this.clock.now();
    return this.prisma.$transaction(async tx=>{
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await this.authorize(tx,ctx);
      const row=await tx.auditLog.findUnique({where:{id},select:auditSelect});
      if(!row)throw new AuditQueryError('AUDIT_LOG_NOT_FOUND');
      return {...project(row),asOf:asOf.toISOString()};
    },readOptions);
  }
  async filterOptions(ctx:CustomerContext,query:AuditFilterOptionsDto) {
    const keyword=query.actorKeyword?.replace(/[\\%_]/g,'\\$&');
    return this.prisma.$transaction(async tx=>{
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await this.authorize(tx,ctx);
      const employees=await tx.employee.findMany({where:keyword?{OR:[{username:{contains:keyword,mode:'insensitive'}},{displayName:{contains:keyword,mode:'insensitive'}}]}:{},select:employeeSelect,
        orderBy:[{username:'asc'},{id:'asc'}],take:query.limit});
      return {actorTypes:[...auditActorTypes],actions:Object.entries(auditDisplayPolicies).map(([value,p])=>({value,label:p.label})),
        targetTypes:auditTargetTypes,businessTypes:[...auditBusinessTypes],employees:employees.map(safeEmployeeIdentity),
        employeeLimit:query.limit,identityNotice:'员工以当前工作账号和稳定编号展示；自由显示名不在审计中展示，事件主体编号保持不变'};
    },readOptions);
  }
}
