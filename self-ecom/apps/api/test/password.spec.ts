// 作用：验证密码 Unicode 与字节边界、原文保留及真实 bcrypt 行为。
import { expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import { PASSWORD_POLICY, validatePassword, validatePasswordChange } from '@shop/shared';
import { BCRYPT_COST, PasswordInputError, PasswordService } from '../src/auth/password.service.js';

const passwords = new PasswordService();

it.each([
  ['ASCII下界', 'a'.repeat(8)], ['ASCII上界', 'a'.repeat(64)],
  ['中文72字节', '密'.repeat(24)], ['表情72字节', '😀'.repeat(18)],
  ['混合72字节', '密'.repeat(20) + 'a'.repeat(12)], ['空格原样保留', '  demo  '],
  ['不新增复杂度要求', ' '.repeat(8)],
])('%s可接受', (_name, value) => { expect(validatePassword(value)).toBeNull(); });

it.each([
  ['空值', undefined, 'PASSWORD_REQUIRED'], ['非字符串', 12345678, 'PASSWORD_REQUIRED'],
  ['空密码', '', 'PASSWORD_TOO_SHORT'], ['ASCII7字符', 'a'.repeat(7), 'PASSWORD_TOO_SHORT'],
  ['表情7码点但JS长度14', '😀'.repeat(7), 'PASSWORD_TOO_SHORT'],
  ['ASCII65字符', 'a'.repeat(65), 'PASSWORD_TOO_LONG'],
  ['中文25字符75字节', '密'.repeat(25), 'PASSWORD_TOO_MANY_BYTES'],
  ['表情19字符76字节', '😀'.repeat(19), 'PASSWORD_TOO_MANY_BYTES'],
  ['恰好73字节', '密'.repeat(24) + 'a', 'PASSWORD_TOO_MANY_BYTES'],
  ['孤立高代理项', 'a'.repeat(8) + '\ud800', 'PASSWORD_INVALID_UNICODE'],
  ['孤立低代理项', 'a'.repeat(8) + '\udc00', 'PASSWORD_INVALID_UNICODE'],
])('%s拒绝且不回显密码', (_name, value, code) => {
  expect(validatePassword(value)?.code).toBe(code);
  expect(Object.keys(validatePassword(value)!)).toEqual(['code', 'message']);
});

it('改密拒绝相同原文，空格和Unicode不被自动规范化', () => {
  expect(validatePasswordChange('Demo#2026', 'Demo#2026')?.code).toBe('PASSWORD_UNCHANGED');
  expect(validatePasswordChange('Demo#2026', ' Demo#2026 ')).toBeNull();
  expect(validatePasswordChange('aaaaaaaé', 'aaaaaaae\u0301')).toBeNull();
  expect(validatePasswordChange('Demo#2026', 'short')?.code).toBe('PASSWORD_TOO_SHORT');
  expect(() => passwords.assertPasswordChange('Demo#2026', 'Demo#2026')).toThrow(PasswordInputError);
  expect(Object.isFrozen(PASSWORD_POLICY)).toBe(true);
});

it('真实bcrypt使用cost12和随机盐，正确密码通过、错误密码失败', async () => {
  const plaintext = '虚构测试密码甲A';
  const first = await passwords.hash(plaintext);
  const second = await passwords.hash(plaintext);
  expect(first).not.toBe(plaintext);
  expect(first).not.toBe(second);
  expect(bcrypt.getRounds(first)).toBe(12);
  expect(BCRYPT_COST).toBe(12);
  expect(await passwords.verify(plaintext, first)).toBe(true);
  expect(await passwords.verify('虚构测试密码甲B', first)).toBe(false);
});

it('hash和verify都会在bcrypt前拒绝超限与非法Unicode', async () => {
  const stored = await passwords.hash('Demo#2026');
  for (const password of ['short', 'a'.repeat(65), '密'.repeat(25), 'a'.repeat(8) + '\ud800']) {
    await expect(passwords.hash(password)).rejects.toBeInstanceOf(PasswordInputError);
    await expect(passwords.verify(password, stored)).rejects.toBeInstanceOf(PasswordInputError);
  }
});

it('同前64字节但末尾不同的合法72字节密码不能匹配', async () => {
  const prefix = '密'.repeat(20) + 'a'.repeat(4);
  const first = prefix + '密A密A';
  const second = prefix + '密A密B';
  expect([...first].length).toBeLessThan(64);
  expect(new TextEncoder().encode(first)).toHaveLength(72);
  const stored = await passwords.hash(first);
  expect(await passwords.verify(first, stored)).toBe(true);
  expect(await passwords.verify(second, stored)).toBe(false);
  // 对相同72字节前缀加尾巴的输入必须拒绝，不能让bcrypt截断后误判成功。
  await expect(passwords.verify(first + 'X', stored)).rejects.toBeInstanceOf(PasswordInputError);
});

it('哈希与验证保留首尾空格，不把trim后的密码当作原密码', async () => {
  const stored = await passwords.hash(' Demo#2026 ');
  expect(await passwords.verify(' Demo#2026 ', stored)).toBe(true);
  expect(await passwords.verify('Demo#2026', stored)).toBe(false);
});
