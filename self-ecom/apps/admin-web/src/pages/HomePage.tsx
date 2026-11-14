/** 文件作用：展示当前员工身份和后台已开放功能的工作入口。 */
import { useEmployeeAuth } from '../auth/use-employee-auth';
import { employeeRoles } from '../employees/query';

export function HomePage() {
  const { employee } = useEmployeeAuth();
  return <section className="welcome-panel"><div className="welcome-copy">
    <h1>欢迎，{employee?.displayName}。</h1>
    <p>从左侧进入你有权限的经营看板、商品、库存、订单与售后工作。可通过上方入口修改密码或退出账号。</p>
  </div><aside className="welcome-aside" aria-label="当前账号"><h2>当前账号</h2>
    <p>账号：{employee?.username}<br />岗位：{employee ? employeeRoles[employee.role] : ''}</p></aside></section>;
}
