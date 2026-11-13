// 作用：商品编辑各区域共享服务器商品版本，保存后重读；只读员工不加载管理草稿。
import { useState } from 'react';
import { Button, Tag } from 'antd';
import { Link,useParams } from 'react-router-dom';
import { catalog,catalogQueries } from '../services/api';
import { useEmployeeQuery } from '../employees/use-employee-query';
import { useEmployeeAuth } from '../auth/use-employee-auth';
import { CatalogQueryState } from '../catalog/CatalogQueryState';
import { CatalogFeedback } from '../catalog/CatalogFeedback';
import { useCatalogCommand } from '../catalog/use-catalog-command';
import { CatalogCommandScope } from '../catalog/CatalogCommandScope';
import { flatten,statuses,type Category,type Product } from '../catalog/model';
import { ProductImages } from '../catalog/ProductImages';
import { ProductScheme } from '../catalog/ProductScheme';
import { ProductSkus } from '../catalog/ProductSkus';
import { ProductInitialDraft } from '../catalog/ProductInitialDraft';
export function ProductEditPage(){
  const {id=''}=useParams();if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))return <section><h1>商品编号不正确</h1><Link to="/products">返回商品</Link></section>;
  return <ProductLoader key={id} id={id}/>;
}
function ProductLoader({id}:{id:string}){
  const data=useEmployeeQuery(catalogQueries.product,id,id),tree=useEmployeeQuery(catalogQueries.categories,'categories',undefined);const [notice,setNotice]=useState('');
  const reload=()=>{void catalogQueries.product.invalidate();void catalogQueries.draft.invalidate();void catalogQueries.products.invalidate();};
  return <section className="catalog-panel"><Link to="/products">← 商品列表</Link>{notice?<p role="status">{notice}</p>:null}
    {data.status==='ready'&&data.data?<CatalogCommandScope key={id+':'+data.data.version}><ProductEditor product={data.data} categories={(tree.data??[]) as Category[]} reload={reload} saved={()=>{setNotice('已保存，请核对最新版本。');reload();}}/></CatalogCommandScope>:<CatalogQueryState error={data.error} onRetry={reload}/>}</section>;
}
function ProductEditor({product:p,categories,reload,saved}:{product:Product;categories:Category[];reload:()=>void;saved:()=>void}){
  const {permissions}=useEmployeeAuth();const can=(code:string)=>permissions?.effectivePermissions.includes(code)??false;
  const cmd=useCatalogCommand(saved);const [reason,setReason]=useState('');const manage=can('product.manage')&&!p.archivedAt;
  const changed=()=>{saved();};
  return <><div className="catalog-heading"><div><span className="eyebrow">{p.productCode} · 版本 {p.version}</span><h1>{p.name}</h1><Tag>{p.archivedAt?'归档':statuses[p.status]}</Tag></div><Button onClick={reload}>刷新商品</Button></div>
    <CatalogFeedback {...cmd} reload={reload}/>
    <nav className="catalog-section-nav" aria-label="编辑区域"><a href="#profile">基础资料</a><a href="#images">商品图片</a><a href="#scheme">颜色与尺码</a><a href="#skus">SKU与价格</a>{manage?<a href="#initial-draft">初始数量草稿</a>:null}</nav>
    <section id="profile" className="catalog-card"><h2>基础资料</h2><form className="catalog-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void cmd.run(()=>catalog.updateProduct({path:{id:p.id},body:{expectedVersion:p.version,name:String(f.get('name')),brand:String(f.get('brand'))||null,description:String(f.get('description'))||null,categoryId:String(f.get('categoryId'))||null}}));}}><fieldset disabled={!can('product.manage')||cmd.busy||cmd.blocked}>
      <div className="catalog-grid"><label>商品名称<input name="name" defaultValue={p.name} required maxLength={120}/></label><label>品牌（文本）<input name="brand" defaultValue={p.brand??''} maxLength={80}/></label><label>分类<select aria-label="分类" name="categoryId" defaultValue={p.categoryId??''}><option value="">尚未分类</option>{flatten(categories).map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label></div>
      <label>商品介绍（纯文本）<textarea name="description" defaultValue={p.description??''} maxLength={20000} rows={5}/></label><Button htmlType="submit" type="primary" disabled={!can('product.manage')} loading={cmd.busy}>保存资料</Button></fieldset></form></section>
    <ProductImages product={p} disabled={!manage} onSaved={changed} reload={reload}/>
    <ProductScheme product={p} disabled={!manage} onSaved={changed} reload={reload}/>
    <ProductSkus product={p} manage={manage} publish={can('product.publish')&&!p.archivedAt} onSaved={changed} reload={reload}/>
    {manage?<ProductInitialDraft product={p} onSaved={changed} reload={reload}/>:null}
    {can('product.publish')&&!p.archivedAt?<section className="catalog-card"><h2>销售状态</h2><p>上架前需要有效分类、主图、完整售价，以及至少一个真实可售SKU。数量草稿不增加可售库存。</p><form className="catalog-form" onSubmit={e=>{e.preventDefault();const action=new FormData(e.currentTarget).get('action');const input={path:{id:p.id},body:{expectedVersion:p.version,reason}};void cmd.run(()=>action==='publish'?catalog.publishProduct(input):action==='archive'?catalog.archiveProduct(input):catalog.unpublishProduct(input));}}><fieldset disabled={cmd.busy||cmd.blocked}><label>操作<select name="action" aria-label="操作"><option value="publish">上架</option><option value="unpublish">下架</option>{can('product.manage')?<option value="archive">下架并归档（不可恢复）</option>:null}</select></label><label>操作原因<input value={reason} onChange={e=>setReason(e.target.value)} required maxLength={500}/></label><Button htmlType="submit">确认销售操作</Button></fieldset></form></section>:null}
  </>;
}
