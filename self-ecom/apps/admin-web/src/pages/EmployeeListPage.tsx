/** 文件作用：展示员工分页列表，处理筛选、刷新和详情导航。 */
import { useMemo } from 'react';
import { Button, Form, Input, Select, Space, Table, Tag } from 'antd';
import type { TableColumnsType } from 'antd';
import { Link, useSearchParams } from 'react-router-dom';
import type { EmployeeListItem, EmployeeListQuery } from '@shop/api-client';
import { employeeQueries } from '../services/api';
import { employeeDate, employeeRoles, employeeStatuses, employeeSearchParams, parseEmployeeSearch, type EmployeeSearch } from '../employees/query';
import { useEmployeeQuery } from '../employees/use-employee-query';
import { QueryState } from '../employees/QueryState';
import { useEmployeeAuth } from '../auth/use-employee-auth';
import { canCreateEmployees } from '../employees/create';

function EmployeeFilters({ query, onSearch, onReset }: { query: EmployeeSearch; onSearch: (value: EmployeeListQuery) => void; onReset: () => void }) {
  return <Form<EmployeeListQuery> layout="vertical" className="employee-filters" initialValues={query} onFinish={onSearch}>
    <Form.Item name="keyword" label="搜索账号或姓名" rules={[{ validator: (_, value: unknown) => typeof value !== 'string' || Array.from(value.trim()).length <= 50
      ? Promise.resolve() : Promise.reject(new Error('搜索关键词最多50个字符')) }]}><Input placeholder="输入账号或显示名" allowClear /></Form.Item>
    <Form.Item name="role" label="岗位"><Select allowClear placeholder="全部岗位" options={Object.entries(employeeRoles).map(([value, label]) => ({ value, label }))} /></Form.Item>
    <Form.Item name="status" label="状态"><Select allowClear placeholder="全部状态" options={Object.entries(employeeStatuses).map(([value, label]) => ({ value, label }))} /></Form.Item>
    <Space className="employee-filter-actions" wrap><Button type="primary" htmlType="submit">查询</Button><Button onClick={onReset}>重置筛选</Button></Space>
  </Form>;
}

function EmployeeList({ query, onQuery }: { query: EmployeeSearch; onQuery: (value: EmployeeSearch) => void }) {
  const key = JSON.stringify(query);
  const state = useEmployeeQuery(employeeQueries.list, key, query);
  const search = employeeSearchParams(query).toString();
  const columns: TableColumnsType<EmployeeListItem> = [
    { title: '员工账号', dataIndex: 'username', width: 160 }, { title: '显示名', dataIndex: 'displayName', width: 150 },
    { title: '岗位', dataIndex: 'role', width: 140, render: (role: EmployeeListItem['role']) => employeeRoles[role] },
    { title: '状态', dataIndex: 'status', width: 90, render: (status: EmployeeListItem['status']) => <Tag color={status === 'ACTIVE' ? 'green' : 'default'}>{employeeStatuses[status]}</Tag> },
    { title: '需改密码', dataIndex: 'mustChangePassword', width: 100, render: (required: boolean) => required ? '是' : '否' },
    { title: '最近登录', dataIndex: 'lastLoginAt', width: 180, render: employeeDate },
    { title: '操作', key: 'detail', width: 110, render: (_, row) => <Link to={`/employees/${row.id}?${search}`}>查看详情</Link> },
  ];
  return <>
    <EmployeeFilters key={JSON.stringify([query.keyword, query.role, query.status])} query={query}
      onSearch={value => onQuery({ page: 1, pageSize: query.pageSize, ...(value.keyword?.trim() ? { keyword: value.keyword.trim() } : {}),
        ...(value.role ? { role: value.role } : {}), ...(value.status ? { status: value.status } : {}) })}
      onReset={() => onQuery({ page: 1, pageSize: 20 })} />
    <div className="employee-result-heading"><span>{state.status === 'ready' ? `共 ${state.data?.total ?? 0} 名员工` : '员工列表'}</span>
      <Button disabled={state.status === 'loading'} onClick={() => void employeeQueries.list.read(key, query, true)}>刷新列表</Button></div>
    {state.status === 'ready' && state.data ? <Table<EmployeeListItem> rowKey="id" className="employee-table" columns={columns} dataSource={state.data.items}
      scroll={{ x: 1030 }} locale={{ emptyText: '没有符合条件的员工，请调整或重置筛选。' }}
      pagination={{ current: query.page, pageSize: query.pageSize, total: state.data.total, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100],
        onChange: (page, pageSize) => onQuery({ ...query, page: pageSize === query.pageSize ? page : 1, pageSize }) }} /> :
      <QueryState error={state.error} onRetry={() => void employeeQueries.list.read(key, query, true)} />}
  </>;
}

export function EmployeeListPage() {
  const [params, setParams] = useSearchParams(); const search = params.toString();
  const { permissions } = useEmployeeAuth();
  const parsed = useMemo(() => parseEmployeeSearch(search), [search]);
  return <section className="employee-panel"><div className="employee-result-heading"><h1>员工管理</h1>
    {canCreateEmployees(permissions) ? <Link className="employee-create-link" to={`/employees/new?${parsed.query ? employeeSearchParams(parsed.query) : ''}`}>创建员工</Link> : null}
    </div><p className="muted">查找员工，查看账号状态、岗位与权限。</p>
    {parsed.query ? <EmployeeList query={parsed.query} onQuery={value => setParams(employeeSearchParams(value))} /> :
      <div role="alert"><p>{parsed.error}</p><Button onClick={() => setParams(employeeSearchParams({ page: 1, pageSize: 20 }))}>重置筛选</Button></div>}
  </section>;
}
