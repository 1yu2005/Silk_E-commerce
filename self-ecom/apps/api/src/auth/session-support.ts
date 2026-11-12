// 作用：集中校验会话主体、UUID、事务客户端及主体锁等基础约定。
import type { Prisma, SubjectType } from '@prisma/client';

export interface SubjectReference { subjectType: SubjectType; subjectId: string }
export type SessionErrorCode = 'SESSION_REVOKED' | 'ACCOUNT_UNAVAILABLE' | 'INVALID_CREDENTIALS';
export class SessionAuthenticationError extends Error {
  constructor(public readonly code: SessionErrorCode) {
    super(code === 'SESSION_REVOKED' ? '登录会话已撤销'
      : code === 'ACCOUNT_UNAVAILABLE' ? '账号当前不可用' : '账号或密码错误');
    this.name = 'SessionAuthenticationError';
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function checkedId(id: string): string {
  if (typeof id !== 'string' || !uuid.test(id)) throw new Error('会话主体或编号不合法');
  return id.toLowerCase();
}
export function checkedSubject(subject: SubjectReference): SubjectReference {
  if (subject.subjectType !== 'EMPLOYEE' && subject.subjectType !== 'CUSTOMER') {
    throw new Error('会话主体或编号不合法');
  }
  return { subjectType: subject.subjectType, subjectId: checkedId(subject.subjectId) };
}
export function authNow(clock: () => Date): Date {
  const now = clock();
  if (!Number.isFinite(now.getTime()) || now.getTime() < 0) throw new Error('会话时钟不合法');
  return now;
}
export function requireSessionTransaction(tx: Prisma.TransactionClient): void {
  // 与现有审计入口一致，拒绝Prisma根客户端误传；不以此代替业务授权。
  if (typeof (tx as { $connect?: unknown }).$connect === 'function') {
    throw new Error('会话写入必须使用事务客户端');
  }
}

/** 调用方须先取得管理员稳定锁及其它员工锁，遵守全局锁序；重复锁定同一主体不会提前释放锁。 */
export async function lockSessionSubject(tx: Prisma.TransactionClient, subject: SubjectReference): Promise<void> {
  const rows = subject.subjectType === 'EMPLOYEE'
    ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM employee WHERE id=${subject.subjectId}::uuid FOR UPDATE`
    : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM customer WHERE id=${subject.subjectId}::uuid FOR UPDATE`;
  if (rows.length !== 1) throw new SessionAuthenticationError('ACCOUNT_UNAVAILABLE');
}
