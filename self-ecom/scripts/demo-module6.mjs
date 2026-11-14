// 作用：只用标准输入中的原仓储账号，通过正式命令把既有服装数量草稿转换、确认并上架；不重置账号或直接写余额。
import assert from 'node:assert/strict';
import { existsSync,writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
const input=createInterface({input:process.stdin});const [line]=await once(input,'line');input.close();process.stdin.pause();
const credential=JSON.parse(line);assert.equal(credential.username,'m105_warehouse');
const label=process.argv[2]??'run1';assert.match(label,/^[a-z0-9-]+$/);const output=`docs/verification/evidence/M1-06/development-demo-${label}.json`;assert.ok(!existsSync(output));
const origin='http://localhost:8080';let token;const report={at:new Date().toISOString(),account:{username:credential.username,role:'MERCH_WAREHOUSE',newMember:false},requests:[],products:[]};
async function call(path,method='GET',body,status=200){const r=await fetch(origin+'/api/v1'+path,{method,signal:AbortSignal.timeout(15000),headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();report.requests.push({path,method,status:r.status,requestId:j.requestId,code:j.code});assert.equal(r.status,status,path+' '+j.code);assert.equal(j.requestId,r.headers.get('x-request-id'));return j.data??j;}
try{
 const login=await call('/admin/auth/login','POST',credential);token=login.accessToken;assert.equal(login.employee.role,'MERCH_WAREHOUSE');assert.equal(login.mustChangePassword,false);
 for(const [id,reference] of [['85cab370-f9a0-4ac7-a6f9-3106ed1dec41','TSHIRT-12'],['cdde35cb-472f-4f45-afda-a2807e657344','JACKET-12']]){
  let product=await call('/admin/products/'+id);const draft=await call(`/admin/products/${id}/initial-inventory-draft`);assert.ok(draft);const skus=product.skus.filter(s=>!s.retiredAt);
  assert.equal(draft.lines.length,skus.length);assert.ok(draft.lines.every(l=>l.quantity===12));const before=skus.map(s=>({id:s.id,available:s.available,reserved:s.reserved}));
  let adjustment;
  if(draft.status==='CONVERTED'){assert.ok(draft.adjustmentId);adjustment=await call('/admin/inventory/adjustments/'+draft.adjustmentId);}
  else{
   assert.equal(draft.status,'EDITABLE');assert.ok(skus.every(s=>s.available===0&&s.reserved===0));
   const prior=await call('/admin/inventory/sources?keyword=M106-LOCAL-DEMO');let source;
   const existing=prior.items.find(s=>s.namespace==='M106-LOCAL-DEMO'&&s.reference===reference);
   if(existing)source=await call('/admin/inventory/sources/'+existing.id);
   else source=await call('/admin/inventory/sources','POST',{sourceType:'RECEIPT',namespace:'M106-LOCAL-DEMO',reference,note:'本机功能演示资料：按既存服装草稿每SKU12件核对演示数量。非真实采购、供应商收货或实物验收事实；经用户授权保留，用于正式业务流程演示。',lines:skus.map((s,i)=>({lineKey:String(i+1),skuId:s.id,verifiedQuantity:12}))},201);
   const body={expectedProductVersion:product.version,expectedDraftVersion:draft.version,sourceId:source.id,reason:'本机演示：核对来源SKU与原数量草稿后转待确认登记',evidenceNote:'演示用途，非真实采购；每SKU12件仅用于可售流程验收。',evidenceFileIds:[],mappings:skus.map(s=>({skuId:s.id,sourceLineId:source.lines.find(l=>l.skuId===s.id).id,batchKey:'DEMO-INIT-12'}))};
   adjustment=await call(`/admin/products/${id}/initial-inventory-draft/convert`,'POST',body);
   assert.equal(adjustment.status,'PENDING');assert.ok(adjustment.lines.every(l=>l.available===0&&l.reserved===0));
   const replay=await call(`/admin/products/${id}/initial-inventory-draft/convert`,'POST',body);assert.equal(replay.id,adjustment.id);assert.equal(replay.changed,false);
  }
  if(adjustment.status==='PENDING'){
   assert.equal(adjustment.checkRequired,false);
   if(adjustment.task.status==='OPEN')adjustment=await call(`/admin/inventory/adjustments/${adjustment.id}/claim`,'POST',{expectedVersion:adjustment.version,expectedTaskVersion:adjustment.task.version});
   assert.equal(adjustment.task.assigneeId,login.employee.id);const command={expectedVersion:adjustment.version,expectedTaskVersion:adjustment.task.version};
   adjustment=await call(`/admin/inventory/adjustments/${adjustment.id}/post`,'POST',command);const replay=await call(`/admin/inventory/adjustments/${adjustment.id}/post`,'POST',command);assert.equal(replay.action.id,adjustment.action.id);assert.equal(replay.changed,false);
  }
  assert.equal(adjustment.status,'POSTED');assert.equal(adjustment.ledger.length,skus.length);assert.ok(adjustment.ledger.every(l=>l.beforeA===0&&l.deltaA===12&&l.afterA===12&&l.beforeR===0&&l.afterR===0));assert.equal(adjustment.task,null);
  assert.ok(adjustment.sources.every(s=>s.namespace==='M106-LOCAL-DEMO'&&s.lines.every(l=>l.verifiedQuantity===12&&l.netPostedQuantity===12)));
  product=await call('/admin/products/'+id);if(product.status==='DRAFT')product=await call(`/admin/products/${id}/publish`,'POST',{expectedVersion:product.version,reason:'本机演示库存已通过正式来源转换和领取确认，资料图片价格完整，演示上架'});
  assert.equal(product.status,'ON_SALE');const publicProduct=await call('/store/products/'+id);assert.equal(publicProduct.skus.length,skus.length);assert.equal(publicProduct.availableQuantity,String(skus.length*12));assert.ok(publicProduct.skus.every(s=>s.available===12&&s.purchasable));assert.ok(!/reserved|costCents|sourceLineId/.test(JSON.stringify(publicProduct)));
  report.products.push({id,name:product.name,status:product.status,version:product.version,draftId:draft.id,adjustmentId:adjustment.id,adjustmentNumber:adjustment.number,actionId:adjustment.action.id,sourceIds:adjustment.sources.map(s=>s.id),taskIds:adjustment.tasks.map(t=>({id:t.id,status:t.status,stage:t.stage})),before,after:product.skus.filter(s=>!s.retiredAt).map(s=>({id:s.id,available:s.available,reserved:s.reserved})),ledger:adjustment.ledger.map(l=>({id:l.id,requestId:l.requestId,skuId:l.skuId,beforeA:l.beforeA,deltaA:l.deltaA,afterA:l.afterA,afterR:l.afterR})),publicUrl:'http://localhost:8081/products/'+id});
 }
 report.passed=true;console.log(JSON.stringify({passed:true,products:report.products.map(p=>({name:p.name,skus:p.after.length,available:p.after.reduce((n,s)=>n+s.available,0),adjustmentNumber:p.adjustmentNumber}))}));
}catch(e){report.failure=String(e.message).replaceAll(credential.password,'[REDACTED]').replaceAll(token??'__absent__','[REDACTED]');process.exitCode=1;console.error(report.failure);}
finally{writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
