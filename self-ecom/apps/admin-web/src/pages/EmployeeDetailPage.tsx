/** 文件作用：展示员工资料、真实权限及管理操作，保留返回筛选条件。 */
import { Alert, Button, Descriptions, Tag } from 'antd';
import type { PermissionCatalog } from '@shop/api-client';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { employeeQueries } from '../services/api';
import { employeeDate, employeeIdIssue, employeeRoles, employeeStatuses, employeeSearchParams, parseEmployeeSearch } from '../employees/query';
import { useEmployeeQuery } from '../employees/use-employee-query';
import { QueryState } from '../employees/QueryState';
import { EmployeeManagement } from '../employees/EmployeeManagement';

function PermissionList({ title, values, catalog }: { title: string; values: string[]; catalog: PermissionCatalog | null }) {
  const byCode = new Map(catalog?.permissions.map(item => [item.code, item.name]));
  return <section className="employee-permission-column"><h3>{title}<span>{values.length} 项</span></h3>
    {values.length ? <ul>{values.map(value => <li key={value}>{byCode.get(value)}<code>{value}</code></li>)}</ul> : <p className="muted">暂无权限</p>}</section>;
}

function EmployeeDetail({ id }: { id: string }) {
  const state = useEmployeeQuery(employeeQueries.detail, id, id);
  const directory = useEmployeeQuery(employeeQueries.catalog, 'catalog', undefined);
  const catalog = directory.data; const employee = state.data;
  return <>
    <EmployeeManagement employee={employee} catalog={catalog} />
    {state.status !== 'ready' || !employee ? <QueryState error={state.error} onRetry={() => void employeeQueries.detail.read(id, id, true)} /> : <>
    <div className="employee-result-heading"><h2>{employee.displayName}</h2><Button onClick={() => void employeeQueries.detail.read(id, id, true)}>刷新详情</Button></div>
    <Descriptions bordered column={{ xs: 1, sm: 1, md: 2 }} items={[
      { key: 'id', label: '员工编号', children: employee.id, span: 2 },
      { key: 'username', label: '员工账号', children: employee.username }, { key: 'displayName', label: '显示名', children: employee.displayName },
      { key: 'role', label: '岗位', children: employeeRoles[employee.role] },
      { key: 'status', label: '账号状态', children: <Tag color={employee.status === 'ACTIVE' ? 'green' : 'default'}>{employeeStatuses[employee.status]}</Tag> },
      { key: 'mustChangePassword', label: '需改密码', children: employee.mustChangePassword ? '是' : '否' },
      { key: 'version', label: '资料版本', children: employee.version }, { key: 'permissionVersion', label: '权限版本', children: employee.permissionVersion },
      { key: 'createdAt', label: '创建时间', children: employeeDate(employee.createdAt) }, { key: 'lastLoginAt', label: '最近登录', children: employeeDate(employee.lastLoginAt) },
    ]} />
    <section className="employee-permissions"><h2>员工权限</h2><p className="muted">最终有效权限由岗位默认权限与个人额外权限合并。</p>
      {directory.error ? <Alert className="auth-notice" type="warning" showIcon title="权限目录读取失败，暂不能编辑额外权限"
        description={<Button onClick={() => void employeeQueries.catalog.read('catalog', undefined, true)}>重试权限目录</Button>} /> : null}
      <div className="employee-permission-grid"><PermissionList title="岗位默认权限" values={employee.defaultPermissions} catalog={catalog} />
        <PermissionList title="个人额外权限" values={employee.extraPermissions} catalog={catalog} /><PermissionList title="最终有效权限" values={employee.effectivePermissions} catalog={catalog} /></div>
    </section>
    </>}
  </>;
}

export function EmployeeDetailPage() {
  const id = (useParams().id ?? '').toLowerCase(); const [params] = useSearchParams();
  const parsed = parseEmployeeSearch(params.toString()); const back = parsed.query ? `?${employeeSearchParams(parsed.query)}` : '';
  const issue = employeeIdIssue(id);
  return <section className="employee-panel"><Link to={`/employees${back}`}>返回员工列表</Link><h1 className="employee-detail-title">员工详情</h1>
    {issue ? <p role="alert">{issue}</p> : <EmployeeDetail key={id} id={id} />}
  </section>;
}
