// 作用：验证北京时间期限、跨日历边界及可替换时钟，独立进程核对不同宿主时区下的结果。
import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Clock, SystemClock } from '../src/common/time/clock.js';
import { BUSINESS_TIME_ZONE, calculateDeadline, DEADLINE_ALGORITHM_VERSION, isDeadlineReached,
  type DeadlineRule } from '../src/common/time/deadline.js';
import { TimeModule } from '../src/common/time/time.module.js';

afterEach(() => { vi.useRealTimers(); });

describe('服务器时钟', () => {
  it('系统时钟读取当前服务器时刻，每次返回独立Date', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-13T02:00:00.123Z'));
    const clock = new SystemClock(); const first = clock.now();
    expect(first.toISOString()).toBe('2026-11-13T02:00:00.123Z');
    first.setUTCFullYear(2000);
    vi.advanceTimersByTime(1000);
    expect(clock.now().toISOString()).toBe('2026-11-13T02:00:01.123Z');
  });
  it('时间模块默认提供真实时钟，测试可替换同一注入令牌', async () => {
    const normal = await Test.createTestingModule({ imports: [TimeModule] }).compile();
    try { expect(normal.get(Clock)).toBeInstanceOf(SystemClock); } finally { await normal.close(); }
    const fixed: Clock = { now: () => new Date('2026-11-13T02:00:00.123Z') };
    const overridden = await Test.createTestingModule({ imports: [TimeModule] }).overrideProvider(Clock).useValue(fixed).compile();
    try {
      const clock = overridden.get(Clock);
      expect(calculateDeadline(clock.now(), { unit: 'WORKDAY', amount: 1 }).toISOString()).toBe('2026-11-16T02:00:00.123Z');
    } finally { await overridden.close(); }
  });
});

describe('期限日历规则', () => {
  const cases: [string, string, DeadlineRule, string][] = [
    ['周五加1工作日', '2026-11-13T10:00:00+08:00', { unit: 'WORKDAY', amount: 1 }, '2026-11-16T02:00:00.000Z'],
    ['周六加1工作日', '2026-11-14T10:00:00+08:00', { unit: 'WORKDAY', amount: 1 }, '2026-11-16T02:00:00.000Z'],
    ['周日加2工作日', '2026-11-15T10:00:00+08:00', { unit: 'WORKDAY', amount: 2 }, '2026-11-17T02:00:00.000Z'],
    ['周五加2自然日', '2026-11-13T10:00:00+08:00', { unit: 'NATURAL_DAY', amount: 2 }, '2026-11-15T02:00:00.000Z'],
    ['分钟跨北京时间午夜', '2026-11-10T23:50:00+08:00', { unit: 'MINUTE', amount: 30 }, '2026-11-10T16:20:00.000Z'],
    ['周一不计入起算日', '2026-11-16T10:00:00+08:00', { unit: 'WORKDAY', amount: 1 }, '2026-11-17T02:00:00.000Z'],
    ['整工作周', '2026-11-13T10:00:00+08:00', { unit: 'WORKDAY', amount: 5 }, '2026-11-20T02:00:00.000Z'],
    ['周末起算跨整工作周', '2026-11-14T10:00:00+08:00', { unit: 'WORKDAY', amount: 6 }, '2026-11-23T02:00:00.000Z'],
    ['30工作日', '2026-11-13T10:00:00+08:00', { unit: 'WORKDAY', amount: 30 }, '2026-12-25T02:00:00.000Z'],
    ['自然日跨月且保留毫秒', '2026-11-30T23:59:59.987+08:00', { unit: 'NATURAL_DAY', amount: 1 }, '2026-12-01T15:59:59.987Z'],
    ['自然日跨年', '2026-12-31T10:00:00+08:00', { unit: 'NATURAL_DAY', amount: 1 }, '2027-01-01T02:00:00.000Z'],
    ['工作日跨年且不使用节假日表', '2026-12-31T10:00:00+08:00', { unit: 'WORKDAY', amount: 2 }, '2027-01-04T02:00:00.000Z'],
    ['分钟跨年', '2026-12-31T23:50:00.123+08:00', { unit: 'MINUTE', amount: 30 }, '2026-12-31T16:20:00.123Z'],
    ['闰年2月29日', '2028-02-28T10:00:00+08:00', { unit: 'NATURAL_DAY', amount: 1 }, '2028-02-29T02:00:00.000Z'],
    ['闰年跨2月', '2028-02-28T10:00:00+08:00', { unit: 'NATURAL_DAY', amount: 2 }, '2028-03-01T02:00:00.000Z'],
    ['平年跨2月', '2027-02-28T10:00:00+08:00', { unit: 'NATURAL_DAY', amount: 1 }, '2027-03-01T02:00:00.000Z'],
    ['北京时间周一而UTC仍是周日', '2026-11-16T00:10:00.123+08:00', { unit: 'WORKDAY', amount: 1 }, '2026-11-16T16:10:00.123Z'],
    ['跨周末保留秒和毫秒', '2026-11-13T23:59:58.987+08:00', { unit: 'WORKDAY', amount: 1 }, '2026-11-16T15:59:58.987Z'],
    ['历史夏令时仍保留本地时分', '1991-04-13T03:30:00+08:00', { unit: 'NATURAL_DAY', amount: 1 }, '1991-04-13T18:30:00.000Z'],
    ['历史重复本地时刻取较早者', '1991-09-14T01:30:00+09:00', { unit: 'NATURAL_DAY', amount: 1 }, '1991-09-14T16:30:00.000Z'],
  ];
  it.each(cases)('%s', (_name, start, rule, expected) => {
    const startedAt = new Date(start); const before = startedAt.getTime();
    const result = calculateDeadline(startedAt, Object.freeze(rule));
    expect(result.toISOString()).toBe(expected);
    expect(startedAt.getTime()).toBe(before);
    expect(result).not.toBe(startedAt);
  });
  it('算法版本及业务时区可供后续规则快照引用', () => {
    expect(BUSINESS_TIME_ZONE).toBe('Asia/Shanghai');
    expect(DEADLINE_ALGORITHM_VERSION).toBe('shanghai-calendar-v1');
  });
  it('历史夏令时跳过的本地时刻明确失败，不静默改变时分', () => {
    expect(() => calculateDeadline(new Date('1991-04-13T02:30:00+08:00'), { unit: 'NATURAL_DAY', amount: 1 })).toThrow(RangeError);
  });
});

