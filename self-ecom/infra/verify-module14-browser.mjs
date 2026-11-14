// 作用：对调用方独占生产环境实际浏览看板/审计/业务历史，全部业务查询走真实GET。
import assert from 'node:assert/strict';
import path from 'node:path';
export async function verifyModule14Browser({origin,browser,admin,warehouse,support,orderId,orderNo,afterSaleId,customerId,expected,report,output}){
 const capture=page=>{page.on('pageerror',error=>report.pageErrors.push(error.name));page.on('response',async response=>{
  const url=new URL(response.url());if(!url.pathname.startsWith('/api/v1/'))return;let requestId;try{requestId=(await response.json()).requestId;}catch{/* 图片等非JSON响应只记HTTP元信息 */}
  report.requests.push({source:'browser',method:response.request().method(),path:url.pathname+url.search,status:response.status(),requestId});
 });};
 async function login(credentials,viewport={width:1440,height:1000}){const page=await browser.newPage({viewport});capture(page);await page.goto(origin+'/login');await page.getByLabel('员工账号',{exact:true}).fill(credentials.username);await page.getByLabel('密码',{exact:true}).fill(credentials.password);await page.locator('form button[type=submit]').click();await page.waitForURL(origin+'/');return page;}
 const get=async(page,action,pathname,match=()=>true)=>{const [response]=await Promise.all([page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname==='/api/v1'+pathname&&match(new URL(r.url()))),action()]);assert.equal(response.status(),200,pathname);const json=await response.json();assert.ok(json.requestId);return json.data;};
 const staff=await login(admin);
 const overview=await get(staff,()=>staff.goto(origin+'/dashboard'),'/admin/dashboard/overview');assert.deepEqual(overview.today,expected.overview.today);assert.deepEqual(overview.current,expected.overview.current);
 await staff.getByRole('heading',{name:'经营看板',exact:true}).waitFor();await staff.getByRole('heading',{name:'当前业务',exact:true}).waitFor();await staff.getByText('以下卡片可能重叠，不可相加作为订单总数。',{exact:true}).waitFor();
 const trends=await get(staff,()=>staff.getByText('近30天',{exact:true}).click(),'/admin/dashboard/trends',url=>url.searchParams.get('days')==='30');assert.equal(trends.days,30);assert.equal(trends.items.length,30);await staff.getByRole('img',{name:/^近30天支付、退款及净收款趋势/}).waitFor();await staff.getByText('查看每日精确数据',{exact:true}).click();const table=staff.locator('details').filter({has:staff.getByText('查看每日精确数据',{exact:true})});assert.equal(await table.locator('tbody tr').count(),30);await staff.screenshot({path:path.join(output,'dashboard-desktop-30days.png'),fullPage:true});
 const cardFilters=[];
 for(const card of [
  {title:'待发货订单',route:'/orders?status=WAIT_SHIPMENT',api:'/admin/orders',key:'status',value:'WAIT_SHIPMENT',label:'状态',total:overview.current.waitingShipmentOrderCount,screenshot:'dashboard-wait-shipment-card-destination.png'},
  {title:'待审售后',route:'/after-sales?status=PENDING_REVIEW',api:'/admin/after-sales',key:'status',value:'PENDING_REVIEW',label:'售后阶段',total:overview.current.pendingReviewAfterSaleCount,screenshot:'dashboard-pending-review-card-destination.png'},
  {title:'低库存 SKU',route:'/inventory?lowStock=true',api:'/admin/inventory',key:'lowStock',value:'true',label:'库存预警',total:overview.current.lowStockSkuCount,screenshot:'dashboard-low-stock-card-destination.png'},
 ]){
  await staff.goto(origin+'/dashboard');await staff.getByRole('heading',{name:'当前业务',exact:true}).waitFor();
  const article=staff.locator('article').filter({has:staff.getByRole('heading',{name:card.title,exact:true})}),link=article.getByRole('link',{name:'查看业务 →',exact:true});assert.equal(await link.getAttribute('href'),card.route);
  const [response]=await Promise.all([staff.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname==='/api/v1'+card.api),link.click()]);
  assert.equal(response.status(),200,card.title);const requestUrl=new URL(response.url()),json=await response.json();assert.deepEqual(requestUrl.searchParams.getAll(card.key),[card.value],card.title+'首个真实GET必须携带筛选');assert.ok(json.requestId);await staff.waitForURL(origin+card.route);
  // 原生select嵌在label内，标签文本还包含option；先按可见标题定位唯一控件，再检查真实值。
  const filterControl=staff.getByLabel(new RegExp('^'+card.label));assert.equal(await filterControl.count(),1,card.title+'筛选控件唯一');
  const result=json.data;assert.equal(String(result.total),card.total,card.title+'列表总数等于看板卡片');assert.equal(result.page,1);assert.equal(result.pageSize,20);assert.equal(await filterControl.inputValue(),card.value);
  if(card.key==='status')assert.ok(result.items.every(row=>row.status===card.value),card.title+'仅返回匹配状态');
  else{assert.ok(result.items.every(row=>row.lowStock&&row.available<=row.warningThreshold),'低库存含等号');assert.deepEqual(result.items.map(row=>row.skuId).sort(),expected.stock.items.map(row=>row.skuId).sort());}
  await staff.screenshot({path:path.join(output,card.screenshot),fullPage:true});cardFilters.push({title:card.title,route:card.route,request:requestUrl.pathname+requestUrl.search,total:result.total,requestId:json.requestId});
 }
 report.checks.push('看板三卡实际点击后首个后端GET带待发/待审/低库存筛选，表单初值及真实返回总数与卡片一致，低库存含等号');
 const listUrl=origin+'/audit-logs?businessType=ORDER&businessNo='+encodeURIComponent(orderNo)+'&pageSize=100';
 const all=await get(staff,()=>staff.goto(listUrl),'/admin/audit-logs');assert.ok(all.items.some(row=>row.action==='order.pay'));assert.equal(new Set(all.items.map(row=>row.id)).size,all.items.length);await staff.getByRole('heading',{name:'操作审计',exact:true}).waitFor();
 await staff.getByRole('combobox',{name:/^操作动作/}).selectOption('order.pay');const filtered=await get(staff,()=>staff.getByRole('button',{name:'查询审计',exact:true}).click(),'/admin/audit-logs',url=>url.searchParams.get('action')==='order.pay');assert.equal(filtered.total,1);assert.ok(filtered.items.every(row=>row.action==='order.pay'));
 const pay=filtered.items[0];const detail=await get(staff,()=>staff.getByRole('link',{name:'订单模拟支付 →',exact:true}).click(),'/admin/audit-logs/'+pay.id);assert.equal(detail.action,'order.pay');assert.ok(detail.changes.some(change=>change.field==='amountCents'&&change.after===10700));assert.ok(!Object.hasOwn(detail,'afterData'));await staff.getByRole('heading',{name:'审计详情',exact:true}).waitFor();await staff.getByText('金额（分）',{exact:true}).waitFor();await staff.screenshot({path:path.join(output,'audit-safe-payment-detail.png'),fullPage:true});
 await staff.goto(origin+'/audit-logs?action=unknown.action');await staff.getByText('操作动作无效',{exact:true}).waitFor();
 const history=await get(staff,()=>staff.goto(origin+'/orders/'+orderId),'/admin/orders/'+orderId+'/history');assert.ok(history.total>0);
 const timeline=staff.locator('section[aria-label="业务历史"]');await timeline.getByRole('heading',{name:'业务历史',exact:true}).waitFor();const payments=await get(staff,()=>timeline.getByLabel('历史事件类型',{exact:true}).selectOption('PAYMENT'),'/admin/orders/'+orderId+'/history',url=>url.searchParams.get('kind')==='PAYMENT');assert.equal(payments.items.length,1);assert.ok(payments.items.every(row=>row.kind==='PAYMENT'));await staff.screenshot({path:path.join(output,'order-payment-business-history.png'),fullPage:true});
 await get(staff,()=>staff.goto(origin+'/after-sales/'+afterSaleId),'/admin/after-sales/'+afterSaleId+'/history');const saleTimeline=staff.locator('section[aria-label="业务历史"]');await saleTimeline.waitFor();const saleHistory=await get(staff,()=>saleTimeline.getByLabel('历史事件类型',{exact:true}).selectOption('REFUND_ATTEMPT'),'/admin/after-sales/'+afterSaleId+'/history',url=>url.searchParams.get('kind')==='REFUND_ATTEMPT');assert.ok(saleHistory.items.some(row=>row.kind==='REFUND_ATTEMPT'&&row.afterStatus==='SUCCEEDED'));await staff.screenshot({path:path.join(output,'after-sale-refund-business-history.png'),fullPage:true});
 const consumed=await get(staff,()=>staff.goto(origin+'/customers/'+customerId),'/admin/customers/'+customerId+'/consumption');assert.equal(consumed.amountCents,'0');await staff.screenshot({path:path.join(output,'customer-consumption-after-refund.png'),fullPage:true});
 const wh=await login(warehouse,{width:390,height:844});const projected=await get(wh,()=>wh.goto(origin+'/dashboard'),'/admin/dashboard/overview');assert.deepEqual(projected.today,expected.overview.today);await wh.getByRole('heading',{name:'经营看板',exact:true}).waitFor();await wh.getByRole('heading',{name:'库存预警',exact:true}).waitFor();await wh.screenshot({path:path.join(output,'warehouse-dashboard-mobile.png'),fullPage:true});await wh.goto(origin+'/audit-logs');await wh.getByRole('heading',{name:'没有访问权限',exact:true}).waitFor();
 const cs=await login(support);await cs.goto(origin+'/dashboard');await cs.getByRole('heading',{name:'没有访问权限',exact:true}).waitFor();await cs.goto(origin+'/audit-logs');await cs.getByRole('heading',{name:'没有访问权限',exact:true}).waitFor();
 report.browser={orderId,afterSaleId,customerId,auditId:pay.id,trendDays:30,cardFilters,readOnlyBusinessQueries:true};report.checks.push('生产真实浏览器：看板30日期/重叠口径、管理员原单号审计筛选与安全详情、订单付款/售后退款历史、净消费0、仓储手机看板及客服/仓储无权边界');
}
