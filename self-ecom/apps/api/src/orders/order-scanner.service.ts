// 作用：启动及每分钟补扫全部过期待付，deadline/id分页；单单回滚与未知损耗不阻止后页。
import {Inject,Injectable,Logger,type OnApplicationBootstrap,type OnApplicationShutdown} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {Client} from 'pg';
import {APP_CONFIG,type EnvironmentConfig} from '../config/environment.js';
import {Clock} from '../common/time/clock.js';
import {PrismaService} from '../prisma/prisma.service.js';
import {OrderCommands} from './order-command.service.js';
import {OrderError} from './order.errors.js';
@Injectable()
export class OrderScanner {
 private readonly instanceId=randomUUID();
 constructor(@Inject(PrismaService)private readonly db:PrismaService,@Inject(OrderCommands)private readonly commands:OrderCommands,@Inject(Clock)private readonly clock:Clock,@Inject(APP_CONFIG)private readonly config:EnvironmentConfig){}
 async scan(batchSize=100){if(!Number.isInteger(batchSize)||batchSize<1||batchSize>500)throw new OrderError('VALIDATION_FAILED');
  const id=randomUUID(),requestId=randomUUID(),asOf=this.clock.now();let scannedCount=0,changedCount=0,failedCount=0,blockedCount=0,created=false,disconnected=false;
  const guard=new Client({connectionString:this.config.databaseUrl,connectionTimeoutMillis:750,statement_timeout:750,query_timeout:1000});guard.on('error',()=>{disconnected=true;});
  try{await guard.connect();await guard.query('SELECT pg_advisory_lock(hashtextextended($1,0))',['order-timeout-run:'+id]);
   const stale=await this.db.schedulerRun.findMany({where:{jobName:'order-payment-timeout',status:'RUNNING'}});
   for(const run of stale){await guard.query('BEGIN');try{const r=await guard.query<{locked:boolean}>('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked',['order-timeout-run:'+run.id]);if(r.rows[0]?.locked)await guard.query("UPDATE scheduler_run SET status='ABANDONED',finished_at=$2 WHERE id=$1 AND status='RUNNING'",[run.id,new Date(Math.max(+asOf,+run.startedAt))]);await guard.query('COMMIT');}catch(e){await guard.query('ROLLBACK');throw e;}}
   await this.db.schedulerRun.create({data:{id,jobName:'order-payment-timeout',instanceId:this.instanceId,requestId,startedAt:asOf}});created=true;
   let cursor:{id:string;deadline:Date}|undefined;
   for(;;){if(disconnected)throw new Error('扫描锁连接失效');
    const rows=await this.db.$queryRaw<{id:string;deadline:Date}[]>(Prisma.sql`SELECT id,payment_deadline AS deadline FROM "order" WHERE status='WAIT_PAYMENT' AND payment_deadline<=${asOf} ${cursor?Prisma.sql`AND (payment_deadline,id)>(${cursor.deadline},${cursor.id}::uuid)`:Prisma.empty} ORDER BY payment_deadline,id LIMIT ${batchSize}`);
    if(!rows.length)break;for(const row of rows){scannedCount++;try{const result=await this.commands.timeout(row.id,requestId);if('blocked' in result&&result.blocked){blockedCount++;await this.db.schedulerFailure.create({data:{runId:id,errorCode:'ORDER_STOCK_CHECK_REQUIRED',sanitizedMessage:'订单 '+row.id+' 损耗待核实；未关闭，未释放，原截止不延长',occurredAt:this.clock.now()}});}else if('replayed' in result&&!result.replayed)changedCount++;}
     catch(e){failedCount++;await this.db.schedulerFailure.create({data:{runId:id,errorCode:e instanceof OrderError?e.code:'ORDER_TIMEOUT_FAILED',sanitizedMessage:'订单 '+row.id+' 关单事务已回滚，下轮重试',occurredAt:this.clock.now()}});}}
    cursor=rows[rows.length-1];
   }
   const status=failedCount||blockedCount?(changedCount?'PARTIAL_FAILED':'FAILED'):'SUCCEEDED';await this.db.schedulerRun.update({where:{id},data:{status,scannedCount,changedCount,failedCount:failedCount+blockedCount,finishedAt:this.clock.now()}});return {id,requestId,status,scannedCount,changedCount,failedCount,blockedCount};
  }catch(e){if(created)await this.db.schedulerRun.updateMany({where:{id,status:'RUNNING'},data:{status:'FAILED',scannedCount,changedCount,failedCount:failedCount+blockedCount+1,finishedAt:this.clock.now()}});throw e;}finally{await guard.end();}
 }
}
@Injectable()
export class OrderScheduler implements OnApplicationBootstrap,OnApplicationShutdown {
 private readonly logger=new Logger(OrderScheduler.name);private timer?:ReturnType<typeof setInterval>;private running?:Promise<void>;
 constructor(@Inject(OrderScanner)private readonly scanner:OrderScanner,@Inject(APP_CONFIG)private readonly config:EnvironmentConfig){}
 onApplicationBootstrap(){if(this.config.nodeEnv==='test'||this.timer)return;this.tick();this.timer=setInterval(()=>this.tick(),60000);this.timer.unref();}
 private tick(){this.running??=this.scanner.scan().then(()=>undefined).catch(()=>this.logger.error('订单付款超时扫描失败，下轮补扫')).finally(()=>{this.running=undefined;});}
 async onApplicationShutdown(){if(this.timer)clearInterval(this.timer);await this.running;}
}
