/** 文件作用：统一分页默认值和边界，使用整数计算避免超大页码溢出。 */
export const PAGINATION = Object.freeze({ page: 1, pageSize: 20, maxPageSize: 100 });
export interface PaginationInput { page?: number; pageSize?: number }
export function normalizePagination(input: PaginationInput = {}) {
  const page = input.page === undefined ? PAGINATION.page : input.page;
  const pageSize = input.pageSize === undefined ? PAGINATION.pageSize : input.pageSize;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > PAGINATION.maxPageSize) {
    throw new RangeError('分页参数不合法');
  }
  return { page, pageSize };
}
/** skip=null表示该页没有数据，不将巨大偏移量传给数据库；总数与列表须由调用方使用一致筛选和快照。 */
export function paginationWindow(input: PaginationInput, total: number) {
  const pagination = normalizePagination(input);
  if (!Number.isSafeInteger(total) || total < 0) throw new RangeError('分页总数不合法');
  const offset = BigInt(pagination.page - 1) * BigInt(pagination.pageSize);
  return { ...pagination, skip: offset >= BigInt(total) ? null : Number(offset), take: pagination.pageSize };
}
