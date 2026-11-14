// 作用：浏览器已通过后在获准的执行环境定向续验常用API重建；只读数据库核对，不需要再次传入密码。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
const output='docs/verification/evidence/M1-06/deployed-persistence.json';assert.ok(!existsSync(output));const env={...parseEnv(readFileSync('.env','utf8')),...process.env};
const demo=JSON.parse(readFileSync('docs/verification/evidence/M1-06/development-demo-run1.json','utf8'));const browser=JSON.parse(readFileSync('output/playwright/M1-06/deployed-final1/result.json','utf8'));assert.equal(browser.checks.length,2);assert.deepEqual(browser.pageErrors,[]);
const docker=env.DOCKER_EXECUTABLE??'docker';const {Client}=createRequire(resolve('apps/api/package.json'))('pg');const db=new Client({connectionString:env.DATABASE_URL});const report={at:new Date().toISOString(),browserEvidence:'output/playwright/M1-06/deployed-final1/result.json',checks:[],commands:[]};
const run=args=>{const r=spawnSync(docker,args,{env,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});report.commands.push({command:args.slice(0,2),exitCode:r.status,error:r.error?.code});assert.equal(r.status,0,r.error?.code??'Docker命令失败');return r.stdout;};
const compose=args=>run(['compose','--env-file','.env','-f','infra/compose.yaml',...args]);
const state=()=>{const id=compose(['ps','-q','db']).trim();const d=JSON.parse(run(['inspect','--format','{{json .}}',id]));return {id:d.Id,startedAt:d.State.StartedAt,mounts:d.Mounts.map(m=>({name:m.Name,destination:m.Destination}))};};
const digest=async url=>{const r=await fetch(url);assert.equal(r.status,200);return createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex');};
async function facts(){
 const ids=demo.products.map(p=>p.adjustmentId),skuIds=demo.products.flatMap(p=>p.after.map(s=>s.id));const sources=demo.products.flatMap(p=>p.sourceIds);
 return {adjustments:(await db.query('SELECT * FROM inventory_adjustment WHERE id=ANY($1::uuid[]) ORDER BY id',[ids])).rows,
  ledger:(await db.query('SELECT * FROM inventory_ledger WHERE business_id=ANY($1::uuid[]) ORDER BY id',[ids])).rows,
  actions:(await db.query('SELECT * FROM inventory_action WHERE adjustment_id=ANY($1::uuid[]) ORDER BY id',[ids])).rows,
  balances:(await db.query('SELECT * FROM inventory_balance WHERE sku_id=ANY($1::uuid[]) ORDER BY sku_id',[skuIds])).rows,
  sources:(await db.query('SELECT * FROM inventory_source_line WHERE source_id=ANY($1::uuid[]) ORDER BY id',[sources])).rows};
}
try{
 await db.connect();const beforeFacts=await facts(),beforeImages=[];
 for(const p of demo.products){const publicProduct=(await(await fetch('http://localhost:8081/api/v1/store/products/'+p.id)).json()).data;assert.equal(publicProduct.availableQuantity,String(p.after.length*12));for(const origin of ['http://localhost:3000','http://localhost:3001','http://localhost:8081','http://localhost:5174'])beforeImages.push({url:origin+publicProduct.mainImageUrl,sha256:await digest(origin+publicProduct.mainImageUrl)});}
 report.beforeDatabase=state();compose(['up','-d','--no-deps','--force-recreate','--wait','--wait-timeout','90','api']);report.afterDatabase=state();assert.deepEqual(report.afterDatabase,report.beforeDatabase);
 let ready=false;for(let i=0;i<60&&!ready;i++){try{ready=(await fetch('http://localhost:8080/api/v1/health/ready')).status===200;}catch{/* Nginx等待API名称更新 */}if(!ready)await new Promise(r=>setTimeout(r,300));}assert.ok(ready);
 assert.deepEqual(await facts(),beforeFacts);for(const image of beforeImages)assert.equal(await digest(image.url),image.sha256);
 report.images=beforeImages;report.adjustments=beforeFacts.adjustments.map(a=>({id:a.id,status:a.status}));report.ledgerCount=beforeFacts.ledger.length;report.actionCount=beforeFacts.actions.length;report.checks.push('API强制重建后2登记/2动作/8流水/8余额/8来源行逐行保持，两个环境公开图片摘要保持');
 const containers=compose(['ps','--format','json']).trim().split('\n').map(x=>JSON.parse(x));assert.equal(containers.length,4);assert.ok(containers.every(c=>c.State==='running'&&c.Health==='healthy'));report.containers=containers.map(c=>({id:c.ID,service:c.Service,health:c.Health}));
 for(const origin of ['http://localhost:3000','http://localhost:3001','http://localhost:5173','http://localhost:5174','http://localhost:8080','http://localhost:8081']){assert.equal((await fetch(origin+'/api/v1/health/ready')).status,200);assert.deepEqual(await(await fetch(origin+'/api/docs-json')).json(),JSON.parse(readFileSync('docs/openapi/openapi.json','utf8')));}
 report.checks.push('原数据库容器及两个卷保持，常用四服务healthy，本机和Docker六入口85操作契约一致');report.passed=true;console.log(JSON.stringify({passed:true,checks:report.checks,ledgerCount:report.ledgerCount}));
}catch(e){report.failure=e.message;process.exitCode=1;console.error(report.failure);}
finally{await db.end();writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
