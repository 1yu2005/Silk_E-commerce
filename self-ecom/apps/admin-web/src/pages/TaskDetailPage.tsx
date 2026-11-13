/** 文件作用：展示任务事实、期限快照和分页时间线；业务详情只使用后端提供的安全链接。 */
import { useMemo, useState } from 'react';
import { Alert, Button, Descriptions, Pagination, Tag } from 'antd';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useEmployeeQuery } from '../employees/use-employee-query';
import { taskQueries } from '../services/api';
import { beijingTime } from '../settings/model';
import { TaskActions } from '../tasks/TaskActions';
import { TaskQueryState } from '../tasks/TaskQueryState';
import { parseTaskSearch, safeBusinessPath, taskBusinesses, taskIdIssue, taskSearchParams, taskStages, taskStatuses, type TaskHistory } from '../tasks/model';

const historyActions = { CREATED: '进入阶段', CLAIMED: '领取', RELEASED: '释放', TRANSFERRED: '转交', QUALIFICATION_LOST: '失去资格后回池', COMPLETED: '本环节完成', CANCELLED: '取消', SUSPENDED: '暂停', RESUMED: '恢复', DEADLINE_CHANGED: '调整截止' } as const;
function HistoryRecord({ item }: { item: TaskHistory['items'][number] }) {
  return <li><div className="task-history-title"><strong>{item.kind === 'TASK_CHANGE' ? historyActions[item.action] : ({ OVERDUE: '记录逾期', EXTENDED: '延长期限', DEADLINE_ASSIGNED: '首次指定截止' } as const)[item.eventType]}</strong><time dateTime={item.occurredAt}>{beijingTime(item.occurredAt)}</time></div>
    {item.kind === 'TASK_CHANGE' ? <p>{item.beforeStatus ? taskStatuses[item.beforeStatus] + ' → ' : ''}{taskStatuses[item.afterStatus]}{item.fromAssigneeId ? `；原经办编号 ${item.fromAssigneeId}` : ''}{item.toAssigneeId ? `；新经办编号 ${item.toAssigneeId}` : ''}</p>
      : <p>本次记录截止：{beijingTime(item.deadlineAt)}{item.newDueAt ? `；新截止：${beijingTime(item.newDueAt)}` : ''}{item.detectedAt ? `；记录时间：${beijingTime(item.detectedAt)}` : ''}</p>}
    {item.reason !== null ? <p className="task-reason">原因：{item.reason}</p> : null}
  </li>;
}
function TaskHistoryPanel({ id }: { id: string }) {
  const [page, setPage] = useState(1); const input = useMemo(() => ({ id, page }), [id, page]); const key = JSON.stringify(input);
  const state = useEmployeeQuery(taskQueries.history, key, input);
  return <section className="task-history"><div className="employee-result-heading"><h2>处理与期限记录</h2><Button onClick={() => void taskQueries.history.read(key, input, true)}>刷新记录</Button></div>
    {state.status === 'ready' && state.data ? <><ol>{state.data.items.map(item => <HistoryRecord key={item.id + item.kind} item={item} />)}</ol>
      {!state.data.total ? <p className="muted">暂无处理记录。</p> : null}<Pagination current={page} pageSize={10} total={state.data.total} showSizeChanger={false} onChange={setPage} /></>
      : <TaskQueryState error={state.error} retry={() => void taskQueries.history.read(key, input, true)} />}</section>;
}
function TaskDetail({ id }: { id: string }) {
  const state = useEmployeeQuery(taskQueries.detail, id, id); const task = state.data; const [notice, setNotice] = useState<string | null>(null);
  const reload = () => { void taskQueries.detail.read(id, id, true); void taskQueries.history.invalidate(); void taskQueries.summary.invalidate(); void taskQueries.list.invalidate(); };
  const businessPath = safeBusinessPath(task?.business.detailPath ?? null);
  return <>{notice ? <Alert className="auth-notice" showIcon type="success" title={notice} /> : null}
    <div className="employee-result-heading"><h1>任务详情</h1><Button onClick={reload} disabled={state.status === 'loading'}>刷新详情</Button></div>
    {state.status !== 'ready' || !task ? <TaskQueryState error={state.error} retry={reload} /> : <>
      <div className="task-detail-heading"><h2>{taskStages[task.stage]}</h2><Tag>{taskStatuses[task.status]}</Tag>{task.isCurrentlyOverdue ? <Tag color="red">当前已逾期</Tag> : null}{task.hasEverOverdue ? <Tag color="orange">曾逾期</Tag> : null}{task.reassignNeeded ? <Tag color="orange">待安排</Tag> : null}</div>
      <TaskActions key={`${id}:${task.version}`} task={task} reload={reload} saved={message => { setNotice(message); reload(); }} />
      <Descriptions bordered column={{ xs: 1, sm: 1, md: 2 }} items={[
        { key: 'business', label: '业务号', children: businessPath ? <Link to={businessPath}>{task.business.number}</Link> : task.business.number, span: 2 },
        { key: 'type', label: '业务类型', children: taskBusinesses[task.businessType] }, { key: 'round', label: '阶段轮次', children: `第${task.round}轮` },
        { key: 'assignee', label: '当前经办', children: task.assignee?.displayName ?? '尚未分配经办' }, { key: 'version', label: '任务版本', children: task.version },
        { key: 'startedAt', label: '开始时间（北京时间）', children: beijingTime(task.startedAt) }, { key: 'dueAt', label: '当前截止（北京时间）', children: task.dueAt ? beijingTime(task.dueAt) : '未指定截止时间' },
        { key: 'originalDueAt', label: '原始截止（北京时间）', children: task.originalDueAt ? beijingTime(task.originalDueAt) : '本阶段原来没有自动期限' }, { key: 'firstOverdueAt', label: '首次逾期（北京时间）', children: task.firstOverdueAt ? beijingTime(task.firstOverdueAt) : '暂无记录' },
        { key: 'closedAt', label: '结束时间（北京时间）', children: task.closedAt ? beijingTime(task.closedAt) : '尚未结束' },
        { key: 'rule', label: '阶段期限规则', children: task.ruleSnapshot.amount !== null && task.ruleSnapshot.unit ? `${task.ruleSnapshot.amount} ${task.ruleSnapshot.unit === 'WORKDAY' ? '工作日' : task.ruleSnapshot.unit === 'NATURAL_DAY' ? '自然日' : '分钟'}` : '本阶段无自动期限' },
        { key: 'settingsVersion', label: '引用设置版本', children: task.ruleSnapshot.settingsVersionNumber ?? '未引用' },
        { key: 'id', label: '任务编号', children: task.id }, { key: 'businessId', label: '业务编号', children: task.businessId },
      ]} />
      <p className="task-hint">时间均为北京时间。任务操作以服务器当前状态、期限和资格核验结果为准。</p>
      <TaskHistoryPanel id={id} />
    </>}
  </>;
}
export function TaskDetailPage() {
  const id = (useParams().id ?? '').toLowerCase(); const [params] = useSearchParams(); const parsed = parseTaskSearch(params.toString());
  const back = parsed.query ? '?' + taskSearchParams(parsed.query).toString() : ''; const issue = taskIdIssue(id);
  return <section className="task-panel"><Link to={`/tasks${back}`}>返回任务列表</Link>{issue ? <p role="alert">{issue}</p> : <TaskDetail key={id} id={id} />}</section>;
}
