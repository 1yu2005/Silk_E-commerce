// 作用：在列表原事务快照内用EXISTS筛选活跃售后，仅把当前页订单ID带回应用。
import {Prisma} from '@prisma/client';
import type {OrderQueryDto} from './order.dto.js';

export interface OrderListIdScope {
 readonly ids:readonly string[];
 readonly exclude:boolean;
}
interface ActiveAfterSaleScope {
 readonly customerId?:string;
 readonly admin:boolean;
 readonly idScopes:readonly OrderListIdScope[];
}

export async function readActiveAfterSaleOrderPage(tx:Prisma.TransactionClient,q:OrderQueryDto,scope:ActiveAfterSaleScope):Promise<{total:number;ids:string[]}> {
 const clauses=[Prisma.sql`EXISTS (SELECT 1 FROM after_sale s WHERE s.order_id=o.id AND s.status NOT IN ('REJECTED','WITHDRAWN','CLOSED','SUCCEEDED'))`];
 if(scope.customerId)clauses.push(Prisma.sql`o.customer_id=${scope.customerId}::uuid`);
 if(q.status)clauses.push(Prisma.sql`o.status=${q.status}`);
 if(q.fulfillmentStage)clauses.push(Prisma.sql`o.fulfillment_stage=${q.fulfillmentStage}`);
 // 与Prisma contains使用同一LIKE模式；保留客户端%/_/反斜杠原有含义，不自行转义。
 if(q.number)clauses.push(Prisma.sql`o.number LIKE ${'%'+q.number+'%'}`);
 if(q.receiverKeyword&&scope.admin){const pattern='%'+q.receiverKeyword+'%';clauses.push(Prisma.sql`(o.receiver LIKE ${pattern} OR o.phone LIKE ${pattern})`);}
 if(q.from)clauses.push(Prisma.sql`o.created_at>=${new Date(q.from)}`);
 if(q.to)clauses.push(Prisma.sql`o.created_at<=${new Date(q.to)}`);
 for(const idScope of scope.idScopes){const member=Prisma.sql`o.id=ANY(${idScope.ids}::uuid[])`;clauses.push(idScope.exclude?Prisma.sql`NOT (${member})`:member);}
 const where=Prisma.join(clauses.map(clause=>Prisma.sql`(${clause})`),' AND ');
 const [count]=await tx.$queryRaw<{total:bigint}[]>`SELECT count(*) AS total FROM "order" o WHERE ${where}`;
 const total=Number(count!.total),skip=BigInt(q.page-1)*BigInt(q.pageSize);
 if(skip>=BigInt(total))return {total,ids:[]};
 const rows=await tx.$queryRaw<{id:string}[]>`SELECT o.id FROM "order" o WHERE ${where} ORDER BY o.created_at DESC,o.id ASC LIMIT ${q.pageSize} OFFSET ${Number(skip)}`;
 return {total,ids:rows.map(row=>row.id)};
}
