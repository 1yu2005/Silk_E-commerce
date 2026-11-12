// 作用：验证固定目录并计算岗位权限、个人额外权限及依赖补齐和级联撤销结果。
import { Injectable } from '@nestjs/common';
import type { EmployeeRole } from '@prisma/client';
import { permissionDefinitions, roleTemplates, type PermissionDefinition, type RoleTemplates } from './permission-catalog.js';

export class PermissionInputError extends Error {
  constructor(public readonly code: 'PERMISSION_NOT_GRANTABLE' | 'EXTRA_PERMISSION_NOT_APPLICABLE') {
    super(code === 'PERMISSION_NOT_GRANTABLE' ? '额外权限包含未知或不可下放的权限' : '超级管理员不使用个人额外权限');
    this.name = 'PermissionInputError';
  }
}

/** 启动及后续seed共用；配置错误直接失败，不带病运行或静默删权限。 */
export function validatePermissionCatalog(definitions: readonly PermissionDefinition[], templates: RoleTemplates): void {
  const byCode = new Map(definitions.map(item => [item.code, item]));
  if (byCode.size !== definitions.length) throw new Error('权限目录存在重复码');
  for (const item of definitions) {
    if (!/^[a-z][a-z0-9.-]{0,99}$/.test(item.code)) throw new Error('权限目录编码格式错误');
    if (new Set(item.dependencies).size !== item.dependencies.length) throw new Error('权限依赖存在重复码');
    for (const dependency of item.dependencies) {
      if (!byCode.has(dependency)) throw new Error('权限目录依赖不存在');
      if (!item.adminOnly && byCode.get(dependency)?.adminOnly) throw new Error('普通权限不得依赖管理员能力');
    }
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(code: string) {
    if (visiting.has(code)) throw new Error('权限依赖存在环');
    if (visited.has(code)) return;
    visiting.add(code);
    for (const dependency of byCode.get(code)!.dependencies) visit(dependency);
    visiting.delete(code);
    visited.add(code);
  }
  for (const code of byCode.keys()) visit(code);
  for (const role of ['SUPER_ADMIN', 'MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'] as const) {
    const codes = new Set(templates[role]);
    if (codes.size !== templates[role].length) throw new Error('岗位模板存在重复码');
    for (const code of codes) {
      const definition = byCode.get(code);
      if (!definition) throw new Error('岗位模板包含未知权限');
      if (role !== 'SUPER_ADMIN' && definition.adminOnly) throw new Error('普通岗位不得拥有管理员能力');
      if (definition.dependencies.some(dependency => !codes.has(dependency))) throw new Error('岗位模板缺少依赖');
    }
  }
  if (templates.SUPER_ADMIN.length !== definitions.length) throw new Error('超级管理员必须拥有全部目录权限');
  const ordinary = new Set([...templates.MERCH_WAREHOUSE, ...templates.CUSTOMER_SERVICE]);
  if (definitions.some(item => !item.adminOnly && !ordinary.has(item.code))) throw new Error('普通权限必须归属普通岗位模板');
}

export interface PermissionResolution {
  defaultPermissions: string[];
  resolvedExtraPermissions: string[];
  effectivePermissions: string[];
  addedByDependency: string[];
  removedByDependency: string[];
  normalizedDefaultPermissions: string[];
}

const sorted = (values: Iterable<string>) => [...new Set(values)].sort();

@Injectable()
export class PermissionService {
  private readonly byCode = new Map<string, PermissionDefinition>(permissionDefinitions.map(item => [item.code, item]));

  constructor() {
    validatePermissionCatalog(permissionDefinitions, roleTemplates);
  }

  /** 目录只展示版本化配置；逐层复制，避免调用方改动影响后续权限计算。 */
  catalog() {
    return {
      permissions: permissionDefinitions.map(item => ({ code: item.code, name: item.name,
        description: item.description, adminOnly: item.adminOnly, dependencies: [...item.dependencies].sort() }))
        .sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
      roleTemplates: {
        SUPER_ADMIN: [...roleTemplates.SUPER_ADMIN].sort(),
        MERCH_WAREHOUSE: [...roleTemplates.MERCH_WAREHOUSE].sort(),
        CUSTOMER_SERVICE: [...roleTemplates.CUSTOMER_SERVICE].sort(),
      },
    };
  }

  private defaults(role: EmployeeRole): Set<string> {
    if (!Object.hasOwn(roleTemplates, role)) throw new Error('未知员工岗位');
    return new Set(roleTemplates[role]);
  }

  private validateExtras(codes: readonly string[]): void {
    for (const code of codes) {
      const definition = this.byCode.get(code);
      if (!definition || definition.adminOnly) throw new PermissionInputError('PERMISSION_NOT_GRANTABLE');
    }
  }

  /** 读取时仅合并当前授权，不自动发放缺失依赖；脏数据应显式失败。 */
  effectivePermissions(role: EmployeeRole, extraPermissions: readonly string[]): string[] {
    const effective = this.defaults(role);
    if (role === 'SUPER_ADMIN' && extraPermissions.length > 0) throw new PermissionInputError('EXTRA_PERMISSION_NOT_APPLICABLE');
    this.validateExtras(extraPermissions);
    for (const code of extraPermissions) effective.add(code);
    for (const code of effective) {
      if (this.byCode.get(code)!.dependencies.some(dependency => !effective.has(dependency))) {
        throw new Error('已保存的员工权限缺少依赖');
      }
    }
    return sorted(effective);
  }

  /** PUT语义：提交完整期望集合，旧额外依赖被移除时优先级联撤销，再补齐新增依赖。 */
  resolveExtraPermissions(role: EmployeeRole, oldExtraPermissions: readonly string[], requested: readonly string[]): PermissionResolution {
    const defaults = this.defaults(role);
    if (role === 'SUPER_ADMIN') throw new PermissionInputError('EXTRA_PERMISSION_NOT_APPLICABLE');
    this.effectivePermissions(role, oldExtraPermissions);
    this.validateExtras(requested);
    const desired = new Set(requested.filter(code => !defaults.has(code)));
    const removedDependencies = new Set(oldExtraPermissions.filter(code => !defaults.has(code) && !desired.has(code)));
    const removedByDependency = new Set<string>();

    // 检查完整依赖链，防止被删查询权限经另一条新增操作重新补回。
    const blockedMemo = new Map<string, boolean>();
    const blocked = (code: string): boolean => {
      if (defaults.has(code)) return false;
      const cached = blockedMemo.get(code);
      if (cached !== undefined) return cached;
      const result = removedDependencies.has(code) || this.byCode.get(code)!.dependencies.some(blocked);
      blockedMemo.set(code, result);
      return result;
    };
    for (const code of desired) {
      if (blocked(code)) {
        desired.delete(code);
        removedByDependency.add(code);
      }
    }
    const resolved = new Set<string>();
    const add = (code: string) => {
      if (defaults.has(code) || resolved.has(code)) return;
      for (const dependency of this.byCode.get(code)!.dependencies) add(dependency);
      resolved.add(code);
    };
    for (const code of desired) add(code);
    return {
      defaultPermissions: sorted(defaults),
      resolvedExtraPermissions: sorted(resolved),
      effectivePermissions: sorted([...defaults, ...resolved]),
      addedByDependency: sorted([...resolved].filter(code => !desired.has(code))),
      removedByDependency: sorted(removedByDependency),
      normalizedDefaultPermissions: sorted(requested.filter(code => defaults.has(code))),
    };
  }
}
