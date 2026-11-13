// 作用：公开查询可取消且不依赖登录，参数变动由页面键销毁旧状态，迟到响应不覆盖新页。
import { useEffect,useState } from 'react';
export function usePublicQuery<T>(load:(signal:AbortSignal)=>Promise<T>){
  const [state,setState]=useState<{data:T;error?:never}|{data?:never;error:unknown}|null>(null);
  useEffect(()=>{const controller=new AbortController();void load(controller.signal).then(data=>{if(!controller.signal.aborted)setState({data});}).catch(error=>{if(!controller.signal.aborted)setState({error});});return()=>controller.abort();},[load]);
  return state;
}
