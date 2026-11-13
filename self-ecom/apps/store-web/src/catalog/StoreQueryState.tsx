// 作用：公开商品查询处理加载、404及失败重试，保留安全请求编号。
import { Button,Spin } from 'antd';
import { ApiClientError } from '@shop/api-client';
import { Link } from 'react-router-dom';
export function StoreQueryState({error,retry}:{error?:unknown;retry:()=>void}){
  const e=error instanceof ApiClientError?error:null;
  return error?<div className="store-query-error" role="alert"><h2>{e?.status===404?'这件商品暂时无法查看':'暂时无法读取商品'}</h2><p>{e?.message??'请稍后重试。'}</p><Button onClick={retry}>重新读取</Button> <Link to="/products">浏览其他款式</Link>{e?.requestId?<p className="request-id">请求编号：{e.requestId}</p>:null}</div>:<div role="status" className="store-query-loading"><Spin/><p>正在寻找好款式…</p></div>;
}
