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
export function CategoryPage(){
  const tree=useEmployeeQuery(catalogQueries.categories,'categories',undefined);const {permissions}=useEmployeeAuth();
  const [editing,setEditing]=useState<Category|null>(null),[nonce,setNonce]=useState(0);
  const reload=()=>{setEditing(null);setNonce(n=>n+1);void catalogQueries.categories.invalidate();};
  return <section className="catalog-panel"><div className="catalog-heading"><div><span className="eyebrow">CATALOG / 分类</span><h1>把款式放在合适的位置</h1><p>最多三级。父分类筛选同时包含所有下级商品。</p></div><Button onClick={reload}>刷新分类</Button></div>
    {tree.status!=='ready'||!tree.data?<QueryState error={tree.error} onRetry={reload}/>:<div className="category-columns"><div>{tree.data.length?<ul className="category-tree">{flatten(tree.data as Category[]).map(({node,label})=><li key={node.id}><span>{label}</span><small>第{node.depth}级 · 顺序{node.sortOrder}</small><Button onClick={()=>{setEditing(node);setNonce(n=>n+1);}}>查看 / 编辑</Button></li>)}</ul>:<Empty description="还没有分类"/>}</div>
      {permissions?.effectivePermissions.includes('category.manage')?<CategoryForm key={editing?.id+':'+nonce} node={editing} rows={tree.data as Category[]} reload={reload}/>:<p>当前权限仅可查看分类。</p>}</div>}
    {editing?<Button onClick={()=>{setEditing(null);setNonce(n=>n+1);}}>新增分类</Button>:null}
  </section>;
}
function CategoryForm({node,rows,reload}:{node:Category|null;rows:Category[];reload:()=>void}){
  const cmd=useCatalogCommand(reload);const options=flatten(rows);const parentOptions=options.filter(o=>!node||!o.node.pathIds.includes(node.id));
  return <div className="catalog-card"><h2>{node?'编辑「'+node.name+'」':'新增分类'}</h2><CatalogFeedback {...cmd} reload={reload}/>
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
