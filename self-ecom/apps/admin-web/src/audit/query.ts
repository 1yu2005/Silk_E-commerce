// 作用：只接受审计地址栏的明确筛选，保持深层链接和北京时区输入可复查。
import type {ApiOperations} from '@shop/api-client';
export type AuditSearch=NonNullable<ApiOperations['listAuditLogs']['parameters']['query']>&{page:number;pageSize:number};
// 编译时覆盖生成契约的全部枚举，运行时也拒绝未知值，不能以类型断言隐藏未知地址参数。
const actions:Record<NonNullable<AuditSearch['action']>,true>={
  'coordination.change':true,'after-sale.change':true,'order.after-sale.pause':true,'order.fulfillment':true,'order.receipt':true,'order.create':true,'order.pay':true,'order.close':true,
  'stock.incident':true,'customer.status.change':true,'address.change':true,'cart.change':true,'inventory.action':true,'inventory.source':true,'inventory.adjustment':true,'inventory.threshold':true,'inventory.block':true,
  'category.change':true,'product.change':true,'employee.create':true,'employee.profile.update':true,'employee.disable':true,'employee.enable':true,'employee.password.reset':true,'employee.role.change':true,
  'employee.permission.replace':true,'employee.password.change':true,'customer.register':true,'customer.profile.update':true,'customer.password.change':true,'customer.avatar.change':true,'file.upload':true,
  'communication.append':true,'communication.correct':true,'auth.logout':true,'store.setting.update':true,'task.create':true,'task.stage.complete':true,'task.stage.cancel':true,'task.overdue.record':true,
  'task.claim':true,'task.release':true,'task.transfer':true,'task.qualification.lost':true,'task.deadline.extend':true,'task.receipt-start.correct':true,'task.stage.suspend':true,'task.stage.resume':true,
  'task.source.add':true,'task.source.resolve':true,'task.source.cancel':true,'order.timer.block.add':true,'order.timer.block.release':true,'order.timer.handover.record':true,'order.timer.finish':true,
};
const targets:Record<NonNullable<AuditSearch['targetType']>,string>={Coordination:'协同工单',AfterSale:'售后单',Order:'订单',StockIncident:'订单库存异常',Customer:'顾客',Address:'收货地址',CartItem:'购物车商品',InventoryAction:'库存操作',InventorySource:'库存来源',
  InventoryAdjustment:'库存登记',InventoryBalance:'库存账户',InventoryPurchaseBlock:'商品购买限制',Category:'商品分类',Product:'商品',Employee:'员工',FileAsset:'图片文件',Communication:'沟通记录',AuthSession:'登录会话',StoreSettingVersion:'店铺设置',Task:'任务'};
