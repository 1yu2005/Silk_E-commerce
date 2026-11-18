// 作用：同一商品所有编辑区共享提交锁，任一区域冲突或结果不明后统一等待手动重读。
import { useMemo,useRef,useState,type ReactNode } from 'react';
import { CatalogCommandContext } from './use-catalog-command';
export function CatalogCommandScope({children,refreshing=false}:{children:ReactNode;refreshing?:boolean}){
  const [busy,setBusy]=useState(false),[blocked,setBlocked]=useState(false),pending=useRef(false);
  const value=useMemo(()=>({busy:busy||refreshing,setBusy,blocked,setBlocked,pending}),[busy,blocked,refreshing]);
  return <CatalogCommandContext.Provider value={value}>{children}</CatalogCommandContext.Provider>;
}
