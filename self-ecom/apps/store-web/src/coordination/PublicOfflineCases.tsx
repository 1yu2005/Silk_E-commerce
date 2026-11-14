// 作用：本人订单/售后仅显示后端公开投影，线下事项不代表系统资金或库存变化。
import {catalog} from '../services/api';
type Case=Awaited<ReturnType<typeof catalog.getMyAfterSale>>['data']['offlineCases'][number];
const statuses:Record<string,string>={OPEN:'待处理',IN_PROGRESS:'处理中',WAIT_EXTERNAL:'等待外部',RESOLVED:'已解决',CLOSED:'已结束'};
export function PublicOfflineCases({cases}:{cases:Case[]}){return cases.length?<section><h2>线下服务进展</h2><p>以下为店铺公开说明。线下费用和协商结果不改变系统支付、退款或库存事实。</p>{cases.map(c=><article className="catalog-card" key={c.id}><h3>{c.subject} · {statuses[c.status]??c.status}</h3><small>{c.caseNo}</small><p>{c.publicSummary}</p><ol>{c.events.map(e=><li key={e.id}>{new Date(e.occurredAt).toLocaleString('zh-CN')} · {e.publicText}{e.correctsEventId?'（追加更正，原记录保留）':''}</li>)}</ol></article>)}</section>:null;}
