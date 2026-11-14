// 作用：独占Docker中通过正式接口和真实页面核验沟通分页、图片绑定、公开更正及文件隔离；不清理数据。
/* global document */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';

export async function verifyOrderCommunications(c){
 const {admin,customer,newOrder,store,staff,origin,storeOrigin,call,otherToken,compose,env,passed,output}=c;
 assert.ok(otherToken,'复用已有隔离顾客验证文件越权，不更改账号');
 const id=(await newOrder(1)).orderId,marker='沟通分页-'+randomUUID().slice(0,8),records=[];
 const query=page=>'/admin/communications?scopeType=ORDER&scopeId='+id+'&page='+page+'&pageSize=20';
 const publicQuery=page=>'/store/orders/'+id+'/communications?page='+page+'&pageSize=20';
 for(let n=1;n<=21;n++)records.push(await admin('/admin/communications','POST',{scopeType:'ORDER',scopeId:id,channel:'OTHER',occurredAt:new Date().toISOString(),result:marker+'内部结果'+n,publicText:marker+'公开说明'+n},201));
 assert.equal((await admin(query(1))).items.length,20);assert.equal((await admin(query(2))).items.length,1);
 assert.equal((await customer(publicQuery(1))).items.length,20);assert.equal((await customer(publicQuery(2))).items.length,1);
 const staffPager=()=>staff.locator('[aria-label="客服沟通分页"]'),storePager=()=>store.locator('[aria-label="公开说明分页"]');
 const secondPage=async pager=>{await pager.locator('.ant-pagination-item-2').click();};
 await staff.goto(origin+'/orders/'+id);await staffPager().waitFor();await secondPage(staffPager());await staff.getByText('公开说明：'+marker+'公开说明21',{exact:true}).waitFor();
 await store.goto(storeOrigin+'/orders/'+id);await storePager().waitFor();await secondPage(storePager());await store.getByText(marker+'公开说明21',{exact:true}).waitFor();
 assert.ok(!(await store.locator('body').innerText()).includes(marker+'内部结果'));
 passed('沟通分页：正式追加21条记录，后台与商城均可翻第2页读取第21条；商城不显示内部结果');

 // 两张不同的真实PNG经页面上传；服务端生成文件和正式沟通引用，不模拟上传响应。
 const require=createRequire(new URL('../apps/api/package.json',import.meta.url)),sharp=require('sharp');
 const pngs=await Promise.all(['#36546d','#b88869'].map(background=>sharp({create:{width:64,height:80,channels:3,background}}).png().toBuffer()));
 const form=staff.locator('form').filter({has:staff.getByRole('heading',{name:'记录沟通',exact:true})});
 const note=marker+'附件公开说明',internal=marker+'仅客服内部核实内容';
 await form.getByLabel('内部结果',{exact:true}).fill(internal);await form.getByLabel('顾客可见说明（留空不公开）',{exact:true}).fill(note);
 await form.getByLabel('上传沟通凭证（最多5张）',{exact:true}).setInputFiles(pngs.map((buffer,n)=>({name:'communication-'+n+'.png',mimeType:'image/png',buffer})));
 await form.getByLabel('第2张凭证可见范围',{exact:true}).waitFor();await form.getByLabel('第2张凭证可见范围',{exact:true}).selectOption('CUSTOMER_VISIBLE');
 const submit=staff.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/v1/admin/communications');
 await form.getByRole('button',{name:'追加沟通记录',exact:true}).click();const response=await submit;assert.equal(response.status(),201);const saved=(await response.json()).data;
 const rows=await admin(query(2)),record=rows.items.find(r=>r.id===saved.id);assert.ok(record);assert.equal(record.attachments.length,2);
 const privateId=record.attachments.find(a=>a.audience==='INTERNAL').fileId,publicId=record.attachments.find(a=>a.audience==='CUSTOMER_VISIBLE').fileId;
 assert.match(saved.id,/^[a-f0-9-]{36}$/);
 const sql=compose(['exec','-T','db','psql','-U',env.POSTGRES_USER,'-d',env.POSTGRES_DB,'-tAc',`SELECT json_build_object('total',COUNT(*),'internal',COUNT(*) FILTER(WHERE audience='INTERNAL'),'customer',COUNT(*) FILTER(WHERE audience='CUSTOMER_VISIBLE')) FROM file_reference WHERE owner_type='COMMUNICATION' AND owner_id='${saved.id}'::uuid`],'核对正式沟通文件引用与可见范围');
 assert.deepEqual(JSON.parse(sql.stdout.trim()),{total:2,internal:1,customer:1});
 const publicRows=await customer(publicQuery(2)),publicRecord=publicRows.items.find(r=>r.id===saved.id);assert.deepEqual(publicRecord.attachments.map(a=>a.fileId),[publicId]);
 assert.ok(!JSON.stringify(publicRows).includes(internal));assert.ok(!JSON.stringify(publicRows).includes(privateId));
 await customer('/files/'+privateId+'/content','GET',undefined,404,'FILE_NOT_FOUND');
 for(const fileId of [privateId,publicId]){
  await call(storeOrigin,'/files/'+fileId+'/content','GET',undefined,otherToken,404,'FILE_NOT_FOUND');
  await call(storeOrigin,'/files/'+fileId+'/content','GET',undefined,undefined,404,'FILE_NOT_FOUND');
 }
 await staff.reload();await staffPager().waitFor();await secondPage(staffPager());const staffArticle=staff.locator('#communication-'+saved.id);await staffArticle.locator('img.private-image').nth(1).waitFor();
 await staff.waitForFunction(selector=>[...document.querySelectorAll(selector)].every(img=>img.complete&&img.naturalWidth>0),'#communication-'+saved.id+' img.private-image');assert.equal(await staffArticle.locator('img.private-image').count(),2);
 await store.reload();await storePager().waitFor();await secondPage(storePager());const customerArticle=store.locator('article').filter({hasText:note});await customerArticle.locator('img.private-image').waitFor();
 await customerArticle.locator('img.private-image').evaluate(img=>img.complete?Promise.resolve(img.naturalWidth):new Promise(resolve=>{img.addEventListener('load',()=>resolve(img.naturalWidth),{once:true});img.addEventListener('error',()=>resolve(0),{once:true});})).then(width=>assert.ok(width>0));
 assert.equal(await customerArticle.locator('img.private-image').count(),1);assert.ok(!(await store.locator('body').innerText()).includes(internal));
 passed('沟通附件：页面真实上传两张PNG并正式绑定，SQL和API均为1内部/1顾客可见；后台2图、商城1图；本人内部图、另一顾客和匿名均404');

 // 通过页面更正已有公开记录，旧记录保留；公开关系来自服务端白名单投影。
 await staffPager().locator('.ant-pagination-item-1').click();const original=staff.locator('#communication-'+records[0].id);await original.getByRole('button',{name:'追加更正',exact:true}).click();
 const correction=staff.locator('form').filter({has:staff.getByRole('heading',{name:'追加更正',exact:true})}),correctedText=marker+'公开更正说明';
 await correction.getByLabel('内部结果',{exact:true}).fill(marker+'更正内部核实');await correction.getByLabel('顾客可见说明（留空不公开）',{exact:true}).fill(correctedText);await correction.getByLabel('更正原因',{exact:true}).fill('本轮隔离核实后追加更正，保留原始说明');
 const corrected=staff.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/v1/admin/communications');await correction.getByRole('button',{name:'追加沟通记录',exact:true}).click();const correctionResponse=await corrected;assert.equal(correctionResponse.status(),201);const correctionId=(await correctionResponse.json()).data.id;
 const first=await customer(publicQuery(1)),later=await customer(publicQuery(2));assert.ok(first.items.find(r=>r.id===records[0].id)?.isCorrected);assert.equal(later.items.find(r=>r.id===correctionId)?.correctsId,records[0].id);assert.equal(first.total,23);assert.equal(later.total,23);
 assert.ok(!JSON.stringify([first,later]).includes(marker+'更正内部核实'));
 await store.reload();await storePager().waitFor();await store.getByText(marker+'公开说明1（有后续更正）',{exact:true}).waitFor();await secondPage(storePager());await store.getByText(correctedText,{exact:true}).waitFor();await store.getByText('此条说明更正了先前的公开说明，原说明保留在历史记录中。',{exact:true}).waitFor();
 await staff.reload();await staffPager().waitFor();await secondPage(staffPager());await staff.locator('#communication-'+correctionId).getByText('本条追加更正了先前沟通；更正原因：本轮隔离核实后追加更正，保留原始说明',{exact:true}).waitFor();
 await staff.screenshot({path:path.join(output,'communications-admin.png'),fullPage:true});await store.screenshot({path:path.join(output,'communications-customer.png'),fullPage:true});
 passed('公开更正：页面正式追加新记录，原公开记录和更正关系保留，两站第2页显示新说明，商城不泄漏内部更正内容');
}
