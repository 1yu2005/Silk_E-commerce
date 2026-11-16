/** 文件作用：展示当前员工身份和后台已开放功能的工作入口。 */
import { useEmployeeAuth } from '../auth/use-employee-auth';
import { employeeRoles } from '../employees/query';
import { Link } from 'react-router-dom';

export function HomePage() {
  const { employee } = useEmployeeAuth();
  return <><section className="welcome-panel"><div className="welcome-copy">
    <span className="welcome-label">店铺工作台</span>
    <h1>欢迎，{employee?.displayName}。</h1>
    <p>从左侧进入你有权限的经营看板、商品、库存、订单与售后工作。可通过上方入口修改密码或退出账号。</p>
    <Link className="workspace-primary-link" to="/tasks">进入任务工作台 <span aria-hidden="true">↗</span></Link>
  </div><aside className="welcome-aside" aria-label="当前账号"><h2>当前账号</h2>
    <dl className="welcome-account"><div><dt>员工账号</dt><dd>{employee?.username}</dd></div><div><dt>当前岗位</dt><dd>{employee ? employeeRoles[employee.role] : ''}</dd></div></dl></aside></section>
    <section className="workspace-guide" aria-labelledby="workspace-guide-title"><h2 id="workspace-guide-title">清晰衔接每一步日常经营</h2><p>按业务找到工作入口，从任务开始，让处理过程有迹可循。</p>
      <div className="workspace-guide-grid"><article><span className="guide-symbol" aria-hidden="true">▦</span><h3>维护商品与库存</h3><p>整理款式资料，核对规格与数量，让每一件商品信息准确。</p></article><article><span className="guide-symbol" aria-hidden="true">▤</span><h3>跟进交易与服务</h3><p>查看订单进度，衔接履约与售后，及时处理顾客需求。</p></article><article><span className="guide-symbol" aria-hidden="true">◎</span><h3>协同店铺工作</h3><p>在任务工作台查看待办，依照当前岗位权限处理店铺事务。</p></article></div>
    </section></>;
}
