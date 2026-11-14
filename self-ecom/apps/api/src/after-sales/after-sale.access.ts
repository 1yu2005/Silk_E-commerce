// 作用：售后读取投影按当前身份裁剪；仓储只有验收所需范围，顾客只能读本人。
import type {Prisma} from '@prisma/client';
import type {TaskCommandActor} from '../tasks/task-business-adapters.js';
import {AccessDeniedError} from '../auth/access-denied.error.js';
import {AfterSaleError} from './after-sale.rules.js';
export function serviceReader(a:TaskCommandActor){return a.subjectType==='EMPLOYEE'&&!a.mustChangePassword&&a.effectivePermissions.includes('after-sale.service.read');}
export function inspectionReader(a:TaskCommandActor){return a.subjectType==='EMPLOYEE'&&!a.mustChangePassword&&a.effectivePermissions.includes('after-sale.inspection.read');}
export function salePermission(a:TaskCommandActor,permission:string){if(a.subjectType!=='EMPLOYEE'||a.mustChangePassword||!a.effectivePermissions.includes(permission))throw new AccessDeniedError('FORBIDDEN');return a;}
export async function ownedSale(tx:Prisma.TransactionClient,id:string,a:TaskCommandActor){const s=await tx.afterSale.findUnique({where:{id}});if(!s||(a.subjectType==='CUSTOMER'?s.customerId!==a.subjectId:a.subjectType==='EMPLOYEE'&&!serviceReader(a)&&!inspectionReader(a)))throw new AfterSaleError('AFTER_SALE_NOT_FOUND');return s;}
