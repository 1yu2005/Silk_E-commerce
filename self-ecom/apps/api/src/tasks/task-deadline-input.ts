// 作用：严格读取ISO UTC截止，拒绝隐式本地时区、日期自动进位及会被丢失的微秒精度。
export function parseTaskDueAt(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const canonical = value.includes('.') ? value.replace(/\.(\d+)Z$/, (_match, digits: string) => `.${digits.padEnd(3, '0')}Z`) : value.replace(/Z$/, '.000Z');
  const date = new Date(canonical);
  return Number.isFinite(date.getTime()) && date.toISOString() === canonical ? date : null;
}
