// 作用：分类商品查询的加载、错误和重试文案，避免误用员工专属提示。
import { Button, Spin } from 'antd';
import type { ApiClientError } from '@shop/api-client';
import { AuthError } from '../auth/AuthError';
export function CatalogQueryState({error,onRetry}:{error:ApiClientError|null;onRetry:()=>void}){return error?<div><AuthError error={error}/><Button onClick={onRetry}>重新读取</Button></div>:<div className="auth-status" role="status"><Spin/><p>正在读取商品资料…</p></div>;}
