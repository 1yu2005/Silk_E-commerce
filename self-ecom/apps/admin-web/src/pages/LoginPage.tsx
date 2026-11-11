import { Alert, Button, Form, Input } from 'antd';

export function LoginPage() {
  return <section className="login-panel"><h1>员工登录</h1>
    <p className="muted">请使用店铺管理员分配的员工账号。</p>
    <Alert title="登录功能尚未开放" description="当前仅展示登录页面，账号认证将在下一阶段接入。" type="info" showIcon />
    <Form layout="vertical" className="login-form" disabled>
      <Form.Item label="员工账号" name="account"><Input autoComplete="username" placeholder="请输入员工账号" /></Form.Item>
      <Form.Item label="密码" name="password"><Input.Password autoComplete="current-password" placeholder="请输入密码" /></Form.Item>
      <Button type="primary" block disabled>登录暂未开放</Button>
    </Form>
  </section>;
}
