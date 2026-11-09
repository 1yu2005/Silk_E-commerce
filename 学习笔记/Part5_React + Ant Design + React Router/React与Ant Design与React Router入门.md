# React + Ant Design + React Router 入门：它们是什么，能干什么

> 一句话先把三者的分工说清：
>
> - **React** = 造"积木"的框架（把页面拆成组件，数据变了页面自动更新）
> - **Ant Design** = 一盒现成的精美积木（按钮、表格、弹窗直接拿来用，不用自己写样式）
> - **React Router** = 积木之间的"房间切换器"（不同 URL 显示不同组件，页面不刷新）

---

# 一、React 是什么

## 1. 概念

React 是 Meta（原 Facebook）开源的 **前端 UI 库**，用来构建用户界面。它最大特点是把界面拆成一个个**组件（Component）**，再用数据驱动这些组件渲染。

三个关键词：

| 关键词 | 含义 |
| --- | --- |
| **组件化** | 页面 = 组件树。导航栏、侧边栏、表格都是组件，可复用、可嵌套 |
| **声明式** | 你只描述"在某个状态下界面长什么样"，不用手写"先找 DOM 再改 innerHTML" |
| **状态驱动（响应式）** | 数据（state）变了，React 自动重新渲染相关部分，你不管 DOM 操作 |

## 2. 它有什么用

- **复杂交互页面好维护**：传统 DOM 操作代码越长越乱，React 用状态管理界面，逻辑清晰。
- **组件复用**：一个 `<UserCard />` 写一次，到处用。
- **单页应用（SPA）的基础**：配合路由实现无刷新切页，体验接近桌面应用。
- **生态极大**：表单、状态管理、图表、UI 库（如 Ant Design）全都围绕它。

## 3. 最小的 React 长什么样

React 用 **JSX** 语法，看起来像写 HTML，实际是 JS 表达式：

```jsx
function Hello({ name }) {
  return <h1>Hello, {name}!</h1>;
}

// 使用
<Hello name="小明" />
```

带交互的组件需要 **state**（状态）和 **Hook**（钩子函数）：

```jsx
import { useState, useEffect } from 'react';

function Counter() {
  const [count, setCount] = useState(0);   // 声明一个状态，初始值 0

  useEffect(() => {                        // 副作用：组件挂载/依赖变化时执行
    document.title = `点击了 ${count} 次`;
  }, [count]);

  return (
    <button onClick={() => setCount(count + 1)}>
      点了 {count} 次
    </button>
  );
}
```

要点：

- `useState` 返回 `[当前值, 修改函数]`，**必须通过修改函数更新**，直接改变量不会触发渲染。
- `useEffect` 用来处理"渲染之外的事"：请求数据、设置定时器、操作 DOM。
- Hook 只能在**组件顶层**调用，不能写在 `if` / 循环里。

---

# 二、Ant Design 是什么

## 1. 概念

Ant Design（简称 **AntD**）是蚂蚁集团开源的 **React UI 组件库**。它提供了一整套设计规范 + 现成组件，让你不用从零写按钮、表单、表格的样式和交互。

## 2. 它有什么用

| 解决的痛点 | AntD 的做法 |
| --- | --- |
| 每个按钮、输入框都要自己调 CSS | 直接 `<Button type="primary">`，样式开箱即用 |
| 交互细节难做（下拉、分页、上传、弹窗） | 现成组件，键盘操作、无障碍都处理好了 |
| 界面风格不统一 | 一套设计规范，整体视觉一致 |
| 后台管理系统开发慢 | 提供了大量"中后台"专用组件：`Table`、`Form`、`ProTable` 等 |

一句话：**做后台管理系统（Admin）时，AntD 能省掉 70% 的 UI 时间。**

## 3. 安装与最小用法

```bash
npm install antd
```

```jsx
import { Button, Table, message } from 'antd';

function Demo() {
  const columns = [
    { title: '姓名', dataIndex: 'name' },
    { title: '年龄', dataIndex: 'age' },
  ];
  const data = [{ key: 1, name: '小明', age: 20 }];

  return (
    <>
      <Button type="primary" onClick={() => message.success('保存成功')}>
        保存
      </Button>
      <Table columns={columns} dataSource={data} />
    </>
  );
}
```

