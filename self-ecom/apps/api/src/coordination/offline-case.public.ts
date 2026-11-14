// 作用：供原订单/售后本人详情复用纯公开投影，避免领域模块相互注入形成循环。
import type {Prisma} from '@prisma/client';
export async function publicOfflineForOrder(tx:Prisma.TransactionClient,orderId:string,customerId:string){
 const rows=await tx.offlineCase.findMany({where:{orderId,customerId},orderBy:[{createdAt:'asc'},{id:'asc'}]});
 if(!rows.length)return [];
 const events=await tx.offlineCaseEvent.findMany({where:{offlineCaseId:{in:rows.map(row=>row.id)},publicText:{not:null}},orderBy:[{createdAt:'asc'},{id:'asc'}],select:{offlineCaseId:true,id:true,kind:true,occurredAt:true,publicText:true,correctsEventId:true}});
 const byCase=new Map<string,Omit<(typeof events)[number],'offlineCaseId'>[]>();
 for(const {offlineCaseId,...event}of events){const items=byCase.get(offlineCaseId)??[];items.push(event);byCase.set(offlineCaseId,items);}
 return rows.map(row=>({id:row.id,caseNo:row.caseNo,type:row.type,status:row.status,subject:row.subject,publicSummary:row.publicSummary,createdAt:row.createdAt,resolvedAt:row.resolvedAt,closedAt:row.closedAt,events:byCase.get(row.id)??[]}));
}
