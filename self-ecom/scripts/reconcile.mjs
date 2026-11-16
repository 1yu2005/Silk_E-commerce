// 作用：在明确隔离目标的一致只读快照内核对库存、资金、任务和真实文件；绝不修数。
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,open,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseEnv} from 'node:util';

const owners={HANDOVER_VERIFICATION:'handover_verification',SHIPMENT_EXCEPTION:'shipment_exception',
 SHIPMENT_EXCEPTION_DECISION:'shipment_exception_decision',SHIPMENT_TRACKING_REVISION:'shipment_tracking_revision',
 ORDER_ITEM:'order_item',STOCK_INCIDENT:'stock_incident',CUSTOMER_AVATAR:'customer',PRODUCT:'product',
 AFTER_SALE_MATERIAL:'after_sale_material_version',AFTER_SALE_RETURN_LOGISTICS:'return_logistics_revision',
 AFTER_SALE_RETURN_VERIFICATION:'return_dispatch_verification',INVENTORY_ADJUSTMENT:'inventory_adjustment',
 INVENTORY_SOURCE:'inventory_source',FULFILLMENT_CHECK:'unshipped_physical_check',RETURN_RECEIPT:'return_receipt',
 RETURN_INSPECTION:'return_inspection_revision',COMMUNICATION:'communication',OFFLINE_CASE:'offline_case',
 PROXY_VERIFICATION:'proxy_context',DISPUTE_DECISION:'dispute_decision',CUSTODY_EVENT:'custody_event',OFFLINE_CASE_EVENT:'offline_case_event'};
const businessTables={ORDER:'order',AFTER_SALE:'after_sale',INVENTORY_ADJUSTMENT:'inventory_adjustment',OFFLINE_CASE:'offline_case',CUSTODY_ARRANGEMENT:'custody_arrangement'};
const ident=value=>'"'+value.replaceAll('"','""')+'"';
const point=(a,r)=>a+','+r;

/** sequence仅在同动作同SKU内排序。先压成有向边，再验证全部边可从0/0连到余额。
 * 这证明可重建一致链，不声称毫秒时间/随机UUID能恢复唯一真实提交时序。
 */
export function verifyInventoryChain(rows,balance){
 const groups=new Map();
 for(const row of rows){const key=row.action_id;let list=groups.get(key);if(!list){list=[];groups.set(key,list);}list.push(row);}
 const edges=[];
 for(const [id,list]of groups){list.sort((a,b)=>a.sequence-b.sequence);let before;
  for(let i=0;i<list.length;i++){const row=list[i];if(row.sequence!==i+1||[row.before_a,row.before_r,row.after_a,row.after_r].some(v=>!Number.isSafeInteger(v)||v<0)
   ||row.before_a+row.delta_a!==row.after_a||row.before_r+row.delta_r!==row.after_r
   ||before&&point(before.after_a,before.after_r)!==point(row.before_a,row.before_r))return false;before=row;}
  const first=list[0],last=list.at(-1);edges.push({id,from:point(first.before_a,first.before_r),to:point(last.after_a,last.after_r)});
 }
 const outgoing=new Map();for(const edge of edges){let bucket=outgoing.get(edge.from);if(!bucket){bucket=[];outgoing.set(edge.from,bucket);}bucket.push(edge);}
 const stack=[{vertex:'0,0',edge:null}],trail=[];
 while(stack.length){const current=stack.at(-1),next=outgoing.get(current.vertex)?.pop();if(next)stack.push({vertex:next.to,edge:next});else{const done=stack.pop();if(done.edge)trail.push(done.edge);}}
 trail.reverse();let current='0,0';for(const edge of trail){if(edge.from!==current)return false;current=edge.to;}
 return trail.length===edges.length&&current===point(balance.available,balance.reserved);
}

