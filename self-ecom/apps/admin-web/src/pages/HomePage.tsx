import { Button } from 'antd';
import { Link } from 'react-router-dom';

export function HomePage() {
  return <section className="welcome-panel"><div className="welcome-copy">
    <h1>把店铺日常，处理清楚。</h1>
    <p>这里是店铺员工的工作入口。商品维护、库存登记和订单处理功能将逐步开放。</p>
    <Link to="/login"><Button type="primary" size="large">前往员工登录</Button></Link>

  </div><aside className="welcome-aside" aria-label="使用说明"><h2>一个店铺，协作有序</h2><p>超级管理员、商品与仓储、客服将使用各自账号开展工作。</p></aside></section>;
}
