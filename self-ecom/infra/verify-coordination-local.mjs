// 作用：使用既有账号保留一笔明确开发演示；正式checkout/pay后经真实浏览器改址、核实、售后、退款及公开线下摘要。
// 仅在板块13全量验证及独占部署通过后手动运行；同一输出目录的checkpoint用于恢复，不重新造单。
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readInitialAdminConfig} from '../apps/api/dist/auth/initial-admin-seed.js';
import {env,requireApi} from '../scripts/module13-runtime.mjs';
import {launchCoordinationBrowser} from './coordination-browser.mjs';

const output=process.argv[2];assert.ok(output,'必须指定本轮演示输出目录');mkdirSync(output,{recursive:true});
const checkpointPath=path.join(output,'checkpoint.json'),resultPath=path.join(output,'result.json');
const checkpoint=existsSync(checkpointPath)?JSON.parse(readFileSync(checkpointPath,'utf8')):{schemaVersion:1,runId:randomUUID(),startedAt:new Date().toISOString(),commands:{}};
assert.equal(checkpoint.schemaVersion,1);assert.ok(!checkpoint.completed,'本轮已经完成，禁止同目录重复造单');
const credentialFile='private-delivery/板块8＋9_演示顾客.local.json';
execFileSync('git',['check-ignore','--quiet',credentialFile],{windowsHide:true,stdio:'pipe'});
assert.match(readFileSync('.dockerignore','utf8'),/^private-delivery\s*$/m);
const credential=JSON.parse(readFileSync(credentialFile,'utf8')),initial=readInitialAdminConfig(env),username=env.LOCAL_ADMIN_USERNAME??initial.username,password=env.LOCAL_ADMIN_PASSWORD??initial.password;
assert.ok(username&&password&&credential.active&&credential.phone&&credential.password,'需要现有管理员和已激活演示顾客；脚本不会创建账号或修改密码');
const origin='http://localhost:'+(env.ADMIN_HOST_PORT??8080),storeOrigin='http://localhost:'+(env.STORE_HOST_PORT??8081);
assert.ok(!checkpoint.origin||checkpoint.origin===origin);assert.ok(!checkpoint.storeOrigin||checkpoint.storeOrigin===storeOrigin);
Object.assign(checkpoint,{origin,storeOrigin});
const secrets=[password,credential.password,...Object.entries(env).filter(([key,value])=>/SECRET|PASSWORD|TOKEN|DATABASE_URL/.test(key)&&typeof value==='string'&&value.length>5).map(([,value])=>value)];
const redact=text=>secrets.reduce((result,secret)=>result.replaceAll(secret,'[REDACTED]'),String(text));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const save=()=>writeFileSync(checkpointPath,JSON.stringify(checkpoint,null,2)+'\n');
const report={startedAt:new Date().toISOString(),resumed:existsSync(resultPath)||!!checkpoint.orderId,newMembers:0,runId:checkpoint.runId,requests:[],checks:[],pageErrors:[]};
const marker='M313-DEMO-'+checkpoint.runId,internalMarker='M313_INTERNAL_'+checkpoint.runId,subject='板块13开发演示回访 '+checkpoint.runId.slice(0,8),publicSummary='开发演示：整单模拟退款已按系统流程完成，后续服务按实际沟通跟进；不发生真实资金流转。';
const {Client}=requireApi('pg'),db=new Client({connectionString:env.DATABASE_URL,connectionTimeoutMillis:5000});
let browser,adminToken,customerToken,adminId;

