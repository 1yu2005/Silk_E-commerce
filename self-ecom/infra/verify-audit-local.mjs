// 作用：使用用户提供的既有账号验证常用镜像页面与权限；凭据仅由调用方内存传入，不写文件或日志。
/* global window,history,PopStateEvent */
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';

export async function verifyAuditLocal({chromium,executablePath,accounts,output}){
 assert.ok(!existsSync(path.join(output,'result.json')),'保留已有验收证据');
 mkdirSync(output,{recursive:true});
 const report={startedAt:new Date().toISOString(),readOnlyBusiness:true,newMembers:0,checks:[],requests:[],pageErrors:[],pageRequestErrors:[]};
 const browser=await chromium.launch({headless:true,executablePath});
 const passwords=accounts.map(a=>a.password),redact=s=>passwords.reduce((text,password)=>text.replaceAll(password,'[REDACTED]'),String(s));
 const api=async(origin,token,url,expected=200)=>{const r=await fetch(origin+'/api/v1'+url,{headers:{Authorization:'Bearer '+token}});const j=await r.json();report.requests.push({path:url,status:r.status,requestId:j.requestId});assert.equal(r.status,expected,url);return j.data??j;};
 try{
  for(const account of accounts){
   const customer=account.kind==='customer',origin=customer?'http://localhost:8081':'http://localhost:8080';
   const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>report.pageErrors.push(e.name));
   page.on('response',r=>{const url=new URL(r.url());if(url.pathname.startsWith('/api/v1/')&&r.status()>=400)report.pageRequestErrors.push({path:url.pathname,status:r.status()});});
   await page.goto(origin+'/login');await page.getByLabel(customer?'手机号':'员工账号',{exact:true}).fill(account.username);await page.getByLabel('密码',{exact:true}).fill(account.password);
   const pending=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(customer?'/api/v1/store/auth/login':'/api/v1/admin/auth/login'));
   await page.locator('form button[type=submit]').click();const response=await pending;assert.equal(response.status(),200,'既有账号正式登录');
   const token=(await response.json()).data.accessToken;await page.waitForURL(origin+(customer?'/account':'/'));
   const me=await api(origin,token,customer?'/store/me':'/admin/me');if(account.role)assert.equal(me.role,account.role);
   const routes=customer?['/products','/account','/addresses','/cart','/orders']:account.role==='SUPER_ADMIN'?['/employees','/settings','/settings/versions','/categories','/products','/inventory','/inventory/ledger','/inventory/sources','/inventory/adjustments','/customers','/tasks','/orders']:account.role==='CUSTOMER_SERVICE'?['/customers','/orders','/tasks']:['/products','/inventory','/tasks','/orders'];
   for(const route of routes){await page.goto(origin+route);if(customer&&route==='/products')await page.getByRole('heading',{name:'找到你的日常款',exact:true}).waitFor();else await page.locator('h1').first().waitFor();await page.waitForLoadState('networkidle');assert.equal(new URL(page.url()).pathname,route);assert.ok(!/请求失败|加载失败|服务器内部错误/.test(await page.locator('body').innerText()),route+'真实页面读取');report.checks.push({account:account.kind,route,status:'passed'});}
   if(customer){
    await api(origin,token,'/admin/orders',401);
    // 已登录标签页内禁用存储后进行真实客户端导航；不mock后端，不刷新丢掉内存会话。
    await page.evaluate(()=>{Object.defineProperty(window,'sessionStorage',{configurable:true,get(){throw new DOMException('本轮浏览器存储拒绝回归','SecurityError');}});history.pushState(null,'','/checkout');window.dispatchEvent(new PopStateEvent('popstate'));});
    await page.getByRole('heading',{name:'确认订单',exact:true}).waitFor();await page.waitForLoadState('networkidle');report.checks.push({account:account.kind,route:'/checkout',status:'passed',scenario:'浏览器禁止存储时结算页仍渲染，后端真实请求'});
   }else if(account.role==='CUSTOMER_SERVICE')await api(origin,token,'/admin/employees',403);
   else if(account.role==='MERCH_WAREHOUSE')await api(origin,token,'/admin/customers',403);
   await page.screenshot({path:path.join(output,account.kind+'.png'),fullPage:true});await page.close();
  }
  assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.pageRequestErrors,[]);report.status='passed';
 }catch(error){report.status='failed';report.failure=redact(error.stack??error.message);}
 finally{await browser.close();report.endedAt=new Date().toISOString();writeFileSync(path.join(output,'result.json'),JSON.stringify(report,null,2)+'\n');}
 return {status:report.status,checks:report.checks.length,requests:report.requests.length,pageErrors:report.pageErrors,failure:report.failure};
}
