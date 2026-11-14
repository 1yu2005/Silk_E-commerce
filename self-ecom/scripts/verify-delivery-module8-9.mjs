// 作用：交付前只读核实原账号/配置/文件、同组镜像、账务和秘密排除；不写业务数据。
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {parseEnv} from 'node:util';
import path from 'node:path';
const label=process.argv[2];assert.match(label,/^[a-z0-9-]+$/);const directory='docs/verification/evidence/M2-08-09',target=directory+'/delivery-'+label+'.json';assert.ok(!existsSync(target));
const env=parseEnv(readFileSync('.env','utf8')),docker=process.env.DOCKER_EXECUTABLE,sha=v=>createHash('sha256').update(v).digest('hex');
const local=JSON.parse(readFileSync(directory+'/local-final.json','utf8')),deployment=JSON.parse(readFileSync(directory+'/deployment-final.json','utf8'));assert.equal(local.status,'passed');assert.equal(deployment.status,'passed');
const credential=JSON.parse(readFileSync('private-delivery/板块8＋9_演示顾客.local.json','utf8'));
const secretValues=[...Object.entries(env).filter(([k,v])=>/SECRET|PASSWORD|TOKEN|DATABASE_URL/.test(k)&&v.length>=6).map(([,v])=>v),credential.password,process.env.LOCAL_ADMIN_PASSWORD].filter(Boolean);
const report={startedAt:new Date().toISOString(),checks:[],secretFindings:[],commands:[]};
function run(bin,args){const startedAt=new Date().toISOString(),r=spawnSync(bin,args,{encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});report.commands.push({command:[path.basename(bin),...args],startedAt,endedAt:new Date().toISOString(),exitCode:r.status});assert.equal(r.status,0,'只读命令失败');return args[0]==='logs'?r.stdout+r.stderr:r.stdout;}
function scan(name,bytes){if(secretValues.some(s=>Buffer.from(bytes).includes(Buffer.from(s))))report.secretFindings.push(name);}
const {Client}=createRequire(path.resolve('apps/api/package.json'))('pg'),db=new Client({connectionString:env.DATABASE_URL});
try{
 await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const before=JSON.parse(readFileSync(directory+'/accounts-before.json','utf8'));
 for(const [table,rows]of Object.entries(before.rows)){const actual=new Map((await db.query('SELECT to_jsonb(t) AS row FROM '+table+' t')).rows.map(({row})=>{delete row.last_login_at;delete row.updated_at;return[row.id??row.employee_id+':'+row.permission_code,sha(JSON.stringify(row))];}));for(const row of rows)assert.equal(actual.get(row.id),row.digest,'原账号资料/密码/角色权限保持');}
 report.checks.push('原3员工/2顾客除正常登录时间外的全部字段与额外权限摘要保持；新增演示顾客独立');
 const baseline=JSON.parse(readFileSync(directory+'/protection-before.json','utf8'));for(const [file,hash]of Object.entries(baseline.files))assert.equal(sha(readFileSync(file)),hash,file+'保持');
 for(const file of baseline.images){const response=await fetch('http://localhost:'+(env.STORE_HOST_PORT??8081)+'/api/v1/files/'+file.id+'/content');assert.equal(response.status,200);assert.equal(sha(Buffer.from(await response.arrayBuffer())),file.hash);}
 report.checks.push('.env及0001～0007迁移保持，3个原上传文件HTTP内容摘要保持');
 report.database={migrations:(await db.query('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name')).rows.map(r=>r.migration_name),balances:(await db.query('SELECT SUM(available)::text AS available,SUM(reserved)::text AS reserved FROM inventory_balance')).rows[0],orders:(await db.query('SELECT status,COUNT(*)::int AS count FROM "order" GROUP BY status ORDER BY status')).rows,payments:(await db.query('SELECT COUNT(*)::int AS count FROM payment')).rows[0].count};assert.equal(report.database.migrations.length,10);
 const actions=(await db.query('SELECT event_type,delta_a,delta_r FROM inventory_ledger WHERE business_id=$1::uuid OR business_id=$2::uuid ORDER BY created_at',[local.paidOrder.id,local.cancelledOrder.id])).rows;assert.equal(actions.filter(a=>a.event_type==='RESERVE').length,2);assert.equal(actions.filter(a=>a.event_type==='CLOSE').length,1);const payment=(await db.query('SELECT id FROM payment WHERE order_id=$1::uuid',[local.paidOrder.id])).rows;assert.equal(payment.length,1);assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM inventory_ledger WHERE business_id=$1::uuid AND event_type='PAY'",[payment[0].id])).rows[0].count,1);report.checks.push('正式演示两次预占、唯一付款、一次关闭均有对应流水；10迁移成功');
 await db.query('ROLLBACK');
 for(const [i,name]of ['self-ecom-api-1','self-ecom-admin-web-1','self-ecom-store-web-1'].entries()){assert.equal(run(docker,['inspect','--format','{{.Image}}',name]).trim(),deployment.images[i].id);scan(name+'镜像配置',run(docker,['image','inspect','--format','{{json .Config}}',deployment.images[i].id]));scan(name+'运行日志',run(docker,['logs','--tail','300',name]));}
 assert.equal(run(docker,['exec','self-ecom-api-1','id','-u']).trim(),'1000');
 assert.equal(run(docker,['exec','self-ecom-api-1','node','-e',"const f=require('fs');const bad=['/app/.env','/app/private-delivery','/app/output','/app/test','/app/apps/api/test','/app/scripts/task-acceptance.mjs'].filter(p=>f.existsSync(p));console.log(JSON.stringify(bad));process.exitCode=bad.length?1:0"]).trim(),'[]');report.checks.push('三应用使用同组验收镜像、API非root、运行镜像无真实配置/私有交付/测试入口');
 const paths=new Set([...run('git',['diff','--name-only','--relative','-z','--','.']).split('\0'),...run('git',['ls-files','--others','--exclude-standard','-z','--','.']).split('\0')].filter(Boolean));for(const file of paths){if(existsSync(file))scan(file,readFileSync(file));}
 function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}for(const file of files('output/build/M2-08-09/final4'))scan(file,readFileSync(file));
 assert.equal(run('git',['check-ignore','--quiet','private-delivery/板块8＋9_开发完成说明_含账号密码.local.md']),'');assert.match(readFileSync('.dockerignore','utf8'),/^private-delivery\s*$/m);assert.equal(run('git',['ls-files','--','private-delivery']).trim(),'');assert.deepEqual(report.secretFindings,[]);report.checks.push('可提交改动/证据、两端产物、镜像配置及运行日志未发现真实秘密；私有交付被Git与Docker排除');
 report.git={branch:run('git',['branch','--show-current']).trim(),head:run('git',['rev-parse','HEAD']).trim(),staged:run('git',['diff','--cached','--name-only']).trim()};assert.equal(report.git.head,'824537a8ae86908ae883387dcec27689fd2f4dba');assert.equal(report.git.staged,'');report.status='passed';
}catch(e){report.status='failed';report.failure=e instanceof assert.AssertionError?'交付断言失败：'+e.message.split('\n')[0]:e.code??e.name;process.exitCode=1;}
finally{await db.end();report.endedAt=new Date().toISOString();writeFileSync(target,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks,secretFindings:report.secretFindings,database:report.database,git:report.git}));}
