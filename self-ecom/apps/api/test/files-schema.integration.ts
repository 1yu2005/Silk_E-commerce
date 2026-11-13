// 作用：在隔离PostgreSQL事务中验证文件、引用、沟通及状态历史的数据库底线，不冒充业务接口验收。
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { assertSafeTestDatabase } from '../scripts/database-env.js';

const safe = assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('集成测试仅可在test环境执行');
const client = new Client({ connectionString: safe.testUrl });
beforeAll(async () => { await client.connect(); });
afterAll(async () => { await client.end(); });

type Row = Record<string, unknown>;
type FixtureTable = 'employee' | 'customer' | 'file_asset' | 'file_reference' | 'communication' | 'business_state_history';
// 表名和列名只来自本文件固定夹具，所有值均参数化；失败事务统一回滚，不清空已有测试数据。
async function insert(table: FixtureTable, row: Row) {
  const columns = Object.keys(row);
  await client.query(`INSERT INTO "${table}" (${columns.map(column => `"${column}"`).join(',')})
    VALUES (${columns.map((_, index) => `$${index + 1}`).join(',')})`, Object.values(row));
}
async function transaction(run: (actors: { employeeId: string; customerId: string }) => Promise<void>) {
  await client.query('BEGIN');
  try {
    // 数据库时钟可能比宿主机快几毫秒；夹具创建/更新时间统一取数据库事务时刻。
    const fixtureTime = (await client.query<{ time: Date }>('SELECT CURRENT_TIMESTAMP(3) AS time')).rows[0]!.time;
    const employeeId = randomUUID(); const customerId = randomUUID();
    await insert('employee', { id: employeeId, username: `t_${employeeId.replaceAll('-', '').slice(0, 20)}`,
      display_name: '文件约束测试员工', password_hash: '仅用于结构测试的占位值', role: 'CUSTOMER_SERVICE',
      created_at: fixtureTime, updated_at: fixtureTime });
    await insert('customer', { id: customerId,
      phone: `139${String(BigInt(`0x${customerId.replaceAll('-', '').slice(0, 12)}`) % 100000000n).padStart(8, '0')}`,
      nickname: '文件约束测试顾客', password_hash: '仅用于结构测试的占位值', created_at: fixtureTime, updated_at: fixtureTime });
    await run({ employeeId, customerId });
  } finally { await client.query('ROLLBACK'); }
}
const createdAt = new Date('2026-11-01T00:00:00Z');
const expiresAt = new Date('2026-11-02T00:00:00Z');
function file(customerId: string, overrides: Row = {}): Row {
  return { id: randomUUID(), uploader_type: 'CUSTOMER', uploader_customer_id: customerId,
    purpose: 'CUSTOMER_AVATAR', storage_key: `${randomUUID()}.png`, original_name: '测试图.png', mime_type: 'image/png',
    byte_size: 1024, width: 100, height: 100, sha256: 'a'.repeat(64), created_at: createdAt, expires_at: expiresAt, ...overrides };
}
function reference(fileId: unknown, customerId: string, overrides: Row = {}): Row {
  return { id: randomUUID(), file_asset_id: fileId, owner_type: 'CUSTOMER_AVATAR', owner_id: customerId,
    slot: 'avatar', audience: 'PUBLIC', created_by_type: 'CUSTOMER', created_by_customer_id: customerId, ...overrides };
}
function communication(employeeId: string, overrides: Row = {}): Row {
  return { id: randomUUID(), scope_type: 'ORDER', scope_id: randomUUID(), author_employee_id: employeeId,
    channel: 'PHONE', occurred_at: createdAt, created_at: createdAt, result: '内部测试结果', request_id: randomUUID(), ...overrides };
}
function history(overrides: Row = {}): Row {
  return { id: randomUUID(), aggregate_type: 'ORDER', aggregate_id: randomUUID(), dimension: 'main',
    command_key: randomUUID(), from_state: null, to_state: 'WAIT_PAYMENT', actor_type: 'SYSTEM', request_id: randomUUID(), ...overrides };
}

