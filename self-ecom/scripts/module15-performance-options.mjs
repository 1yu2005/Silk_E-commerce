import assert from 'node:assert/strict';

export const formalWorkloads=Object.freeze(['orders','products','tasks','trends30','hotProducts','customers','audit','mixed']);
export function performanceRunPlan(config,{diagnostic=false}={},paths){
 const load=diagnostic?{concurrency:config.diagnostic?.concurrency??1,warmupSeconds:config.diagnostic?.warmupSeconds??2,measurementSeconds:config.diagnostic?.measurementSeconds??5,rounds:1}:{concurrency:100,warmupSeconds:120,measurementSeconds:300,rounds:3};
 for(const value of Object.values(load))assert.ok(Number.isInteger(value)&&value>0);
 const requested=diagnostic?config.diagnostic?.workloads:undefined,workloads=requested===undefined?[...formalWorkloads]:requested;
 assert.ok(Array.isArray(workloads)&&workloads.length>0&&new Set(workloads).size===workloads.length&&workloads.every(name=>formalWorkloads.includes(name)),'INVALID_DIAGNOSTIC_WORKLOADS');
 const names=workloads.includes('mixed')?formalWorkloads.filter(name=>name!=='mixed'):workloads;
 for(const name of names)assert.ok(Array.isArray(paths[name])&&paths[name].length>0,'MISSING_PERFORMANCE_WORKLOAD_PATHS');
 return {load,workloads:[...workloads],paths:Object.fromEntries(names.map(name=>[name,paths[name]])),filtered:diagnostic&&requested!==undefined,minimumLoadSeconds:load.rounds*workloads.length*(load.warmupSeconds+load.measurementSeconds)};
}

export function capturedPlannerSettings(statements,index){
 const connectionId=statements[index]?.connectionId;assert.ok(Number.isSafeInteger(connectionId)&&connectionId>0,'CAPTURED_CONNECTION_ID_REQUIRED');
 let transaction=false,settings={};
 for(const statement of statements.slice(0,index)){
  if(statement.connectionId!==connectionId)continue;
  const sql=statement.sql.trim().replace(/;$/,'').trim();
  if(/^BEGIN(?:\s|$)/i.test(sql)){transaction=true;settings={};continue;}
  if(/^(COMMIT|ROLLBACK)(?:\s|$)/i.test(sql)){transaction=false;settings={};continue;}
  if(!/^SET\b/i.test(sql))continue;
  if(/^SET TRANSACTION (?:READ ONLY(?:,\s*ISOLATION LEVEL REPEATABLE READ)?|ISOLATION LEVEL (?:READ COMMITTED|REPEATABLE READ|SERIALIZABLE))$/i.test(sql))continue;
  const serial=/^SET LOCAL max_parallel_workers_per_gather\s*=\s*0$/i.test(sql),hashJoinOff=/^SET LOCAL enable_hashjoin\s*=\s*off$/i.test(sql);
  assert.ok((serial||hashJoinOff)&&Array.isArray(statement.values)&&statement.values.length===0,'UNSUPPORTED_CAPTURED_PLANNER_SETTING');
  assert.ok(transaction,'CAPTURED_PLANNER_SETTING_OUTSIDE_TRANSACTION');
  if(serial)settings.max_parallel_workers_per_gather='0';else settings.enable_hashjoin='off';
 }
 return settings;
}
