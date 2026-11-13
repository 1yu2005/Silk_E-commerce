// 作用：提供仅供隔离数据库测试使用的数据基础夹具，不注册生产模块或造数HTTP接口。
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';

export const taskTables = ['store_setting_head', 'store_setting_version', 'task_stage_cursor', 'task',
  'task_history', 'deadline_event', 'scheduler_run', 'scheduler_failure'] as const;
export type TaskTable = typeof taskTables[number];
export type SchemaRow = Record<string, unknown>;
export const fixtureTime = new Date('2026-11-01T00:00:00.000Z');
export const fixtureDue = new Date('2026-11-03T00:00:00.000Z');

export async function insertSchemaRow(client: Client, table: TaskTable | 'employee', row: SchemaRow): Promise<void> {
  const columns = Object.keys(row);
  // 表名和字段仅来自本文件及调用方的固定测试代码；所有数据值均参数化。
  await client.query(`INSERT INTO "${table}" (${columns.map(column => `"${column}"`).join(',')})
    VALUES (${columns.map((_, index) => `$${index + 1}`).join(',')})`, Object.values(row));
}

export function settingRow(overrides: SchemaRow = {}): SchemaRow {
  return { id: randomUUID(), version_number: 1, reason: '隔离测试完整配置', shipping_fee_cents: 1000,
    free_shipping_enabled: true, free_shipping_threshold_cents: 9900, return_receiver: '测试收件人',
    return_phone: '010-00000000', return_province: '测试省', return_city: '测试市', return_district: '测试区',
    return_detail: '仅隔离测试使用的虚构地址', service_phone: '+86 010-00000000', service_hours: null,
    payment_minutes: 30, auto_receipt_days: 10, after_sale_window_days: 7, review_workdays: 2,
    supplement_days: 7, return_ship_days: 7, inspection_workdays: 2, refund_workdays: 1, ...overrides };
}

export function cursorRow(overrides: SchemaRow = {}): SchemaRow {
  return { id: randomUUID(), business_type: 'AFTER_SALE', business_id: randomUUID(), stage: 'AFTER_SALE_REVIEW',
    last_round: 1, created_at: fixtureTime, updated_at: fixtureTime, ...overrides };
}

export function taskRow(cursor: SchemaRow, overrides: SchemaRow = {}): SchemaRow {
  return { id: randomUUID(), cursor_id: cursor.id, business_type: cursor.business_type, business_id: cursor.business_id,
    stage: cursor.stage, round: 1, entry_key: randomUUID(), required_permissions: JSON.stringify(['after-sale.service.read', 'after-sale.review']),
    started_at: fixtureTime, original_due_at: fixtureDue, due_at: fixtureDue,
    rule_snapshot: { unit: 'WORKDAY', amount: 2, timeZone: 'Asia/Shanghai', algorithmVersion: 'shanghai-calendar-v1' },
    created_at: fixtureTime, updated_at: fixtureTime, ...overrides };
}

export function historyRow(taskId: unknown, overrides: SchemaRow = {}): SchemaRow {
  return { id: randomUUID(), task_id: taskId, action: 'CREATED', actor_type: 'SYSTEM',
    before_status: null, after_status: 'OPEN', command_key: randomUUID(), request_id: randomUUID(), ...overrides };
}

export function deadlineRow(taskId: unknown, overrides: SchemaRow = {}): SchemaRow {
  return { id: randomUUID(), task_id: taskId, event_type: 'OVERDUE', deadline_at: fixtureDue,
    occurred_at: fixtureDue, detected_at: new Date('2026-11-04T00:00:00Z'), actor_type: 'SYSTEM',
    command_key: randomUUID(), request_id: randomUUID(), ...overrides };
}

export function runRow(overrides: SchemaRow = {}): SchemaRow {
  return { id: randomUUID(), job_name: 'task-overdue-scan', instance_id: 'schema-test',
    started_at: fixtureTime, request_id: randomUUID(), ...overrides };
}
