/** 文件作用：提供员工改名、启停、重置密码、调岗和额外权限表单。 */
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Form, Input, Modal, Select, Space } from 'antd';
import { Link } from 'react-router-dom';
import { ApiClientError, validatePassword, type EmployeeDetail, type EmployeeRole, type PermissionCatalog, type PermissionResolution } from '@shop/api-client';
import { AuthError } from '../auth/AuthError';
import { useEmployeeAuth } from '../auth/use-employee-auth';
import { employees, employeeAuth, employeeQueries, session } from '../services/api';
import { employeeDisplayNameIssue, employeeRoleIssue } from './create';
import { canManageEmployee, managementReasonIssue, previewExtraPermissions, runEmployeeMutation, type EmployeeOperation } from './management';
import { employeeRoles } from './query';

const titles: Record<EmployeeOperation, string> = { profile: '修改显示名', status: '调整账号状态', reset: '重置员工密码', role: '员工调岗', permissions: '编辑额外权限' };
const rule = (validate: (value: unknown) => string | null) => ({ validator: (_: unknown, value: unknown) => {
  const issue = validate(value); return issue ? Promise.reject(new Error(issue)) : Promise.resolve();
} });
interface EditForm { displayName: string; role: EmployeeRole; temporaryPassword: string; confirmation: string; permissions: string[]; reason: string }
interface Editing { operation: EmployeeOperation; target: EmployeeDetail }

function PermissionCodes({ values, catalog }: { values: string[]; catalog: PermissionCatalog }) {
  const byCode = new Map(catalog.permissions.map(item => [item.code, item.name]));
  return values.length ? <ul className="permission-preview-list">{values.map(code => <li key={code}>{byCode.get(code)} <code>{code}</code></li>)}</ul> : <p className="muted">无</p>;
}

