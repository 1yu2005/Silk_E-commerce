// 作用：显式维护命令，以数据库绑定断点分批追加审计引用；输出仅统计及日志ID样本。
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {resolve} from 'node:path';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {parseDatabaseUrl,readDatabaseEnvironment} from './database-env.js';
import {backfillAuditReferenceBatch,initialAuditReferenceCheckpoint,validAuditReferenceCheckpoint,type AuditReferenceCheckpoint} from '../src/audit/audit-reference-backfill.js';

async function main(){
  const args=process.argv.slice(2),options=new Map<string,string>();
  for(let i=0;i<args.length;i++){const key=args[i];if(key==='--apply')continue;if(!['--checkpoint','--batch-size','--max-batches'].includes(key??'')||!args[i+1]||args[i+1]!.startsWith('--'))throw new Error('回填参数无效');options.set(key!,args[++i]!);}
  if(!args.includes('--apply')||!options.get('--checkpoint'))throw new Error('须显式指定 --apply --checkpoint <文件> [--batch-size 200] [--max-batches 100]');
  const batchSize=Number(options.get('--batch-size')??200),maxBatches=Number(options.get('--max-batches')??100);
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>1000||!Number.isInteger(maxBatches)||maxBatches<1||maxBatches>10000)throw new Error('批大小或批数超出维护边界');
  const env=readDatabaseEnvironment(),url=parseDatabaseUrl(env.DATABASE_URL,'DATABASE_URL');
  const databaseKey=createHash('sha256').update(url.hostname+':'+(url.port||'5432')+url.pathname).digest('hex'),path=resolve(options.get('--checkpoint')!);
  const db=new PrismaClient({adapter:new PrismaPg({connectionString:url.toString()})});
  try{
    let state:AuditReferenceCheckpoint;
    if(existsSync(path)){const saved=JSON.parse(readFileSync(path,'utf8')) as {databaseKey?:string;checkpoint?:unknown};if(saved.databaseKey!==databaseKey||!validAuditReferenceCheckpoint(saved.checkpoint))throw new Error('断点无效或不属于当前数据库');state=saved.checkpoint;}
    else state=await initialAuditReferenceCheckpoint(db);
    let scanned=0,inserted=0,done=false;const missing:Record<string,number>={},samples=new Set<string>();
    for(let batch=0;batch<maxBatches&&!done;batch++){
      const result=await backfillAuditReferenceBatch(db,state,batchSize);state=result.checkpoint;scanned+=result.scanned;inserted+=result.inserted;done=result.done;
      for(const diagnostic of result.diagnostics){missing[diagnostic.reason]=(missing[diagnostic.reason]??0)+1;if(samples.size<20)samples.add(diagnostic.auditLogId);}
      writeFileSync(path+'.pending',JSON.stringify({databaseKey,checkpoint:state},null,2)+'\n');renameSync(path+'.pending',path);
    }
    console.log(JSON.stringify({scanned,inserted,done,missing,sampleAuditLogIds:[...samples],checkpoint:path}));
  }finally{await db.$disconnect();}
}
main().catch(()=>{console.error('审计引用回填失败；原审计未修改，已提交批次可从断点幂等重跑');process.exitCode=1;});
