// 作用：板块6交付前只读核对运行/账务/证据/文件保护和Git状态，生成可追溯摘要，不重复全量测试。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
const directory='docs/verification/evidence/M1-06';
const env={...parseEnv(readFileSync('.env','utf8')),...process.env};
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const filesUnder=p=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?filesUnder(path.join(p,e.name)):[path.join(p,e.name)]);
const git=args=>{const r=spawnSync('git',args,{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,'Git只读检查失败');return r.stdout;};
const privateFile='private-delivery/板块6_开发完成说明_含账号密码.local.md';
const publicFile='项目文档/开发进度文档/开发完成说明/板块6_开发完成说明.md';
const changed=git(['ls-files','-m','-o','--exclude-standard','-z']).split('\0').filter(Boolean);
const candidates=[...new Set([...changed,...filesUnder('output/playwright/M1-06'),...filesUnder('output/build/M1-06'),privateFile])].filter(existsSync);

if(process.argv.includes('--credential-scan')){
  // 已有密码仅从标准输入读取，不输出值或命中上下文；公开seed默认值不作为本次新增秘密。
  const credential=JSON.parse(readFileSync(0,'utf8'));const secret=credential.warehouse;assert.ok(secret?.length>16);
  const found=candidates.filter(p=>readFileSync(p).includes(Buffer.from(secret)));
  const report={at:new Date().toISOString(),fileCount:candidates.length,originalWarehousePasswordAbsent:found.length===0,foundPaths:found,existingPublicSeedDefaultExcluded:true};
  writeFileSync(directory+'/credential-scan.json',JSON.stringify(report,null,2)+'\n');assert.deepEqual(found,[]);console.log(JSON.stringify(report));
}else{
  const report={at:new Date().toISOString(),checks:[],commands:[],runtime:[],documents:[],git:{}};
  const passed=s=>report.checks.push(s);
  const expected=read('docs/openapi/openapi.json');
  const docker=env.DOCKER_EXECUTABLE??'docker';
  function run(executable,args,label){const r=spawnSync(executable,args,{env,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});report.commands.push({label,exitCode:r.status,error:r.error?.code});assert.equal(r.status,0,label);return r.stdout;}
  const compose=args=>run(docker,['compose','--env-file','.env','-f','infra/compose.yaml',...args],'只读常用Compose');
  const {Client}=createRequire(path.resolve('apps/api/package.json'))('pg');const db=new Client({connectionString:env.DATABASE_URL});
  try{
    const requiredPassed=['api-unit-swagger-update2','inventory-final-core1','inventory-migration-upgrade1','integration-inventory-reconciliation-scope1','types-post-regression1','lint-delivery1','build-final1','contracts-final1','deployment','deployed-persistence','protection-check-migrated-retry1','protection-check-final-final2','development-demo-run2'];
    for(const label of requiredPassed)assert.equal(read(directory+'/'+label+'.json').passed,true,label);
    assert.equal(read(directory+'/integration-full1.json').passed,false);assert.equal(read(directory+'/integration-failed-suites1.json').passed,false);
    for(const folder of ['docker-inventory-focus1','docker-runtime-tail1']){const e=read('output/playwright/M1-06/'+folder+'/result.json');assert.equal(e.status,'passed');assert.equal(e.cleaned,true);assert.equal(e.originalResourcesPreserved,true);assert.deepEqual(e.pageErrors,[]);}
    assert.equal(read('output/playwright/M1-06/final-copy/result.json').passed,true);assert.equal(read(directory+'/credential-scan.json').originalWarehousePasswordAbsent,true);
    passed('既有成功证据、首轮失败及定向复验状态均保留，无重复累计');
    const lintPaths=['infra/verify-inventory-compose.mjs','infra/verify-runtime-tail.mjs',...changed.filter(p=>/^scripts\/.*module6.*\.mjs$/.test(p))];
    run(process.execPath,['node_modules/eslint/bin/eslint.js',...new Set(lintPaths)],'新增交付脚本定向Lint');passed('最近新增或修改的验收/交付脚本Lint通过');
    for(const origin of ['http://localhost:3000','http://localhost:3001','http://localhost:5173','http://localhost:5174','http://localhost:8080','http://localhost:8081']){
      const health=await fetch(origin+'/api/v1/health/ready',{signal:AbortSignal.timeout(5000)});assert.equal(health.status,200,origin+'健康检查');
      const doc=await(await fetch(origin+'/api/docs-json')).json();assert.deepEqual(doc,expected);report.runtime.push({origin,readyStatus:health.status,operations:85,contractEqual:true});
    }
    const containers=compose(['ps','--format','json']).trim().split('\n').map(JSON.parse);assert.equal(containers.length,4);assert.ok(containers.every(c=>c.State==='running'&&c.Health==='healthy'));
    report.containers=containers.map(c=>({id:c.ID,service:c.Service,health:c.Health}));
    const id=compose(['ps','-q','db']).trim();const state=JSON.parse(run(docker,['inspect','--format','{{json .}}',id],'只读数据库容器身份'));
    report.database={id:state.Id,startedAt:state.State.StartedAt,mounts:state.Mounts.map(m=>({name:m.Name,destination:m.Destination}))};
    assert.deepEqual(report.database,read(directory+'/deployed-persistence.json').afterDatabase);
    const accepted=read('output/playwright/M1-06/docker-runtime-tail1/result.json').acceptedImages;
    report.images=[];
    for(const [service,index]of [['api',0],['admin-web',1],['store-web',2]]){const container=containers.find(c=>c.Service===service);const current=run(docker,['inspect','--format','{{.Image}}',container.ID],'核对当前应用镜像').trim();assert.equal(current,accepted[index].id);report.images.push({service,id:current});}
    passed('常用四服务healthy，原DB容器/启动时间/两卷保持，同组镜像及六入口85操作契约一致');
    await db.connect();assert.equal(Number((await db.query('SELECT count(*) AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows[0].n),6);
    const demo=read(directory+'/development-demo-run2.json');let total=0;
    for(const p of demo.products){
      const skuIds=p.after.map(s=>s.id);const balances=(await db.query('SELECT available,reserved FROM inventory_balance WHERE sku_id=ANY($1::uuid[])',[skuIds])).rows;assert.equal(balances.length,skuIds.length);assert.ok(balances.every(b=>b.available===12&&b.reserved===0));total+=balances.reduce((n,b)=>n+b.available,0);
      assert.equal(Number((await db.query('SELECT count(*) AS n FROM inventory_ledger WHERE business_id=$1::uuid',[p.adjustmentId])).rows[0].n),skuIds.length);
      for(const origin of ['http://localhost:5174','http://localhost:8081']){const product=(await(await fetch(origin+'/api/v1/store/products/'+p.id)).json()).data;assert.equal(product.availableQuantity,String(skuIds.length*12));assert.ok(product.skus.every(s=>s.available===12&&s.purchasable));assert.ok(product.description.includes('演示数量已通过正式库存登记确认'));}
    }
    assert.equal(total,96);report.demonstration={currentSkus:8,available:96,reserved:0,postedAdjustments:2,ledger:8,method:'正式业务命令，来源为显式演示资料'};passed('六迁移已应用，8SKU各A12/R0及2登记8流水保持，两商品仍公开且介绍一致');
    for(const [p,hash]of Object.entries(read(directory+'/protection-before.json').files))assert.equal(createHash('sha256').update(readFileSync(p)).digest('hex'),hash,p+'保护摘要');
    assert.equal(git(['diff','--cached','--name-only']).trim(),'');assert.equal(git(['branch','--show-current']).trim(),'main');
    assert.equal(git(['rev-parse','HEAD']).trim(),'d3faebdd906e5a118c128ebf33650284b03c2856');
    assert.equal(run('git',['check-ignore','-q','--',privateFile],'私有说明忽略规则'),'');assert.equal(git(['ls-files','--',privateFile]).trim(),'');assert.match(readFileSync('.dockerignore','utf8'),/^private-delivery\r?$/m);
    const publicText=readFileSync(publicFile,'utf8');const privateText=readFileSync(privateFile,'utf8').replace(/^\uFEFF/,'').replaceAll('\r\n','\n').trimEnd();
    assert.equal(privateText,publicText.replace('# 板块6开发完成说明','# 板块6开发完成说明（本机私有完整副本）').replaceAll('../../../','../').replaceAll('\r\n','\n').trimEnd());
    report.git={branch:'main',head:git(['rev-parse','HEAD']).trim(),stagedFiles:0,changedFiles:changed.length,status:'未暂存/提交/推送'};
    passed('真实.env/旧迁移摘要不变；私有说明完整且Git/Docker排除；暂存区为空，HEAD保持');
    const secrets=Object.entries(env).filter(([k,v])=>/^(JWT_SECRET|POSTGRES_PASSWORD|DATABASE_URL)$/.test(k)&&v?.length>8).map(([,v])=>v);
    const exposed=[];for(const p of candidates){const bytes=readFileSync(p);if(secrets.some(s=>bytes.includes(Buffer.from(s)))||/eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(bytes.toString('utf8')))exposed.push(p);}
    assert.deepEqual(exposed,[]);report.secretScan={fileCount:candidates.length,foundPaths:exposed,originalCredentialEvidence:directory+'/credential-scan.json'};passed('变更及本轮证据/构建未发现原仓储密码、真实密钥/连接串或JWT');
    const summary={at:new Date().toISOString(),status:'checking',module:'M1-06',ordinaryTests:{unique:756,api:492,shared:19,apiClient:133,admin:75,store:37,firstRunApiFailed:true,finalApiPassed:true},integration:{unique:1417,initial:{passed:1194,failed:3,notExecuted:220},targetedFirst:{passed:267,failed:1,total:268},targetedFinal:{passed:28,total:28},allUniqueHavePassingEvidence:true,fullRunRepeated:false},docker:{initial:{passedGroups:20,http:183,status:'failed'},inventoryContinuation:{groups:6,http:30,status:'passed'},runtimeContinuation:{groups:6,http:36,status:'passed'},overlapNotSummed:true},demonstration:report.demonstration,originalMembersPreserved:true,newRetainedMembers:0,appliedMigration:'0006_inventory_sources_adjustments_ledger',operations:85,generatedJsonCallers:83,git:report.git,verification:'docs/verification/M1-06.md',deliveryChecks:directory+'/delivery-checks.json',notExecuted:['本轮板块6远程CI','失败处理后再次整套集成重跑'],future:['板块6 SW-L01在8～9','板块6 SW-L02在12','板块5 SW-L02在8＋9','完整购买闭环、性能与备份恢复']};
    writeFileSync(directory+'/final-summary.json',JSON.stringify(summary,null,2)+'\n');writeFileSync(directory+'/delivery-checks.json',JSON.stringify(report,null,2)+'\n');
    const docs=['README.md','项目文档/开发进度总览.md','docs/design/M1-06.md','docs/verification/M1-06.md','docs/verification/M1-05.md','项目文档/开发进度文档/M1_商品可售/06_板块6_库存入账与记账内核.md',publicFile,privateFile];
    const missing=[];for(const p of docs){const text=readFileSync(p,'utf8');let count=0;for(const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){let target=m[1];if(/^(https?:|#|mailto:)/.test(target))continue;target=decodeURIComponent(target.replace(/^<|>$/g,'').split('#')[0]);if(!existsSync(path.resolve(path.dirname(p),target)))missing.push({file:p,target});count++;}report.documents.push({path:p,localLinkCount:count});}
    assert.deepEqual(missing,[]);passed('交付文档本地链接均存在，SW/IT矩阵和两份完整说明齐备');
    summary.status='passed';report.passed=true;writeFileSync(directory+'/final-summary.json',JSON.stringify(summary,null,2)+'\n');
  }catch(e){report.failure=e.message;process.exitCode=1;}
  finally{await db.end();const text=JSON.stringify(report,null,2)+'\n';if(!report.passed)writeFileSync(directory+'/delivery-checks-'+Date.now()+'-failed.json',text);writeFileSync(directory+'/delivery-checks.json',text);console.log(JSON.stringify({passed:!!report.passed,checks:report.checks,commands:report.commands,failure:report.failure}));}
}
