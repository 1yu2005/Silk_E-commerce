// 作用：使用一致数据库快照查询员工列表或详情，控制公开字段并计算三组权限。
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { PermissionService } from '../permissions/permission.service.js';
import { roleTemplates } from '../permissions/permission-catalog.js';
import { EmployeeListQueryDto } from './employee-query.dto.js';
import { EmployeeNotFoundError } from './employee-command.errors.js';

const employeeListSelect = {
  id: true, username: true, displayName: true, role: true, status: true,
  mustChangePassword: true, version: true, createdAt: true, lastLoginAt: true,
} satisfies Prisma.EmployeeSelect;
const readOptions = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 5000 };

@Injectable()
export class EmployeeQueryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PermissionService) private readonly permissions: PermissionService) {}

  async list(query: EmployeeListQueryDto) {
    // PostgreSQL LIKE默认以反斜线转义，先转义用户文本，避免%和_改变检索范围。
    const keyword = query.keyword?.replace(/[\\%_]/g, '\\$&');
    const where: Prisma.EmployeeWhereInput = {
      ...(query.role ? { role: query.role } : {}), ...(query.status ? { status: query.status } : {}),
      ...(keyword ? { OR: [
        { username: { contains: keyword, mode: 'insensitive' } }, { displayName: { contains: keyword, mode: 'insensitive' } },
      ] } : {}),
    };
    return this.prisma.$transaction(async tx => {
      const total = await tx.employee.count({ where });
      // 公共分页允许安全整数page；先用BigInt比较，避免乘法溢出或将巨大skip交给数据库。
      const offset = BigInt(query.page - 1) * BigInt(query.pageSize);
      const items = offset >= BigInt(total) ? [] : await tx.employee.findMany({ where,
        select: employeeListSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: Number(offset), take: query.pageSize });
      return { items, total, page: query.page, pageSize: query.pageSize };
    }, readOptions);
  }

  async detail(id: string) {
    // 岗位、版本与关联授权使用同一读取快照；列表不读取这些逐人授权。
    return this.prisma.$transaction(async tx => {
      const row = await tx.employee.findUnique({ where: { id }, select: { ...employeeListSelect,
        permissionVersion: true, extraPermissions: { select: { permissionCode: true }, orderBy: { permissionCode: 'asc' } },
      } });
      if (!row) throw new EmployeeNotFoundError();
      const { extraPermissions: relations, ...employee } = row;
      const extraPermissions = relations.map(relation => relation.permissionCode).sort();
      return { ...employee, defaultPermissions: [...roleTemplates[row.role]].sort(), extraPermissions,
        effectivePermissions: this.permissions.effectivePermissions(row.role, extraPermissions) };
    }, readOptions);
  }
}
