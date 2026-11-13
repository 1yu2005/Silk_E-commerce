// 作用：隔离主体与命令版本，对白名单业务载荷生成SHA-256；后续领域负责幂等记录与事务重放。
import { createHash } from 'node:crypto';
import { canonicalJson, ContractError } from '@shop/shared';
export interface FingerprintCommand {
  command: string;
  version: number;
  actor: { type: 'CUSTOMER' | 'EMPLOYEE' | 'SYSTEM'; id: string };
  payload: unknown;
}
function namespace(input: FingerprintCommand) {
  if (!input || typeof input.command !== 'string' || !input.actor || typeof input.actor.id !== 'string'
    || !/^[a-z][a-z0-9.-]{0,99}$/.test(input.command) || !Number.isSafeInteger(input.version) || input.version < 1
    || !['CUSTOMER', 'EMPLOYEE', 'SYSTEM'].includes(input.actor.type)
    || !/^[A-Za-z0-9_-]{1,128}$/.test(input.actor.id)) throw new ContractError('COMMAND_PAYLOAD_INVALID');
  return { command: input.command, version: input.version, actor: { type: input.actor.type, id: input.actor.id } };
}
/** 只取白名单字段，HTTP上下文中的requestId/token不会进入摘要；payload中出现凭据字段则拒绝。 */
export function commandFingerprint(input: FingerprintCommand): string {
  return createHash('sha256').update(canonicalJson({ ...namespace(input), payload: input.payload })).digest('hex');
}
export function commandNamespace(input: Omit<FingerprintCommand, 'payload'>): string {
  return createHash('sha256').update(canonicalJson(namespace({ ...input, payload: null }))).digest('hex');
}
