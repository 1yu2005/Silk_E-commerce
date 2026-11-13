// 作用：从已含板块4配置与任务的独占库升级0005，逐行核对旧数据及重复部署；不修改旧迁移。
import { randomUUID,createHash } from 'node:crypto';
import { copyFileSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { Client } from 'pg';
import { expect,it } from 'vitest';
import { assertSafeTestDatabase } from '../scripts/database-env.js';
import { runPrisma } from '../scripts/database.js';
import { cursorRow,fixtureTime,historyRow,insertSchemaRow,settingRow,taskRow } from './fixtures/task-schema.js';
const base=assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL,process.env.DATABASE_URL);
it('0004真实配置/任务/账号升级0005逐行保持、旧迁移checksum保持且可重复deploy',async()=>{
  const name='catalog_migration_'+randomUUID().replaceAll('-','')+'_test';const url=new URL(base.testUrl);url.pathname='/'+name;
  const checked=assertSafeTestDatabase(base.developmentUrl,url.toString());const adminUrl=new URL(base.testUrl);adminUrl.pathname='/postgres';
  const admin=new Client({connectionString:adminUrl.toString()}),client=new Client({connectionString:checked.testUrl});let created=false,connected=false;
  const previous=['0001_bootstrap','0002_auth_employee_permission_audit','0003_files_communication_history','0004_store_settings_tasks_deadlines'];
  const scratch=mkdtempSync(join(tmpdir(),'self-ecom-catalog-migration-'));const migrations=join(scratch,'migrations');mkdirSync(migrations);
  for(const item of previous){mkdirSync(join(migrations,item));copyFileSync(resolve(__dirname,'../prisma/migrations',item,'migration.sql'),join(migrations,item,'migration.sql'));}
  copyFileSync(resolve(__dirname,'../prisma/migrations/migration_lock.toml'),join(migrations,'migration_lock.toml'));
  const config=join(scratch,'prisma.config.ts');writeFileSync(config,`export default {schema:${JSON.stringify(resolve(__dirname,'../prisma/schema.prisma'))},migrations:{path:${JSON.stringify(migrations)}},datasource:{url:process.env.DATABASE_URL}};`);
  const variables={...process.env,DATABASE_URL:checked.testUrl};
  try{
    await admin.connect();await admin.query(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`);created=true;
    runPrisma(['migrate','deploy','--config',config],variables);await client.connect();connected=true;
    const employee=randomUUID();await client.query(`INSERT INTO employee(id,username,display_name,password_hash,role,must_change_password,created_at,updated_at) VALUES($1,'catalog_upgrade','旧库员工','仅独占结构夹具','SUPER_ADMIN',false,$2,$2)`,[employee,fixtureTime]);
    const setting=settingRow({created_by_employee_id:employee});await insertSchemaRow(client,'store_setting_version',setting);await client.query('UPDATE store_setting_head SET current_version_id=$1,version=1 WHERE id=1',[setting.id]);
    const cursor=cursorRow();await insertSchemaRow(client,'task_stage_cursor',cursor);const task=taskRow(cursor,{settings_version_id:setting.id});await insertSchemaRow(client,'task',task);await insertSchemaRow(client,'task_history',historyRow(task.id));
    const tables=(await client.query<{tablename:string}>("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(r=>r.tablename);
    const snapshot=async()=>{const rows:Record<string,unknown[]>={};for(const table of tables)rows[table]=(await client.query(`SELECT to_jsonb(t) AS row FROM "${table}" t ${table==='system_guard'?"WHERE key<>'CATEGORY_TREE'":''} ORDER BY to_jsonb(t)::text`)).rows.map(r=>r.row);return rows;};
    const before=await snapshot();const checksums=(await client.query('SELECT migration_name,checksum FROM _prisma_migrations ORDER BY migration_name')).rows;
    runPrisma(['migrate','deploy'],variables);expect(await snapshot()).toEqual(before);
    expect((await client.query('SELECT key FROM system_guard ORDER BY key')).rows).toEqual([{key:'ADMIN_AVAILABILITY'},{key:'CATEGORY_TREE'}]);
    for(const row of checksums){expect(row.checksum).toBe(createHash('sha256').update(readFileSync(resolve(__dirname,'../prisma/migrations',row.migration_name,'migration.sql'))).digest('hex'));}
    expect((await client.query("SELECT migration_name,checksum FROM _prisma_migrations WHERE migration_name<>'0005_categories_products_skus_inventory_accounts' ORDER BY migration_name")).rows).toEqual(checksums);
    const applied=(await client.query('SELECT * FROM _prisma_migrations ORDER BY migration_name')).rows;runPrisma(['migrate','deploy'],variables);expect(await snapshot()).toEqual(before);expect((await client.query('SELECT * FROM _prisma_migrations ORDER BY migration_name')).rows).toEqual(applied);
  }finally{if(connected)await client.end();if(created)await admin.query(`DROP DATABASE "${name}"`);await admin.end();console.log('保留0005升级测试目录：'+scratch);}
},60000);