export const auditTargetLabel=(value:string)=>Object.hasOwn(targets,value)?targets[value as keyof typeof targets]:value;
const isAction=(value:string):value is NonNullable<AuditSearch['action']>=>Object.hasOwn(actions,value);
const isTarget=(value:string):value is NonNullable<AuditSearch['targetType']>=>Object.hasOwn(targets,value);
const isBusiness=(value:string):value is NonNullable<AuditSearch['businessType']>=>Object.hasOwn(auditBusinessLabels,value);
const keys=['page','pageSize','actorType','actorEmployeeId','actorCustomerId','action','targetType','targetId','businessType','businessNo','requestId','from','to'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const date=(s:string)=>/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d{2}:\d{2})$/i.test(s)&&Number.isFinite(Date.parse(s));
export const auditBusinessLabels:Record<string,string>={ORDER:'订单',AFTER_SALE:'售后',REFUND:'退款',INVENTORY_ADJUSTMENT:'库存调整',OFFLINE_CASE:'线下工单'};
export function canReadAudit(permissions:{effectivePermissions:readonly string[]}|null|undefined){return permissions?.effectivePermissions.includes('audit.read')??false;}
export function auditIdIssue(id:string){return uuid.test(id)?null:'审计编号格式无效';}
export function parseAuditSearch(search:string):{query:AuditSearch;error?:never}|{query?:never;error:string}{
  const p=new URLSearchParams(search),bad=(error:string)=>({error});
  for(const key of p.keys())if(!keys.includes(key)||p.getAll(key).length!==1)return bad('查询参数不受支持，请重置筛选');
  const a=p.get('page')??'1',b=p.get('pageSize')??'20',page=Number(a),pageSize=Number(b);
  if(!/^[1-9]\d*$/.test(a)||!/^[1-9]\d*$/.test(b)||!Number.isSafeInteger(page)||!Number.isSafeInteger(pageSize)||pageSize>100)return bad('页码须为正整数，每页1～100条');
  if(BigInt(page)*BigInt(pageSize)>10000n)return bad('最多定位10000条，请缩小筛选范围');
  const data:Record<string,string>={};for(const key of keys.slice(2)){const raw=p.get(key);if(raw===null)continue;const value=raw.trim();if(!value)return bad('筛选值不能为空，请移除空筛选');data[key]=value;}
  const query:AuditSearch={page,pageSize};
  if(data.actorType){if(data.actorType!=='EMPLOYEE'&&data.actorType!=='CUSTOMER'&&data.actorType!=='SYSTEM')return bad('主体类型无效');query.actorType=data.actorType;}
  for(const key of ['actorEmployeeId','actorCustomerId'])if(data[key]&&!uuid.test(data[key]))return bad('主体编号格式无效');
  if(data.actorEmployeeId&&data.actorCustomerId||data.actorEmployeeId&&data.actorType&&data.actorType!=='EMPLOYEE'||data.actorCustomerId&&data.actorType&&data.actorType!=='CUSTOMER')return bad('主体类型与人员筛选不匹配');
  if(data.businessType){if(!isBusiness(data.businessType))return bad('业务类型无效');query.businessType=data.businessType;}
  if(data.action){if(!isAction(data.action))return bad('操作动作无效');query.action=data.action;}
  if(data.targetType){if(!isTarget(data.targetType))return bad('对象类型无效');query.targetType=data.targetType;}
  for(const key of ['action','targetType','targetId','businessNo'])if(data[key]&&data[key].length>100)return bad('筛选内容过长');
  if(data.requestId&&!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(data.requestId))return bad('请求编号格式无效');
  if(data.from&&!date(data.from)||data.to&&!date(data.to))return bad('时间须为包含时区的ISO日期');
  if(data.from&&data.to){const gap=Date.parse(data.to)-Date.parse(data.from);if(gap<=0)return bad('结束时间必须晚于开始时间');if(gap>366*86_400_000)return bad('时间范围最多366天');}
  for(const key of ['actorEmployeeId','actorCustomerId','targetId','businessNo','requestId','from','to'] as const)if(data[key])query[key]=data[key];
  return {query};
}
export function auditSearchParams(query:AuditSearch){const p=new URLSearchParams();for(const key of keys){const value=query[key as keyof AuditSearch];if(value!==undefined)p.set(key,String(value));}return p;}
export function auditLocalTime(iso:string|undefined){return iso?new Date(Date.parse(iso)+8*3_600_000).toISOString().slice(0,19):'';}
export function auditTimeFromInput(value:string){return value?new Date(value+'+08:00').toISOString():undefined;}
export const auditDate=(iso:string)=>new Date(iso).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const statuses:Record<string,string>={WAIT_PAYMENT:'待付款',WAIT_SHIPMENT:'待发货',SHIPPED:'已交运',COMPLETED:'已完成',CLOSED:'已结束',REFUNDED:'已退款',
  ACTIVE:'启用',DISABLED:'停用',NORMAL:'正常',TRADE_RESTRICTED:'限制交易',LOGIN_FROZEN:'冻结登录',OPEN:'待领取',CLAIMED:'已领取',CANCELLED:'已取消',SUSPENDED:'已暂停',
  PENDING_REVIEW:'待审核',WAIT_SUPPLEMENT:'待补充',WAIT_FULFILLMENT_CHECK:'待实物核实',WAIT_REFUND:'待退款',WAIT_RETURN:'待寄回',WAIT_RECEIPT:'待收包',WAIT_INSPECTION:'待验收',
  INSPECTION_EXCEPTION:'验收异常',FINAL_INSPECTION:'已最终验收',REFUNDING:'退款处理中',REFUND_FAILED:'退款失败',REJECTED:'已拒绝',WITHDRAWN:'已撤回',SUCCEEDED:'已成功',
  SUPER_ADMIN:'超级管理员',MERCH_WAREHOUSE:'商品与仓储',CUSTOMER_SERVICE:'客服',SYSTEM:'系统',EMPLOYEE:'员工',CUSTOMER:'顾客',IN_PROGRESS:'执行中',WAIT_EXTERNAL:'等待外部',RESOLVED:'已解决',
  VERIFIED:'核实可用',CONSUMED:'已使用',INVALIDATED:'已失效',PLANNED:'已安排',DECIDED:'已决定',HANDED_OFF:'已移交',EXCEPTION:'异常'};
export function auditValue(field:string,value:unknown):string{
  if(value===null||value===undefined)return '未记录';if(typeof value==='boolean')return value?'是':'否';if(Array.isArray(value))return value.join('、')||'无';
  if(field==='amountCents'&&(typeof value==='number'||typeof value==='string')&&/^-?\d+$/.test(String(value))){const n=BigInt(value);const v=n<0n?-n:n;return `${n<0n?'-':''}${v/100n}.${String(v%100n).padStart(2,'0')} 元`;}
  if(typeof value==='string'&&/^\d{4}-\d\d-\d\dT/.test(value))return auditDate(value);
  return typeof value==='string'?statuses[value]??value:String(value);
}
