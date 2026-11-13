// 作用：用只从标准输入接收的演示凭据核对常用四服务；图片保存后重建API再核对，凭据不写入证据。
/* global document,innerWidth */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
const input=createInterface({input:process.stdin});const [line]=await once(input,'line');input.close();process.stdin.pause();const credential=JSON.parse(line);
const env={...parseEnv(readFileSync('.env','utf8')),...process.env};
const demo=JSON.parse(readFileSync('docs/verification/evidence/M1-05/development-demo.json','utf8'));assert.equal(credential.username,demo.account.username);
const output='output/playwright/M1-05/deployed-final1';assert.ok(!existsSync(output+'/result.json'));mkdirSync(output,{recursive:true});
const origin='http://localhost:'+(env.ADMIN_HOST_PORT??8080),storeOrigin='http://localhost:'+(env.STORE_HOST_PORT??8081);
const report={at:new Date().toISOString(),checks:[],requests:[],pageErrors:[]};let browser,token;
const check=name=>{report.checks.push(name);console.log(JSON.stringify({passed:true,check:name}));};
async function call(path,method='GET',body,expected=200,authenticated=true){const r=await fetch(origin+'/api/v1'+path,{method,headers:{...(authenticated&&token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const json=await r.json();assert.equal(r.status,expected,path+' '+json.code);report.requests.push({path,method,status:r.status,requestId:r.headers.get('x-request-id')});return json.data??json;}
const digest=async url=>{const r=await fetch(url);assert.equal(r.status,200);return createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex');};
try{
  token=(await call('/admin/auth/login','POST',credential)).accessToken;
  const images=[];for(const row of demo.products){const p=await call('/admin/products/'+row.id);assert.equal(p.status,'DRAFT');assert.equal(p.skus.filter(s=>!s.retiredAt).length,row.currentSkus);assert.ok(p.skus.every(s=>s.available===0&&s.reserved===0));const draft=await call('/admin/products/'+row.id+'/initial-inventory-draft');assert.equal(draft.lines.length,row.currentSkus);assert.ok(draft.lines.every(l=>l.quantity===12));images.push({url:p.mainImageUrl,hash:await digest(storeOrigin+p.mainImageUrl)});}
  const p=demo.products[0];const rejected=await call('/admin/products/'+p.id+'/publish','POST',{expectedVersion:p.version,reason:'本机最终验收：数量草稿不等于入账'},409);assert.equal(rejected.code,'PRODUCT_NOT_PUBLISHABLE');assert.match(JSON.stringify(rejected.details),/可售库存不足/);assert.equal((await call('/store/products','GET',undefined,200,false)).total,0);assert.equal((await call('/store/products/'+p.id,'GET',undefined,404,false)).code,'PRODUCT_NOT_FOUND');check('保留演示两商品8个当前SKU、10个零账户、两数量草稿与上架拒绝/公开404');
  const {chromium}=await import(pathToFileURL(env.PLAYWRIGHT_MODULE_PATH).href);browser=await chromium.launch({headless:true,executablePath:env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});const page=await browser.newPage({viewport:{width:1366,height:768}});page.on('pageerror',e=>report.pageErrors.push(e.name));
  await page.goto(origin+'/login');await page.getByLabel('员工账号',{exact:true}).fill(credential.username);await page.getByLabel('密码',{exact:true}).fill(credential.password);await page.locator('form button[type=submit]').click();await page.waitForURL(origin+'/');await page.goto(origin+'/products');await page.getByRole('link',{name:'日常纯棉T恤',exact:true}).waitFor();await page.screenshot({path:output+'/admin-products.png',fullPage:true});await page.getByRole('link',{name:'日常纯棉T恤',exact:true}).click();await page.locator('#images img').first().waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('#images img')].every(i=>i.complete&&i.naturalWidth>0));await page.screenshot({path:output+'/admin-product.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:output+'/admin-product-mobile.png',fullPage:true});
  const store=await browser.newPage({viewport:{width:1366,height:768}});store.on('pageerror',e=>report.pageErrors.push(e.name));await store.goto(storeOrigin);await store.getByRole('heading',{name:'新款正在准备中'}).waitFor();await store.screenshot({path:output+'/store-home.png',fullPage:true});assert.deepEqual(report.pageErrors,[]);check('常用Nginx实际登录、商品真图/六SKU/手机编辑与商城备货空态');await browser.close();browser=undefined;
  const docker=env.DOCKER_EXECUTABLE??'docker';const recreated=spawnSync(docker,['compose','--env-file','.env','-f','infra/compose.yaml','up','-d','--no-deps','--force-recreate','--wait','--wait-timeout','90','api'],{env,encoding:'utf8',windowsHide:true});assert.equal(recreated.status,0,'API重建失败');report.recreateExitCode=recreated.status;
  for(const image of images)assert.equal(await digest('http://localhost:'+(env.API_HOST_PORT??3000)+image.url),image.hash);
  for(const row of demo.products)assert.equal((await call('/admin/products/'+row.id)).version,row.version);
  check('常用API重建后同一图片内容、商品版本、SKU和会话保持，数据库未重启');
  const protectedData=spawnSync(process.execPath,['scripts/protect-module5-data.mjs','final'],{env,encoding:'utf8',windowsHide:true});assert.equal(protectedData.status,0,'旧数据最终保护核对失败');report.protectionExitCode=protectedData.status;check('原20表既有行逐行不变，真实.env/0001～0004/无关CI文件摘要保持');report.passed=true;
}catch(error){report.failure={name:error.name,message:String(error.message).replaceAll(credential.password,'[REDACTED]').replaceAll(token??'__absent__','[REDACTED]')};process.exitCode=1;console.error(JSON.stringify(report.failure));}
finally{await browser?.close();writeFileSync(output+'/result.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:!!report.passed,checks:report.checks.length,pageErrors:report.pageErrors.length}));}
