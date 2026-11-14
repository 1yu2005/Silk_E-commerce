// 作用：统一库存导航、加载和私有证据展示；图片通过Bearer Blob读取，URL不携带凭据。
import { Button, Spin } from 'antd';
import { NavLink } from 'react-router-dom';
import { PrivateImage,ImageUploader } from '@shop/ui';
import { files,session } from '../services/api';
import { AuthError } from '../auth/AuthError';
import type { ApiClientError } from '@shop/api-client';
export function InventoryNav(){return <nav className="catalog-section-nav" aria-label="库存导航"><NavLink to="/inventory" end>余额与预警</NavLink><NavLink to="/inventory/sources">来源凭据</NavLink><NavLink to="/inventory/adjustments">库存登记</NavLink><NavLink to="/inventory/ledger">数量流水</NavLink></nav>;}
export function InventoryState({error,reload}:{error:ApiClientError|null;reload:()=>void}){return error?<><AuthError error={error}/><Button onClick={reload}>重新读取库存资料</Button></>:<div role="status"><Spin/><p>正在读取库存资料…</p></div>;}
export function InventoryEvidence({rows}:{rows:{id:string}[]}){return rows.length?<div className="catalog-gallery">{rows.map(r=><PrivateImage key={r.id} fileId={r.id} load={files.content} sessionKey={session.getSnapshot().revision} alt="库存私有核实凭证"/>)}</div>:<p>无独立图片凭证，请核对关联来源及说明。</p>;}
export function EvidenceUpload({onChange,disabled=false}:{onChange:(ids:string[])=>void;disabled?:boolean}){return <ImageUploader label="上传核实凭证（最多5张）" maxCount={5} disabled={disabled} upload={async(file,signal)=>(await files.upload('INVENTORY_EVIDENCE',file,signal)).data} load={files.content} sessionKey={session.getSnapshot().revision} onChange={rows=>onChange(rows.map(r=>r.id))}/>;}
export function InventoryPager({page,total,size=20,onPage}:{page:number;total:number;size?:number;onPage:(page:number)=>void}){return <div className="catalog-batch"><Button disabled={page<=1} onClick={()=>onPage(page-1)}>上一页</Button><span>第 {page} 页，共 {total} 条</span><Button disabled={page*size>=total} onClick={()=>onPage(page+1)}>下一页</Button></div>;}
