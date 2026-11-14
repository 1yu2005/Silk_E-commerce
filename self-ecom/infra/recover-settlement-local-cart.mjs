// 作用：仅恢复本轮建单前失败演示新增的唯一购物车项，归属由失败时间、顾客和报价共同证明；走正式单项删除接口。
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {env,requireApi} from '../scripts/module12-runtime.mjs';
const folder='docs/verification/evidence/M3-12/local-final',target=folder+'/cart-recovery.json';assert.ok(!existsSync(target));
const failure=JSON.parse(readFileSync(folder+'/result.json','utf8')),baseline=JSON.parse(readFileSync('docs/verification/evidence/M3-12/data-postdeploy.json','utf8')),credential=JSON.parse(readFileSync('private-delivery/板块8＋9_演示顾客.local.json','utf8'));
assert.equal(failure.status,'failed');assert.equal(failure.requests.filter(r=>r.path==='/store/orders'&&r.status===201).length,0);
const {Client}=requireApi('pg'),db=new Client({connectionString:env.DATABASE_URL}),origin='http://localhost:'+(env.STORE_HOST_PORT??8081)+'/api/v1';let token;
async function call(p,method='GET',body){const r=await fetch(origin+p,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();assert.equal(r.status,200,p+' '+j.code);return j.data;}
try{await db.connect();token=(await call('/store/auth/login','POST',{phone:credential.phone,password:credential.password})).accessToken;const me=await call('/store/me');
 const rows=(await db.query('SELECT ci.id,ci.sku_id,ci.version,q.id AS quote_id FROM cart_item ci JOIN checkout_quote_item qi ON qi.cart_item_id_snapshot=ci.id JOIN checkout_quote q ON q.id=qi.quote_id WHERE ci.customer_id=$1 AND q.customer_id=$1 AND ci.created_at BETWEEN $2 AND $3 AND q.created_at BETWEEN $2 AND $3',[me.id,failure.startedAt,failure.endedAt])).rows;assert.equal(rows.length,1);const item=rows[0];
 assert.equal((await db.query('SELECT count(*)::int AS n FROM "order" WHERE quote_id=$1',[item.quote_id])).rows[0].n,0);
 await call('/store/cart/items/'+item.id,'DELETE',{expectedVersion:item.version});
 const checks={};for(const table of ['cart_item','address']){const old=baseline.tables[table],projection=old.columns.map(n=>'t."'+n+'"').join(','),rows=(await db.query(`SELECT row_to_json(x)::text AS row FROM (SELECT ${projection} FROM "${table}" t) x ORDER BY row_to_json(x)::text`)).rows;assert.equal(createHash('sha256').update(JSON.stringify(rows)).digest('hex'),old.sha256);checks[table]='与部署后、演示前全表摘要一致';}
 writeFileSync(target,JSON.stringify({at:new Date().toISOString(),status:'passed',deletedCartItemId:item.id,quoteId:item.quote_id,quoteRetained:true,checks},null,2)+'\n');console.log(JSON.stringify({status:'passed',deletedCartItemId:item.id,checks}));
}finally{await db.end();}
