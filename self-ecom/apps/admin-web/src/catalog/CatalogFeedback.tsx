// 作用：复用统一错误提示并明确冲突后重新确认的操作，不自动覆盖新版本。
import { Alert, Button } from 'antd';
import { AuthError } from '../auth/AuthError';
export function CatalogFeedback({error,blocked,reload}:{error:unknown;blocked?:boolean;reload:()=>void}){
  return <div aria-live="polite"><AuthError error={error}/>{blocked?<Alert type="warning" title="请读取最新版本后重新确认" description="当前提交可能冲突或结果尚未确认。重读会替换未保存内容，请先核对。" action={<Button onClick={reload}>读取最新版本</Button>}/>:null}</div>;
}
