/** 文件作用：处理顾客注册与确认密码校验，注册成功后前往登录。 */
import { useEffect, useRef, useState } from 'react';
import { Button, Form, Input } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { validatePassword, type CustomerRegisterInput } from '@shop/api-client';
import { AuthError } from '../auth/AuthError';
import { phoneIssue, nicknameIssue, registrationInput } from '../auth/form-rules';
import { customerAuth } from '../services/api';

interface RegisterForm extends CustomerRegisterInput { confirmation: string }
export function RegisterPage() {
  const [form] = Form.useForm<RegisterForm>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const navigate = useNavigate();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function submit(input: RegisterForm) {
    if (submitting) return;
    setSubmitting(true); setError(null);
    try {
      const completed = await customerAuth.register(registrationInput(input));
      // 离开注册页或切换登录后，迟到的成功结果不能把用户带回登录页。
      if (completed && mounted.current) void navigate('/login', { replace: true });
    } catch (failure) { if (mounted.current) setError(failure); }
    finally { form.resetFields(['password', 'confirmation']); if (mounted.current) setSubmitting(false); }
  }
  return <section className="login-panel"><h1>注册顾客账号</h1>
    <p className="muted">使用手机号和密码创建账号。注册成功后，请再登录。</p>
    <AuthError error={error} />
    <Form form={form} layout="vertical" className="login-form" disabled={submitting} onFinish={submit}>
      <Form.Item label="手机号" name="phone" rules={[{ validator: (_, value: unknown) => {
        const issue = phoneIssue(value); return issue ? Promise.reject(new Error(issue)) : Promise.resolve();
      } }]}><Input type="tel" inputMode="tel" autoComplete="username" placeholder="请输入手机号" /></Form.Item>
      <Form.Item label="昵称（可选）" name="nickname" rules={[{ validator: (_, value: unknown) => {
        const issue = nicknameIssue(value); return issue ? Promise.reject(new Error(issue)) : Promise.resolve();
      } }]}><Input autoComplete="nickname" placeholder="不填时使用默认昵称" /></Form.Item>
      <Form.Item label="密码" name="password" extra="8～64个字符，UTF-8编码不超过72字节；空格会原样保留。" rules={[{ validator: (_, value: unknown) => {
        const issue = validatePassword(value); return issue ? Promise.reject(new Error(issue.message)) : Promise.resolve();
      } }]}><Input.Password autoComplete="new-password" /></Form.Item>
      <Form.Item label="确认密码" name="confirmation" dependencies={['password']} rules={[{ required: true, message: '请再次输入密码' }, ({ getFieldValue }) => ({
        validator: (_, value: unknown) => value === getFieldValue('password') ? Promise.resolve() : Promise.reject(new Error('两次密码不一致')),
      })]}><Input.Password autoComplete="new-password" /></Form.Item>
      <Button type="primary" htmlType="submit" block loading={submitting}>注册</Button>
    </Form>
    <p className="form-link">已有账号？<Link to="/login">顾客登录</Link></p>
  </section>;
}