it.each(['image/jpeg', 'image/png', 'image/webp'])('合法%s和5MiB、4000万像素边界可保存', async mimeType => {
  await transaction(async ({ customerId }) => {
    const row = file(customerId, { mime_type: mimeType, byte_size: 5242880, width: 10000, height: 4000 });
    await insert('file_asset', row);
    expect((await client.query('SELECT state,visibility,version FROM file_asset WHERE id=$1', [row.id])).rows)
      .toEqual([{ state: 'STAGED', visibility: 'PRIVATE', version: 0 }]);
  });
});

const invalidFiles: [string, Row, string][] = [
  ['无上传人', { uploader_customer_id: null }, 'file_asset_uploader_valid'],
  ['上传类型与主体不匹配', { uploader_type: 'EMPLOYEE' }, 'file_asset_uploader_valid'],
  ['STAGED缺到期时间', { expires_at: null }, 'file_asset_lifecycle_valid'],
  ['STAGED提前公开', { visibility: 'PUBLIC' }, 'file_asset_lifecycle_valid'],
  ['RETAINED保留到期时间', { state: 'RETAINED' }, 'file_asset_lifecycle_valid'],
  ['STAGED含清理标记', { purge_started_at: expiresAt }, 'file_asset_lifecycle_valid'],
  ['清理中缺开始时间', { state: 'PURGE_PENDING' }, 'file_asset_lifecycle_valid'],
  ['未到期便开始清理', { state: 'PURGE_PENDING', purge_started_at: createdAt }, 'file_asset_lifecycle_valid'],
  ['已清理缺完成时间', { state: 'PURGED', purge_started_at: expiresAt }, 'file_asset_lifecycle_valid'],
  ['清理完成早于开始', { state: 'PURGED', purge_started_at: expiresAt, purged_at: createdAt }, 'file_asset_lifecycle_valid'],
  ['到期不晚于创建', { expires_at: createdAt }, 'file_asset_expiration_valid'],
  ['零字节', { byte_size: 0 }, 'file_asset_bytes_valid'],
  ['负字节', { byte_size: -1 }, 'file_asset_bytes_valid'],
  ['超过5MiB', { byte_size: 5242881 }, 'file_asset_bytes_valid'],
  ['零宽度', { width: 0 }, 'file_asset_dimensions_valid'],
  ['负高度', { height: -1 }, 'file_asset_dimensions_valid'],
  ['宽度超10000', { width: 10001 }, 'file_asset_dimensions_valid'],
  ['高度超10000', { height: 10001 }, 'file_asset_dimensions_valid'],
  ['像素乘积超限', { width: 10000, height: 4001 }, 'file_asset_dimensions_valid'],
  ['大整数尺寸不溢出', { width: 2147483647, height: 2147483647 }, 'file_asset_dimensions_valid'],
  ['不允许的MIME', { mime_type: 'image/svg+xml' }, 'file_asset_mime_valid'],
  ['非法摘要', { sha256: 'not-a-sha256' }, 'file_asset_digest_valid'],
  ['空存储键', { storage_key: ' ' }, 'file_asset_storage_key_valid'],
  ['负版本', { version: -1 }, 'file_asset_version_nonnegative'],
];
it.each(invalidFiles)('%s由文件CHECK拒绝', async (_name, overrides, constraint) => {
  await transaction(async ({ customerId }) => {
    await expect(insert('file_asset', file(customerId, overrides))).rejects.toMatchObject({ code: '23514', constraint });
  });
});

it('双上传主体被拒绝，员工与顾客上传人均有真实外键', async () => {
  await transaction(async ({ employeeId, customerId }) => {
    await expect(insert('file_asset', file(customerId, { uploader_employee_id: employeeId })))
      .rejects.toMatchObject({ code: '23514', constraint: 'file_asset_uploader_valid' });
  });
});
it.each(['CUSTOMER', 'EMPLOYEE'])('%s上传人不存在时外键拒绝', async subject => {
  await transaction(async ({ customerId }) => {
    await expect(insert('file_asset', file(customerId, { uploader_type: subject,
      uploader_customer_id: subject === 'CUSTOMER' ? randomUUID() : null,
      uploader_employee_id: subject === 'EMPLOYEE' ? randomUUID() : null }))).rejects.toMatchObject({ code: '23503' });
  });
});
it.each(['AFTER_SALE_EVIDENCE', 'INVENTORY_EVIDENCE', 'FULFILLMENT_EVIDENCE', 'INSPECTION_EVIDENCE', 'COMMUNICATION_EVIDENCE'])(
  '%s不能变为公开文件', async purpose => {
    await transaction(async ({ customerId }) => {
      await expect(insert('file_asset', file(customerId, { purpose, state: 'RETAINED', expires_at: null, visibility: 'PUBLIC' })))
        .rejects.toMatchObject({ code: '23514', constraint: 'file_asset_public_purpose_valid' });
    });
  });
