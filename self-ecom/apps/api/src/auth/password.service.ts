// 作用：统一执行共享密码规则和 bcrypt 哈希或验证，避免静默截断密码。
import { Injectable } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { validatePassword, validatePasswordChange, type PasswordIssue } from '@shop/shared';

export const BCRYPT_COST = 12;

export class PasswordInputError extends Error {
  constructor(public readonly issue: PasswordIssue) {
    // issue只含固定规则信息，不附带密码输入。
    super(issue.message);
    this.name = 'PasswordInputError';
  }
}

@Injectable()
export class PasswordService {
  /** 所有入口在bcrypt之前校验，不能依赖其默认的72字节静默截断。 */
  private assertValid(password: string): void {
    const issue = validatePassword(password);
    if (issue) throw new PasswordInputError(issue);
  }

  async hash(password: string): Promise<string> {
    this.assertValid(password);
    return bcrypt.hash(password, BCRYPT_COST);
  }

  async verify(password: string, passwordHash: string): Promise<boolean> {
    this.assertValid(password);
    return bcrypt.compare(password, passwordHash);
  }

  assertPasswordChange(oldPassword: string, newPassword: string): void {
    const issue = validatePasswordChange(oldPassword, newPassword);
    if (issue) throw new PasswordInputError(issue);
  }
}
