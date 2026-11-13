// 作用：服装商城入口，分类、搜索和排序读取真实公开商品，不制造热销或库存。
import { useCallback,useMemo,useState } from 'react';
import { Button,Pagination } from 'antd';
import { Link,useLocation,useSearchParams } from 'react-router-dom';
import { catalog } from '../services/api';
import { flatten,parseSearch,price,type Category,type ProductQuery } from '../catalog/model';
import { usePublicQuery } from '../catalog/use-public-query';
import { StoreQueryState } from '../catalog/StoreQueryState';
export function HomePage(){
  const [params,setParams]=useSearchParams(),location=useLocation();const search=params.toString();const query=useMemo(()=>parseSearch(search),[search]);const [retry,setRetry]=useState(0);
  return <div className="store-catalog">{location.pathname==='/'?<section className="clothing-hero"><div><span className="store-kicker">THE EVERYDAY WARDROBE</span><h1>穿着，<br/><em>自在一点。</em></h1><p>从一件喜欢的日常开始。<br/>找到属于你的颜色、尺码与舒适。</p><a className="store-primary-link" href="#collection">浏览全部款式 <span>↘</span></a></div><div className="hero-garment" aria-hidden="true"><span className="hero-caption">LESS, BUT BETTER.</span><svg viewBox="0 0 420 450"><path d="M152 82 92 113 28 214 105 258 129 222 122 403 297 403 290 222 315 258 392 214 329 113 269 82 Q210 121 152 82Z" fill="#c3ae8d" stroke="#685a45" strokeWidth="2"/><path d="M152 82Q210 155 269 82M129 222 137 126M290 222 282 126M141 383 278 383" fill="none" stroke="#8b795d" strokeWidth="2"/></svg><span className="hero-footnote">日常衣橱 / 自营精选</span></div></section>:null}
    <section id="collection" className="collection"><div className="collection-heading"><div><span className="store-kicker">EXPLORE THE COLLECTION</span><h2>找到你的日常款</h2></div><span>款式 · 颜色 · 尺码</span></div>
      {query?<Collection key={search+':'+retry} query={query} setParams={setParams} retry={()=>setRetry(n=>n+1)}/>:<div role="alert"><p>筛选地址不正确，请重新选择。</p><Button onClick={()=>setParams({})}>重置筛选</Button></div>}
    </section></div>;
}
function Collection({query,setParams,retry}:{query:ProductQuery;setParams:(p:URLSearchParams|Record<string,string>)=>void;retry:()=>void}){
  const load=useCallback(async(signal:AbortSignal)=>{const [products,categories]=await Promise.all([catalog.listStoreProducts({query,signal}),catalog.getStoreCategoryTree({signal})]);return {products:products.data,categories:categories.data};},[query]);
  const state=usePublicQuery(load);
  const change=(patch:Record<string,string|number|undefined>)=>{const p=new URLSearchParams();for(const [k,v]of Object.entries({...query,...patch}))if(v!==undefined&&v!==''&&k!=='pageSize')p.set(k,String(v));setParams(p);};
  return <><form className="store-search" onSubmit={e=>{e.preventDefault();change({keyword:String(new FormData(e.currentTarget).get('keyword')).trim(),page:1});}}><label htmlFor="product-search">寻找喜欢的款式</label><div><input id="product-search" name="keyword" placeholder="搜索商品名称" defaultValue={query.keyword} maxLength={50}/><button type="submit">搜索 →</button></div></form>
    <div className="collection-layout"><aside aria-label="商品分类"><h3>按分类浏览</h3><button className={!query.categoryId?'selected':''} onClick={()=>change({categoryId:undefined,page:1})}>全部款式</button>{flatten((state?.data?.categories??[]) as Category[]).map(c=><button key={c.id} style={{paddingLeft:16+c.level*15}} className={c.id===query.categoryId?'selected':''} onClick={()=>change({categoryId:c.id,page:1})}>{c.name}</button>)}</aside>
      <div><div className="collection-toolbar"><span>{state?.data?`${state.data.products.total} 件商品`:'商品精选'}</span><label>排序 <select aria-label="排序" value={query.sort??'NEWEST'} onChange={e=>change({sort:e.target.value,page:1})}><option value="NEWEST">最新上架</option><option value="PRICE_ASC">价格从低到高</option><option value="PRICE_DESC">价格从高到低</option><option value="SALES_DESC">累计销量</option></select></label></div>
        {!state?.data?<StoreQueryState error={state?.error} retry={retry}/>:<>{state.data.products.items.length?<div className="product-grid">{state.data.products.items.map((p,i)=><article className="store-product-card" key={p.id}><Link to={'/products/'+p.id}><div className="product-image">{p.mainImageUrl?<img src={p.mainImageUrl} alt={p.name} loading={i<3?'eager':'lazy'} decoding="async"/>:<span>图片准备中</span>}{!p.purchasable?<span className="availability-label">{p.availableQuantity==='0'?'暂时缺货':'暂不可购买'}</span>:null}</div><div className="product-card-copy"><span className="product-brand">{p.brand??'日常精选'}</span><h3>{p.name}</h3><div><strong>{price(p.priceFromCents)}</strong><span>已售 {p.paidSalesCount}</span></div></div></Link></article>)}</div>:<div className="collection-empty"><span aria-hidden="true">—</span><h3>{query.keyword||query.categoryId?'没有找到匹配的款式':'新款正在准备中'}</h3><p>{query.keyword||query.categoryId?'换一个关键词，或浏览全部款式。':'舒适的日常，值得慢慢挑选。稍后再来看看。'}</p>{query.keyword||query.categoryId?<Button onClick={()=>setParams({})}>浏览全部款式</Button>:null}</div>}
          <Pagination current={query.page??1} pageSize={12} total={state.data.products.total} onChange={page=>change({page})} showSizeChanger={false}/></>}
      </div></div></>;
}
