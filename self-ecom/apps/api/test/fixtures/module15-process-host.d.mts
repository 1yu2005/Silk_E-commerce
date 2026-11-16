import type { ChildProcess } from 'node:child_process';
export interface Module15Process {
  pid: number; baseUrl: string; instanceId: string; child: ChildProcess;
  rpc<T = Record<string, unknown>>(op: string, payload?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  waitFor<T = Record<string, unknown>>(event: string, predicate?: (value: T) => boolean, timeoutMs?: number): Promise<T>;
  privateOutput(): string; stop(): Promise<void>; terminate(): Promise<void>;
}
export function startModule15Process(options?: { env?: NodeJS.ProcessEnv; timeoutMs?: number }): Promise<Module15Process>;
