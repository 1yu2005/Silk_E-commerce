// 仅本轮独占性能库中的计划对照；候选索引随事务ROLLBACK，不改变生产迁移或强制planner。
import type {Client} from 'pg';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect} from 'vitest';
type Statement={sql:string;values:unknown[]};
export async function compareReportingPlans(db:Client,captures:Map<string,Statement[]>,evidence:string){
  if(process.env.NODE_ENV!=='test'||!/^\/m414_[a-f0-9]{32}_test$/.test(new URL(process.env.DATABASE_URL!).pathname))throw new Error('计划对照仅允许本轮m414独占库');
  const trends=captures.get('trends30')!.find(s=>/generate_series/.test(s.sql))!,hot=captures.get('hotProducts')!.find(s=>/WITH quantities/.test(s.sql))!;
  const lateral:Statement={sql:`WITH dates AS (SELECT generate_series($1::date,$2::date,interval '1 day')::date d)
    SELECT dates.d::text date,o.n::text "createdOrderCount",c.n::text "newCustomerCount",p.n::text "paidAmountCents",f.n::text "refundAmountCents",(p.n-f.n)::text "netReceiptsCents"
    FROM dates CROSS JOIN LATERAL (SELECT COALESCE(sum(amount_cents::bigint),0) n FROM payment WHERE status='SUCCEEDED'
      AND paid_at >= (dates.d::timestamp AT TIME ZONE 'Asia/Shanghai') AND paid_at < LEAST(((dates.d+1)::timestamp AT TIME ZONE 'Asia/Shanghai'),$3::timestamptz)) p
    CROSS JOIN LATERAL (SELECT COALESCE(sum(amount_cents::bigint),0) n FROM refund WHERE status='SUCCEEDED'
      AND succeeded_at >= (dates.d::timestamp AT TIME ZONE 'Asia/Shanghai') AND succeeded_at < LEAST(((dates.d+1)::timestamp AT TIME ZONE 'Asia/Shanghai'),$3::timestamptz)) f
    CROSS JOIN LATERAL (SELECT count(*) n FROM "order" WHERE created_at >= (dates.d::timestamp AT TIME ZONE 'Asia/Shanghai')
      AND created_at < LEAST(((dates.d+1)::timestamp AT TIME ZONE 'Asia/Shanghai'),$3::timestamptz)) o
    CROSS JOIN LATERAL (SELECT count(*) n FROM customer WHERE created_at >= (dates.d::timestamp AT TIME ZONE 'Asia/Shanghai')
      AND created_at < LEAST(((dates.d+1)::timestamp AT TIME ZONE 'Asia/Shanghai'),$3::timestamptz)) c ORDER BY dates.d`,values:[trends.values[0],trends.values[1],trends.values[3]]};
  const baselineTrends=(await db.query(trends.sql,trends.values)).rows,baselineHot=(await db.query(hot.sql,hot.values)).rows;
  const comparisons:Record<string,unknown>={};
  for(const candidate of [{name:'current',parallel:2,cover:false},{name:'no-parallel',parallel:0,cover:false},{name:'covering-payment',parallel:2,cover:true},{name:'covering-payment-no-parallel',parallel:0,cover:true}]){
    await db.query('BEGIN');
    try{
      await db.query('SET LOCAL max_parallel_workers_per_gather='+candidate.parallel);
      if(candidate.cover)await db.query("CREATE INDEX m414_diagnostic_payment_cover_idx ON payment(paid_at) INCLUDE(order_id,amount_cents) WHERE status='SUCCEEDED'");
      const results:Record<string,unknown>={};
      for(const [name,statement,expected]of [['trends',trends,baselineTrends],['hot',hot,baselineHot],['lateral-trends',lateral,baselineTrends]]as const){
        expect((await db.query(statement.sql,statement.values)).rows,name+' '+candidate.name).toEqual(expected);
        const plans:unknown[]=[];
        for(let attempt=0;attempt<3;attempt++)plans.push((await db.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+statement.sql,statement.values)).rows[0]['QUERY PLAN']);
        results[name]={sql:statement.sql,resultsMatchBaseline:true,plans};
      }
      comparisons[candidate.name]={parallelWorkersPerGather:candidate.parallel,temporaryCoveringIndex:candidate.cover,results};
    }finally{await db.query('ROLLBACK');}
  }
  const tables=(await db.query("SELECT relname,n_live_tup,last_autovacuum,last_autoanalyze,autovacuum_count,autoanalyze_count FROM pg_stat_user_tables WHERE relname IN ('payment','order','order_item') ORDER BY relname")).rows;
  writeFileSync(resolve(evidence,'query-plan-comparisons.json'),JSON.stringify({kind:'diagnostic-only-not-http-proof',repeats:3,allIndexesRolledBack:true,forcedScanMethods:false,tables,comparisons},null,2)+'\n');
}
