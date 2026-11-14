// 作用：以真实页面和受控HTTP响应验证编辑表单的浏览器约束及提交期间的卸载保护，不连接业务数据库。
import assert from 'node:assert/strict';
import { existsSync,mkdirSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root=resolve(import.meta.dirname,'../../..');
const label=process.argv[2]??'attempt1';assert.match(label,/^[a-z0-9-]+$/);
const output=resolve(root,'output/playwright/review-1-6',label);assert.ok(!existsSync(resolve(output,'result.json')),'不能覆盖浏览器证据');mkdirSync(output,{recursive:true});
assert.ok(process.env.PLAYWRIGHT_MODULE_PATH,'请提供已安装的Playwright模块路径，不安装新依赖');
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href);
const {createServer}=await import(pathToFileURL(resolve(root,'apps/admin-web/node_modules/vite/dist/node/index.js')).href);
const id='11111111-1111-4111-8111-111111111111',employeeId='22222222-2222-4222-8222-222222222222',sourceId='33333333-3333-4333-8333-333333333333';
const skuId='44444444-4444-4444-8444-444444444444',lineId='55555555-5555-4555-8555-555555555555',now=new Date().toISOString();
const source={id:sourceId,sourceType:'RECEIPT',namespace:'独立浏览器夹具',reference:'REVIEW',version:0,note:'模拟响应，不是真实采购事实',createdAt:now,evidence:[],lines:[{id:lineId,sourceId,skuId,skuCode:'REVIEW-SKU',lineKey:'1',verifiedQuantity:10,netPostedQuantity:0,version:0,batches:[]}]};
let adjustment={id,number:'REVIEW-UI',type:'ARRIVAL',status:'PENDING',version:0,reason:'原登记原因',evidenceNote:'原核实说明',createdById:employeeId,createdAt:now,postedAt:null,postedById:null,checkRequired:false,conversionKey:null,task:null,tasks:[],ledger:[],history:[],evidence:[],sources:[source],lines:[{id:'66666666-6666-4666-8666-666666666666',skuId,skuCode:'REVIEW-SKU',sourceId,sourceLineId:lineId,quantity:1,batchKey:'REVIEW-BATCH',deltaA:1,available:0,reserved:0}]};
const permissions=['inventory.read','inventory.adjustment.create','inventory.source.manage'];
const report={at:now,fixture:'仅模拟HTTP，未连接或写入数据库',checks:[],errors:[],requests:[],detailReads:0};
const record=(name,passed)=>report.checks.push({name,passed});
let vite,browser,release,started;const requestStarted=new Promise(r=>{started=r;}),gate=new Promise(r=>{release=r;});
try{
 vite=await createServer({root:resolve(root,'apps/admin-web'),configFile:resolve(root,'apps/admin-web/vite.config.ts'),logLevel:'silent',clearScreen:false,server:{host:'127.0.0.1',port:0,strictPort:false}});await vite.listen();
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});const page=await browser.newPage({viewport:{width:1366,height:900}});page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.addInitScript(()=>sessionStorage.setItem('self-ecom.employee.session',JSON.stringify({domain:'EMPLOYEE',accessToken:'browser-review-fixture-only',expiresAt:new Date(Date.now()+3600000).toISOString()})));
 await page.route('**/api/v1/**',async route=>{
  const path=new URL(route.request().url()).pathname.slice('/api/v1'.length),method=route.request().method();report.requests.push({path,method});let data;
  if(path==='/admin/me')data={id:employeeId,username:'review_fixture',displayName:'浏览器审查夹具',role:'MERCH_WAREHOUSE',status:'ACTIVE',mustChangePassword:false};
  else if(path==='/admin/me/permissions')data={role:'MERCH_WAREHOUSE',permissionVersion:0,defaultPermissions:permissions,extraPermissions:[],effectivePermissions:permissions};
  else if(path==='/admin/inventory/sources')data={items:[source],total:1,page:1,pageSize:100};
  else if(path===`/admin/inventory/sources/${sourceId}`)data=source;
  else if(path===`/admin/inventory/adjustments/${id}`){
   if(method==='PATCH'){started();await gate;adjustment={...adjustment,reason:'已修改的原因',version:1};data={id,version:1,changed:true};}
   else{report.detailReads++;data=adjustment;}
  }else{report.errors.push(`未配置夹具请求 ${method} ${path}`);await route.abort();return;}
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data,requestId:id})});
 });
 await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/inventory/adjustments/${id}`);
 const toggle=page.getByRole('button',{name:'编辑待确认登记',exact:true});await toggle.click();
 const form=page.locator('form').filter({has:page.getByRole('button',{name:'保存待确认修改',exact:true})});await form.getByLabel('登记原因',{exact:true}).fill('已修改的原因');
 record('已有有效来源明细，编辑无需重新选择额外来源',await form.evaluate(f=>f.checkValidity()));
 // 旧实现的多余必填会挡住提交；选择已有来源后继续独立复现卸载问题。
 if(!report.checks.at(-1).passed)await form.getByLabel(/^关联已核实来源/).selectOption(sourceId);
 await form.getByRole('button',{name:'保存待确认修改',exact:true}).click();await requestStarted;
 record('请求进行中，收起表单按钮不可操作',await toggle.isDisabled());
 if(!report.checks.at(-1).passed)await toggle.click();
 await page.screenshot({path:resolve(output,'pending.png'),fullPage:true});release();
 await page.waitForResponse(r=>r.request().method()==='PATCH');
 try{await page.getByText('登记版本 1；',{exact:false}).waitFor({timeout:3000});record('保存后重读最新版本并解除页面忙碌',true);}catch{record('保存后重读最新版本并解除页面忙碌',false);}
 await page.screenshot({path:resolve(output,'settled.png'),fullPage:true});record('页面无脚本或意外请求错误',report.errors.length===0);
 assert.ok(report.checks.every(c=>c.passed),'浏览器审查回归未全部通过');
}catch(error){report.failure=error.message;process.exitCode=1;}
finally{release?.();await browser?.close();await vite?.close();report.passed=report.checks.length===4&&report.checks.every(c=>c.passed)&&!report.failure;writeFileSync(resolve(output,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
