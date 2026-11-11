/** 显式转换查询参数；数组、空白、空字符串和 null 仍视为无效值。 */
export function strictInteger(value: unknown): unknown {
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const converted = Number(value);
    return Number.isSafeInteger(converted) ? converted : value;
  }
  return value;
}

export function strictBoolean(value: unknown): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}