describe('到期与非法输入', () => {
  it.each([[-1, false], [0, true], [1, true]] as const)('当前时刻相对截止差%s毫秒', (delta, expected) => {
    const dueAt = new Date('2026-11-13T02:00:00.123Z');
    expect(isDeadlineReached(new Date(dueAt.getTime() + delta), dueAt)).toBe(expected);
  });
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '1', null])('拒绝非法数量%s', amount => {
    expect(() => calculateDeadline(new Date('2026-11-13T02:00:00Z'), { unit: 'WORKDAY', amount } as DeadlineRule)).toThrow(RangeError);
  });
  it.each(['DAY', 'workday', '', undefined])('拒绝未知单位%s', unit => {
    expect(() => calculateDeadline(new Date('2026-11-13T02:00:00Z'), { unit, amount: 1 } as DeadlineRule)).toThrow(RangeError);
  });
  it.each(['MINUTE', 'NATURAL_DAY', 'WORKDAY'] as const)('巨大%s期限快速拒绝日期溢出', unit => {
    expect(() => calculateDeadline(new Date('2026-11-13T02:00:00Z'), { unit, amount: Number.MAX_SAFE_INTEGER })).toThrow(RangeError);
  });
  it('拒绝缺失规则，不替无SLA任务新增期限', () => {
    expect(() => calculateDeadline(new Date(), null as unknown as DeadlineRule)).toThrow(RangeError);
  });
  it('无效日期不得被计算或默认为尚未到期', () => {
    const invalid = new Date(Number.NaN); const valid = new Date('2026-11-13T02:00:00Z');
    expect(() => calculateDeadline(invalid, { unit: 'MINUTE', amount: 1 })).toThrow(RangeError);
    expect(() => isDeadlineReached(invalid, valid)).toThrow(RangeError);
    expect(() => isDeadlineReached(valid, invalid)).toThrow(RangeError);
    expect(() => calculateDeadline('2026-11-13' as unknown as Date, { unit: 'MINUTE', amount: 1 })).toThrow(RangeError);
  });
});

describe('宿主时区隔离', () => {
  it.each(['UTC', 'America/Los_Angeles', 'Asia/Tokyo'])('独立Node进程使用%s时区仍得到北京时间期限', zone => {
    const sourceUrl = pathToFileURL(resolve(__dirname, '../src/common/time/deadline.ts')).href;
    // Node24原生剥离纯工具文件类型；显式参数传入子进程，不通过shell拼接执行。
    const source = `import { calculateDeadline } from ${JSON.stringify(sourceUrl)};
      const start = new Date('2026-11-13T02:00:00.123Z');
      console.log(JSON.stringify({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        dueAt: calculateDeadline(start, { unit: 'WORKDAY', amount: 1 }).toISOString() }));`;
    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', source], {
      env: { ...process.env, TZ: zone }, encoding: 'utf8', windowsHide: true, timeout: 10_000,
    });
    expect(JSON.parse(output)).toEqual({ zone, dueAt: '2026-11-16T02:00:00.123Z' });
  });
});
