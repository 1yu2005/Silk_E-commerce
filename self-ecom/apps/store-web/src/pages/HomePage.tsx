/** 文件作用：展示商城使用说明及随登录状态变化的账号入口。 */
import { Button } from 'antd';
import { Link } from 'react-router-dom';
import { useCustomerAuth } from '../auth/use-customer-auth';

export function HomePage() {
  const { status } = useCustomerAuth();
  return <section className="welcome-panel"><div className="welcome-copy">
    <h1>欢迎来到我们的自营店铺。</h1>
    <p>商品浏览与购物功能正在准备中。未来你可以在这里选购商品、查看订单并申请售后。</p>
    {status === 'anonymous' ? <Link to="/login"><Button type="primary" size="large">前往顾客登录</Button></Link> : null}
    {status === 'ready' ? <Link to="/account"><Button type="primary" size="large">查看我的账号</Button></Link> : null}
    <p className="muted">模拟交易，不发生真实资金流转。</p>
  </div><aside className="welcome-aside" aria-label="使用说明"><h2>购物流程，清楚可查</h2><p>选购、下单、模拟付款，再到收货与售后，记录会保留在你的订单中。</p></aside></section>;
}
