// 作用：顾客选择完整SKU，展示真实价格及A，并通过正式接口加购。
import { useCallback,useState } from 'react';
import { Link,useParams } from 'react-router-dom';
import { catalog } from '../services/api';
import { usePublicQuery } from '../catalog/use-public-query';
import { StoreQueryState } from '../catalog/StoreQueryState';
import { price,type Product } from '../catalog/model';
import { AddToCart } from '../customers/AddToCart';
import { useCustomerAuth } from '../auth/use-customer-auth';
export function ProductDetailPage(){const {id=''}=useParams();const [retry,setRetry]=useState(0);return <ProductLoader key={id+':'+retry} id={id} retry={()=>setRetry(n=>n+1)}/>;}
function ProductLoader({id,retry}:{id:string;retry:()=>void}){
  const load=useCallback(async(signal:AbortSignal)=>(await catalog.getStoreProduct({path:{id},signal})).data,[id]);const state=usePublicQuery(load);
  return !state?.data?<StoreQueryState error={state?.error} retry={retry}/>:<ProductView product={state.data}/>;
}
function ProductView({product:p}:{product:Product}){
  const auth=useCustomerAuth();
  const [selected,setSelected]=useState<Record<string,string>>({}),[image,setImage]=useState(p.mainImageUrl);
  const complete=p.specDimensions.every(d=>selected[d.id]);const sku=complete?p.skus.find(s=>s.choices.every(c=>selected[c.dimensionId]===c.valueId)):undefined;
  const possible=(dimensionId:string,valueId:string)=>p.skus.some(s=>s.choices.some(c=>c.dimensionId===dimensionId&&c.valueId===valueId)&&Object.entries(selected).every(([d,v])=>d===dimensionId||s.choices.some(c=>c.dimensionId===d&&c.valueId===v)));
  const gallery=[...new Set([p.mainImageUrl,...p.galleryImageUrls].filter((v):v is string=>!!v))];
  return <article className="store-product-detail"><nav className="product-breadcrumb" aria-label="当前位置"><Link to="/products">全部款式</Link>{p.categoryPath.map(c=><span key={c.id}> / <Link to={'/products?categoryId='+c.id}>{c.name}</Link></span>)}</nav>
    <div className="product-detail-grid"><div><div className="detail-main-image">{image?<img src={image} alt={p.name}/>:<span>商品图片准备中</span>}</div>{gallery.length>1?<div className="detail-thumbnails">{gallery.map((src,i)=><button key={src} aria-label={'查看商品图片'+(i+1)} aria-pressed={image===src} onClick={()=>setImage(src)}><img src={src} alt=""/></button>)}</div>:null}</div>
      <div className="detail-copy"><span className="store-kicker">{p.brand??'THE EVERYDAY WARDROBE'}</span><h1>{p.name}</h1><p className="detail-price">{sku?price(sku.priceCents):price(p.priceFromCents)}{!complete&&p.priceFromCents!==null?<small> 起</small>:null}</p>
        <div className="detail-specs">{p.specDimensions.map(d=><fieldset key={d.id}><legend>{d.name} {selected[d.id]?<span>· {d.values.find(v=>v.id===selected[d.id])?.name}</span>:null}</legend>{d.values.map(v=><button type="button" key={v.id} className={selected[d.id]===v.id?'selected':''} aria-pressed={selected[d.id]===v.id} disabled={!possible(d.id,v.id)} onClick={()=>setSelected(rows=>{const next={...rows};if(next[d.id]===v.id)delete next[d.id];else next[d.id]=v.id;return next;})}>{v.name}</button>)}</fieldset>)}</div>
        <div className="sku-availability" aria-live="polite">{!complete?<p>请选择完整的颜色与尺码。</p>:sku?<><p>{sku.purchasable?'此款有货':sku.available===0?'此款暂时缺货':'此款暂不可购买'} <span>可售数量 {sku.available}</span></p><small>款式编号 {sku.code}</small></>:<p>暂无可售规格</p>}</div>
        <AddToCart key={(sku?.id??'incomplete')+':'+auth.status+':'+(auth.customer?.id??'')} sku={sku}/><div className="detail-service"><span>自营精选</span><span>清晰的款式与尺码</span><span>累计售出 {p.paidSalesCount} 件</span></div>
      </div></div><section className="product-description"><span className="store-kicker">THE DETAILS</span><h2>关于这件衣服</h2><p>{p.description??'详细介绍正在准备中。'}</p></section><Link className="store-primary-link" to="/products">继续浏览其他款式 →</Link>
  </article>;
}
