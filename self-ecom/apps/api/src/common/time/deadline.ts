// 作用：按北京时间计算分钟、自然日、工作日期限及截止等号，不依赖操作系统默认时区。
export const BUSINESS_TIME_ZONE = 'Asia/Shanghai';
export const DEADLINE_ALGORITHM_VERSION = 'shanghai-calendar-v1';

export interface DeadlineRule {
  readonly unit: 'MINUTE' | 'NATURAL_DAY' | 'WORKDAY';
  readonly amount: number;
}

const DAY_MS = 86_400_000;
const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TIME_ZONE, calendar: 'iso8601', numberingSystem: 'latn',
  era: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function timestamp(value: Date): number {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new RangeError('时刻必须是有效的Date');
  return value.getTime();
}

/** 将北京时间字段放入UTC日历容器；该容器只用于日历运算，不代表真实业务时刻。 */
function localCalendar(instant: Date): Date {
  timestamp(instant);
  const parts = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
  const year = parts.era === 'BC' ? 1 - Number(parts.year) : Number(parts.year);
  const calendar = new Date(0);
  // setUTCFullYear避免Date.UTC把0～99年解释为1900～1999年。
  calendar.setUTCFullYear(year, Number(parts.month) - 1, Number(parts.day));
  calendar.setUTCHours(Number(parts.hour), Number(parts.minute), Number(parts.second), instant.getUTCMilliseconds());
  timestamp(calendar);
  return calendar;
}

/** 解析IANA时区偏移，保留历史夏令时语义，不把自然日硬编码为24小时。 */
function instantFromCalendar(calendar: Date): Date {
  const wallTime = timestamp(calendar);
  const offsets = new Set<number>();
  // 上海历史偏移及夏令时转换都落在相邻日内；最多三个样本，无开放式重试循环。
  for (const delta of [-DAY_MS, 0, DAY_MS]) {
    const sample = new Date(wallTime + delta);
    if (Number.isFinite(sample.getTime())) offsets.add(timestamp(localCalendar(sample)) - sample.getTime());
  }
  const matches = [...offsets].map(offset => new Date(wallTime - offset))
    .filter(instant => Number.isFinite(instant.getTime()) && timestamp(localCalendar(instant)) === wallTime);
  if (!matches.length) throw new RangeError('期限超出日期范围，或北京时间本地时刻不存在');
  // 历史秋季回拨出现重复本地时刻时，固定取较早时刻，保证结果可复算。
  return new Date(Math.min(...matches.map(instant => instant.getTime())));
}

function advanceWorkdays(calendar: Date, amount: number): void {
  let remaining = amount;
  const weekday = calendar.getUTCDay();
  // 周末起算后的第一个周一算第1工作日，不把起算日计入期限。
  if (weekday === 6 || weekday === 0) {
    calendar.setUTCDate(calendar.getUTCDate() + (weekday === 6 ? 2 : 1));
    remaining--;
  }
  // 整周直接推进，余数最多4个工作日，避免大数输入造成逐日长循环。
  calendar.setUTCDate(calendar.getUTCDate() + Math.floor(remaining / 5) * 7);
  timestamp(calendar);
  remaining %= 5;
  while (remaining > 0) {
    calendar.setUTCDate(calendar.getUTCDate() + 1);
    timestamp(calendar);
    if (calendar.getUTCDay() !== 0 && calendar.getUTCDay() !== 6) remaining--;
  }
}

/** 只计算明确的正整数期限；无SLA由调用方保留null，不在此补默认天数。 */
export function calculateDeadline(startedAt: Date, rule: Readonly<DeadlineRule>): Date {
  const start = timestamp(startedAt);
  if (!rule || !Number.isSafeInteger(rule.amount) || rule.amount <= 0
    || !['MINUTE', 'NATURAL_DAY', 'WORKDAY'].includes(rule.unit)) throw new RangeError('期限单位或数量不合法');
  if (rule.unit === 'MINUTE') {
    const result = new Date(start + rule.amount * 60_000);
    timestamp(result);
    return result;
  }
  const calendar = localCalendar(startedAt);
  if (rule.unit === 'NATURAL_DAY') calendar.setUTCDate(calendar.getUTCDate() + rule.amount);
  else advanceWorkdays(calendar, rule.amount);
  return instantFromCalendar(calendar);
}

/** 等于截止即已到期；业务命令应在持锁后取服务器当前时刻再次检查。 */
export function isDeadlineReached(now: Date, dueAt: Date): boolean {
  return timestamp(now) >= timestamp(dueAt);
}
