// 作用：逐项手算BR-05，覆盖多重阻塞、延后解除、至少三天、交运补录、幂等和输入不变。
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { applyOrderTimer, type OrderTimerState, type OrderTimerCommand } from '../src/tasks/order-timer.rules.js';
const day = 86400_000; const at = (n: number) => new Date(`2026-11-${String(n).padStart(2, '0')}T02:00:00.000Z`);
const source = () => ({ sourceType: 'AFTER_SALE' as const, sourceId: randomUUID() });
type CommandFields<T = OrderTimerCommand> = T extends OrderTimerCommand ? Omit<T, 'commandKey' | 'reason'> : never;
const command = (patch: CommandFields): OrderTimerCommand => ({ commandKey: randomUUID(), reason: '隔离计时规则', ...patch });
function initial(patch: Partial<OrderTimerState> = {}): OrderTimerState {
  return { orderId: randomUUID(), status: 'SHIPPED', version: 0, autoReceiptDays: 10, actualHandoverAt: at(10), baseDueAt: at(20), dueAt: at(20),
    updatedAt: at(10), blocks: [], pauses: [], commandReceipts: [], ...patch };
}
function block(state: OrderTimerState, when = at(18), ref = source()) { return applyOrderTimer(state, command({ action: 'ADD_BLOCK', source: ref }), when).state; }
it('文档手算：18日剩两天，19日加阻塞，20日部分解除，25日最后解除到28日', () => {
  const a = source(); const b = source(); let state = block(initial(), at(18), a); const originalPause = structuredClone(state.pauses[0]);
  state = block(state, at(19), b); expect(state.pauses).toEqual([originalPause]);
  state = applyOrderTimer(state, command({ action: 'RELEASE_BLOCK', source: a }), at(20)).state;
  expect(state.dueAt).toBeNull(); expect(state.pauses[0]).toEqual(originalPause);
  state = applyOrderTimer(state, command({ action: 'RELEASE_BLOCK', source: b }), at(25)).state;
  expect(state.dueAt).toEqual(at(28)); expect(state.pauses[0]).toMatchObject({ status: 'RESUMED', remainingMs: 2 * day, resumedAt: at(25), newDueAt: at(28) });
});
it.each([0, 2, 5])('冻结剩%d天，最后解除保留max(剩余,三天)', remaining => {
  const ref = source(); const due = new Date(+at(18) + remaining * day); const state = block(initial({ dueAt: due, baseDueAt: due }), at(18), ref);
  expect(state.pauses[0]?.remainingMs).toBe(remaining * day);
  expect(applyOrderTimer(state, command({ action: 'RELEASE_BLOCK', source: ref }), at(25)).state.dueAt).toEqual(new Date(+at(25) + Math.max(3, remaining) * day));
});
it('重复添加相同来源、重复解除和旧解除重放均不延长，换参数冲突', () => {
  const ref = source(); const add = command({ action: 'ADD_BLOCK', source: ref }); const one = applyOrderTimer(initial(), add, at(18));
  expect(applyOrderTimer(one.state, add, at(19))).toEqual({ changed: false, state: one.state });
  expect(applyOrderTimer(one.state, command({ action: 'ADD_BLOCK', source: ref }), at(19)).changed).toBe(false);
  const release = command({ action: 'RELEASE_BLOCK', source: ref }); const done = applyOrderTimer(one.state, release, at(25));
  expect(applyOrderTimer(done.state, release, at(27))).toEqual({ changed: false, state: done.state });
  expect(applyOrderTimer(done.state, command({ action: 'RELEASE_BLOCK', source: ref }), at(27)).changed).toBe(false);
  expect(() => applyOrderTimer(done.state, { ...release, reason: '换原因' }, at(27))).toThrowError(expect.objectContaining({ code: 'ORDER_TIMER_COMMAND_CONFLICT' }));
  expect(() => applyOrderTimer(done.state, release, at(27), 'CUSTOMER:' + randomUUID())).toThrow();
});
it('再次暂停建立新周期；旧周期解除重放不会解除新来源或再次延长', () => {
  const a = source(); const b = source(); let state = block(initial(), at(18), a); const release = command({ action: 'RELEASE_BLOCK', source: a });
  state = applyOrderTimer(state, release, at(20)).state; state = block(state, at(21), b);
  expect(state.pauses.map(row => row.status)).toEqual(['RESUMED', 'ACTIVE']); expect(state.pauses[1]?.remainingMs).toBe(2 * day);
  const replay = applyOrderTimer(state, release, at(22)); expect(replay.changed).toBe(false); expect(replay.state.dueAt).toBeNull();
  expect(applyOrderTimer(state, command({ action: 'RELEASE_BLOCK', source: b }), at(25)).state.dueAt).toEqual(at(28));
});
it.each(['COMPLETED', 'REFUNDED'] as const)('%s终结暂停周期，解除剩余来源也不会恢复计时', terminal => {
  const ref = source(); let state = block(initial(), at(18), ref);
  state = applyOrderTimer(state, command({ action: 'FINISH', terminal }), at(19)).state;
  expect(state.pauses[0]?.status).toBe('TERMINATED'); expect(state.dueAt).toBeNull();
  state = applyOrderTimer(state, command({ action: 'RELEASE_BLOCK', source: ref }), at(25)).state;
  expect(state.status).toBe(terminal); expect(state.dueAt).toBeNull();
  expect(() => block(state, at(26))).toThrow();
  expect(() => applyOrderTimer(state, command({ action: 'RECORD_HANDOVER', actualAt: at(10) }), at(26))).toThrow();
});
it.each(['UNSHIPPED', 'HANDOVER_UNKNOWN'] as const)('%s添加阻塞不启动收货计时；补录交运再按当前剩余冻结', status => {
  const ref = source(); let state = initial({ status, actualHandoverAt: null, baseDueAt: null, dueAt: null }); state = block(state, at(18), ref);
  expect(state.pauses).toEqual([]); expect(state.dueAt).toBeNull();
  state = applyOrderTimer(state, command({ action: 'RECORD_HANDOVER', actualAt: at(10) }), at(19)).state;
  expect(state.actualHandoverAt).toEqual(at(10)); expect(state.baseDueAt).toEqual(at(20)); expect(state.dueAt).toBeNull(); expect(state.pauses[0]?.remainingMs).toBe(day);
});
it('阻塞中补录十天前交运，基础截止已过仍冻结0，最后解除至少三天', () => {
  const ref = source(); let state = block(initial({ status: 'HANDOVER_UNKNOWN', actualHandoverAt: null, baseDueAt: null, dueAt: null }), at(18), ref);
  state = applyOrderTimer(state, command({ action: 'RECORD_HANDOVER', actualAt: at(8) }), at(18)).state;
  expect(state.pauses[0]?.remainingMs).toBe(0); expect(state.baseDueAt).toEqual(at(18));
  expect(applyOrderTimer(state, command({ action: 'RELEASE_BLOCK', source: ref }), at(25)).state.dueAt).toEqual(at(28));
});
it('无阻塞补录交运按真实时点和设置快照起算，重复不重算', () => {
  const cmd = command({ action: 'RECORD_HANDOVER', actualAt: at(10) }); const base = initial({ status: 'UNSHIPPED', actualHandoverAt: null, baseDueAt: null, dueAt: null });
  const result = applyOrderTimer(base, cmd, at(18)); expect(result.state.dueAt).toEqual(at(20));
  expect(applyOrderTimer(result.state, cmd, at(19)).changed).toBe(false);
  expect(() => applyOrderTimer(result.state, command({ action: 'RECORD_HANDOVER', actualAt: at(11) }), at(19))).toThrow();
});
it('输入及Date不被修改，结果中的Date为独立副本，毫秒剩余不取整', () => {
  const base = initial({ dueAt: new Date(+at(18) + 5 * day + 123) }); const before = structuredClone(base); const result = block(base);
  expect(base).toEqual(before); expect(result.pauses[0]?.remainingMs).toBe(5 * day + 123); result.pauses[0]!.baseDueAt.setTime(0); expect(base).toEqual(before);
});
it.each([0, -1, 366, 1.5, NaN])('拒绝非法autoReceiptDays=%s', value => {
  expect(() => block(initial({ autoReceiptDays: value }))).toThrow();
});
it('拒绝不存在来源、已解除来源重新添加、未来交运和时钟倒退', () => {
  const ref = source(); const base = initial(); expect(() => applyOrderTimer(base, command({ action: 'RELEASE_BLOCK', source: ref }), at(18))).toThrow();
  expect(() => applyOrderTimer(initial({ status: 'UNSHIPPED', actualHandoverAt: null, baseDueAt: null, dueAt: null }), command({ action: 'RECORD_HANDOVER', actualAt: at(20) }), at(18))).toThrow();
  let state = block(base, at(18), ref); expect(() => applyOrderTimer(state, command({ action: 'RELEASE_BLOCK', source: ref }), at(17))).toThrow();
  state = applyOrderTimer(state, command({ action: 'RELEASE_BLOCK', source: ref }), at(20)).state; expect(() => block(state, at(21), ref)).toThrow();
});
it('拒绝非法日期、空原因、未知动作和版本溢出', () => {
  expect(() => block(initial(), new Date(NaN))).toThrow();
  expect(() => applyOrderTimer(initial(), { ...command({ action: 'ADD_BLOCK', source: source() }), reason: ' ' }, at(18))).toThrow();
  expect(() => applyOrderTimer(initial(), { action: 'ANY' } as unknown as OrderTimerCommand, at(18))).toThrow();
  expect(() => block(initial({ version: 2147483647 }))).toThrowError(expect.objectContaining({ code: 'TASK_VERSION_EXHAUSTED' }));
});
it('拒绝缺实际交运却有收货截止，以及多个ACTIVE周期等损坏状态', () => {
  expect(() => block(initial({ actualHandoverAt: null }))).toThrowError(expect.objectContaining({ code: 'ORDER_TIMER_STATE_INVALID' }));
  const state = block(initial()); state.pauses.push(structuredClone(state.pauses[0]!)); expect(() => block(state, at(19))).toThrow();
});
