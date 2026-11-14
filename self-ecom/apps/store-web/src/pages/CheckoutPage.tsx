// 作用：服务器报价与明确确认；网络恢复沿原购买键，任何新价格都须重新确认。
import {useCallback,useEffect,useRef,useState} from 'react';
import {Alert,Button,Empty,Spin} from 'antd';
import {Link,useNavigate} from 'react-router-dom';
import {ApiClientError} from '@shop/api-client';
import {catalog,session} from '../services/api';
import {useCustomerAuth} from '../auth/use-customer-auth';
import {AuthError} from '../auth/AuthError';
import {useStoreQuery} from '../customers/use-store-data';
import {money} from '../customers/model';
import {PURCHASE_KEY,readConfirmation,type PurchaseConfirmation} from '../customers/purchase-confirmation';
type Quote=Awaited<ReturnType<typeof catalog.previewCheckout>>['data'];
session.subscribe(()=>{try{sessionStorage.removeItem(PURCHASE_KEY);}catch{/* 禁用存储时仅本页恢复。 */}});
export function CheckoutPage(){const auth=useCustomerAuth();return <Checkout key={auth.customer?.id??''} customerId={auth.customer?.id??''}/>;}
function Checkout({customerId}:{customerId:string}){
 const navigate=useNavigate(),[addressId,setAddressId]=useState(''),[quote,setQuote]=useState<Quote>(),[pending,setPending]=useState<PurchaseConfirmation|null>(()=>readConfirmation(()=>sessionStorage,customerId)),[error,setError]=useState<unknown>(),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(!!pending),[epoch,setEpoch]=useState(0);const running=useRef(false),alive=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const load=useCallback(async(signal:AbortSignal)=>{const [a,first]=await Promise.all([catalog.listAddresses({signal}),catalog.getCart({query:{page:1,pageSize:100},signal})]);const rows=[...first.data.items];for(let page=2;rows.length<first.data.total;page++)rows.push(...(await catalog.getCart({query:{page,pageSize:100},signal})).data.items);return {addresses:a.data.items,rows};},[]);const state=useStoreQuery(load,'checkout:'+epoch);const data=state?.data;
 const selected=data?.rows.filter(r=>r.selected)??[];const chosen=addressId||data?.addresses.find(a=>a.isDefault)?.id||data?.addresses[0]?.id||'';
 const valid=!!chosen&&selected.length>0&&selected.length<=100&&selected.every(i=>i.validity==='VALID');
 function clear(){sessionStorage.removeItem(PURCHASE_KEY);setPending(null);setQuote(undefined);setUncertain(false);setError(undefined);setEpoch(e=>e+1);}
 async function preview(){if(running.current||!valid)return;running.current=true;setBusy(true);setError(undefined);const revision=session.current().revision;try{const result=await catalog.previewCheckout({body:{addressId:chosen,items:selected.map(i=>({cartItemId:i.id,skuId:i.skuId,quantity:i.quantity}))}});if(alive.current&&session.current().revision===revision){sessionStorage.removeItem(PURCHASE_KEY);setPending(null);setUncertain(false);setQuote(result.data);}}catch(e){if(alive.current&&session.current().revision===revision)setError(e);}finally{running.current=false;if(alive.current&&session.current().revision===revision)setBusy(false);}}
 async function submit(){if(running.current||(!quote&&!pending))return;running.current=true;setBusy(true);setError(undefined);const revision=session.current().revision;
  const confirmation=pending??{customerId,key:crypto.randomUUID(),body:{quoteId:quote!.quoteId,addressId:quote!.addressId,items:quote!.items.map(i=>({cartItemId:i.cartItemId,skuId:i.skuId,quantity:i.quantity}))}};
  // 存储失败时不发送：确保用户刷新也能拿回本次购买结果。
  try{sessionStorage.setItem(PURCHASE_KEY,JSON.stringify(confirmation));setPending(confirmation);for(let attempt=0;attempt<3;attempt++){try{const result=await catalog.createOrder({body:confirmation.body,headers:{'Idempotency-Key':confirmation.key}});if(alive.current&&session.current().revision===revision){sessionStorage.removeItem(PURCHASE_KEY);navigate('/orders/'+result.data.orderId);}return;}catch(e){if(e instanceof ApiClientError&&e.code==='REQUEST_IN_PROGRESS'&&attempt<2){await new Promise(resolve=>setTimeout(resolve,Math.min(e.retryAfterSeconds??1,5)*1000));if(!alive.current||session.current().revision!==revision)return;continue;}throw e;}}}
  catch(e){if(alive.current&&session.current().revision===revision){setError(e);setUncertain(!(e instanceof ApiClientError)||!e.status||e.status>=500||e.code==='REQUEST_IN_PROGRESS');}}
  finally{running.current=false;if(alive.current&&session.current().revision===revision)setBusy(false);}
 }
 return <section className="customer-workspace"><div className="customer-heading"><div><span className="store-kicker">CONFIRM YOUR PICKS</span><h1>确认订单</h1><p>核对收货资料、商品和最终金额，再提交本次购买。</p></div><Link to="/cart">返回购物车 →</Link></div><Alert type="info" title="模拟交易，不发生真实资金流转"/><AuthError error={error}/>
 {pending?<Alert className="auth-notice" type="warning" title={uncertain?'请先确认本次订单结果':'本次请求需要重新核对'} description="恢复请求会沿用原确认键和原购买清单，已经成功时直接打开原订单。" action={<Button loading={busy} onClick={()=>void submit()}>确认订单结果</Button>}/>:null}
 {pending&&!uncertain?<Button disabled={busy} onClick={clear}>重新读取商品和报价</Button>:null}
 {!data?<>{state?.error?<AuthError error={state.error}/>:<Spin/>}<Button onClick={()=>setEpoch(e=>e+1)}>重读结算资料</Button></>:<>
 {!data.addresses.length?<Empty description={<span>请先<Link to="/addresses">添加收货地址</Link></span>}/>:<label className="checkout-address">收货地址<select aria-label="收货地址" value={chosen} disabled={busy||!!pending} onChange={e=>{setAddressId(e.target.value);setQuote(undefined);}}>{data.addresses.map(a=><option key={a.id} value={a.id}>{a.receiver} / {a.phone} / {a.province}{a.city}{a.district}{a.detail}{a.isDefault?'（默认）':''}</option>)}</select></label>}
 {!selected.length?<Empty description="购物车没有已选商品；如有未确认请求，请先恢复结果。"/>:<div className="checkout-lines">{selected.map(i=><article className="catalog-card" key={i.id}><strong>{i.productName}</strong><p>{i.choices.map(c=>c.dimension+' '+c.value).join(' / ')} · {i.quantity} 件 · {money(i.unitPriceCents)}</p>{i.validity!=='VALID'?<Alert type="warning" title={i.validityMessage}/>:null}</article>)}</div>}
 {selected.length>100?<Alert type="warning" title="单笔订单最多100个规格，请回购物车减少本次勾选。"/>:null}
 {!pending?<Button disabled={!valid||busy} onClick={()=>void preview()}>{quote?'重新获取报价':'获取服务器报价'}</Button>:null}
 {quote?<aside className="cart-summary"><h2>本次服务器报价</h2><p>{quote.address.receiver} · {quote.address.phone} · {quote.address.province}{quote.address.city}{quote.address.district}{quote.address.detail}</p><p>商品 {money(quote.goodsAmountCents)} + 运费 {money(quote.shippingFeeCents)}</p><strong>应付 {money(quote.payableCents)}</strong><p>报价有效至 {new Date(quote.expiresAt).toLocaleTimeString()}，提交成功后按订单付款截止为准。</p>{!pending?<Button type="primary" loading={busy} onClick={()=>void submit()}>确认金额并创建订单</Button>:null}</aside>:null}
 </>}</section>;
}