const rules=[
 ['database-validated-constraints',`SELECT conrelid::regclass::text AS id FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated`],
 ['inventory-reserved-unpaid',`WITH expected AS (SELECT i.sku_id,sum(i.quantity::bigint) qty FROM order_item i JOIN "order" o ON o.id=i.order_id WHERE o.status='WAIT_PAYMENT' GROUP BY i.sku_id)
  SELECT s.id FROM sku s LEFT JOIN inventory_balance b ON b.sku_id=s.id LEFT JOIN expected e ON e.sku_id=s.id WHERE b.sku_id IS NULL OR b.reserved::bigint<>coalesce(e.qty,0) OR b.available<0 OR b.reserved<0`],
 ['inventory-source-net',`SELECT s.id FROM inventory_source_line s JOIN inventory_source p ON p.id=s.source_id LEFT JOIN
  (SELECT source_line_id,sum(delta_a::bigint) net FROM inventory_ledger WHERE source_line_id IS NOT NULL GROUP BY source_line_id) l ON l.source_line_id=s.id
  WHERE s.net_posted_quantity::bigint<>coalesce(l.net,0)*CASE WHEN p.source_type='LOSS' THEN -1 ELSE 1 END OR s.net_posted_quantity NOT BETWEEN 0 AND s.verified_quantity`],
 ['inventory-action-ledger-owner',`SELECT l.id FROM inventory_ledger l LEFT JOIN inventory_action a ON a.id=l.action_id WHERE a.id IS NULL OR l.business_type<>a.business_type OR l.business_id<>a.business_id OR l.before_a::bigint+l.delta_a<>l.after_a OR l.before_r::bigint+l.delta_r<>l.after_r`],
 ['inventory-action-facts',`SELECT a.id FROM inventory_action a WHERE CASE a.business_type
  WHEN 'ADJUSTMENT' THEN NOT EXISTS(SELECT 1 FROM inventory_adjustment x WHERE x.id=a.business_id AND x.status='POSTED')
  WHEN 'ORDER' THEN NOT EXISTS(SELECT 1 FROM "order" x WHERE x.id=a.business_id)
  WHEN 'PAYMENT' THEN NOT EXISTS(SELECT 1 FROM payment x WHERE x.id=a.business_id AND x.status='SUCCEEDED')
  WHEN 'RETURN_INSPECTION' THEN NOT EXISTS(SELECT 1 FROM final_inspection x WHERE x.id=a.business_id AND x.inventory_action_id=a.id)
  WHEN 'REFUND' THEN NOT EXISTS(SELECT 1 FROM refund x WHERE x.id=a.business_id AND x.status='SUCCEEDED') ELSE true END`],
 ['inventory-empty-action',`SELECT a.id FROM inventory_action a WHERE NOT EXISTS(SELECT 1 FROM inventory_ledger l WHERE l.action_id=a.id) AND NOT
  (a.action_type='RETURN_RESTOCK' AND EXISTS(SELECT 1 FROM final_inspection f WHERE f.id=a.business_id AND f.inventory_action_id=a.id AND NOT EXISTS(SELECT 1 FROM final_inspection_item i WHERE i.final_inspection_id=f.id AND i.sellable_qty<>0)) OR
   a.action_type='UNSHIPPED_REFUND_RESTOCK' AND EXISTS(SELECT 1 FROM unshipped_physical_check c WHERE c.consumed_refund_id=a.business_id AND c.status='CONSUMED' AND NOT EXISTS(SELECT 1 FROM unshipped_physical_check_item i WHERE i.check_id=c.id AND i.sellable_qty<>0)))`],
 ['order-amounts',`SELECT o.id FROM "order" o LEFT JOIN (SELECT order_id,sum(line_amount_cents::bigint) goods,count(*) n FROM order_item GROUP BY order_id) i ON i.order_id=o.id
  WHERE i.n IS NULL OR i.goods<>o.goods_amount_cents::bigint OR o.goods_amount_cents::bigint+o.shipping_fee_cents<>o.payable_cents
  UNION ALL SELECT id FROM order_item WHERE unit_price_cents::bigint*quantity<>line_amount_cents::bigint`],
 ['order-payment-state',`SELECT o.id FROM "order" o LEFT JOIN payment p ON p.order_id=o.id WHERE
  (o.status IN('WAIT_PAYMENT','CLOSED') AND p.id IS NOT NULL) OR (o.status IN('WAIT_SHIPMENT','SHIPPED','COMPLETED','REFUNDED') AND p.id IS NULL)
  OR p.id IS NOT NULL AND (p.amount_cents<>o.payable_cents OR p.status<>'SUCCEEDED' OR p.actor_customer_id<>o.customer_id OR p.paid_at IS DISTINCT FROM o.paid_at)`],
 ['order-reservation-facts',`SELECT o.id FROM "order" o WHERE NOT EXISTS(SELECT 1 FROM inventory_action a WHERE a.business_type='ORDER' AND a.business_id=o.id AND a.action_type='RESERVE')
  UNION ALL SELECT i.id FROM order_item i WHERE NOT EXISTS(SELECT 1 FROM inventory_ledger l JOIN inventory_action a ON a.id=l.action_id
   WHERE a.business_type='ORDER' AND a.business_id=i.order_id AND a.action_type='RESERVE' AND l.sku_id=i.sku_id GROUP BY l.sku_id HAVING sum(l.delta_a::bigint)=-i.quantity AND sum(l.delta_r::bigint)=i.quantity)`],
 ['payment-stock-facts',`SELECT i.id FROM order_item i JOIN payment p ON p.order_id=i.order_id WHERE NOT EXISTS
  (SELECT 1 FROM inventory_ledger l JOIN inventory_action a ON a.id=l.action_id WHERE a.business_type='PAYMENT' AND a.business_id=p.id AND a.action_type='PAY' AND l.sku_id=i.sku_id
   GROUP BY l.sku_id HAVING sum(l.delta_a::bigint)=0 AND sum(l.delta_r::bigint)=-i.quantity)`],
 ['product-paid-sales',`SELECT p.id FROM product p LEFT JOIN (SELECT i.product_id,sum(i.quantity::bigint) qty FROM order_item i JOIN payment pay ON pay.order_id=i.order_id AND pay.status='SUCCEEDED' GROUP BY i.product_id) q ON q.product_id=p.id WHERE p.paid_sales_count<>coalesce(q.qty,0)`],
 ['refund-payment-ownership',`SELECT r.id FROM refund r LEFT JOIN payment p ON p.id=r.payment_id LEFT JOIN after_sale a ON a.id=r.after_sale_id
  WHERE p.id IS NULL OR a.id IS NULL OR r.order_id<>p.order_id OR a.order_id<>r.order_id OR a.payment_id<>p.id OR r.amount_cents<>p.amount_cents OR r.currency<>p.currency OR a.refund_id IS DISTINCT FROM r.id`],
 ['refund-success-state',`SELECT r.id FROM refund r JOIN "order" o ON o.id=r.order_id JOIN after_sale a ON a.id=r.after_sale_id
  LEFT JOIN refund_attempt t ON t.id=r.successful_attempt_id WHERE r.status='SUCCEEDED' AND
  (o.status<>'REFUNDED' OR a.status<>'SUCCEEDED' OR t.refund_id IS DISTINCT FROM r.id OR t.outcome IS DISTINCT FROM 'SUCCEEDED' OR r.succeeded_at IS NULL OR
   (SELECT count(*) FROM refund_attempt x WHERE x.refund_id=r.id AND x.outcome='SUCCEEDED')<>1)
  UNION ALL SELECT o.id FROM "order" o WHERE o.status='REFUNDED' AND NOT EXISTS(SELECT 1 FROM refund r WHERE r.order_id=o.id AND r.status='SUCCEEDED')
  UNION ALL SELECT a.id FROM after_sale a WHERE a.status='SUCCEEDED' AND NOT EXISTS(SELECT 1 FROM refund r WHERE r.after_sale_id=a.id AND r.status='SUCCEEDED')`],
 ['refund-failure-not-success',`SELECT r.id FROM refund r WHERE r.status<>'SUCCEEDED' AND (r.successful_attempt_id IS NOT NULL OR r.succeeded_at IS NOT NULL OR EXISTS(SELECT 1 FROM refund_attempt t WHERE t.refund_id=r.id AND t.outcome='SUCCEEDED'))`],
 ['final-inspection-quantities',`SELECT i.id FROM final_inspection_item i JOIN final_inspection f ON f.id=i.final_inspection_id JOIN after_sale a ON a.id=f.after_sale_id JOIN order_item o ON o.id=i.order_item_id
  WHERE o.order_id<>a.order_id OR i.purchased_qty<>o.quantity OR i.received_qty<>i.sellable_qty+i.unsellable_qty OR i.purchased_qty<>i.received_qty+i.missing_qty
  UNION ALL SELECT f.id FROM final_inspection f JOIN after_sale a ON a.id=f.after_sale_id WHERE a.final_inspection_id IS DISTINCT FROM f.id OR NOT EXISTS(SELECT 1 FROM final_inspection_item i WHERE i.final_inspection_id=f.id)
  OR EXISTS(SELECT 1 FROM order_item o WHERE o.order_id=a.order_id AND NOT EXISTS(SELECT 1 FROM final_inspection_item i WHERE i.final_inspection_id=f.id AND i.order_item_id=o.id))`],
 ['final-inspection-restock',`SELECT f.id FROM final_inspection f LEFT JOIN inventory_action a ON a.id=f.inventory_action_id WHERE
  a.business_type IS DISTINCT FROM 'RETURN_INSPECTION' OR a.business_id IS DISTINCT FROM f.id OR a.action_type IS DISTINCT FROM 'RETURN_RESTOCK'
  UNION ALL SELECT i.id FROM final_inspection_item i JOIN final_inspection f ON f.id=i.final_inspection_id JOIN order_item o ON o.id=i.order_item_id
  LEFT JOIN (SELECT action_id,sku_id,sum(delta_a::bigint) a,sum(delta_r::bigint) r FROM inventory_ledger GROUP BY action_id,sku_id) l ON l.action_id=f.inventory_action_id AND l.sku_id=o.sku_id
  WHERE coalesce(l.a,0)<>i.sellable_qty OR coalesce(l.r,0)<>0`],
 ['unshipped-refund-consumed-check',`SELECT r.id FROM refund r JOIN after_sale a ON a.id=r.after_sale_id JOIN "order" o ON o.id=r.order_id WHERE r.status='SUCCEEDED' AND a.type='REFUND_ONLY' AND o.actual_handover_at IS NULL AND
  NOT EXISTS(SELECT 1 FROM unshipped_physical_check c WHERE c.id=a.active_unshipped_check_id AND c.after_sale_id=a.id AND c.order_id=o.id AND c.status='CONSUMED' AND c.consumed_refund_id=r.id)
  UNION ALL SELECT c.id FROM unshipped_physical_check c WHERE c.status='CONSUMED' AND NOT EXISTS(SELECT 1 FROM refund r WHERE r.id=c.consumed_refund_id AND r.after_sale_id=c.after_sale_id AND r.order_id=c.order_id AND r.status='SUCCEEDED')`],
 ['unshipped-refund-restock',`SELECT r.id FROM refund r JOIN after_sale a ON a.id=r.after_sale_id JOIN "order" o ON o.id=r.order_id WHERE r.status='SUCCEEDED' AND a.type='REFUND_ONLY' AND o.actual_handover_at IS NULL AND
  (SELECT count(*) FROM inventory_action x WHERE x.business_type='REFUND' AND x.business_id=r.id AND x.action_type='UNSHIPPED_REFUND_RESTOCK')<>1
  UNION ALL SELECT i.id FROM unshipped_physical_check_item i JOIN unshipped_physical_check c ON c.id=i.check_id JOIN order_item o ON o.id=i.order_item_id
  WHERE c.status='CONSUMED' AND (i.purchased_qty<>o.quantity OR i.sellable_qty+i.damaged_qty<>i.purchased_qty OR o.order_id<>c.order_id OR i.sellable_qty<>
   (SELECT coalesce(sum(l.delta_a::bigint),0) FROM inventory_ledger l JOIN inventory_action a ON a.id=l.action_id WHERE a.business_type='REFUND' AND a.business_id=c.consumed_refund_id AND a.action_type='UNSHIPPED_REFUND_RESTOCK' AND l.sku_id=o.sku_id))`],
 ['shipped-refund-no-restock',`SELECT r.id FROM refund r JOIN after_sale a ON a.id=r.after_sale_id JOIN "order" o ON o.id=r.order_id WHERE a.type='REFUND_ONLY' AND o.actual_handover_at IS NOT NULL AND
  (a.final_inspection_id IS NOT NULL OR EXISTS(SELECT 1 FROM inventory_action x WHERE x.business_type='REFUND' AND x.business_id=r.id AND x.action_type='UNSHIPPED_REFUND_RESTOCK'))`],
 ['after-sale-active-unique',`SELECT order_id AS id FROM after_sale WHERE status NOT IN('SUCCEEDED','REJECTED','CLOSED','WITHDRAWN') GROUP BY order_id HAVING count(*)>1`],
 ['task-active-unique',`SELECT business_id AS id FROM task WHERE status IN('OPEN','CLAIMED','SUSPENDED') GROUP BY business_type,business_id,stage HAVING count(*)>1`],
 ['task-cursor-round',`SELECT t.id FROM task t LEFT JOIN task_stage_cursor c ON c.id=t.cursor_id WHERE c.id IS NULL OR c.business_type<>t.business_type OR c.business_id<>t.business_id OR c.stage<>t.stage OR t.round>c.last_round
  UNION ALL SELECT c.id FROM task_stage_cursor c LEFT JOIN (SELECT cursor_id,max(round) max_round FROM task GROUP BY cursor_id) rounds ON rounds.cursor_id=c.id WHERE c.last_round<>coalesce(rounds.max_round,0)`],
 ['task-source-lifecycle',`SELECT s.id FROM task_business_source s LEFT JOIN task t ON t.id=s.task_id WHERE t.id IS NULL OR s.status='ACTIVE' AND t.status IN('COMPLETED','CANCELLED') OR (s.status='ACTIVE')<>(s.ended_at IS NULL)`],
 ['handover-pending-unique',`SELECT order_id AS id FROM handover_attempt WHERE status IN('IN_PROGRESS','UNCERTAIN') GROUP BY order_id HAVING count(*)>1`],
 ['timer-active-unique',`SELECT order_id AS id FROM timer_pause WHERE status='ACTIVE' GROUP BY order_id HAVING count(*)>1`],
 ['file-reference-state',`SELECT r.id FROM file_reference r JOIN file_asset f ON f.id=r.file_asset_id WHERE f.state<>'RETAINED'`],
 ['file-order-snapshot',`SELECT i.id FROM order_item i WHERE i.image_asset_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM file_reference r WHERE r.owner_type='ORDER_ITEM' AND r.owner_id=i.id AND r.file_asset_id=i.image_asset_id AND r.slot='snapshot' AND r.audience='PUBLIC')`],
];

