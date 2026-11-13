// 作用：在独立PostgreSQL事务中验证设置、任务、期限事件和调度记录的真实数据库底线。
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { assertSafeTestDatabase } from '../scripts/database-env.js';
import { cursorRow, deadlineRow, fixtureDue, fixtureTime, historyRow, insertSchemaRow, runRow, settingRow,
  taskRow, type SchemaRow, type TaskTable } from './fixtures/task-schema.js';

const safe = assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('集成测试仅可在test环境执行');
const client = new Client({ connectionString: safe.testUrl });
beforeAll(async () => { await client.connect(); });
afterAll(async () => { await client.end(); });

async function transaction(run: (fixture: { employeeId: string; cursor: SchemaRow; task: SchemaRow }) => Promise<void>) {
  await client.query('BEGIN');
  try {
    const employeeId = randomUUID();
    await insertSchemaRow(client, 'employee', { id: employeeId, username: `t_${employeeId.replaceAll('-', '').slice(0, 20)}`,
      display_name: '任务数据结构测试员工', password_hash: '仅为隔离结构测试占位值', role: 'CUSTOMER_SERVICE',
      must_change_password: false, created_at: fixtureTime, updated_at: fixtureTime });
    const cursor = cursorRow(); const task = taskRow(cursor);
    await insertSchemaRow(client, 'task_stage_cursor', cursor); await insertSchemaRow(client, 'task', task);
    await run({ employeeId, cursor, task });
  } finally { await client.query('ROLLBACK'); }
}

it('迁移只初始化未配置Head，没有假地址或配置版本', async () => {
  expect((await client.query('SELECT * FROM store_setting_head')).rows).toEqual([{ id: 1, current_version_id: null, version: 0 }]);
});

it.each([
  ['负运费', { shipping_fee_cents: -1 }, '23514'], ['运费超限', { shipping_fee_cents: 1000001 }, '23514'],
  ['负门槛', { free_shipping_threshold_cents: -1 }, '23514'], ['门槛超限', { free_shipping_threshold_cents: 100000001 }, '23514'],
  ['空原因', { reason: ' ' }, '23514'], ['空收件人', { return_receiver: '' }, '23514'],
  ['空地区', { return_district: ' ' }, '23514'], ['空地址', { return_detail: '' }, '23514'],
  ['非法电话', { service_phone: 'not-a-phone' }, '23514'], ['电话太短', { return_phone: '12' }, '23514'],
  ['电话太长', { return_phone: '1'.repeat(31) }, '22001'], ['零版本', { version_number: 0 }, '23514'],
  ['收件人超长', { return_receiver: '字'.repeat(41) }, '22001'], ['服务时间超长', { service_hours: '字'.repeat(101) }, '22001'],
  ['配置创建人不存在', { created_by_employee_id: randomUUID() }, '23503'],
] as [string, SchemaRow, string][])('%s被数据库拒绝', async (_name, overrides, code) => {
  await transaction(async () => { await expect(insertSchemaRow(client, 'store_setting_version', settingRow(overrides))).rejects.toMatchObject({ code }); });
});

it.each([
  ['payment_minutes', 1440], ['auto_receipt_days', 365], ['after_sale_window_days', 365], ['review_workdays', 30],
  ['supplement_days', 90], ['return_ship_days', 90], ['inspection_workdays', 30], ['refund_workdays', 30],
] as const)('%s期限上下界由CHECK保护', async (field, max) => {
  await transaction(async () => {
    await insertSchemaRow(client, 'store_setting_version', settingRow({ [field]: 1 }));
    await insertSchemaRow(client, 'store_setting_version', settingRow({ version_number: 2, [field]: max }));
  });
  for (const invalid of [0, max + 1]) await transaction(async () => {
    await expect(insertSchemaRow(client, 'store_setting_version', settingRow({ [field]: invalid })))
      .rejects.toMatchObject({ code: '23514', constraint: 'store_setting_deadlines_valid' });
  });
});

