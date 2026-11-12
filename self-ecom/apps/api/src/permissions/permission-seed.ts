// 作用：在事务锁保护下幂等同步固定权限目录和岗位绑定，不删除未知历史数据。
import type { EmployeeRole, Prisma, PrismaClient } from '@prisma/client';
import { permissionDefinitions, roleTemplates } from './permission-catalog.js';
import { validatePermissionCatalog } from './permission.service.js';

export const PERMISSION_CATALOG_VERSION = 'M0-02.permissions.v1';

export class PermissionSeedConflictError extends Error {
  constructor() {
    super('数据库包含当前版本未声明的权限或岗位绑定，请通过专门迁移处理，不自动删除');
    this.name = 'PermissionSeedConflictError';
  }
}

/** 管理员初始化可在同一事务内复用；不创建账号、不删除个人授权。 */
export async function syncPermissionCatalog(tx: Prisma.TransactionClient) {
  if (typeof (tx as { $connect?: unknown }).$connect === 'function') throw new Error('权限初始化必须使用事务客户端');
  validatePermissionCatalog(permissionDefinitions, roleTemplates);
  // 这是权限目录专用的事务锁，与管理员可用集合的行锁不是同一把锁。
  // 组合初始化先锁ADMIN_AVAILABILITY，再进入本函数；禁止反向取得管理员锁。
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(52002, 1)`;
  const expectedCodes = new Set<string>(permissionDefinitions.map(item => item.code));
  const expectedBindings = new Set(Object.entries(roleTemplates)
    .flatMap(([role, codes]) => codes.map(code => `${role}:${code}`)));
  const existingDefinitions = await tx.permissionDefinition.findMany({ select: { code: true } });
  const existingBindings = await tx.rolePermission.findMany();
  if (existingDefinitions.some(item => !expectedCodes.has(item.code))
    || existingBindings.some(item => !expectedBindings.has(`${item.role}:${item.permissionCode}`))) {
    throw new PermissionSeedConflictError();
  }
  for (const definition of permissionDefinitions) {
    const data = { name: definition.name, description: definition.description,
      adminOnly: definition.adminOnly, dependencies: [...definition.dependencies] };
    await tx.permissionDefinition.upsert({ where: { code: definition.code },
      create: { code: definition.code, ...data }, update: data });
  }
  await tx.rolePermission.createMany({
    data: Object.entries(roleTemplates).flatMap(([role, codes]) => codes.map(permissionCode => ({
      role: role as EmployeeRole, permissionCode,
    }))),
    skipDuplicates: true,
  });
  return { version: PERMISSION_CATALOG_VERSION, permissions: permissionDefinitions.length,
    rolePermissions: expectedBindings.size };
}

/** 独立seed命令拥有整个事务；任意写入失败都会回滚，不吞掉错误。 */
export function seedPermissionCatalog(prisma: PrismaClient) {
  return prisma.$transaction(tx => syncPermissionCatalog(tx), { timeout: 15_000 });
}
