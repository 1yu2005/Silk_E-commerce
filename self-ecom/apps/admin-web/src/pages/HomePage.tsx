/** 文件作用：展示当前员工身份和后台已开放功能的工作入口。 */
import { useEmployeeAuth } from '../auth/use-employee-auth';
import { employeeRoles } from '../employees/query';

export function HomePage() {
  const { employee } = useEmployeeAuth();
  return <section className="welcome-panel"><div className="welcome-copy">
    <h1>欢迎，{employee?.displayName}。</h1>
    <p>这里是你的店铺工作入口。可通过上方入口修改密码或退出账号，商品、库存和订单功能将陆续开放。</p>
  </div><aside className="welcome-aside" aria-label="当前账号"><h2>当前账号</h2>
    <p>账号：{employee?.username}<br />岗位：{employee ? employeeRoles[employee.role] : ''}</p></aside></section>;
}
