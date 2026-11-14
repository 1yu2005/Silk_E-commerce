// 作用：在线写入和历史补齐共用真实关系解析；不信任快照中的业务ID，不按requestId猜归属。
import { type AuditBusinessType, type Prisma } from '@prisma/client';

export interface AuditReferenceSource {
  id: string;
  targetType: string;
  targetId: string;
  action: string;
  afterData: unknown;
}
export type AuditReference = Pick<Prisma.AuditBusinessReferenceCreateManyInput, 'auditLogId'|'businessType'|'businessId'|'businessNo'>;
export interface ReferenceDiagnostic { auditLogId: string; reason: 'NON_UUID_TARGET'|'UNKNOWN_RELATIONSHIP'|'MISSING_OBJECT' }
type Node = { auditLogId: string; kind: string; id: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const roots: Record<string, string> = { ORDER:'Order', PAYMENT:'Payment', AFTER_SALE:'AfterSale', REFUND:'Refund', RETURN_INSPECTION:'FinalInspection', ADJUSTMENT:'InventoryAdjustment', INVENTORY_ADJUSTMENT:'InventoryAdjustment', OFFLINE_CASE:'OfflineCase', CUSTODY_ARRANGEMENT:'CustodyArrangement' };
const supported = new Set(['Order','AfterSale','Refund','InventoryAdjustment','OfflineCase','Task','InventoryAction','StockIncident','Communication','Coordination','ProxyContext','InventoryPurchaseBlock','Payment','FinalInspection','CustodyArrangement','CustodyEvent','DisputeRequest','DisputeDecision','ShipmentException','AddressRequest']);
const unscoped = new Set(['Employee','Customer','Address','CartItem','Category','Product','FileAsset','AuthSession','StoreSettingVersion','InventoryBalance','InventorySource']);
const coordinationRoutes: Record<string,string> = {
  'custody.correction-followup':'Task', 'custody.event':'CustodyEvent',
  'dispute.followup':'Task', 'dispute.request':'DisputeRequest', 'dispute.close':'DisputeDecision',
  'exception-handoff':'ShipmentException',
  open:'AddressRequest', 'physical-verified':'AddressRequest', 'continue-original':'AddressRequest',
  'cancel-reorder':'AddressRequest', 'handoff-offline':'AddressRequest', 'handoff-after-sale':'AddressRequest',
  create:'OfflineCase', begin:'OfflineCase', event:'OfflineCase', resolve:'OfflineCase', close:'OfflineCase',
};
function field(data: unknown, name: string): string | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  const value = (data as Record<string,unknown>)[name];
  return typeof value === 'string' ? value : undefined;
}

