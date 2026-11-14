// 作用：只读核对迁移和演示前后旧行；预期业务变化单独核对，不输出账号密码或原始敏感行。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
const mode=process.argv[2];assert.ok(['migrated','final'].includes(mode));const folder='docs/verification/evidence/M1-06';const attempt=process.argv[4]??'';assert.match(attempt,/^[a-z0-9-]*$/);const target=`${folder}/protection-check-${mode}${attempt?'-'+attempt:''}.json`;assert.ok(!existsSync(target));
const original=JSON.parse(readFileSync(folder+'/protection-before.json','utf8')),predeploy=JSON.parse(readFileSync(folder+'/protection-predeploy.json','utf8'));
const env={...parseEnv(readFileSync('.env','utf8')),...process.env};const {Client}=createRequire(resolve('apps/api/package.json'))('pg');const db=new Client({connectionString:env.DATABASE_URL});
const sha=s=>createHash('sha256').update(s).digest('hex');const report={at:new Date().toISOString(),mode,checkedOldRows:0,checks:[]};const demo=mode==='final'?JSON.parse(readFileSync(process.argv[3],'utf8')):null;
const productIds=new Set(demo?.products.map(p=>p.id)),draftIds=new Set(demo?.products.map(p=>p.draftId)),skuIds=new Set(demo?.products.flatMap(p=>p.after.map(s=>s.id)));
try{
 await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 for(const [file,hash] of Object.entries(original.files))assert.equal(sha(readFileSync(file)),hash,file+'已改变');
 const migrations=(await db.query('SELECT migration_name,checksum FROM _prisma_migrations ORDER BY migration_name')).rows;for(const m of original.migrations)assert.deepEqual(migrations.find(r=>r.migration_name===m.migration_name),m);assert.equal(migrations.length,6);report.checks.push('真实.env与0001～0005文件/数据库校验和保持，0006已增量应用');
 for(const [table,old] of Object.entries(original.rows)){
  assert.match(table,/^[a-z_]+$/);const rows=(await db.query(`SELECT to_jsonb(t) AS row FROM "${table}" t`)).rows.map(r=>r.row);
  for(const [key,hash] of Object.entries(old)){
   const identity=JSON.parse(key);const found=rows.find(r=>typeof identity==='object'?Object.keys(identity).filter(k=>['code','sku_id','draft_id','employee_id','role','permission_code','dimension_id','value_id'].includes(k)).every(k=>r[k]===identity[k]):(r.id??r.key)===identity);
   assert.ok(found,table+'旧行缺失');
   const allowed=mode==='final'&&((table==='product'&&productIds.has(found.id))||(table==='initial_inventory_draft'&&draftIds.has(found.id))||(table==='inventory_balance'&&skuIds.has(found.sku_id))||table==='employee');
   if(!allowed){const comparable={...found};if(table==='initial_inventory_draft')delete comparable.adjustment_id;assert.equal(sha(JSON.stringify(comparable)),hash,table+'旧行被修改');}
   report.checkedOldRows++;
  }
 }
 const identities={};for(const table of ['employee','customer'])identities[table]=Object.fromEntries((await db.query(`SELECT to_jsonb(t)-'last_login_at'-'updated_at' AS row FROM ${table} t`)).rows.map(({row})=>[row.id,sha(JSON.stringify(row))]));assert.deepEqual(identities,predeploy.identities);report.checks.push('全部原员工/顾客密码摘要、角色、权限版本、状态、资料和头像保持；仅实际登录时间允许变化');
 const stableBusiness={};for(const [table,fields] of [['product',['status','version','updated_at']],['initial_inventory_draft',['status','version','updated_at','adjustment_id']],['inventory_balance',['available','version','updated_at']]]){
  stableBusiness[table]=Object.fromEntries((await db.query(`SELECT to_jsonb(t) AS row FROM ${table} t`)).rows.map(({row})=>{const key=row.id??row.sku_id;if(mode==='final'&&table==='product'&&existsSync(folder+'/development-demo-copy.json')){const copy=JSON.parse(readFileSync(folder+'/development-demo-copy.json','utf8')).products.find(p=>p.id===row.id);if(copy){assert.equal(row.description,copy.afterDescription);row.description=copy.beforeDescription;}}for(const f of fields)delete row[f];return [key,sha(JSON.stringify(row))];}));
 }
 if(mode==='migrated'){report.stableBusiness=stableBusiness;report.checks.push('0006迁移后原30表全部旧行逐行保持，草稿仅新增null外键');}
 else{
  assert.deepEqual(stableBusiness,JSON.parse(readFileSync(process.argv[5]??folder+'/protection-check-migrated.json','utf8')).stableBusiness);
  for(const p of demo.products){const current=(await db.query('SELECT status,version FROM product WHERE id=$1',[p.id])).rows[0];assert.equal(current.status,'ON_SALE');assert.equal(current.version,p.version);
   const draft=(await db.query('SELECT status,adjustment_id FROM initial_inventory_draft WHERE id=$1',[p.draftId])).rows[0];assert.equal(draft.status,'CONVERTED');assert.equal(draft.adjustment_id,p.adjustmentId);
   const a=(await db.query('SELECT status,posted_by_id FROM inventory_adjustment WHERE id=$1',[p.adjustmentId])).rows[0];assert.equal(a.status,'POSTED');assert.ok(a.posted_by_id);
   for(const s of p.after){const b=(await db.query('SELECT available,reserved,purchase_blocked FROM inventory_balance WHERE sku_id=$1',[s.id])).rows[0];assert.deepEqual(b,{available:12,reserved:0,purchase_blocked:false});}
  }
  const bad=(await db.query('SELECT b.sku_id FROM inventory_balance b LEFT JOIN inventory_ledger l ON l.sku_id=b.sku_id GROUP BY b.sku_id,b.available,b.reserved HAVING b.available::bigint<>COALESCE(sum(l.delta_a::bigint),0) OR b.reserved::bigint<>COALESCE(sum(l.delta_r::bigint),0)')).rows;assert.deepEqual(bad,[]);
  const sourceBad=(await db.query("SELECT s.id FROM inventory_source_line s JOIN inventory_source parent ON parent.id=s.source_id LEFT JOIN inventory_ledger l ON l.source_line_id=s.id GROUP BY s.id,s.net_posted_quantity,parent.source_type HAVING s.net_posted_quantity::bigint<>COALESCE(sum(CASE WHEN parent.source_type='LOSS' THEN -l.delta_a::bigint ELSE l.delta_a::bigint END),0)")).rows;assert.deepEqual(sourceBad,[]);
  report.checks.push('两商品上架状态/版本与已记录的演示介绍更新正确，其余原资料、草稿身份和数量保持；8SKU各A12/R0，全部余额/来源净量与流水对账相等');
 }
 await db.query('COMMIT');report.passed=true;console.log(JSON.stringify({passed:true,mode,checkedOldRows:report.checkedOldRows,checks:report.checks}));
}catch(e){report.failure=e.message;process.exitCode=1;console.error(report.failure);}
finally{await db.end();writeFileSync(target,JSON.stringify(report,null,2)+'\n');}
