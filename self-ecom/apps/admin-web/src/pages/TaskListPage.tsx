/** 文件作用：展示真实待办、合资格岗位池和管理员待安排，地址保留筛选分页与返回位置。 */
import { useMemo } from 'react';
import { Alert, Button, Form, Input, Select, Space, Table, Tag } from 'antd';
import type { TableColumnsType } from 'antd';
import { Link, useSearchParams } from 'react-router-dom';
import { useEmployeeAuth } from '../auth/use-employee-auth';
import { useEmployeeQuery } from '../employees/use-employee-query';
import { taskQueries } from '../services/api';
import { beijingTime } from '../settings/model';
import { TaskQueryState } from '../tasks/TaskQueryState';
import { canArrangeTasks, parseTaskSearch, taskBusinesses, taskIdIssue, taskSearchParams, taskStages, taskStatuses, taskViews, type TaskItem, type TaskQuery, type TaskSearch } from '../tasks/model';

function TaskSummaryBar() {
  const state = useEmployeeQuery(taskQueries.summary, 'summary', undefined); const data = state.data;
  return state.status === 'ready' && data ? <section aria-label="任务摘要" className="task-summary">
    <dl><div><dt>本人未完成</dt><dd>{data.myPending}</dd></div><div><dt>合资格待领</dt><dd>{data.eligibleOpen}</dd></div>
      <div><dt>当前逾期</dt><dd>{data.currentOverdue}</dd></div><div><dt>历史曾逾期</dt><dd>{data.everOverdue}</dd></div>
      {data.reassignNeeded !== null ? <div><dt>待安排</dt><dd>{data.reassignNeeded}</dd></div> : null}</dl>
    <p>统计截至 {beijingTime(data.asOf)}（北京时间），各项数量可能重叠。</p>
  </section> : <TaskQueryState error={state.error} retry={() => void taskQueries.summary.read('summary', undefined, true)} />;
}
function TaskFilters({ query, change }: { query: TaskSearch; change: (value: TaskSearch) => void }) {
  return <Form<Omit<TaskQuery, 'overdue'> & { overdue?: 'true' | 'false' }> className="task-filters" layout="vertical" initialValues={{ ...query, overdue: query.overdue === undefined ? undefined : String(query.overdue) }} onFinish={values => change({ view: query.view, page: 1, pageSize: query.pageSize,
    ...(values.stage ? { stage: values.stage } : {}), ...(values.status ? { status: values.status } : {}), ...(values.businessType ? { businessType: values.businessType } : {}),
    ...(values.businessId?.trim() ? { businessId: values.businessId.trim().toLowerCase() } : {}), ...(values.overdue !== undefined ? { overdue: values.overdue === 'true' } : {}) })}>
    <Form.Item name="stage" label="任务阶段"><Select allowClear placeholder="全部阶段" options={Object.entries(taskStages).map(([value, label]) => ({ value, label }))} /></Form.Item>
    <Form.Item name="status" label="任务状态"><Select allowClear placeholder="全部状态" options={Object.entries(taskStatuses).map(([value, label]) => ({ value, label }))} /></Form.Item>
    <Form.Item name="businessType" label="业务类型"><Select allowClear placeholder="全部业务" options={Object.entries(taskBusinesses).map(([value, label]) => ({ value, label }))} /></Form.Item>
    <Form.Item name="overdue" label="当前逾期"><Select allowClear placeholder="全部期限" options={[{ value: 'true', label: '当前已逾期' }, { value: 'false', label: '当前未逾期' }]} /></Form.Item>
    <Form.Item name="businessId" label="业务编号（UUID）" rules={[{ validator: (_, value: string | undefined) => !value?.trim() || !taskIdIssue(value.trim()) ? Promise.resolve() : Promise.reject(new Error('请输入有效的业务编号')) }]}><Input allowClear placeholder="可选，输入完整业务编号" /></Form.Item>
    <Space wrap className="task-filter-actions"><Button type="primary" htmlType="submit">查询任务</Button><Button onClick={() => change({ view: query.view, page: 1, pageSize: 20 })}>重置筛选</Button></Space>
  </Form>;
}
function TaskList({ query, change }: { query: TaskSearch; change: (value: TaskSearch) => void }) {
  const key = taskSearchParams(query).toString(); const state = useEmployeeQuery(taskQueries.list, key, query);
  const refresh = () => { void taskQueries.list.read(key, query, true); void taskQueries.summary.read('summary', undefined, true); };
  const columns: TableColumnsType<TaskItem> = [
    { title: '业务与阶段', key: 'business', width: 300, render: (_, row) => <><Link to={`/tasks/${row.id}?${key}`}>{row.business.number}</Link><div className="task-subline">{taskStages[row.stage]} · 第{row.round}轮</div><div className="task-subline">{row.business.label}</div></> },
    { title: '状态与经办', key: 'state', width: 180, render: (_, row) => <><Tag color={row.status === 'CLAIMED' ? 'blue' : 'default'}>{taskStatuses[row.status]}</Tag><div className="task-subline">{row.assignee?.displayName ?? '尚未分配经办'}</div>{row.reassignNeeded ? <Tag color="orange">待安排</Tag> : null}</> },
    { title: '截止时间（北京时间）', key: 'deadline', width: 235, render: (_, row) => <>{row.dueAt ? beijingTime(row.dueAt) : '未指定截止时间'}<div>{row.isCurrentlyOverdue ? <Tag color="red">当前已逾期</Tag> : null}{row.hasEverOverdue ? <Tag color="orange">曾逾期</Tag> : null}</div></> },
    { title: '操作', key: 'detail', width: 110, render: (_, row) => <Link to={`/tasks/${row.id}?${key}`}>查看任务</Link> },
  ];
  return <><TaskFilters key={key} query={query} change={change} /><div className="employee-result-heading"><h2>{taskViews[query.view]}</h2><Button onClick={refresh} disabled={state.status === 'loading'}>刷新任务</Button></div>
    {state.status === 'ready' && state.data ? <Table<TaskItem> className="task-table" rowKey="id" columns={columns} dataSource={state.data.items} scroll={{ x: 825 }}
      locale={{ emptyText: query.view === 'pool' ? '暂无可领取的任务。岗位池仅展示你有资格领取的任务。' : query.view === 'reassign' ? '暂无待安排任务。' : '暂无待办，可到岗位池查看可领取的任务。' }}
      pagination={{ current: query.page, pageSize: query.pageSize, total: state.data.total, showTotal: total => `共 ${total} 项任务`, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100],
        onChange: (page, pageSize) => change({ ...query, page: pageSize === query.pageSize ? page : 1, pageSize }) }} /> : <TaskQueryState error={state.error} retry={refresh} />}</>;
}
export function TaskListPage() {
  const [params, setParams] = useSearchParams(); const search = params.toString(); const { permissions } = useEmployeeAuth();
  const parsed = useMemo(() => parseTaskSearch(search), [search]); const arranged = canArrangeTasks(permissions);
  return <section className="task-panel"><div className="task-heading"><h1>任务工作台</h1><p className="muted">领取待办、核对期限，查看每次处理的记录。</p></div>
    <TaskSummaryBar /><nav className="task-views" aria-label="任务列表">{Object.entries(taskViews).filter(([view]) => view !== 'reassign' || arranged).map(([view, label]) =>
      <Link key={view} aria-current={parsed.query?.view === view ? 'page' : undefined} to={`/tasks?${taskSearchParams({ view: view as TaskSearch['view'], page: 1, pageSize: 20 })}`}>{label}</Link>)}</nav>
    {!parsed.query ? <div role="alert"><p>{parsed.error}</p><Button onClick={() => setParams(taskSearchParams({ view: 'mine', page: 1, pageSize: 20 }))}>重置筛选</Button></div>
      : parsed.query.view === 'reassign' && !arranged ? <Alert type="warning" showIcon title="没有查看管理员待安排的权限" />
      : <TaskList query={parsed.query} change={query => setParams(taskSearchParams(query))} />}
  </section>;
}
