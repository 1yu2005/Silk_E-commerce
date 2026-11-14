// 作用：生产四服务真实HTTP/浏览器验收；所有库存变化均通过正式业务命令。
/* global document,innerWidth */
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
export async function verifyOrders(c){
 const {origin,storeOrigin,adminToken,adminUsername,adminPassword,browser,call,passed,output,report,secrets,compose}=c;
 const admin=(url,method='GET',body,status=200,code)=>call(origin,url,method,body,adminToken,status,code);
 const address={receiver:'开发演示收件人',phone:'01000000000',province:'开发演示省',city:'开发演示市',district:'开发演示区',detail:'开发演示地址，不用于真实寄件'};
 const setting={shippingFeeCents:800,freeShippingEnabled:true,freeShippingThresholdCents:20000,returnAddress:address,serviceContact:{phone:'01000000000',serviceHours:'开发演示配置，非真实客服电话'},deadlines:{paymentMinutes:30,autoReceiptDays:10,afterSaleWindowDays:7,reviewWorkdays:3,supplementDays:7,returnShipDays:7,inspectionWorkdays:3,refundWorkdays:3}};
 async function saveSetting(minutes=30){const current=await admin('/admin/settings');await admin('/admin/settings','PUT',{...setting,deadlines:{...setting.deadlines,paymentMinutes:minutes},expectedVersion:current.version,reason:'板块8＋9开发演示配置，非真实经营资料'});}
 await saveSetting();
 const category=await admin('/admin/categories','POST',{name:'板块89隔离服装'},201);
 let product=await admin('/admin/products','POST',{name:'板块89正式入账棉衫',categoryId:category.id,description:'本轮独占验收演示资料'},201);
 const skuId=product.skus.find(s=>!s.retiredAt).id;
 product=await admin('/admin/products/'+product.id+'/skus/batch-fill','POST',{expectedVersion:product.version,skuIds:[skuId],priceCents:9900,costCents:4000});
 const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
 const bytes=await require('sharp')({create:{width:320,height:420,channels:3,background:'#7c9299'}}).png().toBuffer();
 const form=new FormData();form.append('purpose','PRODUCT_IMAGE');form.append('file',new Blob([bytes],{type:'image/png'}),'orders-shirt.png');
 const upload=await fetch(origin+'/api/v1/files',{method:'POST',headers:{Authorization:'Bearer '+adminToken},body:form});assert.equal(upload.status,201);const image=(await upload.json()).data;
 product=await admin('/admin/products/'+product.id+'/images','PUT',{expectedVersion:product.version,mainImageId:image.id,galleryImageIds:[]});
 const source=await admin('/admin/inventory/sources','POST',{sourceType:'RECEIPT',namespace:'DOCKER-M208',reference:randomUUID(),note:'本轮独占开发演示实收资料',lines:[{lineKey:'1',skuId,verifiedQuantity:50}]},201);
 let arrival=await admin('/admin/inventory/adjustments','POST',{type:'ARRIVAL',reason:'隔离演示正式入账',lines:[{skuId,sourceLineId:source.lines[0].id,batchKey:'ORDERS-50',quantity:50}]},201);
 arrival=await admin('/admin/inventory/adjustments/'+arrival.id+'/claim','POST',{expectedVersion:arrival.version,expectedTaskVersion:arrival.task.version});
 arrival=await admin('/admin/inventory/adjustments/'+arrival.id+'/post','POST',{expectedVersion:arrival.version,expectedTaskVersion:arrival.task.version});assert.equal(arrival.ledger[0].afterA,50);
 product=await admin('/admin/products/'+product.id+'/publish','POST',{expectedVersion:product.version,reason:'正式库存入账后发布'});
 passed('板块5/6真实衔接：来源→待确认登记→领取→正式入账50件→上架，未直接写余额');
 const phone='138'+String(BigInt('0x'+randomBytes(6).toString('hex'))%100000000n).padStart(8,'0'),password='Orders#'+randomBytes(20).toString('hex');secrets.push(password);
 await call(storeOrigin,'/store/auth/register','POST',{phone,password,nickname:'板块89隔离顾客'},undefined,201);
 const login=await call(storeOrigin,'/store/auth/login','POST',{phone,password}),token=login.accessToken;
 const customer=(url,method='GET',body,status=200,code,headers)=>call(storeOrigin,url,method,body,token,status,code,headers);
 const a=(await customer('/store/addresses','POST',{...address,isDefault:true},201)).address;
 async function newOrder(quantity=1){const cart=await customer('/store/cart/items','POST',{skuId,quantity},201);const body={addressId:a.id,items:[{cartItemId:cart.item.id,skuId,quantity}]};const q=await customer('/store/checkout/preview','POST',body,201);return customer('/store/orders','POST',{...body,quoteId:q.quoteId},201,undefined,{'Idempotency-Key':randomUUID()});}
 const store=await browser.newPage({viewport:{width:1280,height:900}}),staff=await browser.newPage({viewport:{width:1440,height:1000}});for(const page of [store,staff]){page.on('pageerror',e=>report.pageErrors.push(e.name));page.on('response',async response=>{if(!response.url().includes('/api/v1/'))return;const request=response.request();let body;try{body=await response.json();}catch{/* 非JSON响应只记录状态 */}report.requests.push({source:'browser',method:request.method(),path:new URL(response.url()).pathname,status:response.status(),code:body?.code,requestId:body?.requestId});});}
 await store.goto(storeOrigin+'/login');await store.getByLabel('手机号',{exact:true}).fill(phone);await store.getByLabel('密码',{exact:true}).fill(password);await store.locator('form button[type=submit]').click();await store.waitForURL(storeOrigin+'/account');
 await store.goto(storeOrigin+'/products/'+product.id);await store.getByLabel('添加数量',{exact:true}).fill('2');await store.getByRole('button',{name:'加入购物车',exact:true}).click();await store.getByText('已加入购物车。',{exact:false}).waitFor();
 await store.goto(storeOrigin+'/cart');await store.getByRole('link',{name:'去确认订单 →',exact:true}).click();await store.getByRole('button',{name:'获取服务器报价',exact:true}).click();await store.getByRole('heading',{name:'本次服务器报价',exact:true}).waitFor();
 assert.match(await store.locator('.cart-summary').innerText(),/206\.00/);
 product=await admin('/admin/products/'+product.id);product=await admin('/admin/products/'+product.id+'/skus/batch-fill','POST',{expectedVersion:product.version,skuIds:[skuId],priceCents:10000});
 await store.getByRole('button',{name:'确认金额并创建订单',exact:true}).click();await store.getByText('价格或运费规则已变化，请重新确认',{exact:false}).first().waitFor();
 await store.getByRole('button',{name:'重新读取商品和报价',exact:true}).click();await store.getByRole('button',{name:'获取服务器报价',exact:true}).click();await store.getByRole('heading',{name:'本次服务器报价',exact:true}).waitFor();
 let lostOrder,originalBody,originalKey,routeFailure;await store.route('**/api/v1/store/orders',async route=>{if(route.request().method()!=='POST')return route.continue();try{originalBody=route.request().postDataJSON();originalKey=route.request().headers()['idempotency-key'];const response=await route.fetch();if(response.status()!==201){const body=await response.json();report.requests.push({method:'POST',path:'/store/orders',status:response.status(),requestId:body.requestId});throw new Error('真实建单失败 HTTP '+response.status()+' '+body.code);}lostOrder=(await response.json()).data;}catch(e){routeFailure=e;}await route.abort('connectionfailed');});
 await store.getByRole('button',{name:'确认金额并创建订单',exact:true}).click();await store.getByRole('button',{name:'确认订单结果',exact:true}).waitFor();await store.unroute('**/api/v1/store/orders');if(routeFailure)throw routeFailure;
 await store.reload();await store.getByRole('button',{name:'确认订单结果',exact:true}).click();await store.waitForURL(storeOrigin+'/orders/'+lostOrder.orderId);
 const replay=await customer('/store/orders','POST',originalBody,200,undefined,{'Idempotency-Key':originalKey});assert.equal(replay.orderId,lostOrder.orderId);assert.equal(replay.replayed,true);
 await store.getByRole('button',{name:'确认模拟付款',exact:true}).click();await store.getByText('模拟付款成功，等待发货',{exact:true}).waitFor();
 const payment=await customer('/store/orders/'+lostOrder.orderId+'/pay','POST',{});assert.equal(payment.replayed,true);
 assert.equal((await admin('/admin/inventory/'+skuId)).reserved,0);assert.equal((await customer('/store/orders/'+lostOrder.orderId)).status,'WAIT_SHIPMENT');
 await store.screenshot({path:path.join(output,'order-paid.png'),fullPage:true});await store.setViewportSize({width:390,height:844});assert.ok(await store.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await store.screenshot({path:path.join(output,'order-mobile.png'),fullPage:true});
 passed('生产浏览器：选择真实服装→加购→报价→改价409重新确认→真实建单丢响应→刷新同键恢复→唯一模拟付款；手机无横向溢出');
 await staff.goto(origin+'/login');await staff.getByLabel('员工账号',{exact:true}).fill(adminUsername);await staff.getByLabel('密码',{exact:true}).fill(adminPassword);await staff.locator('form button[type=submit]').click();await staff.waitForURL(origin+'/');
 await staff.goto(origin+'/orders/'+lostOrder.orderId);await staff.getByRole('heading',{name:'任务与阻塞',exact:true}).waitFor();await staff.getByLabel('内部结果',{exact:true}).fill('仅员工可见的核实资料');await staff.getByLabel('顾客可见说明（留空不公开）',{exact:true}).fill('已确认演示收货信息');await staff.getByRole('button',{name:'追加沟通记录',exact:true}).click();
 await store.reload();await store.getByText('已确认演示收货信息',{exact:true}).waitFor();assert.ok(!(await store.locator('body').innerText()).includes('仅员工可见的核实资料'));assert.ok(!/unitCostCents|assigneeId|damagedReservedQuantity/.test(JSON.stringify(await customer('/store/orders/'+lostOrder.orderId))));
 await staff.screenshot({path:path.join(output,'order-admin.png'),fullPage:true});
 const otherPhone='139'+String(BigInt('0x'+randomBytes(6).toString('hex'))%100000000n).padStart(8,'0');await call(storeOrigin,'/store/auth/register','POST',{phone:otherPhone,password},undefined,201);const otherToken=(await call(storeOrigin,'/store/auth/login','POST',{phone:otherPhone,password})).accessToken;
 await call(storeOrigin,'/store/orders/'+lostOrder.orderId,'GET',undefined,otherToken,404,'ORDER_NOT_FOUND');await customer('/store/orders/'+lostOrder.orderId+'/pay','POST',{amountCents:1},400,'VALIDATION_FAILED');
 const me=await customer('/store/me');const consumption=await admin('/admin/customers/'+me.id+'/consumption');assert.equal(consumption.availability,'AVAILABLE');assert.equal(consumption.amountCents,'0');
 passed('真实订单/客服沟通/净消费端口接通；顾客只见公开说明，未收货付款不计净消费，越权404、伪造金额400');
 const cancelled=await newOrder(2);await store.goto(storeOrigin+'/orders/'+cancelled.orderId);store.once('dialog',d=>d.accept());await store.getByRole('button',{name:'取消订单',exact:true}).click();await store.getByRole('heading',{name:'已关闭',exact:true}).waitFor();assert.equal((await customer('/store/orders/'+cancelled.orderId+'/cancel','POST',{})).replayed,true);
 const damaged=await newOrder(2);let incident=await admin('/admin/inventory/stock-incidents','POST',{incidentKey:randomUUID(),skuId,items:[{orderItemId:(await customer('/store/orders/'+damaged.orderId)).items[0].id}],reason:'隔离开发演示实物待核实',evidenceNote:'本轮验收事实，非真实经营损耗'},201);
 await customer('/store/orders/'+damaged.orderId+'/pay','POST',{},409,'ORDER_STOCK_BLOCKED');await customer('/store/orders/'+damaged.orderId+'/cancel','POST',{},409,'ORDER_STOCK_CHECK_REQUIRED');
 await staff.goto(origin+'/inventory/stock-incidents/'+incident.id);await staff.getByRole('button',{name:'领取核实任务',exact:true}).first().click();await staff.getByLabel('受损件数',{exact:true}).first().fill('1');await staff.getByLabel('核实原因',{exact:true}).first().fill('确认本订单损耗1件');await staff.getByLabel('实际证据',{exact:true}).first().fill('本轮隔离实物核实资料');await staff.getByRole('button',{name:'保存核实',exact:true}).first().click();
 await staff.getByLabel('替代件数量',{exact:true}).first().fill('1');await staff.getByLabel('替代件货位与来源',{exact:true}).first().fill('演示货架A');await staff.getByLabel('分配原因',{exact:true}).first().fill('实际分配可售替代件');await staff.getByLabel('实际证据',{exact:true}).nth(1).fill('隔离补齐证据');staff.once('dialog',d=>d.accept());await staff.getByRole('button',{name:'从可售库存分配补齐',exact:true}).first().click();
 await staff.getByText('当前未补齐 0',{exact:false}).first().waitFor();await staff.getByLabel('解除原因',{exact:true}).fill('已实际补齐全部影响');await staff.getByLabel('整体核实证据',{exact:true}).fill('本轮专属核实完毕');await staff.getByRole('button',{name:'校验并解除本异常来源',exact:true}).click();await staff.getByText('已解除',{exact:true}).first().waitFor();
 await customer('/store/orders/'+damaged.orderId+'/pay','POST',{});incident=await admin('/admin/inventory/stock-incidents/'+incident.id);assert.equal(incident.items[0].damagedQuantity,1);assert.equal(incident.items[0].replenishments.length,1);
 await staff.screenshot({path:path.join(output,'stock-incident-resolved.png'),fullPage:true});passed('生产浏览器：未知损耗阻付款/取消→领取核实→确认损耗→正式可售补齐→解除本来源→原期限内付款；原损耗历史保留');
 const known=await newOrder(2),line=(await customer('/store/orders/'+known.orderId)).items[0];const beforeKnown=await admin('/admin/inventory/'+skuId);
 const knownIncident=await admin('/admin/inventory/stock-incidents','POST',{incidentKey:randomUUID(),skuId,items:[{orderItemId:line.id,damagedQuantity:1}],reason:'已知受损净释放演示',evidenceNote:'本轮独占事实'},201);await customer('/store/orders/'+known.orderId+'/cancel','POST',{});const afterKnown=await admin('/admin/inventory/'+skuId);assert.equal(afterKnown.available,beforeKnown.available+1);assert.equal(afterKnown.reserved,beforeKnown.reserved-2);assert.equal(afterKnown.purchaseBlocked,true);
 await admin('/admin/inventory/stock-incidents/'+knownIncident.id+'/resolve','POST',{expectedVersion:knownIncident.version,expectedTaskVersion:0,commandKey:randomUUID(),reason:'未付单净释放已结清，本来源实物核实结束',evidenceNote:'独占损耗历史保留，不把坏货重新入账'});assert.equal((await admin('/admin/inventory/'+skuId)).purchaseBlocked,false);
 await c.verifyFulfillment?.({...c,admin,customer,newOrder,store,staff,otherToken,orderId:lostOrder.orderId,skuId});
 // 仅本轮隔离库改为真实一分钟期限；停止API跨越截止，再由外层重启验证启动补扫。
 await saveSetting(1);const expired=await newOrder(1);await saveSetting(30);
 product=await admin('/admin/products/'+product.id);await admin('/admin/products/'+product.id+'/sku-scheme','PUT',{expectedVersion:product.version,mode:'REBUILD',reason:'真实订单引用保护',dimensions:[{clientKey:randomUUID(),name:'尺码',values:[{clientKey:randomUUID(),name:'M'}]}]},409,'SKU_SCHEME_REFERENCED');
 // 订单历史图在当前商品解绑后仍公开可读；不能因当前商品下架而丢失旧单证据。
 product=await admin('/admin/products/'+product.id);await admin('/admin/products/'+product.id+'/unpublish','POST',{expectedVersion:product.version,reason:'旧单历史图验收'});product=await admin('/admin/products/'+product.id);await admin('/admin/products/'+product.id+'/images','PUT',{expectedVersion:product.version,mainImageId:null,galleryImageIds:[]});
 const oldImage=(await customer('/store/orders/'+lostOrder.orderId)).items[0].imageUrl;const img=await fetch(storeOrigin+oldImage);assert.equal(img.status,200);const digest=createHash('sha256').update(Buffer.from(await img.arrayBuffer())).digest('hex');
 passed('前置补验：已知受损取消净释放q−d，真实订单阻止SKU重建，商品解绑图片后旧单图片仍可读');
 const snapshot=await customer('/store/orders/'+lostOrder.orderId);const balance=await admin('/admin/inventory/'+skuId);
 await store.close();await staff.close();
 compose(['stop','api'],'专属API停机跨付款截止');console.log(JSON.stringify({waiting:'独占API已停机，等待真实付款截止后重启补扫',paymentDeadline:expired.paymentDeadline}));
 while(Date.now()<=Date.parse(expired.paymentDeadline)+1000)await new Promise(r=>setTimeout(r,500));
 return {async verifyPersistence(){
  let ready=false;for(let n=0;n<60;n++){try{ready=(await fetch(origin+'/api/v1/health/ready')).status===200;}catch{/* 重建代理DNS刷新 */}if(ready)break;await new Promise(r=>setTimeout(r,500));}assert.ok(ready);
  const actual=await customer('/store/orders/'+lostOrder.orderId);delete actual.serverTime;const expected={...snapshot};delete expected.serverTime;assert.deepEqual(actual,expected);
  let timed;for(let n=0;n<60;n++){timed=await customer('/store/orders/'+expired.orderId);if(timed.status==='CLOSED')break;await new Promise(r=>setTimeout(r,500));}assert.equal(timed.status,'CLOSED');assert.equal(timed.closeReasonCode,'PAYMENT_TIMEOUT');
  assert.equal((await admin('/admin/inventory/'+skuId)).available,balance.available+1);assert.equal((await admin('/admin/inventory/'+skuId)).reserved,balance.reserved-1);assert.equal((await customer('/store/orders/'+lostOrder.orderId+'/pay','POST',{})).paymentId,payment.paymentId);
  const response=await fetch(storeOrigin+oldImage);assert.equal(response.status,200);assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'),digest);
  passed('真实生产时间：API停机跨一分钟付款截止，重启补扫唯一关闭/释放；原付款与历史图保持');
 }};
}
