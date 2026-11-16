// 作用：压测查询逐个走生产DTO，防止非法筛选400被当作负载或静默少测。
import 'reflect-metadata';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { expect,it } from 'vitest';
import { createValidationPipe } from '../src/common/http/dto-validation.js';
import { OrderQueryDto } from '../src/orders/order.dto.js';
import { AdminProductsQueryDto } from '../src/catalog/catalog.dto.js';
import { TaskQueryDto } from '../src/tasks/task.dto.js';
import { CustomerQueryDto } from '../src/customers/customer.dto.js';
import { AuditListQueryDto } from '../src/audit-query/audit-query.dto.js';
import { TrendQueryDto,HotProductsQueryDto } from '../src/reporting/reporting.dto.js';
it('全部性能轮转查询及20→100分页均满足实际生产DTO',async()=>{
 const script=pathToFileURL(resolve(__dirname,'../../../scripts/module15-performance-support.mjs')).href;
 const {workloadPaths}=await import(script) as {workloadPaths():Record<string,string[]>};
 const dtos={orders:OrderQueryDto,products:AdminProductsQueryDto,tasks:TaskQueryDto,customers:CustomerQueryDto,audit:AuditListQueryDto,trends30:TrendQueryDto,hotProducts:HotProductsQueryDto};
 const pipe=createValidationPipe();
 for(const [name,paths]of Object.entries(workloadPaths()))for(const path of paths)for(const queryPath of [path,path.replace('pageSize=20','pageSize=100')]){
   const query=Object.fromEntries(new URL(queryPath,'http://isolated.invalid').searchParams);
   await expect(pipe.transform(query,{type:'query',metatype:dtos[name as keyof typeof dtos]})).resolves.toBeDefined();
 }
});
