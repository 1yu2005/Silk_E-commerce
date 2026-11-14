/** 文件作用：展示顾客本人资料，提供昵称编辑和修改密码入口。 */
import { useEffect, useRef, useState } from 'react';
import { Button, Descriptions, Form, Input, Space, Tag } from 'antd';
import { Link } from 'react-router-dom';
import type { CustomerProfileInput } from '@shop/api-client';
import { useCustomerAuth } from '../auth/use-customer-auth';
import { AuthError } from '../auth/AuthError';
import { nicknameIssue } from '../auth/form-rules';
import { customerAuth } from '../services/api';
import { AvatarEditor } from './AvatarEditor';

function NicknameEditor({ nickname, onClose }: { nickname: string; onClose: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function submit(input: CustomerProfileInput) {
    if (submitting) return;
    setSubmitting(true); setError(null);
    try { if (await customerAuth.updateProfile({ nickname: input.nickname }) && mounted.current) onClose(); }
    catch (failure) { if (mounted.current) setError(failure); }
    finally { if (mounted.current) setSubmitting(false); }
  }
  return <div className="nickname-editor"><h2>编辑昵称</h2><AuthError error={error} />
    <Form<CustomerProfileInput> layout="vertical" disabled={submitting} initialValues={{ nickname }} onFinish={submit}>
      <Form.Item label="昵称" name="nickname" extra="去掉首尾空格后，须为1～40个字符。" rules={[{ validator: (_, value: unknown) => {
        const issue = nicknameIssue(value, true); return issue ? Promise.reject(new Error(issue)) : Promise.resolve();
      } }]}><Input autoComplete="nickname" /></Form.Item>
      <Space wrap><Button type="primary" htmlType="submit" loading={submitting}>保存昵称</Button>
        <Button onClick={onClose}>取消</Button></Space>
    </Form>
  </div>;
}

export function AccountPage() {
  const { customer } = useCustomerAuth();
  const [editing, setEditing] = useState(false);
  if (!customer) return null;
  return <section className="account-panel"><h1>我的账号</h1><AvatarEditor avatarUrl={customer.avatarUrl} />
    <Descriptions bordered column={1} items={[
      { key: 'phone', label: '手机号', children: customer.phone },
      { key: 'nickname', label: '昵称', children: customer.nickname },
      { key: 'status', label: '账号状态', children: <Tag color={customer.status === 'NORMAL' ? 'green' : 'orange'}>{customer.status === 'NORMAL' ? '正常' : '交易受限'}</Tag> },
      { key: 'createdAt', label: '注册时间', children: new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(customer.createdAt)) },
    ]} />
    {editing ? <NicknameEditor nickname={customer.nickname} onClose={() => setEditing(false)} /> :
      <div className="auth-actions"><Button onClick={() => setEditing(true)}>编辑昵称</Button></div>}
    <p className="form-link"><Link to="/addresses">管理收货地址</Link> · <Link to="/cart">查看购物车</Link> · <Link to="/change-password">修改密码</Link></p>
  </section>;
}
