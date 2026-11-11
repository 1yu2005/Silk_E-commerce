import { Alert, Button, Form, Input } from 'antd';

export function LoginPage() {
  return <section className="login-panel"><h1>顾客登录</h1>
    <p className="muted">使用手机号与密码登录。</p>
    <Alert title="登录功能尚未开放" description="当前仅展示登录页面，账号认证将在下一阶段接入。" type="info" showIcon />
    <Form layout="vertical" className="login-form" disabled>
      <Form.Item label="手机号" name="account"><Input autoComplete="username" placeholder="请输入手机号" /></Form.Item>
      <Form.Item label="密码" name="password"><Input.Password autoComplete="current-password" placeholder="请输入密码" /></Form.Item>
      <Button type="primary" block disabled>登录暂未开放</Button>
    </Form>
  </section>;
}
