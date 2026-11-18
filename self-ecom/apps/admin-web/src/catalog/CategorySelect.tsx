// 作用：分类默认仅显示根节点，按层级展开；表单仍提交分类ID，选中后显示完整路径。
import { useId, useRef, useState } from 'react';
import { Popover, Tree, type TreeProps } from 'antd';
import { flatten, type Category } from './model';

function treeNodes(rows:Category[]):NonNullable<TreeProps['treeData']>{
  return rows.map(node=>({key:node.id,title:node.name,children:treeNodes(node.children)}));
}

export function CategorySelect({categories,value,defaultValue='',onChange,disabled=false,placeholder='全部分类',label='商品分类'}:{categories:Category[];value?:string;defaultValue?:string;onChange?:(value:string)=>void;disabled?:boolean;placeholder?:string;label?:string}){
  const id=useId(),[selected,setSelected]=useState(defaultValue),[open,setOpen]=useState(false),[expanded,setExpanded]=useState<NonNullable<TreeProps['expandedKeys']>>([]);
  const trigger=useRef<HTMLButtonElement>(null),popup=useRef<HTMLDivElement>(null),current=value??selected;
  const nodes=flatten(categories),names=new Map(nodes.map(({node})=>[node.id,node.name]));
  const node=nodes.find(({value:id})=>id===current)?.node;
  const path=node?.pathIds.map(id=>names.get(id)).filter(Boolean).join(' / ')||node?.name;
  const change=(next:string)=>{setSelected(next);onChange?.(next);setOpen(false);trigger.current?.focus();};
  return <div className="catalog-category-select"><input type="hidden" name="categoryId" value={current}/><Popover
    trigger="click" placement="bottomLeft" arrow={false} open={open&&!disabled}
    onOpenChange={next=>{setOpen(next);if(next)setExpanded([]);}}
    afterOpenChange={visible=>{if(visible)popup.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();}}
    content={<div id={id} ref={popup} className="catalog-category-popup" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();setOpen(false);trigger.current?.focus();}}}>
      {categories.length?<Tree aria-label={label} treeData={treeNodes(categories)}
        tabIndex={0} showLine={{showLeafIcon:false}} blockNode expandedKeys={expanded} onExpand={setExpanded}
        selectedKeys={current?[current]:[]} onSelect={(_,info)=>change(String(info.node.key))}
      />:<p>暂无可选分类</p>}
    </div>}
  ><button ref={trigger} type="button" role="combobox" aria-label={label} aria-haspopup="tree" aria-expanded={open&&!disabled} aria-controls={open&&!disabled?id:undefined} disabled={disabled}
      className="catalog-category-trigger" onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setExpanded([]);setOpen(true);}}}>
      <span className={current?'':'catalog-category-placeholder'}>{current?path||'当前分类':placeholder}</span><span aria-hidden="true">⌄</span>
    </button></Popover>{current?<button type="button" className="catalog-category-clear" aria-label="清除分类" disabled={disabled} onClick={()=>change('')}>×</button>:null}</div>;
}
