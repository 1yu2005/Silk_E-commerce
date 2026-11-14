// 作用：启动/每分钟补扫未决交运与收货，游标跨页；每单独立回滚，失败不阻止后页。
import {Inject,Injectable,Logger,type OnApplicationBootstrap,type OnApplicationShutdown} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {Prisma} from '@prisma/client';
import {APP_CONFIG,type EnvironmentConfig} from '../config/environment.js';
import {Clock} from '../common/time/clock.js';
import {PrismaService} from '../prisma/prisma.service.js';
import {FulfillmentService} from './fulfillment.service.js';
import {OrderError} from './order.errors.js';
export type FulfillmentJob='handover'|'receipt';
@Injectable()
export class FulfillmentScanner {
 private readonly instanceId=randomUUID();
 constructor(@Inject(PrismaService)private readonly db:PrismaService,@Inject(FulfillmentService)private readonly service:FulfillmentService,@Inject(Clock)private readonly clock:Clock,@Inject(APP_CONFIG)private readonly config:EnvironmentConfig){}
 async scan(kind:FulfillmentJob,batchSize=100){if(!['handover','receipt'].includes(kind)||!Number.isInteger(batchSize)||batchSize<1||batchSize>500)throw new OrderError('VALIDATION_FAILED');
  const id=randomUUID(),requestId=randomUUID(),jobName=kind==='handover'?'order-handover-recovery':'order-auto-receipt',asOf=this.clock.now();let scannedCount=0,changedCount=0,failedCount=0,created=false,disconnected=false;
  const guard=new Client({connectionString:this.config.databaseUrl,connectionTimeoutMillis:1000,statement_timeout:1000,query_timeout:1500});guard.on('error',()=>{disconnected=true;});
  try{await guard.connect();const lock=await guard.query<{locked:boolean}>('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[jobName]);if(!lock.rows[0]?.locked)return {status:'SKIPPED',scannedCount,changedCount,failedCount};
   // 全局任务锁仍在，旧RUNNING必无活跃守护连接；按各旧run起点修正结束时刻。
   await guard.query("UPDATE scheduler_run SET status='ABANDONED',finished_at=GREATEST(started_at,$2) WHERE job_name=$1 AND status='RUNNING'",[jobName,asOf]);
   await this.db.schedulerRun.create({data:{id,jobName,instanceId:this.instanceId,requestId,startedAt:asOf}});created=true;let cursor:string|undefined;
   for(;;){if(disconnected)throw new Error('扫描守护连接失效');const after=cursor?Prisma.sql`AND o.id>${cursor}::uuid`:Prisma.empty;
    const rows=kind==='handover'?await this.db.$queryRaw<{id:string}[]>(Prisma.sql`SELECT o.id FROM "order" o WHERE o.status='WAIT_SHIPMENT' AND EXISTS(SELECT 1 FROM handover_attempt h WHERE h.order_id=o.id AND h.status='IN_PROGRESS' AND (h.uncertain_after<=${asOf} OR NOT EXISTS(SELECT 1 FROM task t WHERE t.business_type='ORDER' AND t.business_id=o.id AND t.stage='SHIPMENT_PROCESS' AND t.status='CLAIMED'))) ${after} ORDER BY o.id LIMIT ${batchSize}`):await this.db.$queryRaw<{id:string}[]>(Prisma.sql`SELECT o.id FROM "order" o WHERE o.status='SHIPPED' AND o.auto_receipt_due_at<=${asOf} ${after} ORDER BY o.id LIMIT ${batchSize}`);
    if(!rows.length)break;for(const row of rows){if(disconnected)throw new Error('扫描守护连接失效');scannedCount++;try{if(kind==='handover'){if((await this.service.timeout(row.id,requestId)).changed)changedCount++;}else{const result=await this.service.autoReceipt(row.id,requestId);if('replayed' in result&&!result.replayed)changedCount++;}}
     catch(error){failedCount++;await this.db.schedulerFailure.create({data:{runId:id,errorCode:error instanceof OrderError?error.code:'FULFILLMENT_SCAN_FAILED',sanitizedMessage:'订单 '+row.id+' '+(kind==='handover'?'交运核实':'收货')+'事务未提交，下轮补扫',occurredAt:this.clock.now()}});}}
    cursor=rows.at(-1)!.id;
   }
   const status=failedCount?(changedCount?'PARTIAL_FAILED':'FAILED'):'SUCCEEDED';await this.db.schedulerRun.update({where:{id},data:{status,scannedCount,changedCount,failedCount,finishedAt:this.clock.now()}});return {id,requestId,status,scannedCount,changedCount,failedCount};
  }catch(error){if(created)await this.db.schedulerRun.updateMany({where:{id,status:'RUNNING'},data:{status:'FAILED',scannedCount,changedCount,failedCount:failedCount+1,finishedAt:this.clock.now()}});throw error;}finally{await guard.end();}
 }
}
@Injectable()
export class FulfillmentScheduler implements OnApplicationBootstrap,OnApplicationShutdown {
 private readonly logger=new Logger(FulfillmentScheduler.name);private timer?:ReturnType<typeof setInterval>;private running?:Promise<void>;
 constructor(@Inject(FulfillmentScanner)private readonly scanner:FulfillmentScanner,@Inject(APP_CONFIG)private readonly config:EnvironmentConfig){}
 onApplicationBootstrap(){if(this.config.nodeEnv==='test'||this.timer)return;this.tick();this.timer=setInterval(()=>this.tick(),60000);this.timer.unref();}
 private tick(){this.running??=Promise.allSettled([this.scanner.scan('handover'),this.scanner.scan('receipt')]).then(results=>{if(results.some(r=>r.status==='rejected'))this.logger.error('履约扫描失败，下轮补扫');}).finally(()=>{this.running=undefined;});}
 async onApplicationShutdown(){if(this.timer)clearInterval(this.timer);await this.running;}
}
