/** 文件作用：创建员工账号，校验初始密码并提示首次登录改密。 */
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Input, Select, Space } from 'antd';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiClientError, validatePassword, type EmployeeCreateData, type EmployeeCreateInput } from '@shop/api-client';
import { AuthError } from '../auth/AuthError';
import { employees, session } from '../services/api';
import { employeeRoles, employeeSearchParams, parseEmployeeSearch } from '../employees/query';
import { employeeCreateInput, employeeDisplayNameIssue, employeeReasonIssue, employeeRoleIssue, employeeUsernameIssue } from '../employees/create';

interface CreateForm extends EmployeeCreateInput { confirmation: string }
const rule = (validate: (value: unknown) => string | null) => ({ validator: (_: unknown, value: unknown) => {
  const issue = validate(value); return issue ? Promise.reject(new Error(issue)) : Promise.resolve();
} });

export function EmployeeCreatePage() {
  const [form] = Form.useForm<CreateForm>(); const [params] = useSearchParams();
  const parsed = parseEmployeeSearch(params.toString()); const search = parsed.query ? `?${employeeSearchParams(parsed.query)}` : '';
  const [submitting, setSubmitting] = useState(false); const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<EmployeeCreateData | null>(null);
  const mounted = useRef(true); const pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const role = Form.useWatch('role', form);
  const uncertain = !!error && (!(error instanceof ApiClientError) || !error.status || error.status >= 500);

  async function submit(input: CreateForm) {
    if (pending.current || !session.current().credential) return;
    pending.current = true; setSubmitting(true); setError(null);
    const revision = session.current().revision; const loginRevision = session.getLoginRevision();
    const isCurrent = () => mounted.current && session.current().revision === revision && session.getLoginRevision() === loginRevision;
    try {
      const { data } = await employees.create(employeeCreateInput(input));
      // 离开页面、退出或切换登录后，迟到的创建结果不能改写当前页面。
      if (isCurrent()) setCreated(data);
    } catch (failure) { if (isCurrent()) setError(failure); }
    finally {
      if (mounted.current) { form.resetFields(['initialPassword', 'confirmation']); setSubmitting(false); }
      pending.current = false;
    }
  }

  return <section className="employee-panel employee-create-panel"><Link to={`/employees${search}`}>返回员工列表</Link>
    {created ? <><h1 className="employee-detail-title">员工已创建</h1>
      <Alert type="success" showIcon title={`${created.displayName}（${created.username}）已创建`} description="账号已启用，员工首次登录必须修改密码。请将账号和初始密码交给员工本人。" />
      <Space className="auth-actions" wrap><Link to={`/employees/${created.id}${search}`}>查看员工详情</Link><Link to={`/employees${search}`}>返回列表</Link></Space>
    </> : <><h1 className="employee-detail-title">创建员工</h1>
      <p className="muted">为店铺分配员工账号和岗位。创建后默认启用，首次登录必须修改密码。</p>
      <AuthError error={error} />
      {uncertain ? <Alert className="auth-notice" type="info" showIcon title="创建结果未确认"
        description="请先返回员工列表，按账号查询是否已创建，再决定是否重试。" /> : null}
      <Form form={form} className="employee-create-form" layout="vertical" clearOnDestroy disabled={submitting} onFinish={submit}>
        <div className="employee-create-grid">
          <Form.Item required label="员工账号" name="username" extra="4～32位字母、数字或下划线，以字母开头；保存为小写，创建后不可修改。" rules={[rule(employeeUsernameIssue)]}>
            <Input autoComplete="off" autoCapitalize="none" spellCheck={false} /></Form.Item>
          <Form.Item required label="显示名" name="displayName" rules={[rule(employeeDisplayNameIssue)]}><Input autoComplete="off" /></Form.Item>
        </div>
        <Form.Item required label="岗位" name="role" rules={[rule(employeeRoleIssue)]}><Select placeholder="请选择岗位" options={Object.entries(employeeRoles).map(([value, label]) => ({ value, label }))} /></Form.Item>
        {role === 'SUPER_ADMIN' ? <Alert className="auth-notice" type="warning" showIcon title="超级管理员拥有全部后台管理权限，请确认该岗位安排。" /> : null}
        <div className="employee-create-grid">
          <Form.Item required label="初始密码" name="initialPassword" extra="8～64个字符，UTF-8编码不超过72字节；空格会原样保留。" rules={[rule(value => validatePassword(value)?.message ?? null)]}>
            <Input.Password autoComplete="new-password" /></Form.Item>
          <Form.Item label="确认初始密码" name="confirmation" dependencies={['initialPassword']} rules={[{ required: true, message: '请再次输入初始密码' }, ({ getFieldValue }) => ({
            validator: (_, value: unknown) => value === getFieldValue('initialPassword') ? Promise.resolve() : Promise.reject(new Error('两次初始密码不一致')),
          })]}><Input.Password autoComplete="new-password" /></Form.Item>
        </div>
        <Form.Item required label="创建原因" name="reason" extra="说明本次人员安排，最多500个字符。" rules={[rule(employeeReasonIssue)]}><Input.TextArea rows={3} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={submitting}>创建员工</Button>
      </Form>
    </>}
  </section>;
}
