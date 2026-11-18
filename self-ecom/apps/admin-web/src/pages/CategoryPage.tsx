// 作用：三级分类的资料编辑、整树移动及受保护删除，全部按当前版本提交。
import { useState } from 'react';
import { Button, Empty } from 'antd';
import { catalog,catalogQueries } from '../services/api';
import { useEmployeeQuery } from '../employees/use-employee-query';
import { CatalogQueryState as QueryState } from '../catalog/CatalogQueryState';
import { useEmployeeAuth } from '../auth/use-employee-auth';
import { flatten,type Category } from '../catalog/model';
import { useCatalogCommand } from '../catalog/use-catalog-command';
import { CatalogFeedback } from '../catalog/CatalogFeedback';
import './category-page.css';
export function CategoryPage(){
  const tree=useEmployeeQuery(catalogQueries.categories,'categories',undefined);const {permissions}=useEmployeeAuth();
  const [editing,setEditing]=useState<Category|null>(null),[nonce,setNonce]=useState(0);
  const [expandedIds,setExpandedIds]=useState<Set<string>>(()=>new Set());
  const reload=()=>{setEditing(null);setNonce(n=>n+1);void catalogQueries.categories.invalidate();};
  const newCategory=()=>{setEditing(null);setNonce(n=>n+1);};
  const edit=(node:Category)=>{setEditing(node);setNonce(n=>n+1);};
  const toggle=(node:Category)=>setExpandedIds(current=>{
    const next=new Set(current);
    if(next.has(node.id))for(const {node:child} of flatten([node]))next.delete(child.id);
    else next.add(node.id);
    return next;
  });
  return <section className="catalog-panel category-workspace"><div className="catalog-heading"><div><h1>商品分类</h1><p>最多三级。默认显示根分类，点击箭头逐级查看下级分类。</p></div><Button onClick={reload}>刷新分类</Button></div>
    {tree.status!=='ready'||!tree.data?<QueryState error={tree.error} onRetry={reload}/>:<div className="category-columns"><section className="category-directory" aria-labelledby="category-directory-title"><div className="category-directory-heading"><div><h2 id="category-directory-title">分类目录</h2><p>{tree.data.length} 个根分类，共 {flatten(tree.data as Category[]).length} 个分类</p></div><Button type="text" disabled={!expandedIds.size} onClick={()=>setExpandedIds(new Set())}>收起全部</Button></div>{tree.data.length?<ul className="category-tree" aria-label="分类目录">{(tree.data as Category[]).map(node=><CategoryBranch key={node.id} node={node} editingId={editing?.id} expandedIds={expandedIds} onToggle={toggle} onEdit={edit}/>)}</ul>:<Empty description="还没有分类"/>}<p className="category-directory-note">父分类筛选会同时包含所有下级商品。</p></section>
      {permissions?.effectivePermissions.includes('category.manage')?<CategoryForm key={editing?.id+':'+nonce} node={editing} rows={tree.data as Category[]} reload={reload} onNew={newCategory}/>:<p>当前权限仅可查看分类。</p>}</div>}
  </section>;
}
function CategoryBranch({node,editingId,expandedIds,onToggle,onEdit}:{node:Category;editingId?:string;expandedIds:Set<string>;onToggle:(node:Category)=>void;onEdit:(node:Category)=>void}){
  const hasChildren=node.children.length>0,expanded=expandedIds.has(node.id),childrenId='category-children-'+node.id;
  return <li className="category-node"><div className="category-node-row" data-selected={editingId===node.id}>
    <div className="category-node-info">{hasChildren?<button type="button" className="category-node-toggle" aria-expanded={expanded} aria-controls={childrenId} aria-label={(expanded?'收起':'展开')+'「'+node.name+'」的下级分类'} onClick={()=>onToggle(node)}><svg className="category-chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg><strong>{node.name}</strong></button>:<div className="category-node-leaf"><span className="category-leaf-mark" aria-hidden="true"/><strong>{node.name}</strong></div>}
      <div className="category-node-meta"><span>{node.depth===1?'根分类':'第 '+node.depth+' 级'}</span>{hasChildren?<span>{node.children.length} 个下级</span>:null}<span>排序 {node.sortOrder}</span></div>
    </div><Button type={editingId===node.id?'default':'text'} className="category-edit-button" aria-label={'查看 / 编辑「'+node.name+'」'} onClick={()=>onEdit(node)}>查看 / 编辑</Button>
    </div>{hasChildren?<ul id={childrenId} className="category-tree-children" hidden={!expanded}>{node.children.map(child=><CategoryBranch key={child.id} node={child} editingId={editingId} expandedIds={expandedIds} onToggle={onToggle} onEdit={onEdit}/>)}</ul>:null}</li>;
}
function CategoryForm({node,rows,reload,onNew}:{node:Category|null;rows:Category[];reload:()=>void;onNew:()=>void}){
  const cmd=useCatalogCommand(reload);const options=flatten(rows);const parentOptions=options.filter(o=>!node||!o.node.pathIds.includes(node.id));
  return <div className="catalog-card category-editor"><div className="category-editor-heading"><h2>{node?'编辑「'+node.name+'」':'新增分类'}</h2>{node?<Button disabled={cmd.busy} onClick={onNew}>新增分类</Button>:null}</div><p className="category-form-hint">{node?'修改分类资料，或在下方移动、删除分类。':'选择父分类可创建下级分类，最多支持三级。'}</p><CatalogFeedback {...cmd} reload={reload}/>
    <form className="catalog-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void cmd.run(()=>node?catalog.updateCategory({path:{id:node.id},body:{expectedVersion:node.version,name:String(f.get('name')),iconKey:(f.get('icon')||null) as Category['iconKey'],sortOrder:Number(f.get('sort'))}}):catalog.createCategory({body:{name:String(f.get('name')),parentId:String(f.get('parent'))||null,iconKey:(f.get('icon')||null) as Category['iconKey'],sortOrder:Number(f.get('sort'))}}));}}>
      <fieldset disabled={cmd.busy||cmd.blocked}><label>分类名称<input name="name" defaultValue={node?.name} required maxLength={50}/></label>
        {!node?<label>父分类<select name="parent" aria-label="父分类"><option value="">根分类</option>{options.filter(o=>o.node.depth<3).map(o=><option value={o.value} key={o.value}>{o.label}</option>)}</select></label>:null}
        <label>内置图标<select aria-label="内置图标" name="icon" defaultValue={node?.iconKey??''}><option value="">无</option>{['clothes','top','trousers','coat','dress','accessory'].map(v=><option key={v}>{v}</option>)}</select></label>
        <label>排序<input name="sort" type="number" min="0" max="1000000" step="1" defaultValue={node?.sortOrder??0} required/></label><Button type="primary" htmlType="submit" loading={cmd.busy}>保存分类</Button></fieldset>
    </form>
    {node?<form className="catalog-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);const body={expectedVersion:node.version,reason:String(f.get('reason'))};void cmd.run(()=>f.get('action')==='delete'?catalog.deleteCategory({path:{id:node.id},body}):catalog.moveCategory({path:{id:node.id},body:{...body,parentId:String(f.get('parent'))||null}}));}}>
      <fieldset disabled={cmd.busy||cmd.blocked}><legend>移动或删除</legend><label>操作<select name="action" aria-label="操作"><option value="move">移动整棵子树</option><option value="delete">删除空分类</option></select></label>
        <label>目标父分类<select aria-label="目标父分类" name="parent" defaultValue={node.parentId??''}><option value="">根分类</option>{parentOptions.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label><label>原因<input name="reason" required maxLength={500}/></label>
        <p className="muted">删除前服务器会检查子分类和全部关联商品，包括归档商品。</p><Button htmlType="submit">确认操作</Button></fieldset></form>:null}
  </div>;
}
