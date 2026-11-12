// 作用：验证仅对可安全重试的事务冲突进行有限重试，并保留业务错误。
import { Prisma } from '@prisma/client';
import { expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { runAuthTransaction } from '../src/auth/auth-transaction.js';
import { SessionAuthenticationError } from '../src/auth/session-support.js';

function known(code: string, sqlCode?: string) { return new Prisma.PrismaClientKnownRequestError('测试冲突', {
  code, clientVersion: '7.10.1', ...(sqlCode ? { meta: { code: sqlCode } } : {}),
}); }
it.each([known('P2034'), known('P2010', '40P01'), known('P2010', '40001')])('已知事务冲突重试整个命令，第三次可成功', async error => {
  const command = vi.fn().mockResolvedValue('结果');
  const transaction = vi.fn().mockRejectedValueOnce(error).mockRejectedValueOnce(error).mockImplementation(command);
  expect(await runAuthTransaction({ $transaction: transaction } as unknown as PrismaService, command)).toBe('结果');
  expect(transaction).toHaveBeenCalledTimes(3);
});
it('持续冲突最多三次，错误不吞掉', async () => {
  const error = known('P2034'); const transaction = vi.fn().mockRejectedValue(error);
  await expect(runAuthTransaction({ $transaction: transaction } as unknown as PrismaService, vi.fn())).rejects.toBe(error);
  expect(transaction).toHaveBeenCalledTimes(3);
});
it.each([new SessionAuthenticationError('INVALID_CREDENTIALS'), known('P2010', '57014'), new Error('连接失败')])('业务拒绝或非冲突故障不重试', async error => {
  const transaction = vi.fn().mockRejectedValue(error);
  await expect(runAuthTransaction({ $transaction: transaction } as unknown as PrismaService, vi.fn())).rejects.toBe(error);
  expect(transaction).toHaveBeenCalledTimes(1);
});
