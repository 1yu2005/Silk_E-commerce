// 作用：固定真实事实来源在授权裁剪后由SQL统一分页，GET只读且不取得业务写锁。
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginationWindow } from '@shop/shared';
import { CurrentIdentityService } from '../auth/current-identity.service.js';
import { TokenValidationError } from '../auth/jwt-token.service.js';
import { AccessDeniedError } from '../auth/access-denied.error.js';
import type { CustomerContext } from '../customers/customer-access.service.js';
import { ownedOrder, orderReader } from '../orders/order-access.service.js';
import { ownedSale } from '../after-sales/after-sale.access.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { BusinessHistoryQueryDto, HistoryKind } from './business-history.dto.js';

export interface HistoryRow {
  id:string; kind:HistoryKind; source:string; recordedAt:Date; occurredAt:Date;
  summary:string; internalNote:string|null; action:string|null; beforeStatus:string|null; afterStatus:string|null;
  taskId:string|null; taskStage:string|null; deadlineAt:Date|null; newDueAt:Date|null; amountCents:number|null; correctsId:string|null;
}
const nil = Prisma.sql`NULL::text`, noDate=Prisma.sql`NULL::timestamptz`, noId=Prisma.sql`NULL::uuid`;
interface Projection { kind:HistoryKind; source:string; from:Prisma.Sql; id:Prisma.Sql; recordedAt:Prisma.Sql; occurredAt?:Prisma.Sql; summary:Prisma.Sql;
  internalNote?:Prisma.Sql; action?:Prisma.Sql; beforeStatus?:Prisma.Sql; afterStatus?:Prisma.Sql; taskId?:Prisma.Sql; taskStage?:Prisma.Sql;
  deadlineAt?:Prisma.Sql; newDueAt?:Prisma.Sql; amountCents?:Prisma.Sql; correctsId?:Prisma.Sql; }
function project(p:Projection){return Prisma.sql`SELECT ${p.id} AS id,${p.kind}::text AS kind,${p.source}::text AS source,
  ${p.recordedAt} AS "recordedAt",${p.occurredAt??p.recordedAt} AS "occurredAt",${p.summary} AS summary,
  ${p.internalNote??nil} AS "internalNote",${p.action??nil} AS action,${p.beforeStatus??nil} AS "beforeStatus",${p.afterStatus??nil} AS "afterStatus",
  ${p.taskId??noId} AS "taskId",${p.taskStage??nil} AS "taskStage",${p.deadlineAt??noDate} AS "deadlineAt",${p.newDueAt??noDate} AS "newDueAt",
  ${p.amountCents??Prisma.sql`NULL::integer`} AS "amountCents",${p.correctsId??noId} AS "correctsId" ${p.from}`;}

