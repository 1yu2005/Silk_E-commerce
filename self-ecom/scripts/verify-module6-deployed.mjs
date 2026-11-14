// 作用：以既有账号核对本机/常用Docker真实服装入账及页面，API重建后再次核对账务与图片；凭据只从标准输入读取。
/* global document,innerWidth */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
const input=createInterface({input:process.stdin});const [line]=await once(input,'line');input.close();process.stdin.pause();const credential=JSON.parse(line);
const env={...parseEnv(readFileSync('.env','utf8')),...process.env,...JSON.parse(process.argv[4]??'{}')};
const demo=JSON.parse(readFileSync(process.argv[2],'utf8'));assert.equal(demo.passed,true);const label=process.argv[3]??'final1';assert.match(label,/^[a-z0-9-]+$/);
const output=`output/playwright/M1-06/deployed-${label}`;assert.ok(!existsSync(output+'/result.json'));mkdirSync(output,{recursive:true});
const report={at:new Date().toISOString(),checks:[],requests:[],pageErrors:[]};let browser;const secrets=[credential.warehouse,credential.admin];
const safe=s=>secrets.reduce((v,p)=>v.replaceAll(p,'[REDACTED]'),String(s));
const check=name=>{report.checks.push(name);console.log(JSON.stringify({passed:true,check:name}));};
async function call(origin,path,method='GET',body,token){const r=await fetch(origin+'/api/v1'+path,{method,signal:AbortSignal.timeout(15000),headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();report.requests.push({origin,path,method,status:r.status,requestId:j.requestId});assert.equal(r.status,200,path+' '+j.code);if(j.data?.accessToken)secrets.push(j.data.accessToken);return j.data;}
const digest=async url=>{const r=await fetch(url);assert.equal(r.status,200);return createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex');};
const docker=env.DOCKER_EXECUTABLE??'docker';
const compose=args=>{const r=spawnSync(docker,['compose','--env-file','.env','-f','infra/compose.yaml',...args],{env,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});assert.equal(r.status,0,safe(r.stderr));return r.stdout;};
const dbState=()=>{const id=compose(['ps','-q','db']).trim();const r=spawnSync(docker,['inspect','--format','{{json .}}',id],{env,encoding:'utf8',windowsHide:true});assert.equal(r.status,0);const v=JSON.parse(r.stdout);return {id:v.Id,startedAt:v.State.StartedAt,mounts:v.Mounts.map(m=>({name:m.Name,destination:m.Destination}))};};
try{
 const tokens=new Map(),images=[];
 for(const origin of ['http://localhost:8080','http://localhost:3000']){
  const login=await call(origin,'/admin/auth/login','POST',{username:'m105_warehouse',password:credential.warehouse});assert.equal(login.employee.role,'MERCH_WAREHOUSE');tokens.set(origin,login.accessToken);
  const admin=await call(origin,'/admin/auth/login','POST',{username:'admin',password:credential.admin});assert.equal(admin.employee.role,'SUPER_ADMIN');
  for(const row of demo.products){
   const p=await call(origin,'/admin/products/'+row.id,'GET',undefined,login.accessToken);assert.equal(p.status,'ON_SALE');assert.equal(p.version,row.version);assert.equal(p.skus.filter(s=>!s.retiredAt).length,row.after.length);assert.ok(p.skus.filter(s=>!s.retiredAt).every(s=>s.available===12&&s.reserved===0));
   const a=await call(origin,'/admin/inventory/adjustments/'+row.adjustmentId,'GET',undefined,login.accessToken);assert.equal(a.action.id,row.actionId);assert.equal(a.status,'POSTED');assert.equal(a.ledger.length,row.after.length);assert.ok(a.sources.every(s=>s.lines.every(l=>l.netPostedQuantity===12)));
   for(const site of [origin,origin.includes('8080')?'http://localhost:8081':'http://localhost:5174']){const publicProduct=await call(site,'/store/products/'+row.id);assert.ok(publicProduct.skus.every(s=>s.available===12&&s.purchasable));assert.ok(!/reserved|costCents|sourceLineId/.test(JSON.stringify(publicProduct)));images.push({url:site+p.mainImageUrl,hash:await digest(site+p.mainImageUrl)});}
  }
 }
 check('现有仓储及管理员原密码可登录；本机与Docker两商品8SKU各A12/R0、同一动作和来源净量12');
 const {chromium}=await import(pathToFileURL(env.PLAYWRIGHT_MODULE_PATH).href);browser=await chromium.launch({headless:true,executablePath:env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 for(const [label,origin,storeOrigin] of [['docker','http://localhost:8080','http://localhost:8081'],['native','http://localhost:5173','http://localhost:5174']]){
  const admin=await browser.newPage({viewport:{width:1440,height:1000}});admin.on('pageerror',e=>report.pageErrors.push(e.name));
  await admin.goto(origin+'/login');await admin.getByLabel('员工账号',{exact:true}).fill('m105_warehouse');await admin.getByLabel('密码',{exact:true}).fill(credential.warehouse);await admin.locator('form button[type=submit]').click();await admin.waitForURL(origin+'/');
  await admin.goto(origin+'/inventory');await admin.getByRole('heading',{name:'库存余额与预警',exact:true}).waitFor();await admin.getByRole('cell',{name:'日常纯棉T恤',exact:false}).first().waitFor();await admin.screenshot({path:output+'/'+label+'-balances.png',fullPage:true});
  await admin.goto(origin+'/inventory/adjustments/'+demo.products[0].adjustmentId);await admin.getByRole('heading',{name:'已确认流水',exact:true}).waitFor();await admin.screenshot({path:output+'/'+label+'-posted.png',fullPage:true});
  await admin.goto(origin+'/inventory/sources/'+demo.products[0].sourceIds[0]);await admin.getByRole('heading',{name:'来源凭据详情',exact:true}).waitFor();await admin.screenshot({path:output+'/'+label+'-source.png',fullPage:true});
  await admin.goto(origin+'/inventory/ledger');await admin.getByRole('link',{name:demo.products[0].adjustmentNumber,exact:true}).first().waitFor();await admin.setViewportSize({width:390,height:844});assert.ok(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await admin.screenshot({path:output+'/'+label+'-ledger-mobile.png',fullPage:true});await admin.close();
  const store=await browser.newPage({viewport:{width:1366,height:768}});store.on('pageerror',e=>report.pageErrors.push(e.name));
  await store.goto(storeOrigin+'/products/'+demo.products[0].id);await store.getByRole('button',{name:'白色',exact:true}).click();await store.getByRole('button',{name:'M',exact:true}).click();await store.getByText(/此款有货/).waitFor();await store.waitForFunction(()=>[...document.querySelectorAll('img')].every(i=>i.complete&&i.naturalWidth>0));await store.screenshot({path:output+'/'+label+'-tshirt.png',fullPage:true});
  await store.goto(storeOrigin+'/products/'+demo.products[1].id);await store.getByRole('button',{name:'黑色',exact:true}).click();await store.getByRole('button',{name:'L',exact:true}).click();await store.getByText(/此款有货/).waitFor();await store.setViewportSize({width:390,height:844});assert.ok(await store.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await store.screenshot({path:output+'/'+label+'-jacket-mobile.png',fullPage:true});await store.close();
 }
 assert.deepEqual(report.pageErrors,[]);check('本机与Docker实际仓储登录、来源/登记/流水、手机布局、两服装颜色尺码和真实图片');await browser.close();browser=undefined;
 report.beforeDatabase=dbState();compose(['up','-d','--no-deps','--force-recreate','--wait','--wait-timeout','90','api']);report.afterDatabase=dbState();assert.deepEqual(report.afterDatabase,report.beforeDatabase);
 for(const image of images)assert.equal(await digest(image.url),image.hash);
 for(const row of demo.products){const a=await call('http://localhost:8080','/admin/inventory/adjustments/'+row.adjustmentId,'GET',undefined,tokens.get('http://localhost:8080'));assert.equal(a.action.id,row.actionId);assert.equal(a.ledger.length,row.after.length);}
 check('常用API强制重建后图片摘要、原会话、动作流水保持；原数据库容器ID/启动时间/卷保持');report.passed=true;
}catch(e){report.failure=safe(e.stack??e.message);console.error(report.failure);process.exitCode=1;}
finally{await browser?.close();writeFileSync(output+'/result.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:!!report.passed,checks:report.checks.length,pageErrors:report.pageErrors.length}));}
