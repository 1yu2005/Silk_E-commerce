// 作用：原子创建唯一手机号顾客与注册审计，不自动登录或验证手机号所有权。
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { runAuthTransaction } from './auth-transaction.js';
import { CustomerRegisterDto } from './customer-register.dto.js';
import { CustomerPhoneExistsError } from './customer-register.error.js';
import { PasswordService } from './password.service.js';

@Injectable()
export class CustomerRegisterService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(AuditService) private readonly audit: AuditService) {}

  async register(input: CustomerRegisterDto, requestId: string) {
    // bcrypt在事务外执行；手机号唯一性最终由数据库裁决，避免并发预查竞态。
    const passwordHash = await this.passwords.hash(input.password);
    return runAuthTransaction(this.prisma, async tx => {
      const customer = await tx.customer.create({ data: {
        phone: input.phone, nickname: input.nickname ?? '新顾客', passwordHash, status: 'NORMAL', tokenVersion: 0,
      }, select: { id: true, phone: true, nickname: true, status: true, createdAt: true } }).catch((error: unknown) => {
        // 只映射顾客插入的唯一冲突；审计或其它数据库故障不得伪装成手机号重复。
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new CustomerPhoneExistsError();
        throw error;
      });
      await this.audit.appendAudit(tx, { actor: { type: 'CUSTOMER', id: customer.id }, action: 'customer.register',
        targetId: customer.id, requestId, after: { status: customer.status } });
      // 注册不签发token、不创建会话，也不更新最近登录时间。
      return customer;
    });
  }
}
