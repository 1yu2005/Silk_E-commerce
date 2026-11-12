// 作用：验证身份、会话、授权及审计表的数据库约束与迁移结果。
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { assertSafeTestDatabase } from '../scripts/database-env.js';

const safe = assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('集成测试仅可在test环境执行');
const client = new Client({ connectionString: safe.testUrl });
beforeAll(async () => { await client.connect(); });
afterAll(async () => { await client.end(); });

// 每项独立事务，包含失败的 SQL 也必须回滚，绝不清空已有测试数据。
async function transaction(run: () => Promise<void>) {
  await client.query('BEGIN');
  try { await run(); } finally { await client.query('ROLLBACK'); }
}
async function employee() {
  const id = randomUUID();
  await client.query(`INSERT INTO employee (id, username, display_name, password_hash, role, updated_at)
    VALUES ($1, $2, '约束测试员工', '仅为约束测试占位值', 'CUSTOMER_SERVICE', now())`,
  [id, `t_${id.replaceAll('-', '').slice(0, 20)}`]);
  return id;
}
async function customer() {
  const id = randomUUID();
  await client.query(`INSERT INTO customer (id, phone, password_hash, nickname, updated_at)
    VALUES ($1, $2, '仅为约束测试占位值', '约束测试顾客', now())`, [id, `139${String(BigInt(`0x${id.replaceAll('-', '').slice(0, 12)}`) % 100000000n).padStart(8, '0')}`]);
  return id;
}

it('存在稳定管理员锁行', async () => {
  const result = await client.query("SELECT key FROM system_guard WHERE key='ADMIN_AVAILABILITY'");
  expect(result.rowCount).toBe(1);
});

it.each([
  ['员工账号格式', "UPDATE employee SET username='Bad'", '23514'],
  ['员工空显示名', "UPDATE employee SET display_name='   '", '23514'],
  ['员工令牌版本', 'UPDATE employee SET token_version=-1', '23514'],
  ['员工权限版本', 'UPDATE employee SET permission_version=-1', '23514'],
  ['员工乐观版本', 'UPDATE employee SET version=-1', '23514'],
  ['员工时间', "UPDATE employee SET updated_at=created_at-interval '1 second'", '23514'],
  ['顾客手机号', "UPDATE customer SET phone='123'", '23514'],
  ['顾客昵称', "UPDATE customer SET nickname=' '", '23514'],
  ['顾客版本', 'UPDATE customer SET token_version=-1', '23514'],
  ['会话无主体', `INSERT INTO auth_session (id,subject_type,token_version,expires_at) VALUES (gen_random_uuid(),'EMPLOYEE',0,now()+interval '1 hour')`, '23514'],
  ['审计主体不匹配', `INSERT INTO audit_log (id,actor_type,action,target_type,target_id,request_id) VALUES (gen_random_uuid(),'EMPLOYEE','test','Employee','test','test')`, '23514'],
  ['权限依赖非数组', `INSERT INTO permission_definition (code,name,description,admin_only,dependencies) VALUES ('test','测试','测试',false,'{}')`, '23514'],
])('%s被数据库拒绝', async (_name, sql, code) => {
  await transaction(async () => {
    const employeeId = await employee(); const customerId = await customer();
    const updating = sql.startsWith('UPDATE');
    await expect(client.query(updating ? `${sql} WHERE id=$1` : sql,
      updating ? [sql.startsWith('UPDATE employee') ? employeeId : customerId] : []))
      .rejects.toMatchObject({ code });
  });
});

