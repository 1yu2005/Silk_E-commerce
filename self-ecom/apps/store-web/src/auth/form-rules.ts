/** 文件作用：校验手机号和昵称，组装顾客注册白名单请求。 */
import type { CustomerRegisterInput } from '@shop/api-client';

export function phoneIssue(value: unknown): string | null {
  return typeof value === 'string' && /^1[3-9][0-9]{9}$/.test(value.trim()) ? null : '请输入有效的11位大陆手机号';
}

export function nicknameIssue(value: unknown, required = false): string | null {
  if (value === undefined || value === '') return required ? '请填写昵称' : null;
  if (typeof value !== 'string') return '昵称须为文本';
  const length = Array.from(value.trim()).length;
  return length >= 1 && length <= 40 ? null : '昵称须为1～40个字符，不能只有空格';
}

/** 确认密码只用于页面校验；省略空的可选昵称，绝不向API提交额外表单字段。 */
export function registrationInput(input: CustomerRegisterInput): CustomerRegisterInput {
  return { phone: input.phone.trim(), password: input.password,
    ...(input.nickname === undefined || input.nickname === '' ? {} : { nickname: input.nickname.trim() }) };
}
