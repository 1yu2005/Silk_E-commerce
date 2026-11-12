// 作用：仅在空员工库中事务化初始化首管理员，复用固定权限目录并防止覆盖旧账号。
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { validatePassword } from '@shop/shared';
import { AuditService } from '../audit/audit.service.js';
import { syncPermissionCatalog } from '../permissions/permission-seed.js';
import { PasswordService } from './password.service.js';

export interface InitialAdminConfig { username: string; password: string }

export class InitialAdminSeedError extends Error {
  constructor(public readonly code: 'INIT_ADMIN_CONFIG_INVALID' | 'ADMIN_RECOVERY_REQUIRED' | 'ADMIN_AVAILABILITY_GUARD_MISSING', message: string) {
    super(message);
    this.name = 'InitialAdminSeedError';
  }
}

/** 首管理员默认使用指定账号密码；显式配置仍可覆盖，不影响普通API启动。 */
export function readInitialAdminConfig(env: NodeJS.ProcessEnv): InitialAdminConfig {
  const username = (env.INIT_ADMIN_USERNAME ?? 'admin').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{3,31}$/.test(username)) {
    throw new InitialAdminSeedError('INIT_ADMIN_CONFIG_INVALID', 'INIT_ADMIN_USERNAME: 必须为4～32位、小写字母开头的账号名');
  }
  const password = env.INIT_ADMIN_PASSWORD ?? 'admin123';
  if (validatePassword(password)) {
    throw new InitialAdminSeedError('INIT_ADMIN_CONFIG_INVALID', 'INIT_ADMIN_PASSWORD: 必填，须为8～64个Unicode字符且UTF-8不超过72字节');
  }
  return { username, password: password! };
}

interface SeedServices {
  passwords: Pick<PasswordService, 'hash'>;
  audit: Pick<AuditService, 'appendAudit'>;
}

/** 审计及目录写入复用同一事务；不把seed当作账号恢复或密码重置工具。 */
export async function seedInitialAdmin(prisma: PrismaClient, input: InitialAdminConfig,
  services: SeedServices = { passwords: new PasswordService(), audit: new AuditService() }) {
  const config = readInitialAdminConfig({ INIT_ADMIN_USERNAME: input.username, INIT_ADMIN_PASSWORD: input.password });
  // bcrypt在事务外完成，避免持有管理员稳定锁期间执行耗时密码计算。
  const passwordHash = await services.passwords.hash(config.password);
  const requestId = randomUUID();
  return prisma.$transaction(async tx => {
    // 必须先锁迁移建立的稳定行，再读员工集合和取得目录锁；缺行时明确失败。
    const guards = await tx.$queryRaw<{ key: string }[]>`
      SELECT key FROM system_guard WHERE key='ADMIN_AVAILABILITY' FOR UPDATE`;
    if (guards.length !== 1) throw new InitialAdminSeedError('ADMIN_AVAILABILITY_GUARD_MISSING', '管理员稳定锁行缺失，请先核对数据库迁移');
    const employeeCount = await tx.employee.count();
    if (employeeCount > 0 && await tx.employee.count({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' } }) === 0) {
      throw new InitialAdminSeedError('ADMIN_RECOVERY_REQUIRED', '已有员工但没有可用管理员，需要人工恢复，初始化不会修改旧账号');
    }
    const catalog = await syncPermissionCatalog(tx);
    if (employeeCount > 0) return { created: false, requestId, catalog };
    const employee = await tx.employee.create({ data: {
      username: config.username, displayName: '初始超级管理员', passwordHash,
      role: 'SUPER_ADMIN', status: 'ACTIVE', mustChangePassword: false,
    } });
    await services.audit.appendAudit(tx, {
      actor: { type: 'SYSTEM' }, action: 'employee.create', targetId: employee.id,
      requestId, reason: '首次初始化超级管理员',
      after: { username: employee.username, displayName: employee.displayName, role: employee.role,
        status: employee.status, mustChangePassword: employee.mustChangePassword },
    });
    return { created: true, employeeId: employee.id, requestId, catalog };
  }, { timeout: 15_000 });
}
