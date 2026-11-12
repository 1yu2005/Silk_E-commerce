/** 文件作用：处理顾客本人改密，成功后清除会话并要求重新登录。 */
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Input } from 'antd';
import { Link } from 'react-router-dom';
import { validatePassword, validatePasswordChange, type ChangePasswordInput } from '@shop/api-client';
import { AuthError } from '../auth/AuthError';
import { customerAuth } from '../services/api';

interface PasswordForm extends ChangePasswordInput { confirmation: string }

export function ChangePasswordPage() {
  const [form] = Form.useForm<PasswordForm>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const passwordRule = { validator: (_: unknown, value: unknown) => {
    const issue = validatePassword(value); return issue ? Promise.reject(new Error(issue.message)) : Promise.resolve();
  } };
  async function submit(input: PasswordForm) {
    if (submitting) return;
    setSubmitting(true); setError(null);
    try { await customerAuth.changePassword({ oldPassword: input.oldPassword, newPassword: input.newPassword }); }
    catch (failure) { if (mounted.current) setError(failure); }
    finally { form.resetFields(); if (mounted.current) setSubmitting(false); }
  }
  return <section className="login-panel"><h1>修改密码</h1>
    <Alert type="info" showIcon title="改密后需要重新登录"
      description="修改成功会退出本账号的所有登录会话。密码为8～64个字符，UTF-8编码不超过72字节；密码中的空格会原样保留。" />
    <AuthError error={error} />
    <Form form={form} layout="vertical" className="login-form" disabled={submitting} onFinish={submit}>
      <Form.Item label="旧密码" name="oldPassword" rules={[passwordRule]}><Input.Password autoComplete="current-password" /></Form.Item>
      <Form.Item label="新密码" name="newPassword" dependencies={['oldPassword']} rules={[passwordRule, ({ getFieldValue }) => ({
        validator: (_, value: unknown) => {
          const issue = validatePasswordChange(getFieldValue('oldPassword'), value);
          return issue?.code === 'PASSWORD_UNCHANGED' ? Promise.reject(new Error(issue.message)) : Promise.resolve();
        },
      })]}><Input.Password autoComplete="new-password" /></Form.Item>
      <Form.Item label="确认新密码" name="confirmation" dependencies={['newPassword']} rules={[{ required: true, message: '请再次输入新密码' }, ({ getFieldValue }) => ({
        validator: (_, value: unknown) => value === getFieldValue('newPassword') ? Promise.resolve() : Promise.reject(new Error('两次新密码不一致')),
      })]}><Input.Password autoComplete="new-password" /></Form.Item>
      <Button type="primary" htmlType="submit" block loading={submitting}>修改密码并重新登录</Button>
    </Form>
    <p className="form-link"><Link to="/account">返回我的账号</Link></p>
  </section>;
}
