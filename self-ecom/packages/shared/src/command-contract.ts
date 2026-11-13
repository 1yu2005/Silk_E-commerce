/** 文件作用：校验幂等键并稳定序列化已验证的命令载荷；不提供事务仲裁或结果重放。 */
export type ContractErrorCode = 'IDEMPOTENCY_KEY_INVALID' | 'COMMAND_PAYLOAD_INVALID' | 'IDEMPOTENCY_PAYLOAD_CONFLICT';
const definitions = {
  IDEMPOTENCY_KEY_INVALID: { status: 400, message: '幂等键须为16～128位字母、数字、短横线或下划线' },
  COMMAND_PAYLOAD_INVALID: { status: 400, message: '命令载荷不符合规范' },
  IDEMPOTENCY_PAYLOAD_CONFLICT: { status: 409, message: '同一幂等键对应的业务内容不同' },
} as const;
export class ContractError extends Error {
  readonly status: number;
  constructor(readonly code: ContractErrorCode) {
    super(definitions[code].message); this.name = 'ContractError'; this.status = definitions[code].status;
  }
}
export function validateIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || value.length < 16 || value.length > 128 || /[^A-Za-z0-9_-]/.test(value)) throw new ContractError('IDEMPOTENCY_KEY_INVALID');
  return value;
}
export function canonicalJson(value: unknown): string {
  const ancestors = new WeakSet<object>(); let nodes = 0; let literalBytes = 0;
  const invalid = (): never => { throw new ContractError('COMMAND_PAYLOAD_INVALID'); };
  const literal = (text: string) => {
    literalBytes += new TextEncoder().encode(text).byteLength;
    if (literalBytes > 65536) return invalid(); return text;
  };
  const visit = (item: unknown, depth: number): string => {
    if (++nodes > 10000 || depth > 32) return invalid();
    if (item === null) return 'null';
    if (typeof item === 'boolean') return String(item);
    if (typeof item === 'string') { if (item.length > 65536) return invalid(); return literal(JSON.stringify(item)); }
    if (typeof item === 'number') { if (!Number.isSafeInteger(item)) return invalid(); return String(item); }
    if (typeof item !== 'object' || ancestors.has(item)) return invalid();
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) return invalid();
    const keys = Reflect.ownKeys(item); const descriptors = Object.getOwnPropertyDescriptors(item);
    if (keys.some(key => typeof key !== 'string' || !('value' in descriptors[key]!))) return invalid();
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        if (keys.length !== item.length + 1 || item.length > 10000) return invalid();
        const parts: string[] = [];
        for (let i = 0; i < item.length; i++) {
          if (!Object.hasOwn(item, i)) return invalid(); parts.push(visit(descriptors[String(i)]!.value, depth + 1));
        }
        return `[${parts.join(',')}]`;
      }
      const names = (keys as string[]).sort();
      if (names.some(key => /^(authorization|accessToken|token|requestId)$/i.test(key) || !descriptors[key]!.enumerable)) return invalid();
      return `{${names.map(key => `${literal(JSON.stringify(key))}:${visit(descriptors[key]!.value, depth + 1)}`).join(',')}}`;
    } finally { ancestors.delete(item); }
  };
  const result = visit(value, 0);
  if (new TextEncoder().encode(result).byteLength > 65536) invalid();
  return result;
}
/** 集合语义必须由命令主动声明；拒绝重复后按规范内容排序，普通数组始终保留顺序。 */
export function canonicalSet<T>(values: readonly T[]): T[] {
  if (!Array.isArray(values) || values.length > 10000) throw new ContractError('COMMAND_PAYLOAD_INVALID');
  canonicalJson(values);
  const entries = values.map(value => ({ value, key: canonicalJson(value) }));
  if (new Set(entries.map(item => item.key)).size !== entries.length) throw new ContractError('COMMAND_PAYLOAD_INVALID');
  return entries.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0).map(item => item.value);
}
