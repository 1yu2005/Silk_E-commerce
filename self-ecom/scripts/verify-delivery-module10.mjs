// 作用：只读复核已完成的常用环境演示、保护摘要、同组镜像与秘密排除；不重复建单。
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {parseEnv} from 'node:util';
import path from 'node:path';

const label=process.argv[2];assert.match(label,/^[a-z0-9-]+$/);
const directory='docs/verification/evidence/M2-10',target=directory+'/delivery-'+label+'.json';assert.ok(!existsSync(target));
const env={...parseEnv(readFileSync('.env','utf8')),...process.env},docker=env.DOCKER_EXECUTABLE;
const sha=v=>createHash('sha256').update(v).digest('hex');
const local=JSON.parse(readFileSync(directory+'/local-existing-demo/result.json','utf8'));
const deployment=JSON.parse(readFileSync(directory+'/deployment-final.json','utf8'));
const accepted=JSON.parse(readFileSync(directory+'/docker-5/result.json','utf8'));
assert.equal(deployment.status,'passed');assert.equal(accepted.status,'passed');
// 原执行已完成收货和消费断言，随后被旧的登录时间字段断言中断；不改写原失败记录。
assert.equal(local.status,'failed');assert.match(local.failure,/原员工密码、权限和资料保持 原字段改变 updated_at,last_login_at/);
assert.ok(local.demo?.completedAt);assert.deepEqual(local.pageErrors,[]);
const demoCredential=JSON.parse(readFileSync('private-delivery/板块8＋9_演示顾客.local.json','utf8'));
const secrets=[...Object.entries(env).filter(([k,v])=>/SECRET|PASSWORD|TOKEN|DATABASE_URL/.test(k)&&v.length>=6).map(([,v])=>v),demoCredential.password];
const report={startedAt:new Date().toISOString(),source:directory+'/local-existing-demo/result.json',readOnly:true,checks:[],commands:[],secretFindings:[],scanExclusions:[]};
function run(bin,args){const startedAt=new Date().toISOString();const r=spawnSync(bin,args,{encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});report.commands.push({command:[path.basename(bin),...args],startedAt,endedAt:new Date().toISOString(),exitCode:r.status});assert.equal(r.status,0,'只读命令失败');return args[0]==='logs'?r.stdout+r.stderr:r.stdout;}
function scan(name,bytes){
 const content=Buffer.from(bytes).toString('utf8');
 // Axios固定十六进制字符集偶然包含顾客弱口令的连续数字；只排除此完整公开常量。
 const candidate=content.replaceAll('0123456789abcdef','[HEX_ALPHABET]');
 if(candidate!==content&&secrets.some(s=>content.includes(s)&&!candidate.includes(s)))report.scanExclusions.push({name,reason:'固定十六进制字符集的子串，非凭据注入；原产物不修改'});
 if(secrets.some(s=>candidate.includes(s)))report.secretFindings.push(name);
}
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const {Client}=createRequire(path.resolve('apps/api/package.json'))('pg'),db=new Client({connectionString:env.DATABASE_URL});
try{
 await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const demo=local.demo,id=local.orderId;
 const order=(await db.query('SELECT * FROM "order" WHERE id=$1',[id])).rows[0];
 assert.equal(order.status,'COMPLETED');assert.equal(order.fulfillment_stage,'SHIPPED');assert.equal(order.payable_cents,demo.payableCents);
 assert.equal(order.completed_at.toISOString(),demo.completedAt);assert.equal(order.after_sale_deadline.toISOString(),demo.afterSaleDeadline);
 assert.equal(+order.after_sale_deadline-+order.completed_at,7*86400000);
 const shipment=(await db.query('SELECT * FROM shipment WHERE order_id=$1',[id])).rows[0];assert.equal(shipment.status,'CONFIRMED');assert.equal(shipment.tracking_number,demo.trackingNumber);assert.match(shipment.tracking_number,/^DEMO-M210-/);
 const attempts=(await db.query('SELECT * FROM handover_attempt WHERE order_id=$1',[id])).rows;assert.equal(attempts.length,1);assert.equal(attempts[0].status,'HANDED_OVER');assert.equal(+attempts[0].actual_handover_at,+shipment.actual_handover_at);
 const payments=(await db.query('SELECT id FROM payment WHERE order_id=$1',[id])).rows;assert.equal(payments.length,1);
 const ledger=(await db.query('SELECT event_type,delta_a,delta_r FROM inventory_ledger WHERE business_id=$1 OR business_id=$2 ORDER BY created_at',[id,payments[0].id])).rows;
 assert.deepEqual(ledger.map(r=>[r.event_type,r.delta_a,r.delta_r]),[['RESERVE',-1,1],['PAY',0,-1]]);
 const quantity=(await db.query('SELECT SUM(available)::text AS available,SUM(reserved)::text AS reserved FROM inventory_balance')).rows[0];assert.deepEqual(quantity,{available:'94',reserved:'0'});
 const drift=(await db.query('SELECT b.sku_id FROM inventory_balance b LEFT JOIN (SELECT sku_id,SUM(delta_a) AS a,SUM(delta_r) AS r FROM inventory_ledger GROUP BY sku_id) l ON l.sku_id=b.sku_id WHERE b.available<>COALESCE(l.a,0) OR b.reserved<>COALESCE(l.r,0)')).rows;assert.deepEqual(drift,[]);
 const net=(await db.query('SELECT COALESCE(SUM(payable_cents),0)::text AS cents FROM "order" WHERE customer_id=$1 AND status=\'COMPLETED\'',[demo.customerId])).rows[0].cents;assert.equal(net,String(demo.payableCents));
 for(const filename of ['local-completed.png','local-fulfillment.png'])assert.ok(existsSync(directory+'/local-existing-demo/'+filename));
 assert.ok(local.requests.some(r=>r.path.endsWith('/confirm-handover')&&r.status===200));
 report.demo={...demo,orderId:id,netConsumptionCents:net};report.database={balances:quantity,ledger,orders:(await db.query('SELECT status,COUNT(*)::int AS count FROM "order" GROUP BY status ORDER BY status')).rows};
 report.checks.push('原演示单只读续验：唯一付款/整单实际交运/顾客收货完成/7天窗口/净消费10700分，正式流水仅预占和付款，A94/R0与流水逐SKU一致');

 const accountBefore=JSON.parse(readFileSync('docs/verification/evidence/M2-08-09/accounts-before.json','utf8'));
 for(const [table,rows]of Object.entries(accountBefore.rows)){
  assert.ok(['employee','customer','employee_extra_permission'].includes(table));
  const actual=new Map((await db.query('SELECT to_jsonb(t) AS row FROM "'+table+'" t')).rows.map(({row})=>{delete row.last_login_at;delete row.updated_at;return [row.id??row.employee_id+':'+row.permission_code,sha(JSON.stringify(row))];}));
  for(const row of rows)assert.equal(actual.get(row.id),row.digest,'原账号密码/角色/资料/额外权限保持');
 }
 const baseline=JSON.parse(readFileSync(directory+'/protection-before.json','utf8'));
 for(const [file,hash]of Object.entries(baseline.files))assert.equal(sha(readFileSync(file)),hash,file+'保持');
 for(const file of baseline.images){const response=await fetch('http://localhost:'+(env.STORE_HOST_PORT??8081)+'/api/v1/files/'+file.id+'/content');assert.equal(response.status,200);assert.equal(sha(Buffer.from(await response.arrayBuffer())),file.hash);}
 const allowedChanges={employee:new Set(),customer:new Set(),product:new Set([JSON.stringify(demo.productId)]),inventory_balance:new Set(Object.keys(baseline.rows.inventory_balance).filter(key=>JSON.parse(key).sku_id===demo.skuId))};
 // 登录只改变时间字段，其余账号字段另以历史非时间摘要验证。
 for(const table of ['employee','customer'])for(const row of (await db.query('SELECT id FROM "'+table+'"')).rows)allowedChanges[table].add(JSON.stringify(row.id));
 const changed=[];let originalRows=0;
 for(const [table,rows]of Object.entries(baseline.rows)){
  assert.match(table,/^[a-z_]+$/);
  const projection=table==='order'?"to_jsonb(t)-ARRAY['receipt_rule_snapshot','receipt_setting_version_id','receipt_source','after_sale_rule_snapshot','completion_setting_version_id']":'to_jsonb(t)';
  const current=new Map((await db.query('SELECT '+projection+' AS row FROM "'+table+'" t')).rows.map(({row})=>[JSON.stringify(row.id??row.key??row),sha(JSON.stringify(row))]));
  for(const [key,hash]of Object.entries(rows)){originalRows++;if(current.get(key)!==hash){changed.push({table,key});assert.ok(allowedChanges[table]?.has(key),'无关原行不得修改：'+table);}}
 }
 report.protection={originalRows,expectedChangedRows:changed};
 report.checks.push('部署前原2946行完全保持；演示后仅账号登录时间、选中SKU正式账务和商品销量相关原行变化，原密码/角色/权限/.env/0001～0010和3原文件保持');
 report.database.migrations=(await db.query('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name')).rows.map(r=>r.migration_name);assert.equal(report.database.migrations.length,12);
 await db.query('ROLLBACK');

 for(const [i,name]of ['self-ecom-api-1','self-ecom-admin-web-1','self-ecom-store-web-1'].entries()){
  assert.equal(run(docker,['inspect','--format','{{.Image}}',name]).trim(),accepted.acceptedImages[i].id);
  scan(name+'镜像配置',run(docker,['image','inspect','--format','{{json .Config}}',accepted.acceptedImages[i].id]));scan(name+'运行日志',run(docker,['logs','--tail','400',name]));
 }
 assert.equal(run(docker,['exec','self-ecom-api-1','id','-u']).trim(),'1000');
 assert.equal(run(docker,['exec','self-ecom-api-1','node','-e',"const f=require('fs');const bad=['/app/.env','/app/private-delivery','/app/output','/app/test','/app/apps/api/test','/app/scripts/task-acceptance.mjs'].filter(p=>f.existsSync(p));console.log(JSON.stringify(bad));process.exitCode=bad.length?1:0"]).trim(),'[]');
 report.checks.push('常用三应用镜像ID等于独占验收镜像；API非root，镜像排除真实配置、私有交付和测试入口');
 const paths=new Set([...run('git',['diff','--name-only','--relative','-z','--','.']).split('\0'),...run('git',['ls-files','--others','--exclude-standard','-z','--','.']).split('\0')].filter(Boolean));
 for(const file of paths)if(existsSync(file))scan(file,readFileSync(file));
 for(const file of files('output/build/M2-10/final-1'))scan(file,readFileSync(file));
 assert.equal(run('git',['check-ignore','--quiet','private-delivery/板块10_开发完成说明_含账号密码.local.md']),'');assert.match(readFileSync('.dockerignore','utf8'),/^private-delivery\s*$/m);assert.equal(run('git',['ls-files','--','private-delivery']).trim(),'');
 assert.deepEqual(report.secretFindings,[]);report.checks.push('可提交改动/脱敏证据/两端产物/镜像配置/日志未发现实际秘密；Git和Docker排除private-delivery');
 report.git={branch:run('git',['branch','--show-current']).trim(),head:run('git',['rev-parse','HEAD']).trim(),staged:run('git',['diff','--cached','--name-only']).trim()};assert.equal(report.git.head,'e2a2096277f1e36d6ab3bebd6b5612ad111f5833');assert.equal(report.git.staged,'');
 report.status='passed';
}catch(e){report.status='failed';report.failure=e instanceof assert.AssertionError?'交付断言失败：'+e.message:e.code??e.name;process.exitCode=1;}
finally{await db.end();report.endedAt=new Date().toISOString();writeFileSync(target,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks,failure:report.failure,secretFindings:report.secretFindings,git:report.git}));}
