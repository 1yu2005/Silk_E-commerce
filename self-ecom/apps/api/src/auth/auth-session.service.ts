// 作用：在主体锁保护下创建或撤销员工和顾客会话，并维护成功登录时间。
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { JwtTokenService, TokenValidationError } from './jwt-token.service.js';
import { authNow, checkedId, checkedSubject, lockSessionSubject, requireSessionTransaction,
  SessionAuthenticationError, type SubjectReference } from './session-support.js';

export interface VerifiedPasswordSnapshot extends SubjectReference {
  expectedPasswordHash: string;
  expectedTokenVersion: number;
}
export type SessionRevokeReason = 'LOGOUT' | 'PASSWORD_CHANGED' | 'PASSWORD_RESET' | 'ACCOUNT_DISABLED' | 'LOGIN_FROZEN';
const reasons: readonly SessionRevokeReason[] = ['LOGOUT', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'ACCOUNT_DISABLED', 'LOGIN_FROZEN'];

export class AuthSessionService {
  constructor(private readonly tokens: JwtTokenService, private readonly clock: () => Date = () => new Date()) {}

  /** 仅供内部命令在bcrypt验证成功后调用；返回凭证必须等外层事务提交后才能发给客户端。 */
  async createAfterPasswordVerified(tx: Prisma.TransactionClient, input: VerifiedPasswordSnapshot) {
    requireSessionTransaction(tx);
    const subject = checkedSubject(input);
    if (typeof input.expectedPasswordHash !== 'string' || !input.expectedPasswordHash
      || !Number.isSafeInteger(input.expectedTokenVersion) || input.expectedTokenVersion < 0) {
      throw new Error('已验证密码快照不合法');
    }
    await lockSessionSubject(tx, subject);
    const current = subject.subjectType === 'EMPLOYEE'
      ? await tx.employee.findUniqueOrThrow({ where: { id: subject.subjectId },
        select: { passwordHash: true, tokenVersion: true, status: true, createdAt: true } })
      : await tx.customer.findUniqueOrThrow({ where: { id: subject.subjectId },
        select: { passwordHash: true, tokenVersion: true, status: true, createdAt: true } });
    if (current.status === 'DISABLED' || current.status === 'LOGIN_FROZEN') {
      throw new SessionAuthenticationError('ACCOUNT_UNAVAILABLE');
    }
    // bcrypt可在事务外执行，但被验证的哈希和版本必须仍与锁内当前值完全相同。
    if (current.passwordHash !== input.expectedPasswordHash || current.tokenVersion !== input.expectedTokenVersion) {
      throw new SessionAuthenticationError('INVALID_CREDENTIALS');
    }
    const sessionId = randomUUID();
    const issued = await this.tokens.issue({ ...subject, sessionId, tokenVersion: current.tokenVersion });
    const authenticatedAt = authNow(this.clock);
    if (issued.expiresAt.getTime() <= authenticatedAt.getTime()) throw new TokenValidationError('TOKEN_EXPIRED');
    await tx.authSession.create({ data: { id: sessionId, subjectType: subject.subjectType,
      employeeId: subject.subjectType === 'EMPLOYEE' ? subject.subjectId : null,
      customerId: subject.subjectType === 'CUSTOMER' ? subject.subjectId : null,
      tokenVersion: current.tokenVersion, createdAt: issued.issuedAt, expiresAt: issued.expiresAt } });
    // JWT按秒签发，不能用其向下取整后的iat更新毫秒级登录时间；同秒新建账号也须满足生命周期约束。
    const lastLoginAt = new Date(Math.max(authenticatedAt.getTime(), current.createdAt.getTime()));
    const update = { where: { id: subject.subjectId }, data: { lastLoginAt } };
    if (subject.subjectType === 'EMPLOYEE') await tx.employee.update(update);
    else await tx.customer.update(update);
    return { ...issued, sessionId };
  }

  /** 底层撤销入口不代替认证/审计；仅首次改变返回true，调用方可据此记录一次注销审计。 */
  async revokeCurrent(tx: Prisma.TransactionClient, input: SubjectReference, sessionId: string): Promise<boolean> {
    requireSessionTransaction(tx);
    const subject = checkedSubject(input); const id = checkedId(sessionId);
    await lockSessionSubject(tx, subject);
    const session = await tx.authSession.findUnique({ where: { id },
      select: { subjectType: true, employeeId: true, customerId: true, createdAt: true, revokedAt: true } });
    if (!session || session.subjectType !== subject.subjectType
      || (subject.subjectType === 'EMPLOYEE' ? session.employeeId : session.customerId) !== subject.subjectId) {
      throw new TokenValidationError('TOKEN_INVALID');
    }
    if (session.revokedAt !== null) return false;
    const now = authNow(this.clock);
    await tx.authSession.update({ where: { id }, data: {
      revokedAt: new Date(Math.max(now.getTime(), session.createdAt.getTime())), revokeReason: 'LOGOUT' } });
    return true;
  }

  /** 改密/重置/停用等命令还须在同事务递增主体版本并写审计，本入口只撤销会话。 */
  async revokeAll(tx: Prisma.TransactionClient, input: SubjectReference, reason: SessionRevokeReason): Promise<number> {
    requireSessionTransaction(tx);
    const subject = checkedSubject(input);
    if (!reasons.includes(reason)) throw new Error('会话撤销原因不合法');
    await lockSessionSubject(tx, subject);
    const now = authNow(this.clock);
    // 不覆盖已有撤销事实；GREATEST兼容机器时钟回拨，遵守数据库生命周期约束。
    return subject.subjectType === 'EMPLOYEE'
      ? tx.$executeRaw`UPDATE auth_session SET revoked_at=GREATEST(created_at, ${now}), revoke_reason=${reason}
          WHERE employee_id=${subject.subjectId}::uuid AND subject_type='EMPLOYEE' AND revoked_at IS NULL`
      : tx.$executeRaw`UPDATE auth_session SET revoked_at=GREATEST(created_at, ${now}), revoke_reason=${reason}
          WHERE customer_id=${subject.subjectId}::uuid AND subject_type='CUSTOMER' AND revoked_at IS NULL`;
  }
}