it('零运费、零包邮门槛和关闭包邮可保存，配置指针及版本号必须匹配', async () => {
  await transaction(async ({ employeeId }) => {
    const version = settingRow({ created_by_employee_id: employeeId, shipping_fee_cents: 0,
      free_shipping_threshold_cents: 0, free_shipping_enabled: false });
    await insertSchemaRow(client, 'store_setting_version', version);
    await client.query('UPDATE store_setting_head SET current_version_id=$1,version=1 WHERE id=1', [version.id]);
    expect((await client.query('SELECT version FROM store_setting_head')).rows).toEqual([{ version: 1 }]);
    await expect(client.query('UPDATE store_setting_head SET version=2 WHERE id=1')).rejects.toMatchObject({ code: '23503' });
  });
});
it.each([{ id: 2 }, { id: 0 }])('Head不能另建第二家店%s', async row => {
  await transaction(async () => { await expect(insertSchemaRow(client, 'store_setting_head', row)).rejects.toMatchObject({ code: '23514' }); });
});
it('Head缺配置指针时不能标记正版本', async () => {
  await transaction(async () => { await expect(client.query('UPDATE store_setting_head SET version=1 WHERE id=1'))
    .rejects.toMatchObject({ code: '23514', constraint: 'store_setting_head_pointer_valid' }); });
});
it('配置版本号唯一，未提供完整地址不能保存初版', async () => {
  await transaction(async () => {
    await insertSchemaRow(client, 'store_setting_version', settingRow());
    await expect(insertSchemaRow(client, 'store_setting_version', settingRow())).rejects.toMatchObject({ code: '23505' });
  });
  await transaction(async () => { await expect(insertSchemaRow(client, 'store_setting_version', settingRow({ return_detail: null })))
    .rejects.toMatchObject({ code: '23502' }); });
});

