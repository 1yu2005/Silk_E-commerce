// 作用：验证首管理员初始化的账号规范化、密码规则和配置错误。
import { expect, it } from 'vitest';
import { InitialAdminSeedError, readInitialAdminConfig } from '../src/auth/initial-admin-seed.js';

it('省略初始化配置时使用admin和admin123', () => {
  expect(readInitialAdminConfig({})).toEqual({ username: 'admin', password: 'admin123' });
});
it('只覆盖账号或密码时，另一个字段沿用默认值', () => {
  expect(readInitialAdminConfig({ INIT_ADMIN_USERNAME: 'other_admin' }))
    .toEqual({ username: 'other_admin', password: 'admin123' });
  expect(readInitialAdminConfig({ INIT_ADMIN_PASSWORD: 'Custom#2026' }))
    .toEqual({ username: 'admin', password: 'Custom#2026' });
});
it('规范化初始化账号，但密码中的空格原样保留', () => {
  expect(readInitialAdminConfig({ INIT_ADMIN_USERNAME: '  ADMIN_01  ', INIT_ADMIN_PASSWORD: ' Demo#2026 ' }))
    .toEqual({ username: 'admin_01', password: ' Demo#2026 ' });
});
it.each(['', 'abc', '1admin', 'admin-name', 'a'.repeat(33)])('拒绝非法初始化账号配置', username => {
  expect(() => readInitialAdminConfig({ INIT_ADMIN_USERNAME: username, INIT_ADMIN_PASSWORD: 'Demo#2026' }))
    .toThrow(InitialAdminSeedError);
});
it.each(['', 'short', 'a'.repeat(65), '密'.repeat(25), 'password\ud800'])('拒绝非法初始化密码且错误不带输入', password => {
  expect(() => readInitialAdminConfig({ INIT_ADMIN_USERNAME: 'admin', INIT_ADMIN_PASSWORD: password }))
    .toThrow('INIT_ADMIN_PASSWORD: 必填，须为8～64个Unicode字符且UTF-8不超过72字节');
});
