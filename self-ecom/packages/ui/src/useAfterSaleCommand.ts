// 作用：每次明确提交固定请求体和动作键；结果不明只允许原体重试，切换身份丢弃旧响应。
import {useEffect,useRef,useState} from 'react';
import {ApiClientError,type AuthSessionStore} from '@shop/api-client';
export function useAfterSaleCommand(session:AuthSessionStore,saved:()=>void){
 const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[pending,setPending]=useState(false),[conflict,setConflict]=useState(false);
 const inflight=useRef(false),alive=useRef(false),original=useRef<(()=>Promise<unknown>)|null>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function run(work:()=>Promise<unknown>,retry=false){if(inflight.current||(!retry&&(original.current||conflict))||!session.current().credential)return;const revision=session.current().revision,current=()=>alive.current&&session.current().revision===revision;
  if(!retry)original.current=work;const action=original.current;if(!action)return;inflight.current=true;setBusy(true);setError(undefined);
  try{await action();if(current()){original.current=null;setPending(false);saved();}}
  catch(e){if(current()){setError(e);const uncertain=!(e instanceof ApiClientError)||!e.status||e.status>=500||e.code==='REQUEST_IN_PROGRESS';if(uncertain)setPending(true);else{original.current=null;setPending(false);setConflict(e instanceof ApiClientError&&[403,404,409].includes(e.status));}}}
  finally{inflight.current=false;if(current())setBusy(false);}
 }
 return {busy,error,pending,blocked:busy||pending||conflict,run,retry:()=>run(()=>Promise.resolve(),true),reviewed:()=>{if(!inflight.current&&!original.current){setConflict(false);setError(undefined);}}};
}
