/** 文件作用：收集员工账号密码，完成校验和登录并清除密码字段。 */
import { useState } from 'react';
import { Button, Form, Input } from 'antd';
import { validatePassword, type EmployeeLoginInput } from '@shop/api-client';
import { AuthError } from '../auth/AuthError';
import { employeeAuth } from '../services/api';

export function LoginPage() {
  const [form] = Form.useForm<EmployeeLoginInput>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(input: EmployeeLoginInput) {
    if (submitting) return;
    setSubmitting(true); setError(null);
    try { await employeeAuth.login({ username: input.username.trim().toLowerCase(), password: input.password }); }
    catch (failure) { setError(failure); }
    finally { form.resetFields(['password']); setSubmitting(false); }
  }
  return <section className="login-panel"><h1>员工登录</h1>
    <p className="muted">请使用店铺管理员分配的员工账号。</p>
    <AuthError error={error} />
    <Form form={form} layout="vertical" className="login-form" disabled={submitting} onFinish={submit}>
      <Form.Item label="员工账号" name="username" rules={[{ required: true, message: '请输入员工账号' }, {
        validator: (_, value: unknown) => typeof value === 'string' && /^[a-z][a-z0-9_]{3,31}$/i.test(value.trim())
          ? Promise.resolve() : Promise.reject(new Error('账号须为4～32位字母、数字或下划线，以字母开头')),
      }]}><Input autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="请输入员工账号" /></Form.Item>
      <Form.Item label="密码" name="password" rules={[{ validator: (_, value: unknown) => {
        const issue = validatePassword(value); return issue ? Promise.reject(new Error(issue.message)) : Promise.resolve();
      } }]}><Input.Password autoComplete="current-password" placeholder="请输入密码" /></Form.Item>
      <Button type="primary" htmlType="submit" block loading={submitting}>登录</Button>
    </Form>
  </section>;
}
