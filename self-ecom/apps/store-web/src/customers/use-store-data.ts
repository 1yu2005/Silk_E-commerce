// 作用：私有查询按会话版本隔离，退出/切换账号后不保留旧资料；写入冲突或结果不明须先重读。
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {ApiClientError} from '@shop/api-client';
import {session} from '../services/api';
export function useStoreQuery<T>(load:(signal:AbortSignal)=>Promise<T>,key:string){
 const {revision}=useSyncExternalStore(session.subscribe,session.getSnapshot);
 const [state,setState]=useState<{key:string;revision:number;data?:T;error?:unknown}>();
 useEffect(()=>{const abort=new AbortController();void load(abort.signal).then(data=>{if(!abort.signal.aborted&&session.current().revision===revision)setState({key,revision,data});}).catch(error=>{if(!abort.signal.aborted&&session.current().revision===revision)setState({key,revision,error});});return()=>abort.abort();},[load,key,revision]);
 return state?.key===key&&state.revision===revision?state:undefined;
}
export function useStoreCommand(saved:()=>void){
 const [busy,setBusy]=useState(false),[blocked,setBlocked]=useState(false),[error,setError]=useState<unknown>(null);
 const mounted=useRef(false),pending=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 async function run(work:()=>Promise<unknown>){if(pending.current||blocked||!session.current().credential)return;pending.current=true;setBusy(true);setError(null);const revision=session.current().revision;const current=()=>mounted.current&&session.current().revision===revision;
 try{await work();if(current())saved();}catch(e){if(current()){setError(e);if(!(e instanceof ApiClientError)||e.status===409||e.status===404||!e.status||e.status>=500)setBlocked(true);}}
 finally{pending.current=false;if(current())setBusy(false);}}
 return {busy,blocked,error,run};
}