## 4. 常用组件速览

| 分类 | 组件 | 用途 |
| --- | --- | --- |
| 通用 | `Button` / `Icon` | 按钮、图标 |
| 布局 | `Layout` / `Row` / `Col` / `Space` | 页面框架、栅格布局 |
| 数据录入 | `Form` / `Input` / `Select` / `DatePicker` / `Upload` | 表单与控件 |
| 数据展示 | `Table` / `Card` / `Descriptions` / `Tag` | 表格、卡片、详情 |
| 反馈 | `message` / `Modal` / `notification` / `Spin` | 提示、弹窗、加载 |
| 导航 | `Menu` / `Breadcrumb` / `Tabs` / `Steps` | 菜单、面包屑、页签 |

> 注：AntD v5 起用 **CSS-in-JS**，无需再引入全局样式文件，主题可用 `ConfigProvider` + `theme` 定制主色，比 v4 的 less 变量方案更简单。

---

# 三、React Router 是什么

## 1. 概念

React Router 是 React 生态里最主流的**前端路由库**。它让你在**不刷新页面**的情况下，根据 URL 切换显示的组件 —— 这是单页应用（SPA）的核心能力。

- 传统多页应用：点链接 → 浏览器向服务器要新 HTML → 整页刷新。
- SPA + 路由：点链接 → URL 变了但页面不刷新 → JS 拦截并渲染对应组件。

## 2. 它有什么用

| 用途 | 说明 |
| --- | --- |
| **无刷新跳页** | 页面切换快，体验像原生 App |
| **URL 与界面绑定** | `/users` 显示用户列表，`/users/1` 显示详情，刷新后仍停在同一页 |
| **嵌套路由** | 父页面里再套子页面（如后台布局 + 内容区） |
| **路由守卫** | 未登录访问 `/admin` 时重定向到登录页 |
| **动态参数** | `/:id` 取 URL 参数 |
| **代码分割** | 按路由懒加载，首屏更快 |

## 3. 安装与基本用法（v6/v7 语法）

```bash
npm install react-router-dom
```

```jsx
import { BrowserRouter, Routes, Route, Link, useNavigate, useParams } from 'react-router-dom';

function Home() {
  return <h2>首页</h2>;
}

function UserDetail() {
  const { id } = useParams();               // 取 /:id 参数
  return <h2>用户 ID: {id}</h2>;
}

function App() {
  const navigate = useNavigate();           // 编程式跳转

  return (
    <BrowserRouter>
      <nav>
        <Link to="/">首页</Link>
        <Link to="/users/1">用户 1</Link>
        <button onClick={() => navigate('/users/2')}>去用户 2</button>
      </nav>

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/users/:id" element={<UserDetail />} />
        <Route path="*" element={<h2>404 页面不存在</h2>} />
      </Routes>
    </BrowserRouter>
  );
}
```

核心 API 对照：

| API | 作用 |
| --- | --- |
| `BrowserRouter` | 用 HTML5 History 实现的路由容器，URL 干净无 `#` |
| `Routes` / `Route` | 声明"路径 → 组件"的映射表 |
| `Link` / `NavLink` | 声明式跳转（`NavLink` 可给激活项加样式） |
| `useNavigate()` | 编程式跳转（如表单提交成功后跳转） |
| `useParams()` | 读取动态路由参数 |
| `Outlet` | 嵌套路由的占位出口 |
| `<Navigate />` | 重定向，常用于路由守卫 |

---

# 四、三者如何配合

## 1. 分工关系

```
React            ← 底层框架：组件、状态、渲染
├── Ant Design   ← 上层的"零件箱"：UI 组件
└── React Router ← 上层的"导航系统"：页面切换
```

三者不是替代关系，而是**搭配使用**：

- React 负责"怎么渲染"；
- AntD 负责"长什么样"；
- React Router 负责"在哪个页面"。

