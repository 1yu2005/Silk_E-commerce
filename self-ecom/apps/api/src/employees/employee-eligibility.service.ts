// 作用：连接员工变更与真实任务回池，复用原事务和已准备的完整业务锁。
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { checkedId, requireSessionTransaction } from '../auth/session-support.js';
import { permissionDefinitions } from '../permissions/permission-catalog.js';
import { TaskEligibilityService, type EmployeeTaskChange, type TaskEligibilityContext } from '../tasks/task-eligibility.service.js';

const knownCodes = new Set<string>(permissionDefinitions.map(item => item.code));
@Injectable()
export class EmployeeEligibilityService {
  constructor(@Inject(TaskEligibilityService) private readonly tasks: TaskEligibilityService) {}
  prepare(tx: Prisma.TransactionClient, employeeId: string, newEffective: readonly string[], change: EmployeeTaskChange) {
    return this.tasks.prepare(tx, employeeId, newEffective, change);
  }
  /** 必须复用调用方事务；任何业务交接、历史或审计失败都向上抛出。 */
  onEmployeeEligibilityChanged(tx: Prisma.TransactionClient, employeeId: string,
    oldEffective: readonly string[], newEffective: readonly string[], reason: string, context: TaskEligibilityContext): Promise<void> {
    requireSessionTransaction(tx); checkedId(employeeId);
    if (!reason.trim() || [...reason.trim()].length > 500
      || [oldEffective, newEffective].some(codes => new Set(codes).size !== codes.length || codes.some(code => !knownCodes.has(code)))) {
      throw new Error('员工资格变更参数不合法');
    }
    return this.tasks.apply(tx, employeeId, newEffective, context);
  }
}