/** 每轮按实体种类批量查询，查询数随关系深度而非日志条数增长；不会查询UUID列中的历史非UUID值。 */
export async function resolveAuditBusinessReferences(tx: Prisma.TransactionClient, sources: readonly AuditReferenceSource[]) {
  const references = new Map<string,AuditReference>(), diagnostics: ReferenceDiagnostic[] = [];
  const seen = new Set<string>(), sourceMap = new Map(sources.map(s=>[s.id,s]));
  let pending: Node[] = [];
  const enqueue = (auditLogId:string,kind:string,id:string|null|undefined) => {
    if (!id || !uuid.test(id)) return;
    const canonicalId=id.toLowerCase(),key = auditLogId+':'+kind+':'+canonicalId;
    if (!seen.has(key)) { seen.add(key); pending.push({auditLogId,kind,id:canonicalId}); }
  };
  const add = (node:Node,businessType:AuditBusinessType,businessNo:string) => {
    references.set(node.auditLogId+':'+businessType+':'+node.id,{auditLogId:node.auditLogId,businessType,businessId:node.id,businessNo});
  };
  for (const source of sources) {
    if (!supported.has(source.targetType)) { // 身份/商品/文件上传等无本期业务范围，非缺失错误。
      if(!unscoped.has(source.targetType))diagnostics.push({auditLogId:source.id,reason:'UNKNOWN_RELATIONSHIP'});
      continue;
    }
    if (!uuid.test(source.targetId)) { diagnostics.push({auditLogId:source.id,reason:'NON_UUID_TARGET'}); continue; }
    let kind = source.targetType;
    if (kind==='Coordination') {
      const action=field(source.afterData,'coordinationAction');
      const route=action?.startsWith('proxy-')?'ProxyContext':coordinationRoutes[action??''];
      if (!route) { diagnostics.push({auditLogId:source.id,reason:'UNKNOWN_RELATIONSHIP'}); continue; }
      kind=route;
    }
    enqueue(source.id,kind,source.targetId);
  }
  while (pending.length) {
    const current=pending; pending=[];
    const groups=new Map<string,Node[]>();
    for (const node of current) { const group=groups.get(node.kind)??[];group.push(node);groups.set(node.kind,group); }
    for (const [kind,nodes] of groups) {
      const ids=[...new Set(nodes.map(n=>n.id))];
      const distribute=<T extends {id:string}>(rows:T[], visit:(node:Node,row:T)=>void) => {
        const byId=new Map(rows.map(row=>[row.id,row]));
        for (const node of nodes) { const row=byId.get(node.id);if(row)visit(node,row);else diagnostics.push({auditLogId:node.auditLogId,reason:'MISSING_OBJECT'}); }
      };
      switch(kind) {
        case 'Order': distribute(await tx.order.findMany({where:{id:{in:ids}},select:{id:true,number:true}}),(n,r)=>add(n,'ORDER',r.number));break;
        case 'Payment': distribute(await tx.payment.findMany({where:{id:{in:ids}},select:{id:true,orderId:true}}),(n,r)=>enqueue(n.auditLogId,'Order',r.orderId));break;
        case 'FinalInspection': distribute(await tx.finalInspection.findMany({where:{id:{in:ids}},select:{id:true,afterSaleId:true}}),(n,r)=>enqueue(n.auditLogId,'AfterSale',r.afterSaleId));break;
        case 'AfterSale': {
          const rows=await tx.afterSale.findMany({where:{id:{in:ids}},select:{id:true,number:true,orderId:true,refundId:true}});
          distribute(rows,(n,r)=>{add(n,'AFTER_SALE',r.number);enqueue(n.auditLogId,'Order',r.orderId);
            // 只将明确退款动作关联到真实退款，不把后来退款回写到早期申请/审核日志。
            if(['refund','refund-retry'].includes(field(sourceMap.get(n.auditLogId)?.afterData,'afterSaleAction')??''))enqueue(n.auditLogId,'Refund',r.refundId);
          });break;
        }
        case 'Refund': distribute(await tx.refund.findMany({where:{id:{in:ids}},select:{id:true,refundNo:true,orderId:true,afterSaleId:true}}),(n,r)=>{add(n,'REFUND',r.refundNo);enqueue(n.auditLogId,'Order',r.orderId);enqueue(n.auditLogId,'AfterSale',r.afterSaleId);});break;
        case 'InventoryAdjustment': distribute(await tx.inventoryAdjustment.findMany({where:{id:{in:ids}},select:{id:true,number:true}}),(n,r)=>add(n,'INVENTORY_ADJUSTMENT',r.number));break;
        case 'OfflineCase': distribute(await tx.offlineCase.findMany({where:{id:{in:ids}},select:{id:true,caseNo:true,orderId:true,afterSaleId:true}}),(n,r)=>{add(n,'OFFLINE_CASE',r.caseNo);enqueue(n.auditLogId,'Order',r.orderId);enqueue(n.auditLogId,'AfterSale',r.afterSaleId);});break;
        case 'Task': distribute(await tx.task.findMany({where:{id:{in:ids}},select:{id:true,businessType:true,businessId:true}}),(n,r)=>{const root=roots[r.businessType];if(root)enqueue(n.auditLogId,root,r.businessId);else diagnostics.push({auditLogId:n.auditLogId,reason:'UNKNOWN_RELATIONSHIP'});});break;
        case 'InventoryAction': distribute(await tx.inventoryAction.findMany({where:{id:{in:ids}},select:{id:true,businessType:true,businessId:true,adjustmentId:true}}),(n,r)=>{const root=roots[r.businessType];if(root)enqueue(n.auditLogId,root,r.businessId);enqueue(n.auditLogId,'InventoryAdjustment',r.adjustmentId);if(!root&&!r.adjustmentId)diagnostics.push({auditLogId:n.auditLogId,reason:'UNKNOWN_RELATIONSHIP'});});break;
        case 'StockIncident': distribute(await tx.stockIncident.findMany({where:{id:{in:ids}},select:{id:true,items:{select:{orderItem:{select:{orderId:true}}}}}}),(n,r)=>{for(const item of r.items)enqueue(n.auditLogId,'Order',item.orderItem.orderId);});break;
        case 'Communication': distribute(await tx.communication.findMany({where:{id:{in:ids}},select:{id:true,scopeType:true,scopeId:true}}),(n,r)=>{const root=roots[r.scopeType];if(root)enqueue(n.auditLogId,root,r.scopeId);});break;
        case 'AddressRequest': distribute(await tx.addressRequest.findMany({where:{id:{in:ids}},select:{id:true,orderId:true,handoffAfterSaleId:true,handoffOfflineCaseId:true}}),(n,r)=>{enqueue(n.auditLogId,'Order',r.orderId);const action=field(sourceMap.get(n.auditLogId)?.afterData,'coordinationAction');if(action==='handoff-after-sale')enqueue(n.auditLogId,'AfterSale',r.handoffAfterSaleId);if(action==='handoff-offline')enqueue(n.auditLogId,'OfflineCase',r.handoffOfflineCaseId);});break;
        case 'DisputeRequest': distribute(await tx.disputeRequest.findMany({where:{id:{in:ids}},select:{id:true,afterSaleId:true}}),(n,r)=>enqueue(n.auditLogId,'AfterSale',r.afterSaleId));break;
        case 'DisputeDecision': distribute(await tx.disputeDecision.findMany({where:{id:{in:ids}},select:{id:true,afterSaleId:true}}),(n,r)=>enqueue(n.auditLogId,'AfterSale',r.afterSaleId));break;
        case 'CustodyEvent': distribute(await tx.custodyEvent.findMany({where:{id:{in:ids}},select:{id:true,arrangementId:true}}),(n,r)=>enqueue(n.auditLogId,'CustodyArrangement',r.arrangementId));break;
        case 'CustodyArrangement': distribute(await tx.custodyArrangement.findMany({where:{id:{in:ids}},select:{id:true,afterSaleId:true}}),(n,r)=>enqueue(n.auditLogId,'AfterSale',r.afterSaleId));break;
        case 'ShipmentException': {
          distribute(await tx.shipmentException.findMany({where:{id:{in:ids}},select:{id:true,orderId:true}}),(n,r)=>enqueue(n.auditLogId,'Order',r.orderId));
          const handoffs=await tx.coordinationHandoff.findMany({where:{sourceType:'SHIPMENT_EXCEPTION',sourceId:{in:ids}},select:{sourceId:true,afterSaleId:true}});
          // 审计中的结果ID只有与真实handoff两端同时匹配才可用，不把后来的移交挂回旧日志。
          for(const node of nodes)for(const handoff of handoffs)if(handoff.sourceId===node.id&&handoff.afterSaleId===field(sourceMap.get(node.auditLogId)?.afterData,'sourceId'))enqueue(node.auditLogId,'AfterSale',handoff.afterSaleId);
          break;
        }
        case 'ProxyContext': {
          distribute(await tx.proxyContext.findMany({where:{id:{in:ids}},select:{id:true,orderId:true,afterSaleId:true,offlineCaseId:true}}),(n,r)=>{enqueue(n.auditLogId,'Order',r.orderId);enqueue(n.auditLogId,'AfterSale',r.afterSaleId);enqueue(n.auditLogId,'OfflineCase',r.offlineCaseId);});
          // 已消费代录的结果是可证实的关联；创建/失效日志不倒挂到后来的结果。
          const consumed=nodes.filter(n=>{const a=field(sourceMap.get(n.auditLogId)?.afterData,'coordinationAction');return a?.startsWith('proxy-')&&!a.startsWith('proxy-context-');});
          if(consumed.length){const results=await tx.proxyExecution.findMany({where:{proxyContextId:{in:consumed.map(n=>n.id)}},select:{proxyContextId:true,resultAfterSaleId:true}});for(const n of consumed)enqueue(n.auditLogId,'AfterSale',results.find(r=>r.proxyContextId===n.id)?.resultAfterSaleId);}
          break;
        }
        case 'InventoryPurchaseBlock': distribute(await tx.inventoryPurchaseBlock.findMany({where:{id:{in:ids}},select:{id:true,sourceType:true,sourceId:true}}),(n,r)=>{const root=roots[r.sourceType];if(root)enqueue(n.auditLogId,root,r.sourceId);else if(['STOCK_INCIDENT','ORDER_STOCK_EXCEPTION'].includes(r.sourceType))enqueue(n.auditLogId,'StockIncident',r.sourceId);});break;
      }
    }
  }
  return {references:[...references.values()],diagnostics};
}

export async function appendAuditBusinessReferences(tx:Prisma.TransactionClient,sources:readonly AuditReferenceSource[]) {
  const resolved=await resolveAuditBusinessReferences(tx,sources);
  const inserted=resolved.references.length?await tx.auditBusinessReference.createMany({data:resolved.references,skipDuplicates:true}):{count:0};
  return {...resolved,inserted:inserted.count};
}