const invalidTasks: [string, SchemaRow, string][] = [
  ['零轮次', { round: 0 }, '23514'], ['负版本', { version: -1 }, '23514'], ['空动作键', { entry_key: ' ' }, '23514'],
  ['已领取无经办', { status: 'CLAIMED' }, '23514'], ['已完成无结束时刻', { status: 'COMPLETED' }, '23514'],
  ['有效任务携带结束时刻', { closed_at: fixtureDue }, '23514'], ['截止早于起算', { due_at: new Date('2026-10-31T00:00:00Z') }, '23514'],
  ['清空已有截止', { due_at: null }, '23514'], ['当前截止早于原始截止', { due_at: fixtureTime }, '23514'],
  ['曾逾期无事实时刻', { ever_overdue: true }, '23514'], ['未逾期却有事实时刻', { first_overdue_at: fixtureDue }, '23514'],
  ['权限不是数组', { required_permissions: '{}' }, '23514'], ['权限空数组', { required_permissions: '[]' }, '23514'],
  ['权限含数字', { required_permissions: '[1]' }, '23514'], ['权限含空串', { required_permissions: '[""]' }, '23514'],
  ['权限含非法代码', { required_permissions: '[" "]' }, '23514'], ['规则快照不是对象', { rule_snapshot: '[]' }, '23514'],
  ['设置版本不存在', { settings_version_id: randomUUID() }, '23503'], ['未知状态', { status: 'ARBITRARY' }, '22P02'],
];
it.each(invalidTasks)('%s被任务底线拒绝', async (_name, overrides, code) => {
  await transaction(async ({ task }) => {
    await expect(client.query(`UPDATE task SET ${Object.keys(overrides).map((key, index) => `"${key}"=$${index + 2}`).join(',')}
      WHERE id=$1`, [task.id, ...Object.values(overrides)])).rejects.toMatchObject({ code });
  });
});
it.each(['OPEN', 'SUSPENDED', 'COMPLETED', 'CANCELLED'])('%s不得保留经办人', async status => {
  await transaction(async ({ task, employeeId }) => {
    await expect(client.query('UPDATE task SET status=$2,assignee_id=$3,closed_at=$4 WHERE id=$1',
      [task.id, status, employeeId, ['COMPLETED', 'CANCELLED'].includes(status) ? fixtureDue : null]))
      .rejects.toMatchObject({ code: '23514', constraint: 'task_assignee_status_valid' });
  });
});
it('已领取经办有真实员工外键，未规定SLA可保留null或首次人工指定', async () => {
  await transaction(async ({ task, employeeId }) => {
    await client.query('UPDATE task SET original_due_at=NULL,due_at=NULL,status=\'CLAIMED\',assignee_id=$2 WHERE id=$1', [task.id, employeeId]);
    await client.query('UPDATE task SET due_at=$2 WHERE id=$1', [task.id, fixtureDue]);
    expect((await client.query('SELECT original_due_at,due_at FROM task WHERE id=$1', [task.id])).rows[0])
      .toEqual({ original_due_at: null, due_at: fixtureDue });
    await expect(client.query('UPDATE task SET assignee_id=$2 WHERE id=$1', [task.id, randomUUID()])).rejects.toMatchObject({ code: '23503' });
  });
});
it('任务不能借其它业务游标或错误阶段入库', async () => {
  await transaction(async ({ task }) => {
    await expect(client.query('UPDATE task SET business_id=$2 WHERE id=$1', [task.id, randomUUID()])).rejects.toMatchObject({ code: '23503' });
  });
  await transaction(async () => {
    await expect(insertSchemaRow(client, 'task_stage_cursor', cursorRow({ business_type: 'ORDER' })))
      .rejects.toMatchObject({ code: '23514', constraint: 'task_stage_business_valid' });
  });
  await transaction(async () => { await expect(insertSchemaRow(client, 'task_stage_cursor', cursorRow({ last_round: -1 })))
    .rejects.toMatchObject({ code: '23514', constraint: 'task_stage_cursor_round_valid' }); });
});
it.each(['OPEN', 'CLAIMED', 'SUSPENDED'])('已有%s时同阶段新轮仍被有效唯一索引拒绝', async status => {
  await transaction(async ({ cursor, task, employeeId }) => {
    await client.query('UPDATE task SET status=$2,assignee_id=$3 WHERE id=$1', [task.id, status, status === 'CLAIMED' ? employeeId : null]);
    await expect(insertSchemaRow(client, 'task', taskRow(cursor, { round: 2 })))
      .rejects.toMatchObject({ code: '23505', constraint: 'task_one_active_stage_key' });
  });
});
it('旧轮终结可进入新轮，旧entryKey及旧round仍不能复用', async () => {
  await transaction(async ({ cursor, task }) => {
    await client.query('UPDATE task SET status=\'COMPLETED\',closed_at=$2 WHERE id=$1', [task.id, fixtureDue]);
    await insertSchemaRow(client, 'task', taskRow(cursor, { round: 2 }));
    await expect(insertSchemaRow(client, 'task', taskRow(cursor, { round: 3, entry_key: task.entry_key, status: 'CANCELLED', closed_at: fixtureDue })))
      .rejects.toMatchObject({ code: '23505', constraint: 'task_business_stage_entry_key' });
  });
  await transaction(async ({ cursor }) => { await expect(insertSchemaRow(client, 'task', taskRow(cursor, { status: 'COMPLETED', closed_at: fixtureDue })))
    .rejects.toMatchObject({ code: '23505', constraint: 'task_business_stage_round_key' }); });
});

