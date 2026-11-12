/** 文件作用：收集顾客手机号密码，完成校验和登录并清除密码字段。 */
import { useState } from 'react';
import { Button, Form, Input } from 'antd';
import { Link } from 'react-router-dom';
import { validatePassword, type CustomerLoginInput } from '@shop/api-client';
import { AuthError } from '../auth/AuthError';
import { phoneIssue } from '../auth/form-rules';
import { customerAuth } from '../services/api';

export function LoginPage() {
  const [form] = Form.useForm<CustomerLoginInput>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(input: CustomerLoginInput) {
    if (submitting) return;
    setSubmitting(true); setError(null);
    try { await customerAuth.login({ phone: input.phone.trim(), password: input.password }); }
    catch (failure) { setError(failure); }
    finally { form.resetFields(['password']); setSubmitting(false); }
  }
  return <section className="login-panel"><h1>顾客登录</h1>
    <p className="muted">使用手机号与密码登录。</p>
    <AuthError error={error} />
    <Form form={form} layout="vertical" className="login-form" disabled={submitting} onFinish={submit}>
      <Form.Item label="手机号" name="phone" rules={[{ validator: (_, value: unknown) => {
        const issue = phoneIssue(value); return issue ? Promise.reject(new Error(issue)) : Promise.resolve();
      } }]}><Input type="tel" inputMode="tel" autoComplete="username" placeholder="请输入手机号" /></Form.Item>
      <Form.Item label="密码" name="password" rules={[{ validator: (_, value: unknown) => {
        const issue = validatePassword(value); return issue ? Promise.reject(new Error(issue.message)) : Promise.resolve();
      } }]}><Input.Password autoComplete="current-password" placeholder="请输入密码" /></Form.Item>
      <Button type="primary" htmlType="submit" block loading={submitting}>登录</Button>
    </Form>
    <p className="form-link">还没有账号？<Link to="/register">注册账号</Link></p>
  </section>;
}
