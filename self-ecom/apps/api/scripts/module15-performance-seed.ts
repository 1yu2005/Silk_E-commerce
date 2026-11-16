// 作用：给root已创建/迁移的本轮独占m415持久库造数；不创建、清空或删除库/卷/文件。
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { isAbsolute, resolve, join } from 'node:path';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { seedInitialAdmin } from '../src/auth/initial-admin-seed.js';
import { EmployeeAuthService } from '../src/auth/employee-auth.service.js';
import { CurrentIdentityService } from '../src/auth/current-identity.service.js';
import { StoreSettingsService } from '../src/settings/store-settings.service.js';
import { seedModule15Performance } from '../test/fixtures/module15-performance.js';

let phase='configuration',evidenceRoot:string|undefined;
interface Config { schemaVersion: number; runId: string; envFile: string; uploadsRoot: string; outputRoot: string; credentials: {username: string; password: string}; orderCount?: number }
async function main() {
  const args=process.argv.slice(2),index=args.indexOf('--config');assert.ok(index>=0&&args[index+1]);
  const configFile=resolve(args[index+1]!);assert.match(configFile.replaceAll('\\','/'),/\/private-delivery\/M4-15\//);
  execFileSync('git',['check-ignore','--quiet',configFile],{stdio:'ignore',windowsHide:true});
  const config=JSON.parse(await readFile(configFile,'utf8')) as Config;
  assert.equal(config.schemaVersion,1);assert.match(config.runId,/^[a-f0-9-]{36}$/);
  for(const key of ['envFile','uploadsRoot','outputRoot'] as const)assert.ok(isAbsolute(config[key]));
  assert.match(config.outputRoot.replaceAll('\\','/'),/\/(?:private-delivery|output\/testing)\/M4-15\//);
  const count=args.includes('--diagnostic')?1000:100000;assert.equal(config.orderCount??count,count);
  const values=parseEnv(await readFile(config.envFile,'utf8'));assert.match(new URL(values.DATABASE_URL!).pathname,/^\/m415_[a-f0-9]{32}_test$/);
  assert.ok(values.JWT_SECRET&&values.CORS_ORIGINS,'独占配置须明确提供认证及跨域配置');
  Object.assign(process.env,values,{NODE_ENV:'test',UPLOAD_DIR:config.uploadsRoot,LOG_LEVEL:'silent'});
  await mkdir(config.outputRoot,{recursive:false});evidenceRoot=config.outputRoot;
  phase='database-identity';
  const pg=new Client({connectionString:values.DATABASE_URL});await pg.connect();
  try {
    const identity=(await pg.query('SELECT current_database() database')).rows[0].database;
    assert.equal(identity,new URL(values.DATABASE_URL!).pathname.slice(1));
    const countRow=(await pg.query('SELECT (SELECT count(*) FROM employee)+(SELECT count(*) FROM "order")+(SELECT count(*) FROM customer)+(SELECT count(*) FROM product) count')).rows[0];
    assert.equal(Number(countRow.count),0,'仅接受root明确创建迁移的空隔离库，不改旧账号或业务');
    phase='seed-app-bootstrap';const app=await NestFactory.createApplicationContext(AppModule,{logger:false});
    try {
      phase='initial-admin';const db=app.get(PrismaService),admin=await seedInitialAdmin(db,config.credentials);assert.equal(admin.created,true);
      phase='actual-login';const login=await app.get(EmployeeAuthService).login(config.credentials,'127.0.0.1');
      const actor=await app.get(CurrentIdentityService).authenticate(db,login.accessToken,'EMPLOYEE');
      const settings=app.get(StoreSettingsService),current=await settings.current();
      const address={receiver:'性能隔离收件人',phone:'01000000000',province:'测试省',city:'测试市',district:'测试区',detail:'本轮性能合成资料'};
      phase='store-settings';await settings.update(actor,login.accessToken,{expectedVersion:current.version,shippingFeeCents:800,freeShippingEnabled:true,freeShippingThresholdCents:20000,returnAddress:address,serviceContact:{phone:'01000000000',serviceHours:'性能独占环境'},deadlines:{paymentMinutes:1440,autoReceiptDays:10,afterSaleWindowDays:7,reviewWorkdays:3,supplementDays:7,returnShipDays:7,inspectionWorkdays:3,refundWorkdays:3},reason:'本轮独占性能合法设置'},randomUUID());
      const head=await db.storeSettingHead.findUniqueOrThrow({where:{id:1},include:{currentVersion:true}});
      phase='relational-fixture';const dataset=await seedModule15Performance({employeeId:actor.subjectId,setting:head.currentVersion!,uploadsRoot:config.uploadsRoot,orderCount:count});
      await writeFile(join(config.outputRoot,'fixture-dataset.json'),JSON.stringify({runId:config.runId,kind:'committed-fixture-counts-not-reconcile-acceptance',dataset},null,2)+'\n',{flag:'wx'});
      const script=pathToFileURL(resolve(__dirname,'../../../scripts/reconcile.mjs')).href;
      const {runReconcile}=await import(script) as {runReconcile(options:{client:Client;uploadsRoot:string;scope:{target:string;database:string}}):Promise<{status:string;checks:{passed:boolean;violationCount:string}[]}>};
      phase='reconcile';const reconcile=await runReconcile({client:pg,uploadsRoot:config.uploadsRoot,scope:{target:'persistent-performance-fixture',database:identity}});
      await writeFile(join(config.outputRoot,'fixture-summary.json'),JSON.stringify({schemaVersion:1,runId:config.runId,kind:count===100000?'persistent-100000-performance-fixture':'diagnostic-only',dataset,reconcile,retention:'本轮库/上传文件持久保留；本脚本不清理，不构成正式命令E2E或正式性能通过'},null,2)+'\n',{flag:'wx'});
      assert.equal(reconcile.status,'passed');assert.ok(reconcile.checks.every(check=>check.passed&&check.violationCount==='0'));
      console.log(JSON.stringify({status:'seeded-and-reconciled',runId:config.runId,counts:dataset.counts,formalPerformanceAcceptance:false}));
    } finally {await app.close();}
  } finally {await pg.end();}
}
main().catch(async(error:unknown)=>{const detail=error as {code?:unknown;name?:unknown;constraint?:unknown;table?:unknown;fixtureQueryNumber?:unknown;fixtureStatement?:unknown};const safe=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(value)?value:null;if(evidenceRoot)await writeFile(join(evidenceRoot,'fixture-failure.json'),JSON.stringify({status:'failed',phase,code:safe(detail.code),name:safe(detail.name),constraint:safe(detail.constraint),table:safe(detail.table),fixtureQueryNumber:Number.isSafeInteger(detail.fixtureQueryNumber)?detail.fixtureQueryNumber:null,fixtureStatement:typeof detail.fixtureStatement==='string'&&/^[A-Za-z_ ]{1,100}$/.test(detail.fixtureStatement)?detail.fixtureStatement:null,retained:true},null,2)+'\n',{flag:'wx'}).catch(()=>{});console.error(JSON.stringify({status:'failed',message:'性能持久夹具初始化失败；保留本轮私有证据、数据库和文件，请核查配置/约束/对账。'}));process.exitCode=1;});
