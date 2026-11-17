/** 路由首次初始化时展示的公共占位界面，不依赖登录状态或业务数据。 */
export function RouteLoading() {
  return <main className="route-loading" aria-busy="true">
    <div role="status">
      <span className="route-loading-indicator" aria-hidden="true" />
      <p>正在加载页面…</p>
    </div>
  </main>;
}