it.each(['CUSTOMER_AVATAR', 'PRODUCT_IMAGE'])('%s已保留图允许公开元数据状态', async purpose => {
  await transaction(async ({ customerId }) => {
    await insert('file_asset', file(customerId, { purpose, state: 'RETAINED', expires_at: null, visibility: 'PUBLIC' }));
  });
});
it.each(['PURGE_PENDING', 'PURGED'])('%s合法清理时间可以保存', async state => {
  await transaction(async ({ customerId }) => {
    await insert('file_asset', file(customerId, { state, purge_started_at: expiresAt,
      purged_at: state === 'PURGED' ? expiresAt : null }));
  });
});
it('存储键唯一，摘要不唯一，不跨用户自动合并图片', async () => {
  await transaction(async ({ customerId }) => {
    const first = file(customerId); await insert('file_asset', first);
    await insert('file_asset', file(customerId));
    await expect(insert('file_asset', file(customerId, { storage_key: first.storage_key })))
      .rejects.toMatchObject({ code: '23505', constraint: 'file_asset_storage_key_key' });
  });
});
it('未知用途和未知owner类型不能入库', async () => {
  await transaction(async ({ customerId }) => {
    await expect(insert('file_asset', file(customerId, { purpose: 'ARBITRARY_FILE' }))).rejects.toMatchObject({ code: '22P02' });
  });
  await transaction(async ({ customerId }) => {
    const row = file(customerId); await insert('file_asset', row);
    await expect(insert('file_reference', reference(row.id, customerId, { owner_type: 'ARBITRARY_OWNER' })))
      .rejects.toMatchObject({ code: '22P02' });
  });
});

