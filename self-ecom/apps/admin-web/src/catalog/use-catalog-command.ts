// 作用：防重复提交及迟到跨会话响应；版本冲突和结果不明时须重读后再操作。
import { createContext, useContext, useEffect, useRef, useState, type Dispatch, type SetStateAction, type MutableRefObject } from 'react';
import { ApiClientError } from '@shop/api-client';
import { session } from '../services/api';
export const CatalogCommandContext=createContext<{busy:boolean;blocked:boolean;setBusy:Dispatch<SetStateAction<boolean>>;setBlocked:Dispatch<SetStateAction<boolean>>;pending:MutableRefObject<boolean>}|null>(null);
export function useCatalogCommand(onSaved:()=>void){
  const [localBusy,setLocalBusy]=useState(false),[error,setError]=useState<unknown>(null),[localBlocked,setLocalBlocked]=useState(false);
  const localPending=useRef(false),mounted=useRef(false),shared=useContext(CatalogCommandContext);
  const {busy,setBusy,blocked,setBlocked,pending}=shared??{busy:localBusy,setBusy:setLocalBusy,blocked:localBlocked,setBlocked:setLocalBlocked,pending:localPending};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  async function run(work:()=>Promise<unknown>){
    if(pending.current||blocked||!session.current().credential)return;pending.current=true;setBusy(true);setError(null);
    const revision=session.current().revision;const current=()=>mounted.current&&session.current().revision===revision;
    try{await work();if(current())onSaved();}catch(e){if(current()){setError(e);if(!(e instanceof ApiClientError)||e.code==='VERSION_CONFLICT'||!e.status||e.status>=500)setBlocked(true);}}
    finally{pending.current=false;if(current())setBusy(false);}
  }
  return {busy,error,blocked,run};
}