const invalidHistory: [string, SchemaRow][] = [
  ['员工主体缺员工', { actor_type: 'EMPLOYEE' }], ['空动作键', { command_key: ' ' }],
  ['空requestId', { request_id: '' }], ['释放缺原因', { action: 'RELEASED' }],
  ['已领取历史缺新经办', { after_status: 'CLAIMED' }], ['旧已领取缺原经办', { before_status: 'CLAIMED' }],
];
it.each(invalidHistory)('历史%s由CHECK拒绝', async (_name, overrides) => {
  await transaction(async ({ task }) => { await expect(insertSchemaRow(client, 'task_history', historyRow(task.id, overrides)))
    .rejects.toMatchObject({ code: '23514' }); });
});
it('初建历史没有旧状态时也不能凭空保留原经办', async () => {
  await transaction(async ({ task, employeeId }) => { await expect(insertSchemaRow(client, 'task_history', historyRow(task.id, { from_assignee_id: employeeId })))
    .rejects.toMatchObject({ code: '23514', constraint: 'task_history_assignees_valid' }); });
});
it('员工历史、转交两端及任务引用均为真实外键；相同动作只记一次', async () => {
  await transaction(async ({ task, employeeId }) => {
    const row = historyRow(task.id, { actor_type: 'EMPLOYEE', actor_employee_id: employeeId });
    await insertSchemaRow(client, 'task_history', row);
    await expect(insertSchemaRow(client, 'task_history', { ...row, id: randomUUID() })).rejects.toMatchObject({ code: '23505' });
  });
  await transaction(async ({ task }) => { await expect(insertSchemaRow(client, 'task_history', historyRow(task.id,
    { actor_type: 'EMPLOYEE', actor_employee_id: randomUUID() }))).rejects.toMatchObject({ code: '23503' }); });
});

it('同一截止只产生一次逾期，新的截止可再记，语义动作键也唯一', async () => {
  await transaction(async ({ task }) => {
    await insertSchemaRow(client, 'deadline_event', deadlineRow(task.id));
    await insertSchemaRow(client, 'deadline_event', deadlineRow(task.id, { deadline_at: fixtureTime, occurred_at: fixtureTime }));
    await expect(insertSchemaRow(client, 'deadline_event', deadlineRow(task.id)))
      .rejects.toMatchObject({ code: '23505', constraint: 'deadline_event_one_overdue_key' });
  });
  await transaction(async ({ task }) => {
    const row = deadlineRow(task.id); await insertSchemaRow(client, 'deadline_event', row);
    await expect(insertSchemaRow(client, 'deadline_event', { ...row, id: randomUUID(), deadline_at: fixtureTime, occurred_at: fixtureTime }))
      .rejects.toMatchObject({ code: '23505', constraint: 'deadline_event_command_key' });
  });
});
it.each([
  ['逾期冒充检测时刻', { occurred_at: fixtureTime }], ['逾期携带新截止', { new_due_at: fixtureDue }],
  ['系统冒用员工', { actor_employee_id: randomUUID() }], ['员工缺主体', { actor_type: 'EMPLOYEE' }],
  ['延期缺新截止', { event_type: 'EXTENDED', reason: '测试延期' }],
  ['延期缺原因', { event_type: 'EXTENDED', new_due_at: new Date('2026-11-05T00:00:00Z') }],
  ['首次指定伪造旧截止', { event_type: 'DEADLINE_ASSIGNED', reason: '测试指定', new_due_at: new Date('2026-11-05T00:00:00Z') }],
] as [string, SchemaRow][])('%s被期限事件CHECK拒绝', async (_name, overrides) => {
  await transaction(async ({ task }) => { await expect(insertSchemaRow(client, 'deadline_event', deadlineRow(task.id, overrides)))
    .rejects.toMatchObject({ code: '23514' }); });
});
it('合法延期及首次指定保留独立事实，历史逾期不被覆盖', async () => {
  await transaction(async ({ task, employeeId }) => {
    await insertSchemaRow(client, 'deadline_event', deadlineRow(task.id));
    const next = new Date('2026-11-05T00:00:00Z');
    await insertSchemaRow(client, 'deadline_event', deadlineRow(task.id, { event_type: 'EXTENDED', new_due_at: next,
      occurred_at: fixtureDue, reason: '隔离延期', actor_type: 'EMPLOYEE', actor_employee_id: employeeId }));
    await insertSchemaRow(client, 'deadline_event', deadlineRow(task.id, { event_type: 'DEADLINE_ASSIGNED', deadline_at: next,
      new_due_at: next, occurred_at: fixtureDue, reason: '隔离首次指定' }));
    expect((await client.query('SELECT count(*)::int AS count FROM deadline_event WHERE task_id=$1', [task.id])).rows[0].count).toBe(3);
  });
});

