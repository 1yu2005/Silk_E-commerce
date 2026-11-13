// 作用：商品命令复用员工主体锁和事务内最新会话校验，所有领域锁随后取得。
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CurrentIdentityService, type CurrentIdentity } from '../auth/current-identity.service.js';
import { AccessDeniedError } from '../auth/access-denied.error.js';
import { TokenValidationError } from '../auth/jwt-token.service.js';
import { CatalogError } from './catalog.errors.js';
@Injectable()
export class CatalogAccess {
  constructor(@Inject(CurrentIdentityService) private readonly identities: CurrentIdentityService) {}
  async actor(tx: Prisma.TransactionClient, supplied: CurrentIdentity, token: string, permissions: string[]) {
    if (supplied.subjectType !== 'EMPLOYEE') throw new AccessDeniedError('FORBIDDEN');
    await tx.$queryRaw`SELECT id FROM employee WHERE id=${supplied.subjectId}::uuid FOR UPDATE`;
    const current = await this.identities.authenticate(tx, token, 'EMPLOYEE');
    if (current.subjectType !== 'EMPLOYEE' || current.subjectId !== supplied.subjectId || current.sessionId !== supplied.sessionId) throw new TokenValidationError('TOKEN_INVALID');
    if (current.mustChangePassword) throw new AccessDeniedError('PASSWORD_CHANGE_REQUIRED');
    if (permissions.some(p => !current.effectivePermissions.includes(p))) throw new AccessDeniedError('FORBIDDEN');
    return current;
  }
  async tree(tx: Prisma.TransactionClient) {
    const rows = await tx.$queryRaw<{ key: string }[]>`SELECT key FROM system_guard WHERE key='CATEGORY_TREE' FOR UPDATE`;
    if (!rows.length) throw new Error('分类稳定锁尚未迁移');
  }
  async product(tx: Prisma.TransactionClient, id: string, version?: number) {
    await tx.$queryRaw`SELECT id FROM product WHERE id=${id}::uuid FOR UPDATE`;
    const row = await tx.product.findUnique({ where: { id } });
    if (!row) throw new CatalogError('PRODUCT_NOT_FOUND');
    if (version !== undefined && row.version !== version) throw new CatalogError('VERSION_CONFLICT');
    if (row.version === 2147483647) throw new CatalogError('VERSION_CONFLICT');
    return row;
  }
}
