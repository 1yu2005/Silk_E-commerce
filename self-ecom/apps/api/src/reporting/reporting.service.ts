// 统计只读真实交易事实。金额/计数直接SQL转text，不经JS浮点中转。
import {Inject,Injectable} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {PrismaService} from '../prisma/prisma.service.js';
import {Clock} from '../common/time/clock.js';
import {OrderAccess,requireOrderPermission} from '../orders/order-access.service.js';
import type {CustomerContext} from '../customers/customer-access.service.js';
import type {PaginationDto} from '../common/http/pagination.dto.js';
import {DASHBOARD_DEFINITION,REPORT_TIME_ZONE,reportRange} from './reporting-time.js';
type Events={createdOrderCount:string;newCustomerCount:string;paidAmountCents:string;refundAmountCents:string;netReceiptsCents:string};
type Current={waitingShipmentOrderCount:string;afterSalePausedOrderCount:string;pendingReviewAfterSaleCount:string;failedRefundCount:string;lowStockSkuCount:string};
@Injectable()
export class ReportingService {
 constructor(@Inject(PrismaService)private readonly db:PrismaService,@Inject(OrderAccess)private readonly access:OrderAccess,@Inject(Clock)private readonly clock:Clock){}
 private read<T>(ctx:CustomerContext,days:number,query:(tx:Prisma.TransactionClient,r:ReturnType<typeof reportRange>)=>Promise<T>){
  return this.db.$transaction(async tx=>{
   // 回调首句合并事务模式，早于任何SELECT；保留固定快照与数据库只读保护。
   await tx.$executeRaw`SET TRANSACTION READ ONLY, ISOLATION LEVEL REPEATABLE READ`;
   const actor=await this.access.current(tx,ctx,false);requireOrderPermission(actor,'dashboard.read');
   const r=reportRange(this.clock.now(),days),data=await query(tx,r);
   return {...data,asOf:r.to.toISOString(),timeZone:REPORT_TIME_ZONE,definitionVersion:DASHBOARD_DEFINITION,from:r.from.toISOString(),to:r.to.toISOString(),firstDate:r.firstDate,lastDate:r.lastDate};
  });
 }
 overview(ctx:CustomerContext){return this.read(ctx,1,async(tx,r)=>{
  const [today]=await tx.$queryRaw<Events[]>`SELECT
   (SELECT count(*)::text FROM "order" WHERE created_at>=${r.from} AND created_at<${r.to}) AS "createdOrderCount",
   (SELECT count(*)::text FROM customer WHERE created_at>=${r.from} AND created_at<${r.to}) AS "newCustomerCount",
   p.amount::text AS "paidAmountCents",f.amount::text AS "refundAmountCents",(p.amount-f.amount)::text AS "netReceiptsCents"
   FROM (SELECT COALESCE(sum(amount_cents::bigint),0) amount FROM payment WHERE status='SUCCEEDED' AND paid_at>=${r.from} AND paid_at<${r.to}) p
   CROSS JOIN (SELECT COALESCE(sum(amount_cents::bigint),0) amount FROM refund WHERE status='SUCCEEDED' AND succeeded_at>=${r.from} AND succeeded_at<${r.to}) f`;
  const [current]=await tx.$queryRaw<Current[]>`SELECT
   (SELECT count(*)::text FROM "order" WHERE status='WAIT_SHIPMENT') AS "waitingShipmentOrderCount",
   (SELECT count(*)::text FROM "order" o WHERE o.status IN ('WAIT_SHIPMENT','SHIPPED') AND EXISTS(
    SELECT 1 FROM order_block b JOIN after_sale a ON a.id=b.source_id AND a.order_id=o.id
    WHERE b.order_id=o.id AND b.source_type='AFTER_SALE' AND b.active
     AND ((o.status='WAIT_SHIPMENT' AND b.blocks_shipment) OR (o.status='SHIPPED' AND b.blocks_receipt))
     AND a.status NOT IN ('REJECTED','WITHDRAWN','CLOSED','SUCCEEDED'))) AS "afterSalePausedOrderCount",
   (SELECT count(*)::text FROM after_sale WHERE status='PENDING_REVIEW') AS "pendingReviewAfterSaleCount",
   (SELECT count(*)::text FROM refund WHERE status='FAILED') AS "failedRefundCount",
   (SELECT count(*)::text FROM inventory_balance WHERE available<=warning_threshold) AS "lowStockSkuCount"`;
  return {today:today!,current:current!};
 });}
 trends(ctx:CustomerContext,days:7|30){return this.read(ctx,days,async(tx,r)=>{
  const items=await tx.$queryRaw<(Events&{date:string})[]>`WITH dates AS (
   SELECT generate_series(${r.firstDate}::date,${r.lastDate}::date,interval '1 day')::date AS d
  ),p AS (SELECT (paid_at AT TIME ZONE 'Asia/Shanghai')::date d,sum(amount_cents::bigint) n FROM payment
   WHERE status='SUCCEEDED' AND paid_at>=${r.from} AND paid_at<${r.to} GROUP BY 1),
  f AS (SELECT (succeeded_at AT TIME ZONE 'Asia/Shanghai')::date d,sum(amount_cents::bigint) n FROM refund
   WHERE status='SUCCEEDED' AND succeeded_at>=${r.from} AND succeeded_at<${r.to} GROUP BY 1),
  o AS (SELECT (created_at AT TIME ZONE 'Asia/Shanghai')::date d,count(*) n FROM "order" WHERE created_at>=${r.from} AND created_at<${r.to} GROUP BY 1),
  c AS (SELECT (created_at AT TIME ZONE 'Asia/Shanghai')::date d,count(*) n FROM customer WHERE created_at>=${r.from} AND created_at<${r.to} GROUP BY 1)
  SELECT dates.d::text date,COALESCE(o.n,0)::text AS "createdOrderCount",COALESCE(c.n,0)::text AS "newCustomerCount",
   COALESCE(p.n,0)::text AS "paidAmountCents",COALESCE(f.n,0)::text AS "refundAmountCents",(COALESCE(p.n,0)-COALESCE(f.n,0))::text AS "netReceiptsCents"
  FROM dates LEFT JOIN p USING(d) LEFT JOIN f USING(d) LEFT JOIN o USING(d) LEFT JOIN c USING(d) ORDER BY dates.d`;
  return {days,items};
 });}
 hotProducts(ctx:CustomerContext,limit:number){return this.read(ctx,30,async(tx,r)=>{
  const items=await tx.$queryRaw<{productId:string;productCode:string;name:string;status:string;archived:boolean;paidQuantity:string}[]>`WITH quantities AS (
   SELECT i.product_id,sum(i.quantity::bigint) AS quantity FROM payment p JOIN order_item i ON i.order_id=p.order_id
   WHERE p.status='SUCCEEDED' AND p.paid_at>=${r.from} AND p.paid_at<${r.to} GROUP BY i.product_id
  ), ranked AS (SELECT product_id,quantity FROM quantities ORDER BY quantity DESC,product_id ASC LIMIT ${limit})
   SELECT p.id AS "productId",p.product_code AS "productCode",p.name,p.status,(p.archived_at IS NOT NULL) archived,q.quantity::text AS "paidQuantity"
   FROM ranked q JOIN product p ON p.id=q.product_id ORDER BY q.quantity DESC,p.id ASC`;
  return {days:30 as const,items};
 });}
 lowStock(ctx:CustomerContext,q:PaginationDto){return this.read(ctx,1,async(tx)=>{
  const [count]=await tx.$queryRaw<{total:string}[]>`SELECT count(*)::text total FROM inventory_balance WHERE available<=warning_threshold`;
  const exact=BigInt(count!.total);if(exact>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('分页总量超出契约容量');
  const total=Number(exact),skip=BigInt(q.page-1)*BigInt(q.pageSize);
  const items=skip>=exact?[]:await tx.$queryRaw<{skuId:string;skuCode:string;productId:string;productCode:string;productName:string;available:number;warningThreshold:number;skuEnabled:boolean;skuRetired:boolean;productStatus:string;productArchived:boolean}[]>(Prisma.sql`
   SELECT b.sku_id AS "skuId",s.code AS "skuCode",p.id AS "productId",p.product_code AS "productCode",p.name AS "productName",
    b.available,b.warning_threshold AS "warningThreshold",s.enabled AS "skuEnabled",(s.retired_at IS NOT NULL) AS "skuRetired",p.status AS "productStatus",(p.archived_at IS NOT NULL) AS "productArchived"
   FROM inventory_balance b JOIN sku s ON s.id=b.sku_id JOIN product p ON p.id=s.product_id
   WHERE b.available<=b.warning_threshold ORDER BY b.available ASC,b.sku_id ASC LIMIT ${q.pageSize} OFFSET ${skip}`);
  return {items,total,page:q.page,pageSize:q.pageSize};
 });}
}