it.each([
  ['负扫描数量', { scanned_count: -1 }], ['负变更数量', { changed_count: -1 }], ['负失败数量', { failed_count: -1 }],
  ['空作业名', { job_name: ' ' }], ['空实例名', { instance_id: '' }], ['空requestId', { request_id: '' }],
  ['运行中标结束', { finished_at: fixtureDue }], ['成功缺结束时刻', { status: 'SUCCEEDED' }],
  ['结束早于开始', { status: 'FAILED', finished_at: new Date('2026-10-31T00:00:00Z') }],
] as [string, SchemaRow][])('调度%s被CHECK拒绝', async (_name, overrides) => {
  await transaction(async () => { await expect(insertSchemaRow(client, 'scheduler_run', runRow(overrides))).rejects.toMatchObject({ code: '23514' }); });
});
it.each(['SUCCEEDED', 'PARTIAL_FAILED', 'FAILED', 'ABANDONED'])('调度%s可保存真实完成记录和脱敏失败', async status => {
  await transaction(async ({ task }) => {
    const row = runRow({ status, finished_at: fixtureDue, failed_count: status === 'PARTIAL_FAILED' ? 1 : 0 });
    await insertSchemaRow(client, 'scheduler_run', row);
    await insertSchemaRow(client, 'scheduler_failure', { id: randomUUID(), run_id: row.id, task_id: task.id,
      error_code: 'TASK_SCAN_FAILED', sanitized_message: '测试任务扫描失败', occurred_at: fixtureDue });
  });
});
it.each([
  ['scheduler_failure', { id: randomUUID(), run_id: randomUUID(), error_code: 'ERROR', sanitized_message: '测试错误' }, '23503'],
  ['task_history', historyRow(randomUUID()), '23503'], ['deadline_event', deadlineRow(randomUUID()), '23503'],
] as [TaskTable, SchemaRow, string][])('%s拒绝不存在的上游记录', async (table, row, code) => {
  await transaction(async () => { await expect(insertSchemaRow(client, table, row)).rejects.toMatchObject({ code }); });
});
it('失败摘要不能为空或超长，诊断记录保护原任务和运行记录不被级联删除', async () => {
  await transaction(async ({ task }) => {
    const row = runRow(); await insertSchemaRow(client, 'scheduler_run', row);
    await insertSchemaRow(client, 'scheduler_failure', { id: randomUUID(), run_id: row.id, task_id: task.id,
      error_code: 'TEST_ERROR', sanitized_message: '测试诊断' });
    await expect(client.query('DELETE FROM scheduler_run WHERE id=$1', [row.id])).rejects.toMatchObject({ code: '23503' });
  });
  await transaction(async () => {
    const row = runRow(); await insertSchemaRow(client, 'scheduler_run', row);
    await expect(insertSchemaRow(client, 'scheduler_failure', { id: randomUUID(), run_id: row.id, error_code: ' ', sanitized_message: '测试' }))
      .rejects.toMatchObject({ code: '23514' });
  });
  await transaction(async () => {
    const row = runRow(); await insertSchemaRow(client, 'scheduler_run', row);
    await expect(insertSchemaRow(client, 'scheduler_failure', { id: randomUUID(), run_id: row.id, error_code: 'TEST_ERROR',
      sanitized_message: '字'.repeat(501) })).rejects.toMatchObject({ code: '22001' });
  });
});
