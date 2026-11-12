/** 文件作用：展示后台未匹配地址的提示和返回入口。 */
import { Button, Result } from 'antd';
import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return <Result status="404" title="页面不存在" subTitle="请检查地址，或返回首页继续。" extra={<Link to="/"><Button type="primary">返回首页</Button></Link>} />;
}
