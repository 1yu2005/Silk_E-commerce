// 作用：在调用方独占验收环境中，真实点击人工核实、显式领单和员工代录；不启动浏览器、不写业务表。
import assert from 'node:assert/strict';
import path from 'node:path';

export async function verifyProxyBrowser({origin,browser,username,password,orderId,customerId,communicationId,api,report,output}){
 const employee=await api('/admin/me'),before=await api('/admin/orders/'+orderId+'/coordination');
 assert.equal(employee.username,username);assert.equal(before.customerId,customerId);assert.equal(before.customerStatus,'LOGIN_FROZEN');assert.ok(before.communications.some(row=>row.id===communicationId),'需要已保存的本订单真实来源沟通');assert.ok(!before.afterSales.some(row=>row.active),'原单已有进行中售后，不能重复代录');
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',error=>report.pageErrors.push(error.name));
 const actions=[];
 async function post(button,pathname){
  const [response]=await Promise.all([page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/v1'+pathname),button.click()]);
  const json=await response.json(),body=response.request().postDataJSON(),requestId=response.headers()['x-request-id'];
  report.requests.push({source:'browser',method:'POST',path:pathname,status:response.status(),requestId:json.requestId});assert.equal(response.status(),200,pathname+' '+json.code);assert.equal(json.requestId,requestId);assert.ok(json.requestId);
  actions.push({path:pathname,requestId:json.requestId,status:response.status()});return {data:json.data,body};
 }
 await page.goto(origin+'/login');await page.getByLabel('员工账号',{exact:true}).fill(username);await page.getByLabel('密码',{exact:true}).fill(password);await page.locator('form button[type=submit]').click();await page.waitForURL(origin+'/');
 await page.goto(origin+'/orders/'+orderId+'/coordination');await page.getByRole('heading',{name:'异常协作',exact:true}).waitFor();
 const panel=page.locator('section[aria-label="冻结顾客人工核实代录"]');await panel.getByRole('heading',{name:'记录已实际完成的人工核实',exact:true}).waitFor();
 // 包裹select的label含全部option文字，按稳定标签前缀定位，不用exact全文匹配。
 await panel.getByLabel('顾客本次指定输入').selectOption('APPLY_AFTER_SALE');await panel.getByLabel('已存在的来源沟通').selectOption(communicationId);await panel.getByLabel('人工核实方式').selectOption('PHONE_CALLBACK');
 await panel.getByLabel('实际核实过程与顾客本次意愿',{exact:true}).fill('本轮独占开发验收：已回拨交叉核对顾客、原订单和本次整单仅退款申请意愿；不记录密码或证件原文。');await panel.getByLabel('本次记录原因',{exact:true}).fill('板块13冻结顾客人工核实及单动作代录浏览器验收');await panel.getByLabel('已核实订单归属及本次单一输入，未记录密码或证件原文',{exact:true}).check();
 const created=await post(panel.getByRole('button',{name:'创建30分钟核实上下文',exact:true}),'/admin/customers/'+customerId+'/proxy-contexts'),proxyContextId=created.data.proxyContextId;
 assert.ok(proxyContextId);assert.equal(created.data.status,'VERIFIED');assert.equal(created.data.action,'APPLY_AFTER_SALE');assert.equal(created.body.sourceCommunicationId,communicationId);assert.equal(created.data.orderId,orderId);assert.equal(created.data.customerId,customerId);
 await panel.getByLabel('本次核实记录').selectOption(proxyContextId);await panel.getByRole('button',{name:'领取本轮代理输入任务',exact:true}).waitFor();await page.screenshot({path:path.join(output,'proxy-context-verified-unclaimed.png'),fullPage:true});
 const taskId=created.data.taskId;assert.ok(taskId);const beforeClaim=await api('/admin/orders/'+orderId+'/coordination'),openTask=beforeClaim.tasks.find(task=>task.id===taskId);assert.equal(openTask?.status,'OPEN');assert.equal(openTask?.assigneeId,null);
 await post(panel.getByRole('button',{name:'领取本轮代理输入任务',exact:true}),'/admin/tasks/'+taskId+'/claim');await panel.getByLabel('顾客本次指定输入说明',{exact:true}).waitFor();
 const claimed=await api('/admin/orders/'+orderId+'/coordination'),claimedTask=claimed.tasks.find(task=>task.id===taskId);assert.equal(claimedTask?.status,'CLAIMED');assert.equal(claimedTask?.assigneeId,employee.id);assert.ok(claimedTask.sources.some(source=>source.sourceType==='PROXY_CONTEXT'&&source.sourceId===proxyContextId));
 await panel.getByLabel('申请类型').selectOption('REFUND_ONLY');await panel.getByLabel('顾客申请原因').selectOption('OTHER');await panel.getByLabel('顾客本次指定输入说明',{exact:true}).fill('冻结期间顾客明确指定本次整单仅退款申请，员工仅代录，仍待独立审核、实物核实及正式模拟退款。');await panel.getByLabel('已核对当前顾客意愿、目标和输入内容',{exact:true}).check();
 const submitted=await post(panel.getByRole('button',{name:'提交本次指定输入',exact:true}),'/admin/proxy-contexts/'+proxyContextId+'/after-sales'),afterSaleId=submitted.data.afterSaleId;
 assert.ok(afterSaleId);assert.equal(submitted.data.status,'PENDING_REVIEW');assert.equal(submitted.data.replayed,false);assert.equal(submitted.body.orderId,orderId);assert.equal(submitted.body.expectedProxyTaskVersion,claimedTask.version);assert.ok(submitted.body.commandKey);
 const context=await api('/admin/proxy-contexts/'+proxyContextId),sale=await api('/admin/after-sales/'+afterSaleId),after=await api('/admin/orders/'+orderId+'/coordination');assert.equal(context.status,'CONSUMED');assert.equal(sale.status,'PENDING_REVIEW');assert.equal(sale.orderId,orderId);assert.equal(sale.type,'REFUND_ONLY');assert.equal(sale.approvedAt,null);assert.equal(sale.decisions.length,0);
 // 协作读模型只返回活动任务；完成事实必须通过正式历史详情验证，不能把查不到当完成。
 const completedTask=await api('/admin/tasks/'+taskId),taskHistory=await api('/admin/tasks/'+taskId+'/history?page=1&pageSize=100');assert.equal(completedTask.status,'COMPLETED');assert.equal(completedTask.stage,'PROXY_INPUT');assert.equal(completedTask.businessId,orderId);assert.ok(completedTask.closedAt);assert.ok(taskHistory.items.some(event=>event.afterStatus==='CLAIMED'&&event.toAssigneeId===employee.id));assert.ok(taskHistory.items.some(event=>event.afterStatus==='COMPLETED'&&event.fromAssigneeId===employee.id));assert.ok(!after.tasks.some(task=>task.id===taskId));
 const review=sale.tasks.find(task=>task.stage==='AFTER_SALE_REVIEW');assert.equal(review?.status,'OPEN');assert.equal(review?.assigneeId,null);assert.equal(after.afterSales.filter(sale=>sale.active).length,1);assert.equal(after.refund,null);assert.deepEqual(after.payment,before.payment);assert.deepEqual(after.balances,before.balances);
 await panel.getByText('本次核实已使用',{exact:true}).waitFor();assert.equal(await panel.getByRole('button',{name:'提交本次指定输入',exact:true}).count(),0);await page.screenshot({path:path.join(output,'proxy-apply-consumed-pending-review.png'),fullPage:true});
 report.proxyBrowser={employeeId:employee.id,orderId,customerId,sourceCommunicationId:communicationId,proxyContextId,taskId,afterSaleId,executionId:submitted.data.executionId,actions};report.checks.push('冻结顾客代录真实浏览器：创建单动作核实→显式领取PROXY_INPUT→提交正式待审核申请；上下文消费、独立审核待领，无自动批准或退款');
 return {afterSaleId,proxyContextId,applyBody:submitted.body};
}
