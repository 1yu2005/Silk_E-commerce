// 作用：使用当前账户和来源行提供可读候选，数量从选择关系推导，用户不必手填UUID。
import { useMemo,useState } from 'react';
import { useEmployeeQuery } from '../employees/use-employee-query';
import { inventoryQueries } from '../services/api';
import type { Source } from './model';
import { InventoryState } from './InventoryCommon';
export function SourceSelector({onSelect,sourceType='RECEIPT',initialId=''}:{onSelect:(source:Source)=>void;sourceType:'RECEIPT'|'LOSS';initialId?:string}){
 const [keyword,setKeyword]=useState(''),[selected,setSelected]=useState(initialId);const q=useMemo(()=>({page:1,pageSize:100,keyword:keyword||undefined,sourceType}),[keyword,sourceType]);
 const options=useEmployeeQuery(inventoryQueries.sourceOptions,JSON.stringify(q),q);
 return <div className="catalog-grid"><label>搜索来源凭据<input value={keyword} onChange={e=>setKeyword(e.target.value)} placeholder="凭据编号或范围"/></label><label>关联已核实来源<select required value={selected} onChange={e=>setSelected(e.target.value)}><option value="">请选择来源</option>{options.data?.items.map(s=><option key={s.id} value={s.id}>{s.namespace} / {s.reference}</option>)}</select></label>{selected?<SelectedSource key={selected} id={selected} onSelect={onSelect}/>:null}</div>;
}
function SelectedSource({id,onSelect}:{id:string;onSelect:(source:Source)=>void}){
 const q=useEmployeeQuery(inventoryQueries.selectedSource,id,id);
 // 只有用户明确载入才修改编辑内容，避免后台重读覆盖未保存输入。
 return q.status==='ready'&&q.data?<div><p>{q.data.note}（{q.data.lines.length}个来源行）</p><button type="button" onClick={()=>onSelect(q.data!)}>载入此来源行</button></div>:<InventoryState error={q.error} reload={()=>void inventoryQueries.selectedSource.invalidate()}/>;
}
