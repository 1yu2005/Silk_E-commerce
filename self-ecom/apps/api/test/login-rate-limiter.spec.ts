// 作用：验证认证限流窗口、在途预留、有界容量及注册与登录预算隔离。
import { expect, it } from 'vitest';
import { LoginRateLimiter, LOGIN_RATE_POLICY } from '../src/auth/login-rate-limiter.js';

it('IP第30次可进入，第31次拒绝；时间等于窗口末端恢复', () => {
  let now = 0; const limiter = new LoginRateLimiter(() => now);
  for (let index = 0; index < 30; index++) limiter.consumeIp('127.0.0.1');
  expect(() => limiter.consumeIp('127.0.0.1')).toThrowError(expect.objectContaining({ code: 'AUTH_RATE_LIMITED', retryAfterSeconds: 60 }));
  now = 59_001;
  expect(() => limiter.consumeIp('127.0.0.1')).toThrowError(expect.objectContaining({ retryAfterSeconds: 1 }));
  now = 60_000; expect(() => limiter.consumeIp('127.0.0.1')).not.toThrow();
});

it('账号第五次失败后，第六次被拒绝；窗口等号恢复', () => {
  let now = 0; const limiter = new LoginRateLimiter(() => now);
  for (let index = 0; index < 5; index++) limiter.finish(limiter.reserveAccount('service_a', '127.0.0.1'), true);
  expect(() => limiter.reserveAccount('service_a', '127.0.0.1')).toThrowError(expect.objectContaining({ retryAfterSeconds: 300 }));
  now = 300_000; expect(() => limiter.reserveAccount('service_a', '127.0.0.1')).not.toThrow();
});

it('在途请求占名额，完成成功会释放，但不会清掉之前失败', () => {
  const limiter = new LoginRateLimiter(() => 0);
  limiter.finish(limiter.reserveAccount('service_a', 'ip'), true);
  const pending = Array.from({ length: 4 }, () => limiter.reserveAccount('service_a', 'ip'));
  expect(() => limiter.reserveAccount('service_a', 'ip')).toThrowError(expect.objectContaining({ retryAfterSeconds: 1 }));
  for (const ticket of pending) limiter.finish(ticket, false);
  for (let index = 0; index < 4; index++) limiter.finish(limiter.reserveAccount('service_a', 'ip'), true);
  expect(() => limiter.reserveAccount('service_a', 'ip')).toThrowError(expect.objectContaining({ retryAfterSeconds: 300 }));
});

it('失败时间按滑动五分钟保留，不在首个失败到期时清掉较新的失败', () => {
  let now = 0; const limiter = new LoginRateLimiter(() => now);
  limiter.finish(limiter.reserveAccount('service_a', 'ip'), true);
  now = 60_000;
  for (let index = 0; index < 4; index++) limiter.finish(limiter.reserveAccount('service_a', 'ip'), true);
  now = 300_000;
  limiter.finish(limiter.reserveAccount('service_a', 'ip'), true);
  expect(() => limiter.reserveAccount('service_a', 'ip')).toThrowError(expect.objectContaining({ retryAfterSeconds: 60 }));
});

it('账号和来源IP分别隔离，重复finish不会重复计数', () => {
  const limiter = new LoginRateLimiter(() => 0);
  for (let index = 0; index < 5; index++) {
    const ticket = limiter.reserveAccount('service_a', 'first'); limiter.finish(ticket, true); limiter.finish(ticket, true);
  }
  expect(() => limiter.reserveAccount('service_a', 'second')).not.toThrow();
  expect(() => limiter.reserveAccount('service_b', 'first')).not.toThrow();
});

it('容量耗尽时拒绝新键而非淘汰旧限额，到期清理后恢复', () => {
  let now = 0;
  const limiter = new LoginRateLimiter(() => now, { ...LOGIN_RATE_POLICY, maxIpEntries: 1, maxAccountEntries: 1 });
  limiter.consumeIp('first'); expect(() => limiter.consumeIp('second')).toThrow('认证尝试过于频繁');
  limiter.finish(limiter.reserveAccount('service_a', 'first'), true);
  expect(() => limiter.reserveAccount('service_b', 'first')).toThrow('认证尝试过于频繁');
  now = 300_000;
  expect(() => limiter.consumeIp('second')).not.toThrow();
  expect(() => limiter.reserveAccount('service_b', 'first')).not.toThrow();
});

it('成功请求立即释放账号键，不会因为成功登录耗尽账号容量', () => {
  const limiter = new LoginRateLimiter(() => 0, { ...LOGIN_RATE_POLICY, maxAccountEntries: 1 });
  limiter.finish(limiter.reserveAccount('service_a', 'ip'), false);
  expect(() => limiter.reserveAccount('service_b', 'ip')).not.toThrow();
});
