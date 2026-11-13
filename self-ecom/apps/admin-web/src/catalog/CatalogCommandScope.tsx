// 作用：同一商品所有编辑区共享提交锁，任一区域冲突或结果不明后统一等待手动重读。
import { useMemo,useRef,useState,type ReactNode } from 'react';
import { CatalogCommandContext } from './use-catalog-command';
export function CatalogCommandScope({children}:{children:ReactNode}){
  const [busy,setBusy]=useState(false),[blocked,setBlocked]=useState(false),pending=useRef(false);
  const value=useMemo(()=>({busy,setBusy,blocked,setBlocked,pending}),[busy,blocked]);
  return <CatalogCommandContext.Provider value={value}>{children}</CatalogCommandContext.Provider>;
}