function ManagementDialog({ editing: { operation, target }, catalog, onClose, onSaved }: {
  editing: Editing; catalog: PermissionCatalog | null; onClose: () => void; onSaved: (message: string, resolution?: PermissionResolution) => void;
}) {
  const [form] = Form.useForm<EditForm>();
  const [submitting, setSubmitting] = useState(false); const [error, setError] = useState<unknown>(null);
  const mounted = useRef(true); const pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const role = Form.useWatch('role', form) ?? target.role;
  const selected = Form.useWatch('permissions', form) ?? target.extraPermissions;
  let preview = null; let previewIssue: string | null = null;
  if (operation === 'permissions') {
    try { if (!catalog) throw new Error('请先读取权限目录'); preview = previewExtraPermissions(catalog, target.role, target.extraPermissions, selected); }
    catch { previewIssue = '权限目录或现有授权异常，请关闭弹窗并刷新目录和详情后重试。'; }
  }
  const conflict = error instanceof ApiClientError && error.code === 'VERSION_CONFLICT';
  const uncertain = !!error && (!(error instanceof ApiClientError) || !error.status || error.status >= 500);
  const locked = conflict || uncertain;
  const refresh = () => { onClose(); void employeeQueries.detail.invalidate(target.id); void employeeQueries.list.invalidate(); };

  async function submit(values: EditForm) {
    if (pending.current || locked || previewIssue) return;
    pending.current = true; setSubmitting(true); setError(null);
    const input = { expectedVersion: target.version, reason: values.reason.trim() };
    const send = async () => {
      switch (operation) {
        case 'profile': return employees.updateProfile(target.id, { ...input, displayName: values.displayName.trim() });
        case 'status': return target.status === 'ACTIVE' ? employees.disable(target.id, input) : employees.enable(target.id, input);
        case 'reset': return employees.resetPassword(target.id, { ...input, temporaryPassword: values.temporaryPassword });
        case 'role': return employees.changeRole(target.id, { ...input, role: values.role });
        case 'permissions': return employees.setExtraPermissions(target.id, { ...input, permissions: values.permissions });
      }
    };
    try {
      const result = await runEmployeeMutation<Awaited<ReturnType<typeof send>>['data']>(session, send, () => {
        void employeeQueries.detail.invalidate(target.id); void employeeQueries.list.invalidate();
        // 本人改名、调岗或停用后立即重读身份，导航和访问资格随真实服务端状态更新。
        if (employeeAuth.getSnapshot().employee?.id === target.id) void employeeAuth.restore(true, '本人资料已更新，已重新读取账号信息。');
      });
      if (result && mounted.current) onSaved('changed' in result && !result.changed ? '资料没有变化，未重复写入。' : `${titles[operation]}已保存。`,
        'resolvedExtraPermissions' in result ? result : undefined);
    } catch (failure) { if (mounted.current) setError(failure); }
    finally {
      if (mounted.current) { form.resetFields(['temporaryPassword', 'confirmation']); setSubmitting(false); }
      pending.current = false;
    }
  }

  const defaults = new Set(target.defaultPermissions);
  const grantable = catalog?.permissions.filter(item => !item.adminOnly && !defaults.has(item.code)) ?? [];
  return <Modal open title={operation === 'status' ? (target.status === 'ACTIVE' ? '停用员工' : '启用员工') : titles[operation]}
    width={operation === 'permissions' ? 920 : 600} destroyOnHidden mask={{ closable: false }}
    closable={!submitting} keyboard={!submitting} onCancel={() => { if (!pending.current) onClose(); }} footer={null}>
    <p className="employee-edit-target">{target.displayName}（{target.username}） · 当前资料版本 {target.version}</p>
    <AuthError error={error} />
    {locked ? <Alert className="auth-notice" showIcon type="warning" title={conflict ? '资料已被更新，请重新确认' : '操作结果未确认'}
      description={<><p>{conflict ? '旧表单已停止提交。刷新资料后，请重新打开操作并确认内容。' : '请先刷新详情核实服务器结果，再决定是否重新操作。'}</p>
        <Button onClick={refresh}>刷新资料后重新确认</Button></>} /> : null}
    {/* 关闭会销毁整个独立表单实例；不使用会在StrictMode重挂载时清掉初值的clearOnDestroy。 */}
    <Form form={form} layout="vertical" preserve={false} disabled={submitting || locked}
      initialValues={{ displayName: target.displayName, role: target.role, permissions: [...target.extraPermissions] }} onFinish={submit}>
      {operation === 'profile' ? <Form.Item required label="显示名" name="displayName" rules={[rule(employeeDisplayNameIssue)]}><Input autoComplete="off" /></Form.Item> : null}
      {operation === 'status' ? <Alert className="auth-notice" type={target.status === 'ACTIVE' ? 'warning' : 'info'} showIcon
        title={target.status === 'ACTIVE' ? '停用后立即撤销该员工全部登录会话' : '启用后员工可以重新登录'}
        description={target.status === 'ACTIVE' ? '员工将无法继续访问后台；若操作本人，本页也会退出登录。必须保留至少一名可用超级管理员。' : '之前的会话不会恢复，首次登录改密要求保持。'} /> : null}
      {operation === 'reset' ? <>
        <Alert className="auth-notice" type="warning" showIcon title="重置后撤销全部会话，下次登录必须修改密码" description="临时密码不能与当前密码相同。请将临时密码交给员工本人。" />
        <Form.Item required label="临时密码" name="temporaryPassword" extra="8～64个字符，UTF-8编码不超过72字节；空格原样保留。" rules={[rule(value => validatePassword(value)?.message ?? null)]}><Input.Password autoComplete="new-password" /></Form.Item>
        <Form.Item required label="确认临时密码" name="confirmation" dependencies={['temporaryPassword']} rules={[{ required: true, message: '请再次输入临时密码' }, ({ getFieldValue }) => ({
          validator: (_, value: unknown) => value === getFieldValue('temporaryPassword') ? Promise.resolve() : Promise.reject(new Error('两次临时密码不一致')),
        })]}><Input.Password autoComplete="new-password" /></Form.Item>
      </> : null}
      {operation === 'role' ? <>
        <Form.Item required label="新岗位" name="role" rules={[rule(employeeRoleIssue)]}><Select options={Object.entries(employeeRoles).map(([value, label]) => ({ value, label }))} /></Form.Item>
        <Alert className="auth-notice" type={role === target.role ? 'info' : 'warning'} showIcon
          title={role === target.role ? '岗位未改变，保留现有额外权限' : '调岗将清空全部个人额外权限'}
          description={role === 'SUPER_ADMIN' ? '超级管理员拥有全部后台权限，请确认安排。必须保留至少一名可用超级管理员。' : '真实换岗后按新岗位默认权限生效，旧会话会立即使用新权限。'} />
      </> : null}
      {operation === 'permissions' && catalog ? <>
        <p className="muted">提交完整的个人额外权限集合。岗位默认权限只读；管理员专属权限不能下放。撤销已有依赖时，相关操作会级联移除。</p>
        <details className="permission-defaults"><summary>岗位默认权限（{target.defaultPermissions.length}项，只读）</summary><PermissionCodes values={target.defaultPermissions} catalog={catalog} /></details>
        <Form.Item label="个人额外权限" name="permissions"><Checkbox.Group className="permission-options">
          {grantable.map(item => <Checkbox value={item.code} key={item.code}><strong>{item.name}</strong><code>{item.code}</code><span>{item.description}</span></Checkbox>)}
        </Checkbox.Group></Form.Item>
        {preview ? <section className="permission-preview" aria-label="权限变更预览">
          <h3>保存后的额外权限（{preview.resolvedExtraPermissions.length}项）</h3><PermissionCodes values={preview.resolvedExtraPermissions} catalog={catalog} />
          <h3>自动补齐的依赖</h3><PermissionCodes values={preview.addedByDependency} catalog={catalog} />
          <h3>级联撤销的操作</h3><PermissionCodes values={preview.removedByDependency} catalog={catalog} />
          <details open><summary>最终有效权限（{preview.effectivePermissions.length}项）</summary><PermissionCodes values={preview.effectivePermissions} catalog={catalog} /></details>
        </section> : null}
      </> : null}
      {previewIssue ? <Alert className="auth-notice" type="error" showIcon title={previewIssue} /> : null}
      <Form.Item required label="操作原因" name="reason" extra="说明此次调整原因，最多500个字符。" rules={[rule(managementReasonIssue)]}><Input.TextArea rows={3} /></Form.Item>
      <Space wrap><Button htmlType="submit" type="primary" danger={operation === 'status' && target.status === 'ACTIVE'} loading={submitting} disabled={submitting || locked || !!previewIssue}>确认保存</Button>
        <Button onClick={() => { if (!pending.current) onClose(); }} disabled={submitting}>取消</Button></Space>
    </Form>
  </Modal>;
}