export async function checkFile(asset,root){
 try{
  if(!/^(objects\/[0-9a-f-]{36}\.(jpg|png|webp)|tmp\/[0-9a-f-]{36}\.part)$/.test(asset.storage_key))return false;
  const resolved=path.resolve(root,asset.storage_key),relative=path.relative(path.resolve(root),resolved);if(relative.startsWith('..')||path.isAbsolute(relative))return false;
  let current=path.parse(resolved).root;for(const segment of path.relative(current,resolved).split(path.sep)){current=path.join(current,segment);const info=await lstat(current);if(info.isSymbolicLink())return false;}
  const stat=await lstat(resolved);if(!stat.isFile()||stat.size!==asset.byte_size)return false;
  const hash=createHash('sha256');for await(const chunk of createReadStream(resolved))hash.update(chunk);
  const after=await lstat(resolved);return after.isFile()&&!after.isSymbolicLink()&&after.size===stat.size&&after.mtimeMs===stat.mtimeMs&&hash.digest('hex')===asset.sha256;
 }catch{return false;}
}

export async function runReconcile({client,uploadsRoot,scope}){
 assert.ok(client&&typeof client.query==='function');assert.ok(path.isAbsolute(uploadsRoot),'必须传入明确上传根目录');
 const checks=[],add=(code,ids,count=ids.length,detail)=>checks.push({code,passed:BigInt(count)===0n,violationCount:String(count),sampleBusinessIds:[...new Set(ids)].slice(0,10),...(detail?{detail}:{})});
 await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{
  await client.query("SET LOCAL statement_timeout='120s'");await client.query("SET LOCAL timezone='UTC'");
  const mode=(await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only;assert.equal(mode,'on');
  for(const [code,sql]of rules){const result=await client.query(`WITH violations AS (${sql}) SELECT count(*)::text AS n,coalesce((SELECT jsonb_agg(id) FROM(SELECT DISTINCT id::text id FROM violations ORDER BY id LIMIT 10) sample),'[]'::jsonb) ids FROM violations`);const row=result.rows[0];add(code,row.ids,row.n);}
  for(const [type,table]of Object.entries(businessTables)){const result=await client.query(`SELECT t.id FROM task t WHERE t.business_type=$1 AND NOT EXISTS(SELECT 1 FROM ${ident(table)} b WHERE b.id=t.business_id)`,[type]);add('task-business-'+type,result.rows.map(r=>r.id));}
  for(const [type,table]of Object.entries(owners)){const result=await client.query(`SELECT r.id FROM file_reference r WHERE r.owner_type=$1 AND NOT EXISTS(SELECT 1 FROM ${ident(table)} b WHERE b.id=r.owner_id)`,[type]);add('file-owner-'+type,result.rows.map(r=>r.id));}
  const invalid=[],balances=new Map((await client.query('SELECT sku_id,available,reserved FROM inventory_balance')).rows.map(r=>[r.sku_id,r]));
  await client.query('DECLARE m415_ledgers NO SCROLL CURSOR FOR SELECT sku_id,action_id,sequence,before_a,before_r,after_a,after_r,delta_a,delta_r FROM inventory_ledger ORDER BY sku_id,action_id,sequence');
  let sku=null,rows=[];const finish=()=>{if(sku&&!verifyInventoryChain(rows,balances.get(sku)??{available:-1,reserved:-1}))invalid.push(sku);if(sku)balances.delete(sku);};
  for(;;){const page=await client.query('FETCH FORWARD 2000 FROM m415_ledgers');if(!page.rows.length)break;for(const row of page.rows){if(sku!==row.sku_id){finish();sku=row.sku_id;rows=[];}rows.push(row);}}
  finish();await client.query('CLOSE m415_ledgers');for(const [id,balance]of balances)if(balance.available!==0||balance.reserved!==0)invalid.push(id);
  add('inventory-reconstructable-action-chain',invalid,invalid.length,'每动作每SKU按sequence压边，全部边从A0/R0连至余额；不推断唯一真实时序，不以balance.version等同流水条数');
  const badFiles=[];let assets=0;await client.query("DECLARE m415_files NO SCROLL CURSOR FOR SELECT id,state,storage_key,byte_size,sha256 FROM file_asset WHERE state IN('RETAINED','STAGED') ORDER BY id");
  for(;;){const page=await client.query('FETCH FORWARD 200 FROM m415_files');if(!page.rows.length)break;for(const asset of page.rows){assets++;if(!await checkFile(asset,uploadsRoot))badFiles.push(asset.id);}}
  await client.query('CLOSE m415_files');add('file-retained-and-staged-content',badFiles,badFiles.length,'核对全部RETAINED/STAGED实际普通文件与字节/SHA；STAGED可无引用，PURGED无需物理文件');
  await client.query('COMMIT');return {schemaVersion:1,checkedAt:new Date().toISOString(),scope,readOnly:true,isolation:'REPEATABLE READ',fileAssetsChecked:assets,checks,status:checks.every(check=>check.passed)?'passed':'failed'};
 }catch(error){await client.query('ROLLBACK');throw error;}
}

async function main(){
 const args=process.argv.slice(2).filter(v=>v!=='--'),allowed=new Set(['--target','--env-file','--output']),values={};
 for(let i=0;i<args.length;i+=2){assert.ok(allowed.has(args[i])&&args[i+1]&&!values[args[i]],'参数不完整/重复/未知');values[args[i]]=args[i+1];}
 const target=values['--target'];assert.ok(['test','restore'].includes(target));assert.ok(values['--env-file']&&values['--output']);
 const selected=path.resolve(values['--env-file']),config=parseEnv(await readFile(selected,'utf8'));
 assert.equal(config.ISOLATED_TARGET,target);const url=new URL(config.DATABASE_URL);assert.ok(['postgres:','postgresql:'].includes(url.protocol));
 const name=decodeURIComponent(url.pathname.slice(1));assert.equal(config.ISOLATED_DATABASE_NAME,name);assert.match(name,/^m415_[a-z0-9_]+$/);assert.ok(!['postgres','template0','template1','self_ecom_dev','acceptance_dev'].includes(name));
 assert.ok(config.UPLOAD_DIR&&path.isAbsolute(config.UPLOAD_DIR));
 const require=createRequire(new URL('../apps/api/package.json',import.meta.url)),{Client}=require('pg');
 const client=new Client({connectionString:url.toString(),connectionTimeoutMillis:5000,application_name:'m415-reconcile'});await client.connect();
 try{assert.equal((await client.query('SELECT current_database() name')).rows[0].name,name);const report=await runReconcile({client,uploadsRoot:config.UPLOAD_DIR,scope:{target,database:name}});
  const output=path.resolve(values['--output']),handle=await open(output,'wx',0o600);await handle.close();await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,checks:report.checks.length,violations:report.checks.filter(c=>!c.passed).map(c=>({code:c.code,count:c.violationCount})),output}));if(report.status!=='passed')process.exitCode=1;
 }finally{await client.end();}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(JSON.stringify({status:'failed',errorCode:/^[A-Z0-9_]+$/.test(error.code??'')?error.code:'RECONCILE_REJECTED'}));process.exitCode=1;});
