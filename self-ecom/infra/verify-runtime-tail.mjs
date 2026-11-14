// 作用：仅补齐首轮中断后的持久化、JWT到期、上传限额及生产运行边界，不触碰开发库。
/* global document, innerWidth */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function verifyRuntimeTail(c) {
  const { origin, storeOrigin, adminToken, browser, call, passed, requests, output, compose, env,
    pageErrors, secrets, redact, run, imagePrefix, adminUsername, adminPassword } = c;
  const request=(url,method='GET',body,token=adminToken,status=200,code)=>call(origin,url,method,body,token,status,code);
  const query=sql=>compose(['exec','-T','db','psql','-v','ON_ERROR_STOP=1','-U',env.POSTGRES_USER,'-d',env.POSTGRES_DB,'-Atc',sql],'独占库只读核对').stdout.trim();
  const password='Tail#'+randomBytes(20).toString('hex');secrets.push(password);
  const phones=['138'+String(BigInt('0x'+randomBytes(6).toString('hex'))%100000000n).padStart(8,'0'),
    '139'+String(BigInt('0x'+randomBytes(6).toString('hex'))%100000000n).padStart(8,'0')];
  const customers=[];
  for(const phone of phones){await call(storeOrigin,'/store/auth/register','POST',{phone,password,nickname:'隔离尾项验收'},undefined,201);customers.push(await call(storeOrigin,'/store/auth/login','POST',{phone,password}));}
  const token=customers[0].accessToken;
  const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
  const png=await require('sharp')({create:{width:96,height:96,channels:3,background:'#528879'}}).png().toBuffer();
  const digest=b=>createHash('sha256').update(b).digest('hex');
  async function upload(purpose,actor=token,bytes=png,status=201,code){
    const body=new FormData();body.append('purpose',purpose);body.append('file',new Blob([bytes],{type:'image/png'}),'tail.png');
    const r=await fetch(origin+'/api/v1/files',{method:'POST',headers:{Authorization:'Bearer '+actor},body});const j=await r.json();
    requests.push({method:'POST',path:'/files',status:r.status,requestId:j.requestId,...(code?{code}:{})});
    assert.equal(r.status,status);assert.equal(j.requestId,r.headers.get('x-request-id'));if(code)assert.equal(j.code,code);
    if(status===429)assert.ok(Number(r.headers.get('retry-after'))>=1);return j.data;
  }
  const avatar=await upload('CUSTOMER_AVATAR'),evidence=await upload('AFTER_SALE_EVIDENCE');
  await call(storeOrigin,'/store/me/avatar','PUT',{fileId:avatar.id},token);
  const picture=await upload('PRODUCT_IMAGE',adminToken);
  const category=await request('/admin/categories','POST',{name:'尾项持久化服装'},adminToken,201);
  let product=await request('/admin/products','POST',{name:'仅隔离持久化草稿',categoryId:category.id,description:'不制造正余额'},adminToken,201);
  product=await request('/admin/products/'+product.id+'/images','PUT',{expectedVersion:product.version,mainImageId:picture.id,galleryImageIds:[]});
  const skuId=product.skus[0].id;
  product=await request('/admin/products/'+product.id+'/initial-inventory-draft','PUT',{expectedProductVersion:product.version,expectedDraftVersion:null,lines:[{skuId,quantity:12}]});
  const draft=await request('/admin/products/'+product.id+'/initial-inventory-draft');
  const setting={expectedVersion:0,reason:'尾项持久化准备',shippingFeeCents:29,freeShippingEnabled:false,freeShippingThresholdCents:9901,
    returnAddress:{receiver:'隔离仓库',phone:'01000000000',province:'测试省',city:'测试市',district:'测试区',detail:'仅独占环境'},
    serviceContact:{phone:'01000000000',serviceHours:'09:00～18:00'},
    deadlines:{paymentMinutes:30,autoReceiptDays:10,afterSaleWindowDays:7,reviewWorkdays:2,supplementDays:7,returnShipDays:7,inspectionWorkdays:2,refundWorkdays:1}};
  const first=await request('/admin/settings','PUT',setting);const oldVersion=await request('/admin/settings/versions/'+first.settingVersionId);
  await request('/admin/settings','PUT',{...setting,expectedVersion:1,shippingFeeCents:222,reason:'持久化当前版本与历史'});
  const beforeProduct=await request('/admin/products/'+product.id);
  async function images(){for(const site of [origin,storeOrigin])for(const [asset,actor]of [[avatar,null],[picture,null],[evidence,token]]){
    const r=await fetch(site+asset.contentUrl,{headers:actor?{Authorization:'Bearer '+actor}:{}});assert.equal(r.status,200);assert.equal(digest(Buffer.from(await r.arrayBuffer())),digest(png));
    if(actor)assert.equal((await fetch(site+asset.contentUrl)).status,404);
  }}
  await images();
  const admin=await browser.newPage({viewport:{width:1440,height:1000}}),store=await browser.newPage({viewport:{width:390,height:844}});
  for(const page of [admin,store])page.on('pageerror',e=>pageErrors.push(e.name));
  await admin.goto(origin+'/login');await admin.getByLabel('员工账号',{exact:true}).fill(adminUsername);await admin.getByLabel('密码',{exact:true}).fill(adminPassword);await admin.locator('form button[type=submit]').click();await admin.waitForURL(origin+'/');
  await admin.getByRole('link',{name:'员工管理',exact:true}).click();await admin.getByRole('link',{name:'创建员工',exact:true}).waitFor();await admin.screenshot({path:path.join(output,'tail-employees.png'),fullPage:true});
  await store.goto(storeOrigin+'/login');await store.getByLabel('手机号',{exact:true}).fill(phones[0]);await store.getByLabel('密码',{exact:true}).fill(password);await store.locator('form button[type=submit]').click();await store.waitForURL(u=>u.pathname!=='/login');await store.goto(storeOrigin+'/account');await store.locator('.account-panel').getByText('隔离尾项验收',{exact:true}).waitFor();assert.ok(await store.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await store.screenshot({path:path.join(output,'tail-customer-mobile.png'),fullPage:true});
  await admin.close();await store.close();passed('尾项：Nginx员工与顾客真实登录/账号页、手机布局，无浏览器运行错误');
  return {
    async verifyPersistence(){
      await request('/admin/me');assert.equal((await call(storeOrigin,'/store/me','GET',undefined,token)).avatarUrl,avatar.contentUrl);
      await images();assert.equal(query(`SELECT count(*) FROM file_reference WHERE file_asset_id='${avatar.id}'::uuid`),'1');
      assert.deepEqual(await request('/admin/products/'+product.id),beforeProduct);assert.deepEqual(await request('/admin/products/'+product.id+'/initial-inventory-draft'),draft);
      assert.equal(beforeProduct.skus[0].available,0);assert.equal(beforeProduct.skus[0].reserved,0);
      assert.equal((await request('/admin/settings')).currentSetting.shippingFeeCents,222);assert.deepEqual(await request('/admin/settings/versions/'+first.settingVersionId),oldVersion);
      assert.equal((await call(storeOrigin,'/store/contact')).settingsVersion,2);assert.equal(query("SELECT count(*) FROM audit_log WHERE action='store.setting.update'"),'2');
      passed('尾项：DB/API重启及API重建，原双域会话、头像/私图摘要与引用、设置/历史/审计、商品/SKU/草稿/图片均保持');
    },
    async verifyLimitsAndRuntime(){
      env.JWT_TTL_SECONDS='3';env.FILE_STAGED_QUOTA='1';env.FILE_UPLOADS_PER_MINUTE='2';
      compose(['up','-d','--no-deps','--force-recreate','--wait','--wait-timeout','90','api'],'仅专属API使用三秒JWT和小配额');
      for(let i=0;i<60;i++){try{if((await fetch(origin+'/api/v1/health/ready')).status===200)break;}catch{/* 等待代理恢复 */}await new Promise(r=>setTimeout(r,300));}
      await upload('CUSTOMER_AVATAR',token,png,429,'FILE_QUOTA_EXCEEDED');
      for(let i=0;i<2;i++)await upload('CUSTOMER_AVATAR',customers[1].accessToken,Buffer.from('fake'),400,'FILE_TYPE_NOT_ALLOWED');
      await upload('CUSTOMER_AVATAR',customers[1].accessToken,png,429,'FILE_RATE_LIMITED');await call(storeOrigin,'/store/me','GET',undefined,customers[1].accessToken);
      passed('尾项：真实配额/频率429、Retry-After≥1、正常本人查询200');
      const shortAdmin=await request('/admin/auth/login','POST',{username:adminUsername,password:adminPassword},undefined);
      const shortCustomer=await call(storeOrigin,'/store/auth/login','POST',{phone:phones[0],password});
      await request('/admin/me','GET',undefined,shortAdmin.accessToken);await call(storeOrigin,'/store/me','GET',undefined,shortCustomer.accessToken);
      await new Promise(r=>setTimeout(r,Math.max(0,Math.max(Date.parse(shortAdmin.expiresAt),Date.parse(shortCustomer.expiresAt))-Date.now()+200)));
      await request('/admin/me','GET',undefined,shortAdmin.accessToken,401,'TOKEN_EXPIRED');await call(storeOrigin,'/store/me','GET',undefined,shortCustomer.accessToken,401,'TOKEN_EXPIRED');
      passed('尾项：三秒真实JWT两个登录域均本人200→自然到期401 TOKEN_EXPIRED');
      assert.equal(compose(['exec','-T','api','id','-u'],'非root运行').stdout.trim(),'1000');
      compose(['exec','-T','api','node','-e',"const f=require('node:fs');for(const p of ['/app/.env','/app/output','/app/private-delivery','/app/test','/app/dist/acceptance'])if(f.existsSync(p))process.exit(1)"],'镜像无真实配置/证据/私有交付/测试适配器');
      const migrations=(await readdir('apps/api/prisma/migrations',{withFileTypes:true})).filter(e=>e.isDirectory()).length;assert.equal(migrations,6);
      assert.equal(query('SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'),String(migrations));
      for(const suffix of ['api','admin','store']){const imageEnv=run(['image','inspect','--format','{{json .Config.Env}}',imagePrefix+'-'+suffix+':local'],'镜像配置秘密扫描').stdout;assert.ok(!secrets.some(s=>imageEnv.includes(s)));}
      for(const site of [origin,storeOrigin]){const html=await(await fetch(site)).text();for(const asset of [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(m=>m[1])){const body=await(await fetch(site+asset)).text();assert.ok(!secrets.some(s=>body.includes(s)));}}
      const logs=compose(['logs','--no-color','api'],'运行日志秘密扫描');const text=(logs.stdout??'')+(logs.stderr??'');assert.ok(!secrets.some(s=>text.includes(s)));await writeFile(path.join(output,'runtime.log'),redact(text));
      const doc=JSON.parse(await readFile('docs/openapi/openapi.json','utf8'));assert.equal(Object.values(doc.paths).reduce((n,p)=>n+Object.keys(p).length,0),85);
      passed('尾项：六迁移、API非root、生产镜像边界、镜像/前端产物/运行日志秘密扫描');
    }
  };
}