@Injectable()
export class BusinessHistoryService {
  constructor(@Inject(PrismaService) private readonly prisma:PrismaService,@Inject(CurrentIdentityService) private readonly identities:CurrentIdentityService){}
  history(ctx:CustomerContext,type:'ORDER'|'AFTER_SALE',id:string,query:BusinessHistoryQueryDto){
    return this.prisma.$transaction(async tx=>{
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const actor=await this.identities.authenticate(tx,ctx.token,'EMPLOYEE');
      if(actor.subjectType!=='EMPLOYEE'||actor.subjectId!==ctx.actor.subjectId||actor.sessionId!==ctx.actor.sessionId)throw new TokenValidationError('TOKEN_INVALID');
      if(actor.mustChangePassword)throw new AccessDeniedError('PASSWORD_CHANGE_REQUIRED');
      const can=(permission:string)=>actor.effectivePermissions.includes(permission);
      let orderId:string;
      if(type==='ORDER'){if(!orderReader(actor))throw new AccessDeniedError('FORBIDDEN');orderId=(await ownedOrder(tx,id,actor)).id;}
      else orderId=(await ownedSale(tx,id,actor)).orderId;
      const service=can(type==='ORDER'?'order.service.read':'after-sale.service.read'),fulfillment=can('order.fulfillment.read'),inspection=can('after-sale.inspection.read'),saleService=can('after-sale.service.read');
      const offline=can('offline-case.manage')&&can('order.service.read');
      const proxy=can('customer.frozen.proxy')&&can('customer.read')&&saleService&&can('order.service.read');
      const saleIds=type==='AFTER_SALE'?Prisma.sql`SELECT ${id}::uuid`:Prisma.sql`SELECT id FROM after_sale WHERE order_id=${orderId}::uuid`;
      const sales=(column:Prisma.Sql)=>Prisma.sql`${column} IN (${saleIds})`;
      const cases=(column:Prisma.Sql)=>type==='ORDER'?Prisma.sql`${column} IN (SELECT id FROM offline_case WHERE order_id=${orderId}::uuid)`:
        Prisma.sql`${column} IN (SELECT id FROM offline_case WHERE after_sale_id=${id}::uuid)`;
      const sources:Projection[]=[];
      const stateScope:Prisma.Sql[]=[];
      if(type==='ORDER')stateScope.push(Prisma.sql`(h.aggregate_type IN ('ORDER','FULFILLMENT') AND h.aggregate_id=${orderId}::uuid)`);
      if(saleService||inspection)stateScope.push(Prisma.sql`(h.aggregate_type='AFTER_SALE' AND ${sales(Prisma.sql`h.aggregate_id`)})`);
      if(stateScope.length)sources.push({kind:'STATE_CHANGE',source:'BUSINESS_STATE_HISTORY',id:Prisma.sql`h.id`,recordedAt:Prisma.sql`h.created_at`,summary:Prisma.sql`COALESCE(h.public_text,h.to_state)`,
        internalNote:Prisma.sql`CASE WHEN (h.aggregate_type='FULFILLMENT' AND ${fulfillment}) OR (h.aggregate_type='ORDER' AND ${service}) OR (h.aggregate_type='AFTER_SALE' AND ${saleService}) THEN h.reason ELSE NULL END`,
        action:Prisma.sql`h.dimension`,beforeStatus:Prisma.sql`h.from_state`,afterStatus:Prisma.sql`h.to_state`,from:Prisma.sql`FROM business_state_history h WHERE (${Prisma.join(stateScope,' OR ')})`});
      if(fulfillment||service){
        sources.push({kind:'STATE_CHANGE',source:'TIMER_PAUSE',id:Prisma.sql`p.id`,recordedAt:Prisma.sql`p.paused_at`,summary:Prisma.sql`'收货计时暂停'::text`,afterStatus:Prisma.sql`'PAUSED'::text`,deadlineAt:Prisma.sql`p.base_due_at`,from:Prisma.sql`FROM timer_pause p WHERE p.order_id=${orderId}::uuid`});
        // 同一周期恢复另成事件，保留原暂停事实；不透传结束原因或共享阻塞来源。
        sources.push({kind:'STATE_CHANGE',source:'TIMER_RESUME',id:Prisma.sql`p.id`,recordedAt:Prisma.sql`p.resumed_at`,summary:Prisma.sql`'收货计时恢复'::text`,beforeStatus:Prisma.sql`'PAUSED'::text`,afterStatus:Prisma.sql`'RESUMED'::text`,deadlineAt:Prisma.sql`p.base_due_at`,newDueAt:Prisma.sql`p.new_due_at`,from:Prisma.sql`FROM timer_pause p WHERE p.order_id=${orderId}::uuid AND p.status='RESUMED' AND p.resumed_at IS NOT NULL`});
      }
      // 任务按业务与读取领域共同裁剪。通用reason可能含共享来源材料，因此统一不出现在聚合投影。
      const taskScopes:Prisma.Sql[]=[];
      if(type==='ORDER'){
        if(fulfillment)taskScopes.push(Prisma.sql`(t.business_type='ORDER' AND t.business_id=${orderId}::uuid AND t.stage::text IN ('SHIPMENT_PROCESS','HANDOVER_VERIFY','PHYSICAL_VERIFY','STOCK_EXCEPTION_VERIFY','SHIPMENT_EXCEPTION_VERIFY'))`);
        if(service)taskScopes.push(Prisma.sql`(t.business_type='ORDER' AND t.business_id=${orderId}::uuid AND t.stage='CUSTOMER_CONTACT')`);
        if(proxy)taskScopes.push(Prisma.sql`(t.business_type='ORDER' AND t.business_id=${orderId}::uuid AND t.stage='PROXY_INPUT')`);
        if(can('task.transfer'))taskScopes.push(Prisma.sql`(t.business_type='ORDER' AND t.business_id=${orderId}::uuid AND t.stage='ADMIN_STOCK_REVIEW')`);
      }
      if(saleService)taskScopes.push(Prisma.sql`(t.business_type='AFTER_SALE' AND ${sales(Prisma.sql`t.business_id`)} AND t.stage::text IN ('AFTER_SALE_REVIEW','SUPPLEMENT_FOLLOW','RETURN_FOLLOW','INSPECTION_EXCEPTION_CONTACT','REFUND_PROCESS'))`);
      if(inspection)taskScopes.push(Prisma.sql`(t.business_type='AFTER_SALE' AND ${sales(Prisma.sql`t.business_id`)} AND t.stage::text IN ('RETURN_RECEIVE','RETURN_INSPECT'))`);
      if(can('after-sale.dispute.decide')&&(saleService||inspection))taskScopes.push(Prisma.sql`(t.business_type='AFTER_SALE' AND ${sales(Prisma.sql`t.business_id`)} AND t.stage='ADMIN_DISPUTE')`);
      if(offline)taskScopes.push(Prisma.sql`(t.business_type='OFFLINE_CASE' AND ${cases(Prisma.sql`t.business_id`)} AND (t.stage='OFFLINE_FOLLOW' OR (t.stage='ADMIN_DISPUTE' AND ${can('after-sale.dispute.decide')})))`);
      if(inspection)taskScopes.push(Prisma.sql`(t.business_type='CUSTODY_ARRANGEMENT' AND t.business_id IN (SELECT id FROM custody_arrangement WHERE ${sales(Prisma.sql`after_sale_id`)}))`);
      if(taskScopes.length){const scope=Prisma.sql`(${Prisma.join(taskScopes,' OR ')})`;
        sources.push({kind:'TASK_CHANGE',source:'TASK_HISTORY',id:Prisma.sql`h.id`,recordedAt:Prisma.sql`h.created_at`,summary:Prisma.sql`h.action::text`,action:Prisma.sql`h.action::text`,beforeStatus:Prisma.sql`h.before_status::text`,afterStatus:Prisma.sql`h.after_status::text`,taskId:Prisma.sql`t.id`,taskStage:Prisma.sql`t.stage::text`,from:Prisma.sql`FROM task_history h JOIN task t ON t.id=h.task_id WHERE ${scope}`});
        sources.push({kind:'DEADLINE_EVENT',source:'DEADLINE_EVENT',id:Prisma.sql`e.id`,recordedAt:Prisma.sql`e.detected_at`,occurredAt:Prisma.sql`e.occurred_at`,summary:Prisma.sql`e.event_type::text`,action:Prisma.sql`e.event_type::text`,taskId:Prisma.sql`t.id`,taskStage:Prisma.sql`t.stage::text`,deadlineAt:Prisma.sql`e.deadline_at`,newDueAt:Prisma.sql`e.new_due_at`,from:Prisma.sql`FROM deadline_event e JOIN task t ON t.id=e.task_id WHERE ${scope}`});
      }
      if(service||saleService){const communications:Prisma.Sql[]=[];
        if(type==='ORDER'&&service)communications.push(Prisma.sql`(c.scope_type='ORDER' AND c.scope_id=${orderId}::uuid)`);
        if(saleService)communications.push(Prisma.sql`(c.scope_type='AFTER_SALE' AND ${sales(Prisma.sql`c.scope_id`)})`);
        if(communications.length)sources.push({kind:'COMMUNICATION',source:'COMMUNICATION',id:Prisma.sql`c.id`,recordedAt:Prisma.sql`c.created_at`,occurredAt:Prisma.sql`c.occurred_at`,summary:Prisma.sql`c.result`,internalNote:Prisma.sql`c.next_step`,action:Prisma.sql`c.channel::text`,correctsId:Prisma.sql`c.corrects_id`,from:Prisma.sql`FROM communication c WHERE (${Prisma.join(communications,' OR ')})`});
      }
      if(service)sources.push({kind:'PAYMENT',source:'PAYMENT',id:Prisma.sql`p.id`,recordedAt:Prisma.sql`p.paid_at`,summary:Prisma.sql`'模拟付款'::text`,action:Prisma.sql`p.method`,afterStatus:Prisma.sql`p.status`,amountCents:Prisma.sql`p.amount_cents`,from:Prisma.sql`FROM payment p WHERE p.order_id=${orderId}::uuid`});
      if(service&&saleService)sources.push({kind:'REFUND_ATTEMPT',source:'REFUND_ATTEMPT',id:Prisma.sql`a.id`,recordedAt:Prisma.sql`a.finished_at`,occurredAt:Prisma.sql`a.started_at`,summary:Prisma.sql`a.public_explanation`,action:Prisma.sql`a.failure_code`,afterStatus:Prisma.sql`a.outcome`,amountCents:Prisma.sql`r.amount_cents`,from:Prisma.sql`FROM refund_attempt a JOIN refund r ON r.id=a.refund_id WHERE ${type==='ORDER'?Prisma.sql`r.order_id=${orderId}::uuid`:sales(Prisma.sql`r.after_sale_id`)}`});
      if(can('inventory.read')&&(fulfillment||inspection)){
        const inventoryScope=Prisma.sql`(${type==='ORDER'?Prisma.sql`(i.business_type='ORDER' AND i.business_id=${orderId}::uuid) OR`:Prisma.empty}
          (i.business_type='PAYMENT' AND i.business_id IN (SELECT id FROM payment WHERE order_id=${orderId}::uuid)) OR
          (i.business_type='AFTER_SALE' AND ${sales(Prisma.sql`i.business_id`)}) OR
          (i.business_type='RETURN_INSPECTION' AND i.business_id IN (SELECT id FROM final_inspection WHERE ${sales(Prisma.sql`after_sale_id`)})) OR
          (i.business_type='REFUND' AND i.business_id IN (SELECT id FROM refund WHERE ${sales(Prisma.sql`after_sale_id`)})))`;
        sources.push({kind:'INVENTORY_ACTION',source:'INVENTORY_LEDGER',id:Prisma.sql`l.id`,recordedAt:Prisma.sql`l.created_at`,summary:Prisma.sql`l.event_type || ' · A ' || l.delta_a::text || ' / R ' || l.delta_r::text`,action:Prisma.sql`l.event_type`,from:Prisma.sql`FROM inventory_ledger l JOIN inventory_action i ON i.id=l.action_id WHERE ${inventoryScope}`});
        // 零可售等有效动作允许没有数量流水；仍保留其真实动作，不透传result_summary。
        sources.push({kind:'INVENTORY_ACTION',source:'INVENTORY_ACTION',id:Prisma.sql`i.id`,recordedAt:Prisma.sql`i.created_at`,summary:Prisma.sql`i.action_type`,action:Prisma.sql`i.action_type`,from:Prisma.sql`FROM inventory_action i WHERE ${inventoryScope} AND NOT EXISTS(SELECT 1 FROM inventory_ledger l WHERE l.action_id=i.id)`});
      }
      if(fulfillment||service){
        sources.push({kind:'HANDOVER',source:'HANDOVER_ATTEMPT',id:Prisma.sql`a.id`,recordedAt:Prisma.sql`a.started_at`,summary:Prisma.sql`'交运尝试'::text`,afterStatus:Prisma.sql`a.status`,from:Prisma.sql`FROM handover_attempt a WHERE a.order_id=${orderId}::uuid`});
        sources.push({kind:'HANDOVER',source:'HANDOVER_VERIFICATION',id:Prisma.sql`v.id`,recordedAt:Prisma.sql`v.created_at`,occurredAt:Prisma.sql`COALESCE(v.actual_handover_at,v.created_at)`,summary:Prisma.sql`v.conclusion`,internalNote:fulfillment?Prisma.sql`v.reason`:nil,action:Prisma.sql`v.conclusion`,from:Prisma.sql`FROM handover_verification v WHERE v.order_id=${orderId}::uuid`});
      }
      if(inspection){
        sources.push({kind:'INSPECTION',source:'RETURN_RECEIPT',id:Prisma.sql`r.id`,recordedAt:Prisma.sql`r.recorded_at`,occurredAt:Prisma.sql`r.received_at`,summary:Prisma.sql`'退货实物到仓'::text`,from:Prisma.sql`FROM return_receipt r WHERE ${sales(Prisma.sql`r.after_sale_id`)}`});
        sources.push({kind:'INSPECTION',source:'INSPECTION_REVISION',id:Prisma.sql`r.id`,recordedAt:Prisma.sql`r.created_at`,summary:Prisma.sql`'退货验收版本'::text`,internalNote:Prisma.sql`r.reason`,from:Prisma.sql`FROM return_inspection_revision r JOIN return_receipt receipt ON receipt.id=r.receipt_id WHERE ${sales(Prisma.sql`receipt.after_sale_id`)}`});
        sources.push({kind:'INSPECTION',source:'FINAL_INSPECTION',id:Prisma.sql`i.id`,recordedAt:Prisma.sql`i.confirmed_at`,summary:Prisma.sql`'最终验收确认'::text`,action:Prisma.sql`i.mode`,from:Prisma.sql`FROM final_inspection i WHERE ${sales(Prisma.sql`i.after_sale_id`)}`});
        sources.push({kind:'INSPECTION',source:'RETURN_PHYSICAL_EVENT',id:Prisma.sql`e.id`,recordedAt:Prisma.sql`e.created_at`,summary:Prisma.sql`e.kind`,internalNote:Prisma.sql`e.reason`,action:Prisma.sql`e.kind`,from:Prisma.sql`FROM return_physical_event e WHERE ${sales(Prisma.sql`e.after_sale_id`)}`});
        sources.push({kind:'INSPECTION',source:'CUSTODY_EVENT',id:Prisma.sql`e.id`,recordedAt:Prisma.sql`e.created_at`,occurredAt:Prisma.sql`e.occurred_at`,summary:Prisma.sql`COALESCE(e.public_text,e.kind)`,action:Prisma.sql`e.kind`,correctsId:Prisma.sql`e.corrects_event_id`,from:Prisma.sql`FROM custody_event e JOIN custody_arrangement c ON c.id=e.arrangement_id WHERE ${sales(Prisma.sql`c.after_sale_id`)}`});
      }
      if(offline)sources.push({kind:'OFFLINE_EVENT',source:'OFFLINE_CASE_EVENT',id:Prisma.sql`e.id`,recordedAt:Prisma.sql`e.created_at`,occurredAt:Prisma.sql`e.occurred_at`,summary:Prisma.sql`e.result`,internalNote:Prisma.sql`e.next_step`,action:Prisma.sql`e.kind`,correctsId:Prisma.sql`e.corrects_event_id`,from:Prisma.sql`FROM offline_case_event e WHERE ${cases(Prisma.sql`e.offline_case_id`)} AND (e.proxy_context_id IS NULL OR ${proxy})`});
      if(proxy)sources.push({kind:'OFFLINE_EVENT',source:'PROXY_EXECUTION',id:Prisma.sql`e.id`,recordedAt:Prisma.sql`e.created_at`,summary:Prisma.sql`'已核实身份后代录'::text`,action:Prisma.sql`e.action`,from:Prisma.sql`FROM proxy_execution e JOIN proxy_context p ON p.id=e.proxy_context_id WHERE ${type==='ORDER'?Prisma.sql`e.order_id=${orderId}::uuid`:Prisma.sql`(p.after_sale_id=${id}::uuid OR e.result_after_sale_id=${id}::uuid)`} AND (p.verified_by_id=${actor.subjectId}::uuid OR ${actor.role==='SUPER_ADMIN'})`});
      const selected=sources.filter(source=>!query.kind||source.kind===query.kind);
      if(!selected.length)return {items:[],total:0,page:query.page,pageSize:query.pageSize};
      // 只有固定来源；所有范围与字段在count前裁剪。UNION ALL不会吞掉真实失败与重试。
      const union=Prisma.join(selected.map(project),' UNION ALL ');
      const [count]=await tx.$queryRaw<{total:bigint}[]>`SELECT count(*) AS total FROM (${union}) visible_history`;
      if(count!.total>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('历史分页总量超出契约容量');
      const total=Number(count!.total),window=paginationWindow(query,total);
      // source只在规定三键完全并列时消歧；不同事实表的UUID没有跨表唯一约束。
      const items=window.skip===null?[]:await tx.$queryRaw<HistoryRow[]>`SELECT * FROM (${union}) visible_history ORDER BY "recordedAt" DESC,kind ASC,id DESC,source ASC LIMIT ${window.take} OFFSET ${window.skip}`;
      return {items,total,page:query.page,pageSize:query.pageSize};
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:5000});
  }
}
