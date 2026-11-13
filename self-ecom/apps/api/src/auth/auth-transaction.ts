// 作用：对认证事务中可安全重试的死锁或序列化冲突进行有限重试。
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';

/** 默认只重试明确死锁/序列化冲突；领域可补充“完整锁计划变化”，总计仍最多三次，普通业务拒绝/超时不重试。 */
export async function runAuthTransaction<T>(prisma: PrismaService, command: (tx: Prisma.TransactionClient) => Promise<T>,
  additionalRetryable?: (error: unknown) => boolean): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await prisma.$transaction(command, { timeout: 5000 }); }
    catch (error: unknown) {
      const retryable = (error instanceof Prisma.PrismaClientKnownRequestError
        && (error.code === 'P2034' || (error.code === 'P2010' && ['40P01', '40001'].includes(String(error.meta?.code)))))
        || additionalRetryable?.(error) === true;
      if (attempt >= 3 || !retryable) throw error;
    }
  }
}
