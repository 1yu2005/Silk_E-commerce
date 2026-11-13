// 作用：复用当前会话解析，敏感文件命令锁主体后复核身份；不信任浏览器自报上传者。
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { CurrentIdentityService, type CurrentIdentity } from '../auth/current-identity.service.js';
import { TokenValidationError } from '../auth/jwt-token.service.js';
import { lockSessionSubject } from '../auth/session-support.js';
import { AccessDeniedError } from '../auth/access-denied.error.js';

export interface FileAccess { identity: CurrentIdentity; token: string }
@Injectable()
export class FileAccessService {
  constructor(@Inject(CurrentIdentityService) private readonly identities: CurrentIdentityService) {}
  async current(tx: Prisma.TransactionClient, access: FileAccess, lock = true) {
    const supplied = access.identity;
    if (lock) await lockSessionSubject(tx, supplied);
    const current = await this.identities.authenticate(tx, access.token, supplied.subjectType);
    if (current.subjectId !== supplied.subjectId || current.sessionId !== supplied.sessionId) throw new TokenValidationError('TOKEN_INVALID');
    if (current.subjectType === 'EMPLOYEE' && current.mustChangePassword) throw new AccessDeniedError('PASSWORD_CHANGE_REQUIRED');
    return current;
  }
}
