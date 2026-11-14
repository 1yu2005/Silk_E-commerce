// 作用：仓储通过真实页面领取物品义务、登记寄还和签收，核对原计划及追加事件。
import assert from 'node:assert/strict';
import path from 'node:path';

export async function verifyCustodyBrowser({origin,browser,username,password,arrangementId,report,output,onDispatched}){
 const base=new URL(origin).origin;
 assert.match(arrangementId,/^[a-f0-9-]{36}$/i,'物品安排必须是明确的隔离验收记录');
 report.requests??=[];report.checks??=[];report.pageErrors??=[];
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 page.on('pageerror',error=>report.pageErrors.push(error.name));
 const detailPath='/api/v1/admin/custody-arrangements/'+arrangementId,eventPath=detailPath+'/events';
 const matches=(method,pathname)=>response=>response.request().method()===method&&new URL(response.url()).origin===base&&new URL(response.url()).pathname===pathname;
 async function result(response,expectedStatus=200){
  const json=await response.json(),metadata={source:'browser',method:response.request().method(),path:new URL(response.url()).pathname,status:response.status(),requestId:json.requestId};
  report.requests.push(metadata);
  assert.equal(response.status(),expectedStatus,metadata.method+' '+metadata.path);
  assert.equal(typeof json.requestId,'string','浏览器真实响应须包含请求编号');
  assert.ok(json.requestId.length>0,'浏览器真实响应请求编号不能为空');
  return {data:json.data,requestId:json.requestId,status:response.status()};
 }
 async function action(button,pathname){
  const [posted,loaded]=await Promise.all([
   page.waitForResponse(matches('POST',pathname)),
   page.waitForResponse(matches('GET',detailPath)),
   button.click(),
  ]);
  const post=await result(posted),detail=await result(loaded);
  return {...post,detail:detail.data,body:posted.request().postDataJSON()};
 }
 const plan=a=>Object.fromEntries(['id','disputeDecisionId','afterSaleId','orderItemId','returnReceiptId','unmatchedItemId','description','quantity','disposition','custodianEmployeeId','location','plannedAction','nextFollowAt','followOfflineCaseId','createdAt','orderId'].map(key=>[key,a[key]]));
 try{
  await page.goto(base+'/login');
  await page.getByLabel('员工账号',{exact:true}).fill(username);
  await page.getByLabel('密码',{exact:true}).fill(password);
  const [login]=await Promise.all([page.waitForResponse(matches('POST','/api/v1/admin/auth/login')),page.locator('form button[type=submit]').click()]);
  await result(login);
  await page.waitForURL(base+'/');
  const [loaded]=await Promise.all([page.waitForResponse(matches('GET',detailPath)),page.goto(base+'/custody/'+arrangementId)]);
  const initial=(await result(loaded)).data,originalPlan=plan(initial);
  await page.getByRole('heading',{name:'结案后物品义务',exact:true}).waitFor();
  await page.getByRole('heading',{name:initial.description+' ×'+initial.quantity,exact:true}).waitFor();
  assert.equal(initial.id,arrangementId);
  assert.equal(initial.disposition,'RETURN_TO_CUSTOMER');
  assert.equal(initial.status,'PLANNED');
  assert.ok(Number.isSafeInteger(initial.quantity)&&initial.quantity>0);
  assert.equal(initial.events.length,0,'初始物品安排必须仍只有计划');
  const task=initial.tasks.find(t=>t.stage==='CUSTODY_EXECUTE'&&t.status==='OPEN'&&t.canClaim);
  assert.ok(task,'仓储须从页面显式领取待办物品任务');
  const taskCard=page.locator('article').filter({has:page.locator('a[href="/tasks/'+task.id+'"]')});
  const claimed=await action(taskCard.getByRole('button',{name:'领取本轮物品任务',exact:true}),'/api/v1/admin/tasks/'+task.id+'/claim');
  assert.equal(claimed.body.expectedVersion,task.version);
  const claimedTask=claimed.detail.tasks.find(t=>t.id===task.id);
  assert.equal(claimedTask.status,'CLAIMED');
  assert.ok(claimedTask.assigneeId,'领取后必须有真实经办人');
  assert.deepEqual(plan(claimed.detail),originalPlan);
  await page.getByText('本人经办',{exact:true}).waitFor();
  await page.screenshot({path:path.join(output,'custody-claimed-plan.png'),fullPage:true});

  async function event(kind,previous){
   const form=page.locator('form').filter({has:page.getByRole('heading',{name:'登记本轮实际动作',exact:true})});
   await form.getByLabel('实际动作').selectOption(kind);
   // 毫秒级输入须通过原生校验；不等待凑过创建时间，也不填写未来时间。
   const now=new Date(),localTime=new Date(+now-now.getTimezoneOffset()*60000).toISOString().slice(0,23),at=form.getByLabel('实际发生时间',{exact:true});
   await at.fill(localTime);
   assert.equal(await at.evaluate(input=>input.validity.valid),true,'实际发生时间须允许合法毫秒级输入');
   await form.getByLabel('此次实际数量',{exact:true}).fill(String(initial.quantity));
   await form.getByLabel('此次实际位置',{exact:true}).fill(kind==='RETURN_DISPATCH'?'本轮隔离验收：已交开发演示承运人':'本轮隔离验收：已核实顾客收到寄还物品');
   if(kind==='RETURN_DISPATCH'){
    await form.getByLabel('实际承运人',{exact:true}).fill('板块13开发演示承运');
    await form.getByLabel('实际寄还运单',{exact:true}).fill('M313-RETURN-'+arrangementId);
   }
   await form.getByLabel('真实执行凭据与核实结果',{exact:true}).fill('本轮独占开发验收，通过真实页面核实'+(kind==='RETURN_DISPATCH'?'物品实际寄还交运':'顾客已实际收到寄还物品')+'；不代表真实寄件。');
   await form.getByLabel('顾客可见说明（留空不公开）',{exact:true}).fill(kind==='RETURN_DISPATCH'?'寄还物品已实际交运，继续跟进签收':'已核实顾客收到寄还物品');
   await form.getByLabel('记录原因',{exact:true}).fill('板块13独占浏览器验收，不代表真实寄件或经营事实');
   const recorded=await action(form.getByRole('button',{name:'追加真实记录',exact:true}),eventPath);
   assert.equal(recorded.body.kind,kind);
   assert.equal(recorded.body.expectedArrangementVersion,previous.version);
   assert.equal(recorded.body.expectedTaskVersion,previous.tasks.find(t=>t.id===task.id).version);
   assert.equal(recorded.body.quantity,initial.quantity);
   assert.equal(recorded.data.arrangementId,arrangementId);
   assert.equal(recorded.data.replayed,false);
   assert.equal(recorded.data.version,previous.version+1);
   assert.deepEqual(plan(recorded.detail),originalPlan,'实际事件不得覆盖原计划');
   const persisted=recorded.detail.events.find(e=>e.id===recorded.data.eventId);
   assert.ok(persisted,'实际事件必须由页面刷新查询可见');
   assert.equal(persisted.kind,kind);
   assert.equal(persisted.requestId,recorded.requestId);
   assert.equal(persisted.quantity,initial.quantity);
   assert.equal(persisted.actorEmployeeId,claimedTask.assigneeId);
   await page.getByRole('heading',{name:(kind==='RETURN_DISPATCH'?'实际寄还交运':'实际收件确认')+' · '+initial.quantity+' 件',exact:true}).waitFor();
   return {data:recorded.data,requestId:recorded.requestId,status:recorded.status,detail:recorded.detail};
  }

  const dispatch=await event('RETURN_DISPATCH',claimed.detail);
  assert.equal(dispatch.detail.status,'IN_PROGRESS','交运后仍须核实签收');
  assert.equal(dispatch.detail.tasks.find(t=>t.id===task.id).status,'CLAIMED');
  assert.equal(dispatch.detail.events.length,1);
  await page.screenshot({path:path.join(output,'custody-return-dispatched.png'),fullPage:true});
  if(onDispatched)await onDispatched();
  const receipt=await event('RECEIPT_CONFIRMED',dispatch.detail);
  assert.equal(receipt.detail.status,'COMPLETED');
  assert.equal(receipt.detail.tasks.find(t=>t.id===task.id).status,'COMPLETED');
  assert.equal(receipt.detail.events.length,2);
  assert.notEqual(dispatch.data.eventId,receipt.data.eventId);
  await page.getByRole('heading',{name:'追加历史更正',exact:true}).waitFor();
  const [refreshed]=await Promise.all([page.waitForResponse(matches('GET',detailPath)),page.reload()]);
  const completed=(await result(refreshed)).data;
  assert.deepEqual(completed,receipt.detail,'刷新后原计划、两个追加事件及完成状态应持续保留');
  await page.getByRole('heading',{name:'实际收件确认 · '+initial.quantity+' 件',exact:true}).waitFor();
  await page.screenshot({path:path.join(output,'custody-receipt-completed.png'),fullPage:true});
  report.checks.push('生产浏览器仓储独立登录→显式领取物品任务→实际寄还交运仍执行中→实际签收后完成；原计划及两条真实事件刷新保留');
  report.custodyBrowser={arrangementId,taskId:task.id,claim:{requestId:claimed.requestId,status:claimed.status},dispatch:{...dispatch.data,requestId:dispatch.requestId,status:dispatch.status},receipt:{...receipt.data,requestId:receipt.requestId,status:receipt.status},screenshots:['custody-claimed-plan.png','custody-return-dispatched.png','custody-receipt-completed.png']};
  return {claim:{taskId:task.id,requestId:claimed.requestId,status:claimed.status},dispatch:dispatch.data,receipt:receipt.data,completed};
 }finally{await context.close();}
}