export function EmployeeManagement({ employee, catalog }: { employee: EmployeeDetail | null; catalog: PermissionCatalog | null }) {
  const { employee: myself, permissions } = useEmployeeAuth();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [success, setSuccess] = useState<{ message: string; resolution?: PermissionResolution } | null>(null);
  return <>
    {success ? <Alert className="auth-notice" type="success" showIcon title={success.message} closable onClose={() => setSuccess(null)}
      description={success.resolution && catalog ? <details><summary>查看服务端确认的权限结果</summary>
        <h3>自动补齐的依赖</h3><PermissionCodes values={success.resolution.addedByDependency} catalog={catalog} />
        <h3>级联撤销的操作</h3><PermissionCodes values={success.resolution.removedByDependency} catalog={catalog} />
        <h3>最终有效权限</h3><PermissionCodes values={success.resolution.effectivePermissions} catalog={catalog} />
      </details> : null} /> : null}
    {employee ? <Space wrap className="employee-management" aria-label="员工管理操作">
      {(['profile', 'status', 'reset', 'role', 'permissions'] as const).map(operation => {
        if (!canManageEmployee(permissions, operation) || (operation === 'permissions' && employee.role === 'SUPER_ADMIN')) return null;
        if (operation === 'reset' && myself?.id === employee.id) return <Link key={operation} to="/change-password">修改本人密码</Link>;
        return <Button key={operation} disabled={operation === 'permissions' && !catalog} onClick={() => { setSuccess(null); setEditing({ operation, target: employee }); }}>
          {operation === 'status' ? (employee.status === 'ACTIVE' ? '停用员工' : '启用员工') : titles[operation]}</Button>;
      })}
    </Space> : null}
    {editing ? <ManagementDialog editing={editing} catalog={catalog} onClose={() => setEditing(null)} onSaved={(message, resolution) => { setEditing(null); setSuccess({ message, resolution }); }} /> : null}
  </>;
}
