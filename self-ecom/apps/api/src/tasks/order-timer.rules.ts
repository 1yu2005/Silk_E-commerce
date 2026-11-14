// 作用：实现BR-05纯状态规则；按真实交运起算，多重阻塞只冻结一次，最后解除至少恢复三自然日。
import { calculateDeadline } from '../common/time/deadline.js';
import { checkedId } from '../auth/session-support.js';
import { TaskError } from './task.errors.js';
import { TASK_SOURCE_TYPES, type TaskSourceReference } from './task-source.contract.js';
export interface TimerBlock extends TaskSourceReference { active: boolean; createdAt: Date; releasedAt: Date | null; blocksShipment?:boolean; blocksReceipt?:boolean }
export interface TimerPause {
  cycleNo: number; status: 'ACTIVE' | 'RESUMED' | 'TERMINATED'; pausedAt: Date; remainingMs: number; baseDueAt: Date;
  resumedAt: Date | null; newDueAt: Date | null; endReason: string | null;
}
export interface OrderTimerState {
  orderId: string; status: 'UNSHIPPED' | 'HANDOVER_UNKNOWN' | 'SHIPPED' | 'COMPLETED' | 'REFUNDED'; version: number;
  autoReceiptDays: number; actualHandoverAt: Date | null; baseDueAt: Date | null; dueAt: Date | null; updatedAt: Date;
  blocks: TimerBlock[]; pauses: TimerPause[]; commandReceipts: { key: string; signature: string }[];
}
interface TimerCommandBase { readonly commandKey: string; readonly reason: string }
export type OrderTimerCommand = TimerCommandBase & (
  { readonly action: 'ADD_BLOCK' | 'RELEASE_BLOCK'; readonly source: TaskSourceReference }
  | { readonly action: 'RECORD_HANDOVER'; readonly actualAt: Date }
  | { readonly action: 'FINISH'; readonly terminal: 'COMPLETED' | 'REFUNDED' });