function remember(pathname,data){
 if(pathname.endsWith('/address-requests')&&data?.resultType==='ADDRESS_REQUEST')checkpoint.addressRequestId=data.resultId;
 if(pathname.endsWith('/physical-verifications'))checkpoint.addressVerificationId=data?.resultId;
 if(pathname.endsWith('/handoff-after-sale')&&data?.resultType==='AFTER_SALE')checkpoint.afterSaleId=data.resultId;
 if(pathname==='/admin/offline-cases'&&data?.offlineCaseId)checkpoint.offlineCaseId=data.offlineCaseId;
 if(data?.refundId)checkpoint.refundId=data.refundId;
 if(data?.refundNo)checkpoint.refundNo=data.refundNo;
}
async function call(site,pathname,method='GET',body,token,status=200,headers={}){
 const response=await fetch(site+'/api/v1'+pathname,{method,signal:AbortSignal.timeout(20000),headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const json=await response.json();report.requests.push({method,path:pathname,status:response.status,requestId:json.requestId});
 assert.ok((Array.isArray(status)?status:[status]).includes(response.status),pathname+' '+response.status+' '+(json.code??''));if(json.data?.accessToken)secrets.push(json.data.accessToken);return json.data;
}
const admin=(p,m='GET',b,s=200)=>call(origin,p,m,b,adminToken,s),customer=(p,m='GET',b,s=200)=>call(storeOrigin,p,m,b,customerToken,s);
async function command(name,site,pathname,body,token,status=200,headers={}){
 const original=checkpoint.commands[name]??{pathname,body,headers};checkpoint.commands[name]=original;save();
 assert.equal(original.pathname,pathname);const data=await call(site,original.pathname,'POST',original.body,token,status,original.headers);remember(pathname,data);save();return data;
}
const addressHash=order=>{assert.ok(order.address&&['receiver','phone','province','city','district','detail'].every(key=>typeof order.address[key]==='string'),'正式订单地址快照缺少字段');return digest(order.address);};
const coordination=()=>admin('/admin/orders/'+checkpoint.orderId+'/coordination');
const sale=()=>admin('/admin/after-sales/'+checkpoint.afterSaleId);
const activeTask=(rows,stage)=>rows.find(task=>task.stage===stage&&['OPEN','CLAIMED'].includes(task.status));
async function loginPage(page,store=false){await page.goto((store?storeOrigin:origin)+'/login');await page.getByLabel(store?'手机号':'员工账号',{exact:true}).fill(store?credential.phone:username);await page.getByLabel('密码',{exact:true}).fill(store?credential.password:password);await page.locator('form button[type=submit]').click();await page.waitForURL((store?storeOrigin:origin)+(store?'/account':'/'));}
async function navigateCoordination(page){await page.goto(origin+'/orders/'+checkpoint.orderId+'/coordination');await page.getByRole('heading',{name:'异常协作',exact:true}).waitFor();await page.getByRole('heading',{name:'实物、经办与后续',exact:true}).waitFor();}
async function navigateSale(page){await page.goto(origin+'/after-sales/'+checkpoint.afterSaleId);await page.getByRole('heading',{name:'退货验收与退款',exact:true}).waitFor();}
const form=(page,title)=>page.locator('form').filter({has:page.getByRole('heading',{name:title,exact:true})});
async function postUi(page,button,suffix,status=200){
 const [response]=await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith(suffix)),button.click()]);
 const json=await response.json(),pathname=new URL(response.url()).pathname.replace(/^\/api\/v1/,'');report.requests.push({method:'POST',path:pathname,status:response.status(),requestId:json.requestId,browser:true});
 assert.ok((Array.isArray(status)?status:[status]).includes(response.status()),suffix+' '+response.status()+' '+(json.code??''));remember(pathname,json.data);
 const key=response.request().postDataJSON()?.commandKey;if(key&&checkpoint.pending?.body?.commandKey===key)checkpoint.pending=null;save();return json.data;
}
async function claimUi(page,task){
 assert.ok(task,'当前正式任务不存在');if(task.status==='CLAIMED'){assert.equal(task.assigneeId,adminId,'当前任务已被其他员工领取；停止避免接管');return;}
 const article=page.locator('article').filter({has:page.locator('a[href="/tasks/'+task.id+'"]')});await postUi(page,article.getByRole('button',{name:/^领取/}).first(),'/claim');
}
async function restoreBrowserCommand(){
 const pending=checkpoint.pending;if(!pending)return;
 assert.ok(pending.body?.commandKey&&pending.pathname.startsWith('/admin/'),'检查点原请求缺少稳定键');
 assert.ok(pending.pathname.includes(checkpoint.orderId)||pending.pathname.includes(checkpoint.addressRequestId??'missing-address')||pending.pathname.includes(checkpoint.afterSaleId??'missing-sale')||pending.pathname==='/admin/offline-cases','原请求目标不属于本次演示');
 if(pending.pathname==='/admin/offline-cases')assert.equal(pending.body.orderId,checkpoint.orderId,'线下登记原请求必须属于本轮演示订单');
 const result=await admin(pending.pathname,'POST',pending.body,pending.pathname==='/admin/offline-cases'?[200,201]:200);remember(pending.pathname,result);checkpoint.pending=null;save();report.checks.push('沿检查点原动作及原操作键恢复上次浏览器提交结果');
}