const invalidReferences: [string, Row, string][] = [
  ['缺绑定人', { created_by_customer_id: null }, 'file_reference_creator_valid'],
  ['绑定人类型不符', { created_by_type: 'EMPLOYEE' }, 'file_reference_creator_valid'],
  ['空槽位', { slot: ' ' }, 'file_reference_slot_valid'],
  ['私有业务标为公开引用', { owner_type: 'AFTER_SALE_MATERIAL' }, 'file_reference_public_owner_valid'],
];
it.each(invalidReferences)('%s由引用CHECK拒绝', async (_name, overrides, constraint) => {
  await transaction(async ({ customerId }) => {
    const row = file(customerId); await insert('file_asset', row);
    await expect(insert('file_reference', reference(row.id, customerId, overrides))).rejects.toMatchObject({ code: '23514', constraint });
  });
});
it('绑定人双主体被拒绝', async () => {
  await transaction(async ({ employeeId, customerId }) => {
    const row = file(customerId); await insert('file_asset', row);
    await expect(insert('file_reference', reference(row.id, customerId, { created_by_employee_id: employeeId })))
      .rejects.toMatchObject({ code: '23514', constraint: 'file_reference_creator_valid' });
  });
});
it.each(['file_asset_id', 'created_by_customer_id'])('引用的%s不存在时外键拒绝', async field => {
  await transaction(async ({ customerId }) => {
    const row = file(customerId); await insert('file_asset', row);
    await expect(insert('file_reference', reference(row.id, customerId, { [field]: randomUUID() })))
      .rejects.toMatchObject({ code: '23503' });
  });
});
it('相同文件、业务和槽位唯一，历史引用阻止删除文件', async () => {
  await transaction(async ({ customerId }) => {
    const row = file(customerId, { state: 'RETAINED', expires_at: null }); await insert('file_asset', row);
    const link = reference(row.id, customerId); await insert('file_reference', link);
    await expect(insert('file_reference', { ...link, id: randomUUID() }))
      .rejects.toMatchObject({ code: '23505', constraint: 'file_reference_asset_owner_slot_key' });
  });
  await transaction(async ({ customerId }) => {
    const row = file(customerId); await insert('file_asset', row); await insert('file_reference', reference(row.id, customerId));
    await expect(client.query('DELETE FROM file_asset WHERE id=$1', [row.id]))
      .rejects.toMatchObject({ code: '23503', constraint: 'file_reference_file_asset_id_fkey' });
  });
});
it('头像初始为空、外键拒绝不存在文件并保护当前文件', async () => {
  await transaction(async ({ customerId }) => {
    expect((await client.query('SELECT avatar_asset_id FROM customer WHERE id=$1', [customerId])).rows[0].avatar_asset_id).toBeNull();
    await expect(client.query('UPDATE customer SET avatar_asset_id=$1 WHERE id=$2', [randomUUID(), customerId]))
      .rejects.toMatchObject({ code: '23503', constraint: 'customer_avatar_asset_id_fkey' });
  });
  await transaction(async ({ customerId }) => {
    const row = file(customerId, { state: 'RETAINED', expires_at: null }); await insert('file_asset', row);
    await client.query('UPDATE customer SET avatar_asset_id=$1 WHERE id=$2', [row.id, customerId]);
    await expect(client.query('DELETE FROM file_asset WHERE id=$1', [row.id]))
      .rejects.toMatchObject({ code: '23503', constraint: 'customer_avatar_asset_id_fkey' });
  });
});
it('到仓与验收有独立owner类型，员工上传人与绑定人外键可用', async () => {
  await transaction(async ({ employeeId, customerId }) => {
    const row = file(customerId, { uploader_type: 'EMPLOYEE', uploader_customer_id: null, uploader_employee_id: employeeId,
      purpose: 'INSPECTION_EVIDENCE' }); await insert('file_asset', row);
    for (const ownerType of ['RETURN_RECEIPT', 'RETURN_INSPECTION']) {
      await insert('file_reference', reference(row.id, customerId, { owner_type: ownerType, owner_id: randomUUID(),
        slot: 'evidence', audience: 'INTERNAL', created_by_type: 'EMPLOYEE', created_by_customer_id: null, created_by_employee_id: employeeId }));
    }
    // 这里只证明枚举与外键存在，不代表到仓/验收业务绑定已可用。
    await expect(client.query('DELETE FROM employee WHERE id=$1', [employeeId])).rejects.toMatchObject({ code: '23503' });
  });
});

