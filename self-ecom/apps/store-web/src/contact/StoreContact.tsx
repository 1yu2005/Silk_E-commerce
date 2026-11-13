/** 文件作用：在商城公共布局读取公开服务联系；失败可重试，切回页面时刷新，不依赖顾客登录。 */
import { useEffect, useState } from 'react';
import { Button } from 'antd';
import { ApiClientError, type ApiOperations } from '@shop/api-client';
import { publicContact } from '../services/api';

type Contact = ApiOperations['getStoreContact']['responses'][200]['content']['application/json']['data'];
type State = { status: 'loading' } | { status: 'ready'; data: Contact } | { status: 'error'; error: unknown };

export function StoreContact() {
  const [state, setState] = useState<State>({ status: 'loading' }); const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; let generation = 0; let request: AbortController | null = null;
    const load = async () => {
      const attempt = ++generation; request?.abort(); request = new AbortController(); setState({ status: 'loading' });
      try { const { data } = await publicContact({ signal: request.signal }); if (active && attempt === generation) setState({ status: 'ready', data }); }
      catch (error) { if (active && attempt === generation) setState({ status: 'error', error }); }
    };
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    void load(); window.addEventListener('focus', refresh);
    return () => { active = false; request?.abort(); window.removeEventListener('focus', refresh); };
  }, [retry]);
  const failure = state.status === 'error' && state.error instanceof ApiClientError ? state.error : null;
  return <section className="store-contact" aria-label="联系店铺" aria-live="polite"><h2>联系店铺</h2>
    {state.status === 'loading' ? <p role="status">正在读取联系方式…</p> : null}
    {state.status === 'ready' ? state.data.configured && state.data.servicePhone ? <div className="store-contact-details">
      <p>服务电话：<a href={`tel:${state.data.servicePhone}`}>{state.data.servicePhone}</a></p>
      {state.data.serviceHours ? <p>服务时间：{state.data.serviceHours}</p> : null}
    </div> : <p>联系方式维护中</p> : null}
    {state.status === 'error' ? <div><p>暂时无法读取联系方式</p><Button onClick={() => setRetry(value => value + 1)}>重试联系方式</Button>
      {failure?.requestId ? <p className="request-id">请求编号：{failure.requestId}</p> : null}</div> : null}
  </section>;
}
