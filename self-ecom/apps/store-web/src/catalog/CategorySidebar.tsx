// 作用：分类箭头逐级展开，名称筛选商品；深层分类链接自动显示所选路径。
import { useId,useState } from 'react';
import { categoryPath,type Category } from './model';
import './category-sidebar.css';

export function CategorySidebar({nodes,selectedId,onSelect}:{nodes:Category[];selectedId?:string;onSelect:(id:string|undefined)=>void}){
  const idPrefix=useId(),[expanded,setExpanded]=useState<Record<string,boolean>>({});
  const path=categoryPath(nodes,selectedId),pathIds=new Set(path.map(node=>node.id));
  const isExpanded=(node:Category)=>expanded[node.id]??pathIds.has(node.id);
  const toggle=(node:Category)=>setExpanded(current=>({...current,[node.id]:!(current[node.id]??pathIds.has(node.id))}));
  const collapse=()=>setExpanded(current=>Object.fromEntries([...Object.keys(current),...pathIds].map(id=>[id,false])));
  return <aside className="store-category-sidebar" aria-label="商品分类">
    <div className="store-category-heading"><h3>按分类浏览</h3><button type="button" className="store-category-collapse" onClick={collapse} disabled={!nodes.length}>收起</button></div>
    <p className="store-category-hint">箭头展开，名称筛选</p>
    <nav aria-label="按商品分类筛选">
      <button type="button" className={'store-category-all'+(!selectedId?' selected':'')} aria-pressed={!selectedId} onClick={()=>onSelect(undefined)}>全部款式</button>
      <ul className="store-category-tree">{nodes.map(node=><CategoryBranch key={node.id} node={node} selectedId={selectedId} pathIds={pathIds} idPrefix={idPrefix} isExpanded={isExpanded} onToggle={toggle} onSelect={onSelect}/>)}</ul>
    </nav>
    {path.length?<p className="store-category-current">当前分类<strong>{path.map(node=>node.name).join(' / ')}</strong></p>:null}
  </aside>;
}

function CategoryBranch({node,selectedId,pathIds,idPrefix,isExpanded,onToggle,onSelect}:{node:Category;selectedId?:string;pathIds:Set<string>;idPrefix:string;isExpanded:(node:Category)=>boolean;onToggle:(node:Category)=>void;onSelect:(id:string)=>void}){
  const hasChildren=node.children.length>0,open=isExpanded(node),childrenId=idPrefix+'-children-'+node.id;
  return <li className="store-category-node">
    <div className={'store-category-row'+(node.id===selectedId?' selected':pathIds.has(node.id)?' in-selected-path':'')}>
      {hasChildren?<button type="button" className="store-category-toggle" aria-label={(open?'收起':'展开')+'「'+node.name+'」的下级分类'} aria-expanded={open} aria-controls={childrenId} onClick={()=>onToggle(node)}><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></button>:<span className="store-category-leaf" aria-hidden="true"/>}
      <button type="button" className="store-category-name" aria-pressed={node.id===selectedId} onClick={()=>onSelect(node.id)}>{node.name}</button>
    </div>
    {hasChildren?<ul id={childrenId} className="store-category-children" hidden={!open}>{node.children.map(child=><CategoryBranch key={child.id} node={child} selectedId={selectedId} pathIds={pathIds} idPrefix={idPrefix} isExpanded={isExpanded} onToggle={onToggle} onSelect={onSelect}/>)}</ul>:null}
  </li>;
}
