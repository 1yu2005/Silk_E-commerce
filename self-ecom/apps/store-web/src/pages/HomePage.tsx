import { Button } from 'antd';
import { Link } from 'react-router-dom';

export function HomePage() {
  return <section className="welcome-panel"><div className="welcome-copy">
    <h1>欢迎来到我们的自营店铺。</h1>
    <p>商品浏览与购物功能正在准备中。未来你可以在这里选购商品、查看订单并申请售后。</p>
    <Link to="/login"><Button type="primary" size="large">前往顾客登录</Button></Link>
    <p className="muted">模拟交易，不发生真实资金流转。</p>
  </div><aside className="welcome-aside" aria-label="使用说明"><h2>购物流程，清楚可查</h2><p>选购、下单、模拟付款，再到收货与售后，记录会保留在你的订单中。</p></aside></section>;
}
