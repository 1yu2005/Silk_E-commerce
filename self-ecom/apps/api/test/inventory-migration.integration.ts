// 作用：保留0005已有账号/商品/余额/草稿逐行升级0006，验证增量FK与重复部署，不触及开发库。
import { randomUUID, createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { expect,it } from 'vitest';
import { assertSafeTestDatabase } from '../scripts/database-env.js';
import { runPrisma } from '../scripts/database.js';
const base=assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL,process.env.DATABASE_URL);
it('IT01：0005旧数据升级0006保持原值，草稿真实FK与库存约束生效，重复deploy无变化',async()=>{
 const name='inventory_migration_'+randomUUID().replaceAll('-','')+'_test',url=new URL(base.testUrl);url.pathname='/'+name;const safe=assertSafeTestDatabase(base.developmentUrl,url.toString());
 const adminUrl=new URL(base.testUrl);adminUrl.pathname='/postgres';const admin=new Client({connectionString:adminUrl.toString()}),client=new Client({connectionString:safe.testUrl});let created=false,connected=false;
 const previous=['0001_bootstrap','0002_auth_employee_permission_audit','0003_files_communication_history','0004_store_settings_tasks_deadlines','0005_categories_products_skus_inventory_accounts'];
 const scratch=mkdtempSync(join(tmpdir(),'self-ecom-inventory-migration-')),migrations=join(scratch,'migrations');mkdirSync(migrations);
 for(const item of previous){mkdirSync(join(migrations,item));copyFileSync(resolve(__dirname,'../prisma/migrations',item,'migration.sql'),join(migrations,item,'migration.sql'));}
 copyFileSync(resolve(__dirname,'../prisma/migrations/migration_lock.toml'),join(migrations,'migration_lock.toml'));
 const config=join(scratch,'prisma.config.ts');writeFileSync(config,`export default {schema:${JSON.stringify(resolve(__dirname,'../prisma/schema.prisma'))},migrations:{path:${JSON.stringify(migrations)}},datasource:{url:process.env.DATABASE_URL}};`);
 const env={...process.env,DATABASE_URL:safe.testUrl};
 try{
  await admin.connect();await admin.query(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`);created=true;runPrisma(['migrate','deploy','--config',config],env);await client.connect();connected=true;
  const employee=randomUUID(),product=randomUUID(),sku=randomUUID(),draft=randomUUID();
  await client.query(`INSERT INTO employee(id,username,display_name,password_hash,role,must_change_password,updated_at) VALUES($1,'inventory_upgrade','升级员工','独占夹具原hash','MERCH_WAREHOUSE',false,now())`,[employee]);
  await client.query(`INSERT INTO product(id,product_code,name,created_by_id,updated_by_id,updated_at) VALUES($1,'UPGRADE-INV','原服装商品',$2,$2,now())`,[product,employee]);
  await client.query(`INSERT INTO sku(id,product_id,code,combination_signature,updated_at) VALUES($1,$2,'UPGRADE-SKU','DEFAULT',now())`,[sku,product]);
  await client.query(`INSERT INTO inventory_balance(sku_id,available,reserved,updated_at) VALUES($1,7,2,now())`,[sku]);
  await client.query(`INSERT INTO initial_inventory_draft(id,product_id,conversion_key,created_by_id,updated_at) VALUES($1,$2,$3,$4,now())`,[draft,product,randomUUID(),employee]);
  await client.query(`INSERT INTO initial_inventory_draft_line(draft_id,sku_id,quantity) VALUES($1,$2,12)`,[draft,sku]);
  const tables=(await client.query<{tablename:string}>("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(r=>r.tablename);
  const snapshot=async()=>{const result:Record<string,unknown[]>={};for(const table of tables)result[table]=(await client.query(`SELECT to_jsonb(t)-'adjustment_id' AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`)).rows.map(r=>r.row);return result;};
  const before=await snapshot(),checksums=(await client.query('SELECT migration_name,checksum FROM _prisma_migrations ORDER BY migration_name')).rows;
  runPrisma(['migrate','deploy'],env);expect(await snapshot()).toEqual(before);
  for(const row of checksums)expect(row.checksum).toBe(createHash('sha256').update(readFileSync(resolve(__dirname,'../prisma/migrations',row.migration_name,'migration.sql'))).digest('hex'));
  expect((await client.query('SELECT adjustment_id FROM initial_inventory_draft WHERE id=$1',[draft])).rows).toEqual([{adjustment_id:null}]);
  await expect(client.query('UPDATE initial_inventory_draft SET adjustment_id=$1 WHERE id=$2',[randomUUID(),draft])).rejects.toMatchObject({code:'23503'});
  await expect(client.query('UPDATE inventory_balance SET available=-1 WHERE sku_id=$1',[sku])).rejects.toMatchObject({code:'23514'});
  const applied=(await client.query('SELECT * FROM _prisma_migrations ORDER BY migration_name')).rows;runPrisma(['migrate','deploy'],env);expect(await snapshot()).toEqual(before);expect((await client.query('SELECT * FROM _prisma_migrations ORDER BY migration_name')).rows).toEqual(applied);
 }finally{if(connected)await client.end();if(created)await admin.query(`DROP DATABASE "${name}"`);await admin.end();console.log('保留0006升级测试目录：'+scratch);}
},60000);
