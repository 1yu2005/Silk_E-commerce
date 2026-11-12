/** 文件作用：统一前后端密码规则，按 Unicode 字符数和 UTF-8 字节数校验。 */
export const PASSWORD_POLICY = Object.freeze({ minCodePoints: 8, maxCodePoints: 64, maxUtf8Bytes: 72 });

export interface PasswordIssue {
  code: 'PASSWORD_REQUIRED' | 'PASSWORD_TOO_SHORT' | 'PASSWORD_TOO_LONG'
    | 'PASSWORD_TOO_MANY_BYTES' | 'PASSWORD_INVALID_UNICODE' | 'PASSWORD_UNCHANGED';
  message: string;
}

export function validatePassword(password: unknown): PasswordIssue | null {
  if (typeof password !== 'string') return { code: 'PASSWORD_REQUIRED', message: '密码必须为字符串' };
  let count = 0;
  for (const character of password) {
    // 未配对代理项不是合法Unicode字符，UTF-8编码会替换它，须拒绝以免不同输入被视为同一密码。
    const point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) return { code: 'PASSWORD_INVALID_UNICODE', message: '密码含无效Unicode字符' };
    count++;
    if (count > PASSWORD_POLICY.maxCodePoints) return { code: 'PASSWORD_TOO_LONG', message: '密码最多64个Unicode字符' };
  }
  if (count < PASSWORD_POLICY.minCodePoints) return { code: 'PASSWORD_TOO_SHORT', message: '密码至少8个Unicode字符' };
  if (new TextEncoder().encode(password).byteLength > PASSWORD_POLICY.maxUtf8Bytes) {
    return { code: 'PASSWORD_TOO_MANY_BYTES', message: '密码的UTF-8编码不得超过72字节' };
  }
  return null;
}

/** 只检查格式与原文相等性；旧密码是否正确仍须服务端核验。 */
export function validatePasswordChange(oldPassword: unknown, newPassword: unknown): PasswordIssue | null {
  const issue = validatePassword(oldPassword) ?? validatePassword(newPassword);
  if (issue) return issue;
  if (oldPassword === newPassword) return { code: 'PASSWORD_UNCHANGED', message: '新密码不得与旧密码相同' };
  return null;
}