it.each([
  ['双主体', `INSERT INTO auth_session (id,subject_type,employee_id,customer_id,token_version,expires_at) VALUES (gen_random_uuid(),'EMPLOYEE',$1,$2,0,now()+interval '1 hour')`, '23514'],
  ['错误登录域', `INSERT INTO auth_session (id,subject_type,employee_id,token_version,expires_at) VALUES (gen_random_uuid(),'CUSTOMER',$1,0,now()+interval '1 hour')`, '23514'],
  ['会话负版本', `INSERT INTO auth_session (id,subject_type,employee_id,token_version,expires_at) VALUES (gen_random_uuid(),'EMPLOYEE',$1,-1,now()+interval '1 hour')`, '23514'],
  ['会话到期边界', `INSERT INTO auth_session (id,subject_type,employee_id,token_version,expires_at) VALUES (gen_random_uuid(),'EMPLOYEE',$1,0,now())`, '23514'],
  ['会话撤销时间', `INSERT INTO auth_session (id,subject_type,employee_id,token_version,expires_at,revoked_at) VALUES (gen_random_uuid(),'EMPLOYEE',$1,0,now()+interval '1 hour',now()-interval '1 second')`, '23514'],
  ['外键不存在', `INSERT INTO auth_session (id,subject_type,employee_id,token_version,expires_at) VALUES (gen_random_uuid(),'EMPLOYEE',gen_random_uuid(),0,now()+interval '1 hour')`, '23503'],
])('%s被数据库拒绝', async (_name, sql, code) => {
  await transaction(async () => {
    const employeeId = await employee(); const customerId = await customer();
    const parameters = sql.includes('$2') ? [employeeId, customerId] : sql.includes('$1') ? [employeeId] : [];
    await expect(client.query(sql, parameters)).rejects.toMatchObject({ code });
  });
});

it.each(['username', 'phone'])('%s唯一约束有效', async field => {
  await transaction(async () => {
    if (field === 'username') {
      const id = await employee();
      await expect(client.query(`INSERT INTO employee (id,username,display_name,password_hash,role,updated_at)
        SELECT gen_random_uuid(),username,display_name,password_hash,role,updated_at FROM employee WHERE id=$1`, [id]))
        .rejects.toMatchObject({ code: '23505' });
    } else {
      const id = await customer();
      await expect(client.query(`INSERT INTO customer (id,phone,password_hash,nickname,updated_at)
        SELECT gen_random_uuid(),phone,password_hash,nickname,updated_at FROM customer WHERE id=$1`, [id]))
        .rejects.toMatchObject({ code: '23505' });
    }
  });
});

it('合法会话、三类审计和授权可写入，历史主体禁止级联删除', async () => {
  await transaction(async () => {
    const employeeId = await employee(); const customerId = await customer();
    for (const [subject, employeeRef, customerRef] of [['EMPLOYEE',employeeId,null],['CUSTOMER',null,customerId]]) {
      await client.query(`INSERT INTO auth_session (id,subject_type,employee_id,customer_id,token_version,expires_at)
        VALUES (gen_random_uuid(),$1,$2,$3,0,now()+interval '1 hour')`, [subject,employeeRef,customerRef]);
    }
    for (const [actor, employeeRef, customerRef] of [['SYSTEM',null,null],['EMPLOYEE',employeeId,null],['CUSTOMER',null,customerId]]) {
      await client.query(`INSERT INTO audit_log (id,actor_type,actor_employee_id,actor_customer_id,action,target_type,target_id,request_id)
        VALUES (gen_random_uuid(),$1,$2,$3,'test','Employee',$4,'test')`, [actor,employeeRef,customerRef,employeeId]);
    }
    await client.query(`INSERT INTO permission_definition VALUES ('test.read','测试','测试',false,'[]')`);
    await client.query(`INSERT INTO role_permission VALUES ('CUSTOMER_SERVICE','test.read')`);
    await client.query(`INSERT INTO employee_extra_permission (employee_id,permission_code,granted_by_id) VALUES ($1,'test.read',$1)`, [employeeId]);
    await expect(client.query('DELETE FROM employee WHERE id=$1', [employeeId])).rejects.toMatchObject({ code: '23503' });
  });
});

it.each(['role_permission','employee_extra_permission'])('%s联合唯一约束有效', async table => {
  await transaction(async () => {
    const id = await employee();
    await client.query(`INSERT INTO permission_definition VALUES ('test.read','测试','测试',false,'[]')`);
    const sql = table === 'role_permission'
      ? `INSERT INTO role_permission VALUES ('CUSTOMER_SERVICE','test.read')`
      : `INSERT INTO employee_extra_permission (employee_id,permission_code,granted_by_id) VALUES ($1,'test.read',$1)`;
    const parameters = table === 'role_permission' ? [] : [id];
    await client.query(sql, parameters);
    await expect(client.query(sql, parameters)).rejects.toMatchObject({ code: '23505' });
  });
});
