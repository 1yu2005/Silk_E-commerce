// 作用：校验公共记录内部契约、事务及有限分页；不把字段校验当作业务授权。
import type { Prisma } from '@prisma/client';
import { checkedId } from '../auth/session-support.js';
import { normalizePagination } from '@shop/shared';

export class RecordInputError extends Error {
  readonly code = 'RECORD_INPUT_INVALID';
  constructor(message = '记录参数不合法') { super(message); this.name = 'RecordInputError'; }
}
export class BusinessModuleNotReadyError extends Error {
  readonly code = 'BUSINESS_MODULE_NOT_READY';
  constructor() { super('该业务模块尚未接入公共记录服务'); this.name = 'BusinessModuleNotReadyError'; }
}
export function requireRecordTransaction(tx: Prisma.TransactionClient): void {
  if (!tx || typeof (tx as { $connect?: unknown }).$connect === 'function') {
    throw new Error('公共记录必须使用调用方事务客户端');
  }
}
export function recordId(value: string): string {
  try { return checkedId(value); }
  catch { throw new RecordInputError(); }
}
export function recordObject(value: unknown, allowed: readonly string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).some(key => !allowed.includes(key))) throw new RecordInputError();
}
export function recordText(value: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > max) throw new RecordInputError();
  return value.trim();
}
export function optionalRecordText(value: string | null | undefined, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new RecordInputError();
  return value.trim() ? recordText(value, max) : null;
}
export interface RecordPage { page?: number; pageSize?: number }
export function recordPage(input: RecordPage) {
  recordObject(input, ['page', 'pageSize']);
  let pagination;
  try { pagination = normalizePagination(input); } catch { throw new RecordInputError(); }
  const { page, pageSize } = pagination;
  if (!Number.isSafeInteger((page - 1) * pageSize)) throw new RecordInputError();
  return { page, pageSize, skip: (page - 1) * pageSize };
}
