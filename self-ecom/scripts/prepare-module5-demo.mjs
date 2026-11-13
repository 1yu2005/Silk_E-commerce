// 作用：受控初始化一个新的仓储演示账号，再通过正式HTTP创建零库存服装草稿；密码只输出到当前终端。
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseEnv} from 'node:util';
assert.equal(process.argv[2],'--development');
const require=createRequire(resolve('apps/api/package.json'));require('reflect-metadata');
const env={...parseEnv(readFileSync('.env','utf8')),...process.env};
const output='docs/verification/evidence/M1-05/development-demo.json';assert.ok(!existsSync(output),'演示数据已创建，不重复初始化');
const baseline=JSON.parse(readFileSync('docs/verification/evidence/M1-05/baseline.json','utf8'));
assert.equal(createHash('sha256').update(readFileSync('.env')).digest('hex'),baseline.protectedFiles['.env']);
const {PrismaService}=require('./dist/prisma/prisma.service.js'),{loadConfiguration}=require('./dist/config/environment.js');
const {PasswordService}=require('./dist/auth/password.service.js'),{AuditService}=require('./dist/audit/audit.service.js');
const db=new PrismaService(loadConfiguration(env)),passwords=new PasswordService();
const username='m105_warehouse',password=env.M105_DEMO_PASSWORD??('Wear#'+randomBytes(15).toString('base64url'));
const origin='http://localhost:'+(env.API_HOST_PORT??3000);const report={at:new Date().toISOString(),origin,account:{username,role:'MERCH_WAREHOUSE',purpose:'板块5分类与服装草稿演示，密码仅当前对话或终端交付'},requests:[],products:[],sources:[]};
let token,initialized=false;
const call=async(endpoint,method='GET',body,expected=200)=>{const r=await fetch(origin+'/api/v1'+endpoint,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const json=await r.json();report.requests.push({endpoint,method,status:r.status,requestId:r.headers.get('x-request-id')});assert.equal(r.status,expected,endpoint+' '+json.code);return json.data;};
try{
  const migrations=await db.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;assert.equal(migrations.length,5);
  assert.equal((await fetch(origin+'/api/v1/health/ready')).status,200);
  const hash=await passwords.hash(password);let account=await db.employee.findUnique({where:{username}});
  if(account){assert.ok(env.M105_DEMO_PASSWORD&&await passwords.verify(password,account.passwordHash),'不覆盖已存在账号或密码');}
  else{account=await db.$transaction(async tx=>{const row=await tx.employee.create({data:{username,displayName:'服装商品演示仓储',role:'MERCH_WAREHOUSE',passwordHash:hash,mustChangePassword:false}});await new AuditService().appendAudit(tx,{actor:{type:'SYSTEM'},action:'employee.create',targetId:row.id,requestId:randomUUID(),reason:'板块5用户授权的独立仓储演示账号初始化',after:{username:row.username,displayName:row.displayName,role:row.role,status:row.status,mustChangePassword:row.mustChangePassword}});return row;});}
  initialized=true;report.account.id=account.id;
  token=(await call('/admin/auth/login','POST',{username,password})).accessToken;
  const root=await call('/admin/categories','POST',{name:'服装',iconKey:'clothes'},201);
  const top=await call('/admin/categories','POST',{name:'上衣',parentId:root.id,iconKey:'top'},201);
  const tee=await call('/admin/categories','POST',{name:'T恤',parentId:top.id,iconKey:'top'},201);
  const coat=await call('/admin/categories','POST',{name:'外套',parentId:root.id,iconKey:'coat'},201);
  for(const item of [
    {name:'日常纯棉T恤',categoryId:tee.id,colors:['白色','黑色'],sizes:['S','M','L'],price:9900,cost:4500,file:'output/assets/M1-05/tshirt-unsplash.jpg',source:'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab',image:'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab'},
    {name:'简约拉链外套',categoryId:coat.id,colors:['黑色'],sizes:['M','L'],price:29900,cost:15000,file:'output/assets/M1-05/jacket-unsplash.jpg',source:'https://images.unsplash.com/photo-1551028719-00167b16eac5',image:'https://images.unsplash.com/photo-1551028719-00167b16eac5'},
  ]){
    let p=await call('/admin/products','POST',{name:item.name,categoryId:item.categoryId,brand:'EVERYDAY',description:'开发演示款式，商品图来源Unsplash。已建立颜色与尺码、售价与数量草稿；库存登记尚未确认，因此当前不可售。'},201);
    const dimensions=[item.colors,item.sizes].map((values,i)=>({clientKey:randomUUID(),name:i?'尺码':'颜色',values:values.map(name=>({clientKey:randomUUID(),name}))}));
    p=await call(`/admin/products/${p.id}/sku-scheme`,'PUT',{expectedVersion:p.version,mode:'REBUILD',reason:'建立服装演示颜色尺码',dimensions});const skuIds=p.skus.filter(s=>!s.retiredAt).map(s=>s.id);
    p=await call(`/admin/products/${p.id}/skus/batch-fill`,'POST',{expectedVersion:p.version,skuIds,priceCents:item.price,costCents:item.cost});
    const bytes=readFileSync(item.file),form=new FormData();form.append('purpose','PRODUCT_IMAGE');form.append('file',new Blob([bytes],{type:'image/jpeg'}),'product-demo.jpg');
    const r=await fetch(origin+'/api/v1/files',{method:'POST',headers:{Authorization:'Bearer '+token},body:form});const uploaded=await r.json();assert.equal(r.status,201);report.requests.push({endpoint:'/files',method:'POST',status:r.status,requestId:r.headers.get('x-request-id')});
    p=await call(`/admin/products/${p.id}/images`,'PUT',{expectedVersion:p.version,mainImageId:uploaded.data.id,galleryImageIds:[]});
    p=await call(`/admin/products/${p.id}/initial-inventory-draft`,'PUT',{expectedProductVersion:p.version,expectedDraftVersion:null,lines:skuIds.map(skuId=>({skuId,quantity:12}))});
    assert.equal(p.status,'DRAFT');assert.ok(p.skus.every(s=>s.available===0&&s.reserved===0));
    report.products.push({id:p.id,name:p.name,currentSkus:skuIds.length,status:p.status,available:0,reserved:0,imageId:uploaded.data.id,version:p.version});
    report.sources.push({name:p.name,file:item.file,image:item.image,source:item.source,sha256:createHash('sha256').update(bytes).digest('hex'),use:'开发演示图，通过PRODUCT_IMAGE上传与正式商品绑定，不代表真实品牌或销售承诺'});
  }
  assert.equal((await call('/store/products')).total,0);report.passed=true;writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:true,products:report.products,account:report.account}));
}finally{await db.$disconnect();if(initialized)console.log('PRIVATE_CREDENTIAL='+JSON.stringify({username,password}));}
