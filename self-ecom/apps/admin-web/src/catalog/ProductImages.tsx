// 作用：主图与有序轮播复用正式上传；当前展示替换后仍保留历史文件引用。
import { useRef,useState } from 'react';
import { Button } from 'antd';
import { ImageUploader,PrivateImage } from '@shop/ui';
import { catalog,files,session } from '../services/api';
import type { Product } from './model';
import { CatalogFeedback } from './CatalogFeedback';
import { useCatalogCommand } from './use-catalog-command';
export function ProductImages({product:p,disabled,onSaved,reload}:{product:Product;disabled:boolean;onSaved:()=>void;reload:()=>void}){
  const [main,setMain]=useState(p.mainImageId),[gallery,setGallery]=useState(p.galleryImageIds);const cmd=useCatalogCommand(onSaved);
  const uploaded=useRef<string[]>([]),uploadedMain=useRef<string|null>(null);
  const off=disabled||cmd.busy||cmd.blocked;const upload=async(file:File,signal:AbortSignal)=>(await files.upload('PRODUCT_IMAGE',file,signal)).data;
  return <section id="images" className="catalog-card"><h2>商品图片</h2><p>主图1张、轮播最多10张。拖动替代操作使用“上移 / 下移”，保存顺序即展示顺序。</p><CatalogFeedback {...cmd} reload={reload}/>
    <div className="catalog-grid"><div><h3>主图</h3>{main?<div className="catalog-image"><PrivateImage fileId={main} load={files.content} sessionKey={session.getSnapshot().revision} alt="当前选择的商品主图"/><Button disabled={off} onClick={()=>setMain(null)}>移除主图</Button></div>:<p>尚未选择主图</p>}
      {!disabled?<ImageUploader maxCount={1} upload={upload} load={files.content} sessionKey={session.getSnapshot().revision} disabled={off} label="上传新主图" onChange={rows=>{const id=rows[0]?.id??null;if(id)setMain(id);else{const previous=uploadedMain.current;setMain(current=>current===previous?p.mainImageId:current);}uploadedMain.current=id;}}/>:null}</div>
      <div><h3>轮播顺序</h3><ol className="catalog-gallery">{gallery.map((id,i)=><li key={id}><PrivateImage fileId={id} load={files.content} sessionKey={session.getSnapshot().revision} alt={'轮播图'+(i+1)}/><span>第{i+1}张</span><Button disabled={off||i===0} onClick={()=>setGallery(rows=>{const next=[...rows];[next[i-1],next[i]]=[next[i]!,next[i-1]!];return next;})}>上移</Button><Button disabled={off||i===gallery.length-1} onClick={()=>setGallery(rows=>{const next=[...rows];[next[i+1],next[i]]=[next[i]!,next[i+1]!];return next;})}>下移</Button><Button disabled={off} onClick={()=>setGallery(rows=>rows.filter(v=>v!==id))}>移除</Button></li>)}</ol>
      {!disabled?<ImageUploader maxCount={10} upload={upload} load={files.content} sessionKey={session.getSnapshot().revision} disabled={off} label="上传轮播图片" onChange={rows=>{const ids=rows.map(r=>r.id),previous=uploaded.current;setGallery(current=>[...current.filter(id=>!previous.includes(id)||ids.includes(id)),...ids.filter(id=>!current.includes(id)&&!previous.includes(id))]);uploaded.current=ids;}}/>:null}</div></div>
    {gallery.length>10?<p role="alert">轮播超过10张，请移除多余图片。</p>:null}<Button type="primary" disabled={off||gallery.length>10} onClick={()=>void cmd.run(()=>catalog.setProductImages({path:{id:p.id},body:{expectedVersion:p.version,mainImageId:main,galleryImageIds:gallery}}))}>保存图片与顺序</Button>
  </section>;
}