function millis(value: Date): number {
  if (!(value instanceof Date) || !Number.isFinite(+value) || +value < 0) throw new TaskError('TASK_INPUT_INVALID'); return +value;
}
function text(value: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > max) throw new TaskError('TASK_INPUT_INVALID'); return value.trim();
}
const terminal = (state: OrderTimerState) => state.status === 'COMPLETED' || state.status === 'REFUNDED';
const receiptBlocking=(block:TimerBlock)=>block.active&&block.blocksReceipt!==false;
function freeze(state: OrderTimerState, now: Date) {
  if (!state.dueAt || state.pauses.some(row => row.status === 'ACTIVE')) throw new TaskError('ORDER_TIMER_STATE_INVALID');
  const baseDueAt = new Date(state.dueAt);
  state.pauses.push({ cycleNo: state.pauses.length + 1, status: 'ACTIVE', pausedAt: new Date(now), remainingMs: Math.max(+baseDueAt - +now, 0),
    baseDueAt, resumedAt: null, newDueAt: null, endReason: null }); state.dueAt = null;
}
/** 返回独立状态，不修改输入；仓储用订单锁与版本原子落库，并保存完整周期和命令回执。 */
export function applyOrderTimer(input: OrderTimerState, command: OrderTimerCommand, now: Date, actorKey = 'SYSTEM') {
  const at = millis(now); checkedId(input.orderId); const commandKey = text(command.commandKey, 150); const reason = text(command.reason, 500);
  if (!Number.isInteger(input.version) || input.version < 0 || input.version > 2147483647
    || !Number.isInteger(input.autoReceiptDays) || input.autoReceiptDays < 1 || input.autoReceiptDays > 365 || at < millis(input.updatedAt)) throw new TaskError('TASK_INPUT_INVALID');
  if (!['UNSHIPPED', 'HANDOVER_UNKNOWN', 'SHIPPED', 'COMPLETED', 'REFUNDED'].includes(input.status)) throw new TaskError('ORDER_TIMER_STATE_INVALID');
  const activePauses = input.pauses.filter(row => row.status === 'ACTIVE');
  if (activePauses.length > 1 || (terminal(input) && (input.dueAt || activePauses.length))
    || (input.status !== 'SHIPPED' && !terminal(input) && (input.dueAt || input.actualHandoverAt || input.baseDueAt || activePauses.length))
    || (input.status === 'SHIPPED' && (!input.actualHandoverAt || !input.baseDueAt || (input.blocks.some(receiptBlocking) ? !!input.dueAt || activePauses.length !== 1 : !input.dueAt || activePauses.length > 0)))) throw new TaskError('ORDER_TIMER_STATE_INVALID');
  for (const date of [input.actualHandoverAt, input.baseDueAt, input.dueAt]) if (date) millis(date);
  for (const pause of input.pauses) if (!Number.isSafeInteger(pause.remainingMs) || pause.remainingMs < 0 || millis(pause.pausedAt) > at) throw new TaskError('ORDER_TIMER_STATE_INVALID');
  let signature: string;
  if (command.action === 'ADD_BLOCK' || command.action === 'RELEASE_BLOCK') {
    if (!TASK_SOURCE_TYPES.includes(command.source.sourceType)) throw new TaskError('TASK_INPUT_INVALID');
    signature = JSON.stringify([actorKey, command.action, command.source.sourceType, checkedId(command.source.sourceId), reason]);
  } else if (command.action === 'RECORD_HANDOVER') {
    if (millis(command.actualAt) > at) throw new TaskError('TASK_INPUT_INVALID'); signature = JSON.stringify([actorKey, command.action, command.actualAt.toISOString(), reason]);
  } else if (command.action === 'FINISH' && ['COMPLETED', 'REFUNDED'].includes(command.terminal)) signature = JSON.stringify([actorKey, command.action, command.terminal, reason]);
  else throw new TaskError('TASK_INPUT_INVALID');
  const prior = input.commandReceipts.find(row => row.key === commandKey);
  if (prior) { if (prior.signature !== signature) throw new TaskError('ORDER_TIMER_COMMAND_CONFLICT'); return { changed: false, state: structuredClone(input) }; }
  const state = structuredClone(input);
  if (command.action === 'ADD_BLOCK' || command.action === 'RELEASE_BLOCK') {
    const block = state.blocks.find(row => row.sourceType === command.source.sourceType && row.sourceId === command.source.sourceId.toLowerCase());
    if (command.action === 'ADD_BLOCK') {
      if (terminal(state)) throw new TaskError('ORDER_TIMER_BLOCKED');
      if (block) { if (block.active) return { changed: false, state }; throw new TaskError('ORDER_TIMER_COMMAND_CONFLICT'); }
      const alreadyBlocked = state.blocks.some(receiptBlocking);
      state.blocks.push({ sourceType: command.source.sourceType, sourceId: command.source.sourceId.toLowerCase(), active: true, createdAt: new Date(now), releasedAt: null });
      if (state.status === 'SHIPPED' && !alreadyBlocked) freeze(state, now);
    } else {
      if (!block) throw new TaskError('ORDER_TIMER_BLOCKED'); if (!block.active) return { changed: false, state };
      block.active = false; block.releasedAt = new Date(now);
      if (state.status === 'SHIPPED' && block.blocksReceipt!==false && !state.blocks.some(receiptBlocking)) {
        const pause = state.pauses.find(row => row.status === 'ACTIVE'); if (!pause) throw new TaskError('ORDER_TIMER_STATE_INVALID');
        const minimum = calculateDeadline(now, { unit: 'NATURAL_DAY', amount: 3 });
        const dueAt = new Date(at + Math.max(pause.remainingMs, +minimum - at)); millis(dueAt);
        state.dueAt = dueAt; pause.status = 'RESUMED'; pause.resumedAt = new Date(now); pause.newDueAt = new Date(dueAt); pause.endReason = reason;
      }
    }
  } else if (command.action === 'RECORD_HANDOVER') {
    if (terminal(state)) throw new TaskError('ORDER_TIMER_BLOCKED');
    if (state.actualHandoverAt) { if (+state.actualHandoverAt === +command.actualAt) return { changed: false, state }; throw new TaskError('ORDER_TIMER_COMMAND_CONFLICT'); }
    state.actualHandoverAt = new Date(command.actualAt); state.status = 'SHIPPED';
    state.baseDueAt = calculateDeadline(command.actualAt, { unit: 'NATURAL_DAY', amount: state.autoReceiptDays }); state.dueAt = new Date(state.baseDueAt);
    if (state.blocks.some(receiptBlocking)) freeze(state, now);
  } else if (command.action === 'FINISH') {
    if (state.status === command.terminal) return { changed: false, state };
    if (state.status === 'REFUNDED' || (state.status === 'COMPLETED' && command.terminal !== 'REFUNDED')) throw new TaskError('ORDER_TIMER_BLOCKED');
    state.status = command.terminal; state.dueAt = null;
    for (const pause of state.pauses.filter(row => row.status === 'ACTIVE')) { pause.status = 'TERMINATED'; pause.endReason = reason; }
  } else throw new TaskError('TASK_INPUT_INVALID');
  if (state.version >= 2147483647) throw new TaskError('TASK_VERSION_EXHAUSTED');
  state.version++; state.updatedAt = new Date(now); state.commandReceipts.push({ key: commandKey, signature });
  return { changed: true, state };
}
