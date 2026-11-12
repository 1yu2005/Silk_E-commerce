// 作用：校验员工资格变更的事务契约，预留板块4待办回池接入点。
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { checkedId, requireSessionTransaction } from '../auth/session-support.js';
import { permissionDefinitions } from '../permissions/permission-catalog.js';

const knownCodes = new Set<string>(permissionDefinitions.map(item => item.code));
@Injectable()
export class EmployeeEligibilityService {
  /** 板块4在此接入真实任务回池；必须复用调用方事务，失败不得吞掉。当前不创建Task或内存事件。 */
  onEmployeeEligibilityChanged(tx: Prisma.TransactionClient, employeeId: string,
    oldEffective: readonly string[], newEffective: readonly string[], reason: string): Promise<void> {
    requireSessionTransaction(tx); checkedId(employeeId);
    if (!reason.trim() || [...reason.trim()].length > 500
      || [oldEffective, newEffective].some(codes => new Set(codes).size !== codes.length || codes.some(code => !knownCodes.has(code)))) {
      throw new Error('员工资格变更参数不合法');
    }
    return Promise.resolve();
  }
}