try{
 await db.connect();adminToken=(await call(origin,'/admin/auth/login','POST',{username,password})).accessToken;customerToken=(await call(storeOrigin,'/store/auth/login','POST',{phone:credential.phone,password:credential.password})).accessToken;
 adminId=(await admin('/admin/me')).id;const me=await customer('/store/me');assert.ok(!checkpoint.customerId||checkpoint.customerId===me.id,'恢复时必须使用原演示顾客');checkpoint.customerId=me.id;
 const addresses=(await customer('/store/addresses')).items,cart=(await customer('/store/cart?page=1&pageSize=100')).items;
 if(!checkpoint.baseline){
  const address=addresses.find(row=>row.isDefault)??addresses[0];assert.ok(address,'必须已有收货地址；脚本不会创建或编辑地址');
  const sku=(await db.query("SELECT s.id FROM sku s JOIN product p ON p.id=s.product_id JOIN inventory_balance b ON b.sku_id=s.id WHERE p.status='ON_SALE' AND p.archived_at IS NULL AND s.enabled AND s.retired_at IS NULL AND s.price_cents IS NOT NULL AND b.available>1 AND NOT b.purchase_blocked AND NOT EXISTS(SELECT 1 FROM cart_item ci WHERE ci.customer_id=$1 AND ci.sku_id=s.id) ORDER BY s.code LIMIT 1",[me.id])).rows[0];assert.ok(sku,'需要至少一个未在原购物车中的可售SKU；脚本不补库存');
  const balance=await admin('/admin/inventory/'+sku.id),consumption=await admin('/admin/customers/'+me.id+'/consumption');
  checkpoint.skuId=sku.id;checkpoint.addressId=address.id;checkpoint.baseline={cartHash:digest(cart),addressHash:digest(addresses),available:balance.available,reserved:balance.reserved,consumption:consumption.amountCents};checkpoint.orderKey=randomUUID();save();
 }
 assert.equal(digest(addresses),checkpoint.baseline.addressHash,'原地址簿发生变化，停止自动演示');
 if(!checkpoint.orderId){
  // 已保存下单请求时先沿原键恢复；成功但响应丢失时原购物车行已被消费，不能再次加购。
  if(!checkpoint.orderRequest){
   let own=cart.find(row=>row.skuId===checkpoint.skuId);assert.equal(digest(cart.filter(row=>row.skuId!==checkpoint.skuId)),checkpoint.baseline.cartHash,'原购物车发生变化，停止自动演示');
   if(!own){assert.ok(!checkpoint.cartConsumed,'本轮已消费过购物车，不能再次加购造单');assert.ok(!checkpoint.cartAttempt,'上次加购结果不明且当前未找到该行，停止以避免重复加购');checkpoint.cartAttempt=true;save();own=(await customer('/store/cart/items','POST',{skuId:checkpoint.skuId,quantity:1},201)).item;checkpoint.cartItemId=own.id;save();}
   else{assert.ok(checkpoint.cartAttempt,'意外出现同SKU购物车行，不能认作本次演示');assert.equal(own.quantity,1);checkpoint.cartItemId=own.id;save();}
   const input={addressId:checkpoint.addressId,items:[{cartItemId:checkpoint.cartItemId,skuId:checkpoint.skuId,quantity:1}]},quote=await customer('/store/checkout/preview','POST',input,201);checkpoint.orderRequest={...input,quoteId:quote.quoteId};save();
  }
  assert.ok(checkpoint.orderKey&&checkpoint.orderRequest.addressId===checkpoint.addressId&&checkpoint.orderRequest.items.length===1&&checkpoint.orderRequest.items[0].skuId===checkpoint.skuId&&checkpoint.orderRequest.items[0].quantity===1,'只能恢复本轮原正式下单请求');
  const result=await call(storeOrigin,'/store/orders','POST',checkpoint.orderRequest,customerToken,[200,201],{'Idempotency-Key':checkpoint.orderKey});checkpoint.orderId=result.orderId;checkpoint.cartConsumed=true;save();
 }
 const initialOrder=await admin('/admin/orders/'+checkpoint.orderId);assert.equal(initialOrder.customerId,me.id);checkpoint.orderNo=initialOrder.number;
 if(!checkpoint.orderAddressHash)checkpoint.orderAddressHash=addressHash(initialOrder);save();
 if(initialOrder.status==='WAIT_PAYMENT')await command('pay',storeOrigin,'/store/orders/'+checkpoint.orderId+'/pay',{},customerToken);
 const currentCart=(await customer('/store/cart?page=1&pageSize=100')).items;assert.equal(digest(currentCart),checkpoint.baseline.cartHash,'正式checkout后应精确保留原购物车');
 if(!checkpoint.communicationId){
  const records=(await admin('/admin/communications?scopeType=ORDER&scopeId='+checkpoint.orderId+'&page=1&pageSize=100')).items,existing=records.filter(row=>row.result.includes(marker));assert.ok(existing.length<=1,'发现重复演示沟通，停止');
  if(existing.length)checkpoint.communicationId=existing[0].id;else{assert.ok(!checkpoint.communicationAttempt,'上次沟通追加结果不明且当前未找到原标记，停止以避免重复追加');checkpoint.communicationAttempt=true;save();const communication=await admin('/admin/communications','POST',{scopeType:'ORDER',scopeId:checkpoint.orderId,channel:'OTHER',occurredAt:new Date().toISOString(),result:marker+'：明确开发演示，顾客同意改址诉求经停止作业核实后申请整单模拟全额退款重下；不代表实际寄件或经营事实',publicText:'开发演示：已收到本次改址及整单模拟退款诉求'},201);checkpoint.communicationId=communication.id;}save();
 }
 await restoreBrowserCommand();
 const {chromium}=await import(pathToFileURL(env.PLAYWRIGHT_MODULE_PATH??path.join(env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
 browser=await launchCoordinationBrowser(chromium,output,env);
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',error=>report.pageErrors.push(error.name));await loginPage(page);
 await page.route('**/api/v1/admin/**',async route=>{const request=route.request();if(request.method()==='POST'){let body;try{body=request.postDataJSON();}catch{/* 无JSON的请求不属于本次领域命令。 */}if(body?.commandKey){checkpoint.pending={pathname:new URL(request.url()).pathname.replace(/^\/api\/v1/,''),body};save();}}await route.continue();});
 let facts=await coordination(),request=facts.requests.find(row=>row.id===checkpoint.addressRequestId);
 if(!request){assert.ok(!facts.requests.some(row=>row.status==='OPEN'),'本单已有其它改址诉求，停止避免覆盖');await navigateCoordination(page);const current=form(page,'登记改址诉求');await current.getByRole('combobox',{name:/^本订单实际沟通/}).selectOption(checkpoint.communicationId);await current.getByLabel('本次操作原因',{exact:true}).fill(marker+'：开发演示改址协调，原订单地址不变');await postUi(page,current.getByRole('button',{name:'登记诉求并建立跟进',exact:true}),'/address-requests');facts=await coordination();request=facts.requests.find(row=>row.id===checkpoint.addressRequestId);}
 assert.ok(request);await navigateCoordination(page);await page.screenshot({path:path.join(output,'local-coordination-address-open.png'),fullPage:true});
 if(request.status==='OPEN'&&!request.physicalVerificationId){await claimUi(page,activeTask(facts.tasks.filter(task=>task.sources.some(source=>source.sourceId===request.id)),'PHYSICAL_VERIFY'));await navigateCoordination(page);const current=form(page,'仓储停止作业与整单核实');await current.getByLabel('已逐项核对上述整单数量、停止作业且货仍在手',{exact:true}).check();await current.getByLabel('实物位置',{exact:true}).fill('板块13开发演示保管区，非实际经营货位');await current.getByLabel('本次操作原因',{exact:true}).fill(marker+'：独立核实停止作业及货在手');await postUi(page,current.getByRole('button',{name:'保存实物核实',exact:true}),'/physical-verifications');facts=await coordination();request=facts.requests.find(row=>row.id===checkpoint.addressRequestId);}
 if(!checkpoint.afterSaleId&&request.status==='OPEN'){
  await navigateCoordination(page);await claimUi(page,activeTask(facts.tasks.filter(task=>task.sources.some(source=>source.sourceId===request.id)),'CUSTOMER_CONTACT'));await navigateCoordination(page);const current=form(page,'按真实事实选择路线');await current.getByRole('combobox',{name:/^本订单实际沟通/}).selectOption(checkpoint.communicationId);await current.getByLabel('本次操作原因',{exact:true}).fill(marker+'：顾客明确同意整单模拟退款重下');await current.getByRole('combobox',{name:/^处理路线/}).selectOption('refund');await current.getByLabel('所选路线已按本次沟通取得顾客明确同意',{exact:true}).check();await current.locator('textarea[name="description"]').fill(marker+'：明确开发演示，申请原支付全额含运费；并非已退款');await postUi(page,current.getByRole('button',{name:'提交本次路线',exact:true}),'/handoff-after-sale');
 }
 facts=await coordination();request=facts.requests.find(row=>row.id===checkpoint.addressRequestId);checkpoint.afterSaleId??=request?.handoffAfterSaleId;assert.ok(checkpoint.afterSaleId);save();
 let currentSale=await sale();if(currentSale.status==='PENDING_REVIEW'){
  await navigateSale(page);await claimUi(page,activeTask(currentSale.tasks,'AFTER_SALE_REVIEW'));await navigateSale(page);const current=form(page,'审核决定');await current.getByRole('combobox',{name:/^处理方式/}).selectOption('APPROVE');await current.getByLabel('顾客可见结论',{exact:true}).fill('开发演示同意整单仅退款，仍须本售后独立逐行核实后正式办理模拟退款');await postUi(page,current.getByRole('button',{name:'提交本轮审核',exact:true}),'/review');currentSale=await sale();
 }
 if(currentSale.status==='WAIT_FULFILLMENT_CHECK'){
  facts=await coordination();await navigateCoordination(page);await claimUi(page,activeTask(facts.tasks.filter(task=>task.sources.some(source=>source.sourceId===checkpoint.afterSaleId)),'PHYSICAL_VERIFY'));await navigateSale(page);const current=form(page,'本售后未交运实物核实');for(const label of ['实物可售量']){const inputs=current.getByLabel(label,{exact:true});for(let index=0;index<await inputs.count();index++){const item=currentSale.items[index];await inputs.nth(index).fill(String(item.quantity));}}
  await current.getByLabel('货物当前位置',{exact:true}).fill('板块13开发演示原单货仍在手，非实际经营货位');await current.getByLabel('本次操作原因',{exact:true}).fill(marker+'：本售后独立逐行可售核实，不复用改址核实');await current.getByLabel('实物仍在手，已停止交运，全行可售＋损耗＝购买量',{exact:true}).check();await postUi(page,current.getByRole('button',{name:'提交当前版本实物核实',exact:true}),'/physical-checks');currentSale=await sale();
 }
 if(currentSale.status==='WAIT_REFUND'){
  await navigateSale(page);await claimUi(page,activeTask(currentSale.tasks,'REFUND_PROCESS'));await navigateSale(page);const current=form(page,'办理整单全额模拟退款');await current.getByLabel('本次操作原因',{exact:true}).fill(marker+'：开发演示原支付全额含运费');await current.getByLabel('已核对当前实物/最终验收事实及退款金额',{exact:true}).check();await postUi(page,current.getByRole('button',{name:'确认执行全额模拟退款',exact:true}),'/refund');
 }
 const settled=await admin('/admin/after-sales/'+checkpoint.afterSaleId+'/settlement');assert.equal(settled.refund?.status,'SUCCEEDED');await navigateSale(page);await page.getByText('退款状态：全额模拟退款成功',{exact:false}).waitFor();await page.screenshot({path:path.join(output,'local-coordination-refund-admin.png'),fullPage:true});
 facts=await coordination();let offline=facts.offlineCases.find(row=>row.id===checkpoint.offlineCaseId||row.subject===subject);
 if(!offline){await page.goto(origin+'/offline-cases/new?orderId='+checkpoint.orderId);const current=form(page,'登记线下诉求');await current.waitFor();await current.getByRole('combobox',{name:/^类型/}).selectOption('OTHER_SERVICE');await current.getByLabel('标题',{exact:true}).fill(subject);await current.getByLabel('内部诉求与来源',{exact:true}).fill(internalMarker+'：开发演示回访说明，仅内部可见；不是真实外部付款或寄件');await current.getByLabel('顾客可见摘要',{exact:true}).fill(publicSummary);await current.getByLabel('关联已有售后编号（可选）',{exact:true}).fill(checkpoint.afterSaleId);await current.getByLabel('登记原因',{exact:true}).fill(marker+'：模拟退款后保留独立服务回访');await postUi(page,current.getByRole('button',{name:'登记工单并进入待领队列',exact:true}),'/offline-cases',[200,201]);facts=await coordination();offline=facts.offlineCases.find(row=>row.id===checkpoint.offlineCaseId);}
 assert.ok(offline);checkpoint.offlineCaseId=offline.id;save();const offlineDetail=await admin('/admin/offline-cases/'+offline.id);assert.equal(offlineDetail.status,'OPEN');assert.equal(offlineDetail.tasks.find(task=>task.stage==='OFFLINE_FOLLOW')?.assigneeId,null);await page.goto(origin+'/offline-cases/'+offline.id);await page.getByRole('heading',{name:'线下处理',exact:true}).waitFor();await page.getByText('顾客可见摘要：'+publicSummary,{exact:true}).waitFor();await page.screenshot({path:path.join(output,'local-coordination-offline-admin.png'),fullPage:true});
 const store=await browser.newPage({viewport:{width:390,height:844}});store.on('pageerror',error=>report.pageErrors.push(error.name));await loginPage(store,true);await store.goto(storeOrigin+'/orders/'+checkpoint.orderId);await store.getByRole('heading',{name:'线下服务进展',exact:true}).waitFor();await store.getByText(publicSummary,{exact:true}).waitFor();assert.ok(!(await store.locator('body').innerText()).includes(internalMarker));await store.screenshot({path:path.join(output,'local-coordination-customer-mobile.png'),fullPage:true});
 const finalOrder=await admin('/admin/orders/'+checkpoint.orderId),balance=await admin('/admin/inventory/'+checkpoint.skuId),consumption=await admin('/admin/customers/'+me.id+'/consumption'),publicOrder=await customer('/store/orders/'+checkpoint.orderId);
 assert.equal(finalOrder.status,'REFUNDED');assert.equal(addressHash(finalOrder),checkpoint.orderAddressHash);assert.equal(balance.available,checkpoint.baseline.available);assert.equal(balance.reserved,checkpoint.baseline.reserved);assert.equal(consumption.amountCents,checkpoint.baseline.consumption);assert.equal(digest((await customer('/store/cart?page=1&pageSize=100')).items),checkpoint.baseline.cartHash);assert.equal(digest((await customer('/store/addresses')).items),checkpoint.baseline.addressHash);assert.ok(JSON.stringify(publicOrder).includes(publicSummary));assert.ok(!JSON.stringify(publicOrder).includes(internalMarker));assert.deepEqual(report.pageErrors,[]);
 report.demo={orderId:checkpoint.orderId,orderNo:checkpoint.orderNo,addressRequestId:checkpoint.addressRequestId,afterSaleId:checkpoint.afterSaleId,offlineCaseId:checkpoint.offlineCaseId,refundId:settled.refund.id,refundNo:settled.refund.refundNo,amountCents:settled.refund.amountCents,meaning:'明确开发演示，无实际寄件或真实资金流转'};
 report.balance={before:{available:checkpoint.baseline.available,reserved:checkpoint.baseline.reserved},after:{available:balance.available,reserved:balance.reserved}};
 report.checks.push('真实浏览器：改址登记→显式领单核实→正式售后→独立审核及本售后实物核实→模拟全额退款','独立线下服务工单OPEN且不自动领取，顾客手机只见公开摘要','原订单地址快照、原购物车、地址簿、净消费和SKU A/R精确保留，无新增账号/扩权/改密');
 report.status='passed';checkpoint.completed=true;save();
}catch(error){report.status='failed';report.failure=redact(error.stack??error.message);console.error(report.failure);process.exitCode=1;}
finally{await browser?.close();await db.end();report.endedAt=new Date().toISOString();writeFileSync(resultPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,runId:checkpoint.runId,orderId:checkpoint.orderId??null,checks:report.checks.length,newMembers:0,checkpoint:checkpointPath}));}