const invalidCommunications: [string, Row, string][] = [
  ['空内部结果', { result: ' ' }, 'communication_result_valid'],
  ['内部结果超4000字符', { result: '字'.repeat(4001) }, 'communication_result_valid'],
  ['没有更正对象却填原因', { correction_reason: '更正' }, 'communication_correction_valid'],
  ['有更正对象却缺原因', { corrects_id: randomUUID() }, 'communication_correction_valid'],
  ['有更正对象但原因空白', { corrects_id: randomUUID(), correction_reason: ' ' }, 'communication_correction_valid'],
  ['沟通时间超过录入后5分钟', { occurred_at: new Date(createdAt.getTime() + 300001) }, 'communication_occurred_at_valid'],
  ['空requestId', { request_id: ' ' }, 'communication_request_id_valid'],
];
it.each(invalidCommunications)('%s由沟通CHECK拒绝', async (_name, overrides, constraint) => {
  await transaction(async ({ employeeId }) => {
    await expect(insert('communication', communication(employeeId, overrides))).rejects.toMatchObject({ code: '23514', constraint });
  });
});
it('更正对象不能指向自身', async () => {
  await transaction(async ({ employeeId }) => {
    const id = randomUUID();
    await expect(insert('communication', communication(employeeId, { id, corrects_id: id, correction_reason: '测试自引用' })))
      .rejects.toMatchObject({ code: '23514', constraint: 'communication_correction_valid' });
  });
});
it.each(['author_employee_id', 'corrects_id'])('沟通的%s必须真实存在', async field => {
  await transaction(async ({ employeeId }) => {
    await expect(insert('communication', communication(employeeId, { [field]: randomUUID(),
      ...(field === 'corrects_id' ? { correction_reason: '测试不存在的更正对象' } : {}) })))
      .rejects.toMatchObject({ code: '23503' });
  });
});
it('公开与内部说明独立，边界内容及追加更正可保存，旧记录禁止级联删除', async () => {
  await transaction(async ({ employeeId }) => {
    const original = communication(employeeId, { result: '字'.repeat(4000), public_text: '给顾客看的说明',
      occurred_at: new Date(createdAt.getTime() + 300000) });
    await insert('communication', original);
    const correction = communication(employeeId, { scope_id: original.scope_id, corrects_id: original.id, correction_reason: '补充核实结果' });
    await insert('communication', correction);
    expect((await client.query('SELECT public_text FROM communication WHERE id=$1', [correction.id])).rows[0].public_text).toBeNull();
    expect((await client.query('SELECT result,public_text FROM communication WHERE id=$1', [original.id])).rows[0])
      .toEqual({ result: original.result, public_text: original.public_text });
    await expect(client.query('DELETE FROM communication WHERE id=$1', [original.id]))
      .rejects.toMatchObject({ code: '23503', constraint: 'communication_corrects_id_fkey' });
  });
});

const invalidHistory: [string, Row, string][] = [
  ['员工历史缺主体', { actor_type: 'EMPLOYEE' }, 'business_state_history_actor_valid'],
  ['顾客历史缺主体', { actor_type: 'CUSTOMER' }, 'business_state_history_actor_valid'],
  ['空维度', { dimension: ' ' }, 'business_state_history_values_valid'],
  ['空命令键', { command_key: ' ' }, 'business_state_history_values_valid'],
  ['空目标状态', { to_state: ' ' }, 'business_state_history_values_valid'],
  ['非空来源状态为空白', { from_state: ' ' }, 'business_state_history_values_valid'],
  ['历史缺追踪号', { request_id: ' ' }, 'business_state_history_request_id_valid'],
];
it.each(invalidHistory)('%s由历史CHECK拒绝', async (_name, overrides, constraint) => {
  await transaction(async () => {
    await expect(insert('business_state_history', history(overrides))).rejects.toMatchObject({ code: '23514', constraint });
  });
});
it.each(['SYSTEM', 'EMPLOYEE', 'CUSTOMER'])('%s历史主体可保存，错误组合拒绝', async actorType => {
  await transaction(async ({ employeeId, customerId }) => {
    const actors = { actor_type: actorType, actor_employee_id: actorType === 'EMPLOYEE' ? employeeId : null,
      actor_customer_id: actorType === 'CUSTOMER' ? customerId : null };
    await insert('business_state_history', history(actors));
    await expect(insert('business_state_history', history({ ...actors, actor_employee_id: employeeId, actor_customer_id: customerId })))
      .rejects.toMatchObject({ code: '23514', constraint: 'business_state_history_actor_valid' });
  });
});
it.each(['EMPLOYEE', 'CUSTOMER'])('%s历史主体外键拒绝不存在账号', async actorType => {
  await transaction(async () => {
    await expect(insert('business_state_history', history({ actor_type: actorType,
      [actorType === 'EMPLOYEE' ? 'actor_employee_id' : 'actor_customer_id']: randomUUID() })))
      .rejects.toMatchObject({ code: '23503' });
  });
});
it('同业务同维度命令键唯一，不同业务或维度可以独立记历史', async () => {
  await transaction(async () => {
    const row = history(); await insert('business_state_history', row);
    await insert('business_state_history', { ...row, id: randomUUID(), aggregate_id: randomUUID() });
    await insert('business_state_history', { ...row, id: randomUUID(), dimension: 'fulfillment' });
    await expect(insert('business_state_history', { ...row, id: randomUUID(), request_id: randomUUID() }))
      .rejects.toMatchObject({ code: '23505', constraint: 'business_state_history_command_key' });
  });
});
