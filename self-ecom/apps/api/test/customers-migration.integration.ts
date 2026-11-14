// 作用：0006旧顾客/会话/商品逐行升级0007，保留密码与数据，并验证数据库约束及重复部署。
import {randomUUID,createHash} from 'node:crypto';
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Client} from 'pg';
import {expect,it} from 'vitest';
import {assertSafeTestDatabase} from '../scripts/database-env.js';
import {runPrisma} from '../scripts/database.js';
const base=assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL,process.env.DATABASE_URL);
it('0006旧库增量升级0007保持所有原行，地址/购物车约束及重复deploy生效',async()=>{
 const name='customers_migration_'+randomUUID().replaceAll('-','')+'_test',url=new URL(base.testUrl);url.pathname='/'+name;const safe=assertSafeTestDatabase(base.developmentUrl,url.toString());
 const adminUrl=new URL(base.testUrl);adminUrl.pathname='/postgres';const admin=new Client({connectionString:adminUrl.toString()}),client=new Client({connectionString:safe.testUrl});let created=false,connected=false;
 const previous=['0001_bootstrap','0002_auth_employee_permission_audit','0003_files_communication_history','0004_store_settings_tasks_deadlines','0005_categories_products_skus_inventory_accounts','0006_inventory_sources_adjustments_ledger'];
 const scratch=mkdtempSync(join(tmpdir(),'self-ecom-customers-migration-')),migrations=join(scratch,'migrations');mkdirSync(migrations);
 for(const item of previous){mkdirSync(join(migrations,item));copyFileSync(resolve(__dirname,'../prisma/migrations',item,'migration.sql'),join(migrations,item,'migration.sql'));}
 copyFileSync(resolve(__dirname,'../prisma/migrations/migration_lock.toml'),join(migrations,'migration_lock.toml'));
 const config=join(scratch,'prisma.config.ts');writeFileSync(config,`export default {schema:${JSON.stringify(resolve(__dirname,'../prisma/schema.prisma'))},migrations:{path:${JSON.stringify(migrations)}},datasource:{url:process.env.DATABASE_URL}};`);const env={...process.env,DATABASE_URL:safe.testUrl};
 try{
  await admin.connect();await admin.query(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`);created=true;runPrisma(['migrate','deploy','--config',config],env);await client.connect();connected=true;
  const employee=randomUUID(),customer=randomUUID(),product=randomUUID(),sku=randomUUID();
  await client.query(`INSERT INTO employee(id,username,display_name,password_hash,role,must_change_password,updated_at) VALUES($1,'customer_upgrade','升级员工','独占旧员工hash','SUPER_ADMIN',false,now())`,[employee]);
  await client.query(`INSERT INTO customer(id,phone,nickname,password_hash,updated_at) VALUES($1,'13900000007','原顾客','独占旧顾客hash',now())`,[customer]);
  await client.query(`INSERT INTO product(id,product_code,name,created_by_id,updated_by_id,updated_at) VALUES($1,'UPGRADE-C7','原服装商品',$2,$2,now())`,[product,employee]);
  await client.query(`INSERT INTO sku(id,product_id,code,combination_signature,updated_at) VALUES($1,$2,'UPGRADE-C7-SKU','DEFAULT',now())`,[sku,product]);
  await client.query(`INSERT INTO inventory_balance(sku_id,available,reserved,updated_at) VALUES($1,7,2,now())`,[sku]);
  const tables=(await client.query<{tablename:string}>("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(r=>r.tablename);
  const snapshot=async()=>{const result:Record<string,unknown[]>={};for(const table of tables)result[table]=(await client.query(`SELECT to_jsonb(t)-'status_version' AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`)).rows.map(r=>r.row);return result;};
  const before=await snapshot(),checksums=(await client.query('SELECT migration_name,checksum FROM _prisma_migrations ORDER BY migration_name')).rows;runPrisma(['migrate','deploy'],env);expect(await snapshot()).toEqual(before);
  for(const row of checksums)expect(row.checksum).toBe(createHash('sha256').update(readFileSync(resolve(__dirname,'../prisma/migrations',row.migration_name,'migration.sql'))).digest('hex'));
  expect((await client.query('SELECT status_version FROM customer WHERE id=$1',[customer])).rows).toEqual([{status_version:0}]);
  await expect(client.query('UPDATE customer SET status_version=-1 WHERE id=$1',[customer])).rejects.toMatchObject({code:'23514'});
  const address=`INSERT INTO address(id,customer_id,receiver,phone,province,city,district,detail,is_default,updated_at) VALUES($1,$2,'夹具','01000000000','省','市','区','旧库升级隔离夹具',true,now())`;
  await client.query(address,[randomUUID(),customer]);await expect(client.query(address,[randomUUID(),customer])).rejects.toMatchObject({code:'23505'});
  const cart=`INSERT INTO cart_item(id,customer_id,sku_id,quantity,updated_at) VALUES($1,$2,$3,$4,now())`;
  await client.query(cart,[randomUUID(),customer,sku,1]);await expect(client.query(cart,[randomUUID(),customer,sku,1])).rejects.toMatchObject({code:'23505'});await expect(client.query('UPDATE cart_item SET quantity=100 WHERE customer_id=$1',[customer])).rejects.toMatchObject({code:'23514'});
  const applied=(await client.query('SELECT * FROM _prisma_migrations ORDER BY migration_name')).rows;runPrisma(['migrate','deploy'],env);expect(await snapshot()).toEqual(before);expect((await client.query('SELECT * FROM _prisma_migrations ORDER BY migration_name')).rows).toEqual(applied);
 }finally{if(connected)await client.end();if(created)await admin.query(`DROP DATABASE "${name}"`);await admin.end();console.log('保留0007升级测试目录：'+scratch);}
},60000);