## 2. 一个典型后台页面骨架

```jsx
import { BrowserRouter, Routes, Route, Link, Outlet, NavLink } from 'react-router-dom';
import { Layout, Menu, Button } from 'antd';

const { Header, Sider, Content } = Layout;

// 后台整体布局：AntD 负责框架，Router 的 Outlet 负责把子页面塞进 Content
function AdminLayout() {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider>
        <Menu
          theme="dark"
          items={[
            { key: 'users', label: <Link to="/users">用户管理</Link> },
            { key: 'orders', label: <Link to="/orders">订单管理</Link> },
          ]}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff' }}>
          <Button type="primary">退出登录</Button>
        </Header>
        <Content style={{ padding: 24 }}>
          <Outlet />   {/* 子路由渲染到这里 */}
        </Content>
      </Layout>
    </Layout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AdminLayout />}>
          <Route path="users" element={<div>用户列表</div>} />
          <Route path="orders" element={<div>订单列表</div>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

这段代码体现了真实的开发模式：**AntD 搭布局外壳 → React Router 控制内容区切换 → React 组件承载业务逻辑**。

---

# 五、常见坑与小贴士

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 直接改 `count++` 页面不变 | 没走 `setCount` | 状态必须用设置函数更新 |
| 刷新 `/users/1` 出现 404 | 服务器不认识该路径 | 开发时 Vite/Webpack 已处理；生产需配置把未知路径回落到 `index.html` |
| 在 `BrowserRouter` 外调用 `useNavigate` 报错 | Hook 必须在路由上下文内 | 把组件放进路由树，或调整 Provider 层级 |
| 组件里 `useEffect` 无限循环 | 依赖数组漏写或对象每次新建 | 检查依赖，必要时用 `useMemo` / `useCallback` |
| AntD 样式不生效 | v5 版本或样式引入方式不对 | v5 无需引 CSS；v4 需 `import 'antd/dist/reset.css'` |
| 打包体积过大 | 全量引入 AntD | 使用按需加载（v5 默认支持 tree-shaking） |
| 多个 `Router` 嵌套 | 只能有一个顶层 Router | 确保 `BrowserRouter` 只出现一次 |

---

# 六、术语速查

| 术语 | 英文 / 全称 | 一句话解释 |
| --- | --- | --- |
| 组件 | Component | 可复用的 UI 单元，本质是一个返回 JSX 的函数 |
| JSX | JavaScript XML | 在 JS 里写类 HTML 的语法糖 |
| 状态 | State | 组件内部会变化的数据，变化触发重渲染 |
| 属性 | Props | 父组件传给子组件的只读参数 |
| 钩子 | Hook | 让函数组件拥有状态和生命周期能力的函数（`useState`/`useEffect`） |
| 虚拟 DOM | Virtual DOM | 内存中的 DOM 描述，用于 diff 后最小化真实 DOM 操作 |
| SPA | Single Page Application | 单页应用，整站只有一个 HTML，靠 JS 切页 |
| 前端路由 | Client-side Routing | 由浏览器端 JS 处理 URL 变化，不请求新页面 |
| 嵌套路由 | Nested Route | 父路由内再定义子路由，用 `Outlet` 渲染 |
| 组件库 | Component Library | 成套封装好的 UI 组件集合，如 AntD |
| 受控组件 | Controlled Component | 表单值由 React state 管控的输入组件 |

---

# 七、小结

- **React**：把页面拆成组件、用状态驱动渲染，是写现代前端的底座。
- **Ant Design**：现成的企业级 UI 组件库，做后台系统时能大幅提升开发速度，让界面统一好看。
- **React Router**：让 SPA 拥有多页面的观感，URL、嵌套布局、权限守卫都靠它。
- 三者组合起来，就是**中后台前端项目的标准技术栈**：React 管逻辑、AntD 管外观、Router 管导航。

> 下一步可延伸：`useContext` / Zustand 做全局状态、Axios 封装请求、AntD `Form` 的表单校验、路由懒加载与权限守卫实战。
