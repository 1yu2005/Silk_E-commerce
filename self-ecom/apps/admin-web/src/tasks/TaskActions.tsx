/** 文件作用：按后端动作提示提交领取/释放/转交/延期，保留显示时版本并在成功后刷新详情、历史和摘要。 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Button, Form, Input, Modal, Pagination, Select, Space } from 'antd';
import { AuthError } from '../auth/AuthError';
import { useEmployeeQuery } from '../employees/use-employee-query';
import { managementReasonIssue, runEmployeeMutation } from '../employees/management';
import { employeeRoles } from '../employees/query';
import { session, taskQueries, tasks } from '../services/api';
import { beijingDeadline, taskActions, type TaskAction, type TaskDetail } from './model';
import { TaskQueryState } from './TaskQueryState';
import { TaskMutationController } from './mutation-controller';

function TransferTargets({ task }: { task: TaskDetail }) {
  const [keyword, setKeyword] = useState(''); const [page, setPage] = useState(1);
  const input = useMemo(() => ({ page, pageSize: 20, status: 'ACTIVE' as const, ...(keyword ? { keyword } : {}) }), [page, keyword]);
  const key = JSON.stringify(input); const state = useEmployeeQuery(taskQueries.targets, key, input);
  return <><p className="task-hint">选择已启用且已改密的员工；服务端还会核对本阶段全部资格与业务交接条件。</p>
    <Form.Item label="搜索转交员工"><Input.Search allowClear placeholder="账号或姓名，最多50字" maxLength={50} onSearch={value => { setKeyword(value.trim()); setPage(1); }} enterButton="查找员工" /></Form.Item>
    {state.status !== 'ready' || !state.data ? <TaskQueryState error={state.error} retry={() => void taskQueries.targets.read(key, input, true)} /> : <>
      <Form.Item name="targetEmployeeId" label="目标员工" rules={[{ required: true, message: '请选择目标员工' }]}><Select placeholder="选择目标员工" options={state.data.items.map(row => ({
        value: row.id, label: `${row.displayName}（${row.username}，${employeeRoles[row.role]}${row.mustChangePassword ? '，需改密' : ''}）`, disabled: row.mustChangePassword || row.id === task.assignee?.id,
      }))} /></Form.Item>
      <Pagination simple size="small" current={page} pageSize={20} total={state.data.total} showSizeChanger={false} onChange={setPage} />
    </>}
  </>;
}
interface CommandForm { reason?: string; targetEmployeeId?: string; deadline?: string }
function TaskActionDialog({ task, action, close, saved, reload }: { task: TaskDetail; action: TaskAction; close: () => void; saved: (message: string) => void; reload: () => void }) {
  const [form] = Form.useForm<CommandForm>();
  // StrictMode的清理会销毁订阅，控制器在effect外保留但不永久dispose；用组件存活标记屏蔽旧回调。
  const controller = useMemo(() => new TaskMutationController(session, runEmployeeMutation), []);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const activeRef = useRef(true);
  useEffect(() => { activeRef.current = true; return () => { activeRef.current = false; }; }, []);
  const submit = (values: CommandForm) => {
    const common = { expectedVersion: task.version, reason: values.reason?.trim() ?? '' }; const path = { id: task.id };
    const send = () => action === 'claim' ? tasks.claimTask({ path, body: { expectedVersion: task.version } })
      : action === 'release' ? tasks.releaseTask({ path, body: common })
      : action === 'transfer' ? tasks.transferTask({ path, body: { ...common, targetEmployeeId: values.targetEmployeeId! } })
      : tasks.extendTaskDeadline({ path, body: { ...common, newDueAt: beijingDeadline(values.deadline)! } });
    void controller.submit(send, result => { if (activeRef.current) saved(result.changed ? `${taskActions[action]}成功。` : '该操作已生效，未重复写入。'); });
  };
  const blocked = state.blocked !== null;
  return <Modal open title={taskActions[action]} onCancel={close} maskClosable={!state.sending} keyboard={!state.sending} closable={!state.sending} footer={null} destroyOnHidden>
    <p className="task-hint">{task.business.number} · 第{task.round}轮</p>
    <AuthError error={state.error} />
    {blocked ? <Alert className="auth-notice" type="warning" showIcon title={state.blocked === 'uncertain' ? '操作结果尚未确认' : '任务状态或操作条件已变化'}
      description="请先读取最新任务，核对后重新操作。" action={<Button onClick={reload}>读取最新任务</Button>} /> : null}
    <Form<CommandForm> form={form} layout="vertical" onFinish={submit} disabled={state.sending || blocked} preserve={false}>
      {action === 'claim' ? <p>确认由你领取并处理此任务。领取后可在“我的待办”查看。</p> : null}
      {action === 'transfer' ? <TransferTargets task={task} /> : null}
      {action === 'extendDeadline' ? <><p className="task-hint">{task.dueAt ? '新截止须晚于原截止和服务器当前时间。' : '本次是首次指定人工截止，原始截止仍为空。'}原截止与曾逾期记录会保留。</p>
        <Form.Item name="deadline" label="新截止时间（北京时间）" rules={[{ validator: (_, value: unknown) => {
          const utc = beijingDeadline(value); return utc && (!task.dueAt || Date.parse(utc) > Date.parse(task.dueAt)) ? Promise.resolve() : Promise.reject(new Error('请输入有效的北京时间，且晚于当前截止'));
        } }]}><Input type="datetime-local" step={1} /></Form.Item></> : null}
      {action !== 'claim' ? <Form.Item name="reason" label="操作原因" rules={[{ validator: (_, value: unknown) => { const issue = managementReasonIssue(value); return issue ? Promise.reject(new Error(issue)) : Promise.resolve(); } }]}><Input.TextArea rows={3} placeholder="说明本次操作原因，最多500字" /></Form.Item> : null}
      <Space wrap><Button type="primary" htmlType="submit" loading={state.sending} disabled={state.sending || blocked}>{taskActions[action] === '调整截止时间' ? '确认截止时间' : `确认${action === 'claim' ? '领取' : action === 'release' ? '释放' : '转交'}`}</Button>
        <Button onClick={close} disabled={state.sending}>取消</Button></Space>
    </Form>
  </Modal>;
}
export function TaskActions({ task, saved, reload }: { task: TaskDetail; saved: (message: string) => void; reload: () => void }) {
  const [action, setAction] = useState<TaskAction | null>(null);
  return <div className="task-actions"><Space wrap>{task.allowedActions.map(action => <Button key={action} type={action === 'claim' ? 'primary' : 'default'} onClick={() => setAction(action)}>{taskActions[action]}</Button>)}</Space>
    {!task.allowedActions.length ? <p className="task-hint">当前没有可执行的任务操作。</p> : null}
    {action ? <TaskActionDialog key={action} task={task} action={action} close={() => setAction(null)} saved={message => { setAction(null); saved(message); }} reload={() => { setAction(null); reload(); }} /> : null}
  </div>;
}
