# WebSocket + Turborepo 入门：它们是什么，能干什么

> 这两者虽然常被放在同一个学习阶段，但它们**完全不属于同一个层面**：
>
> - **WebSocket = 一种通信协议**（让服务器和浏览器可以双向实时对话）
> - **Turborepo = 一个构建工具**（让多个子项目的编译、测试、打包跑得更快）
>
> 打个比方：WebSocket 是「装在你家和新家之间的一条对讲机专线」，Turborepo 是「同时管着好几个工地的施工调度员」。下面分开讲。

---

# 第一部分：WebSocket 是什么

## 1. 概念

WebSocket 是一种**在单个 TCP 连接上进行全双工通信的协议**（Full-Duplex）。

- **全双工**：双方可以同时收发消息，不用"你问我答"轮流等。
- **单个连接**：握手一次，之后一直复用，不用每次带一堆请求头。
- **由 HTTP 升级而来**：先发一个带 `Upgrade: websocket` 的普通 HTTP 请求，服务器返回 `101 Switching Protocols`，连接就"升级"成 WebSocket 了。

```
浏览器 → 服务器：GET /chat  HTTP/1.1
                Upgrade: websocket
                Connection: Upgrade
                Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==
服务器 → 浏览器：HTTP/1.1 101 Switching Protocols
                Upgrade: websocket
                Connection: Upgrade
（之后双方就可以随时互发消息了）
```

## 2. 它解决什么问题

HTTP 是**请求-响应**模式：只能由客户端发起，服务器没法主动"喊"客户端。想做实时功能只能：

| 方案 | 做法 | 问题 |
| --- | --- | --- |
| **短轮询** | 前端每隔 2 秒发一次请求问"有新消息吗" | 大量无效请求，实时性差，浪费带宽 |
| **长轮询** | 请求挂起，有数据才返回，再立刻发下一次 | 服务器要维持大量挂起连接，实现复杂 |
| **SSE** | 服务器单向持续推送（`text/event-stream`） | 只能服务器 → 客户端，客户端不能推 |
| **WebSocket** | 一次握手，之后双向随时发 | 需要额外处理断线重连、鉴权、心跳 |

## 3. 有什么用（典型场景）

| 场景 | 说明 |
| --- | --- |
| **即时聊天** | 微信网页版、客服系统、私信 |
| **实时协作** | 多人同时编辑文档、白板（如飞书文档、Figma） |
| **实时数据大屏** | 股票行情、监控指标、物流轨迹 |
| **消息推送 / 通知** | 站内信、订单状态变更提醒 |
| **在线游戏** | 玩家位置、动作的实时同步 |
| **AI 流式输出** | 逐字返回的对话内容（很多实现用 SSE，但 WebSocket 也常见） |

## 4. 最小可用示例

**服务端（Node.js + `ws` 库）**

```bash
npm install ws
```

```js
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', (ws) => {
  console.log('有客户端连上了');

  // 收到客户端消息
  ws.on('message', (data) => {
    // 广播给所有在线客户端
    wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(`收到：${data}`);
    });
  });

  ws.on('close', () => console.log('客户端断开'));
});
```

**客户端（浏览器原生 API）**

```js
const ws = new WebSocket('ws://localhost:8080');

ws.onopen = () => ws.send('你好，我是客户端');
ws.onmessage = (e) => console.log('服务器说：', e.data);
ws.onclose = () => console.log('连接关闭');
ws.onerror = (err) => console.error('出错了', err);
```

就这么几行，双向实时通信就跑起来了。对比下面要讲的 Turborepo，WebSocket 的**概念门槛低、但工程细节多**（鉴权、重连、集群）。

## 5. 上线前必须处理的四件事

| 问题 | 说明 | 常规做法 |
| --- | --- | --- |
| **鉴权** | 原生 WebSocket API 不能自定义请求头 | 把 token 放 URL 参数、或用 Cookie；连接建立后再校验并踢掉非法连接 |
| **心跳保活** | 中间代理可能静默断开空闲连接 | 定时 ping/pong，超时则主动重连 |
| **断线重连** | 网络抖动、切 WiFi 都会断 | 指数退避重连（1s、2s、4s…），重连后补拉消息 |
| **多实例广播** | 部署多台服务器时，用户 A 连在 1 号机、用户 B 连在 2 号机 | 用 **Redis Pub/Sub** 或消息队列做跨实例广播 |

> 生产环境还要注意：Nginx 需配置 `proxy_set_header Upgrade` / `Connection` 才能转发升级请求，`wss://` 就是 WebSocket over TLS。

---

# 第二部分：Turborepo 是什么

## 1. 概念

Turborepo 是 Vercel 维护的 **JavaScript / TypeScript 高性能构建系统**，专门服务于 **Monorepo**（单仓库多项目）场景。

先说 **Monorepo** 是什么：把多个项目放在**同一个 Git 仓库**里，而不是每个项目一个仓库。

```
传统多仓库（Polyrepo）              Monorepo（单仓库多项目）
repo-web/     ─┐                   my-project/
repo-server/   ├ 各自独立             ├── apps/
repo-shared/  ─┘ 依赖靠 npm 发包      │    ├── web/       前端
                                     │    └── server/    后端
                                     ├── packages/
                                     │    ├── ui/       共享组件
                                     │    └── utils/    共享工具
                                     ├── package.json
                                     └── turbo.json
```

Monorepo 的好处：共享代码直接 `import` 不用发 npm 包、统一依赖版本、一次提交同时改前后端。坏处：**项目一多，"全部重新构建一遍"会非常慢** —— 这正是 Turborepo 要解决的。

## 2. 它有什么用

| 痛点 | Turborepo 的做法 |
| --- | --- |
| 改一个包，所有包全量重跑构建 | **任务依赖图**：只跑受影响的包及其下游 |
| 同样的构建跑第二遍还是那么慢 | **本地缓存**：输入没变就直接回放上次的输出（毫秒级） |
| 换台电脑 / CI 上从零开始 | **远程缓存（Remote Cache）**：把缓存存到云端，团队和 CI 共享 |
| 要手动一个个 `cd` 进目录执行命令 | **并行执行**：`turbo run build` 一条命令，按依赖顺序并行跑 |
| 配置散落各处，看不清任务关系 | **`turbo.json` 集中声明**任务管道和输入输出 |

一句话：**Turborepo 的核心卖点就是"缓存 + 增量"——只重算真正变了的、只跑该跑的。**

## 3. 核心概念

| 概念 | 含义 |
| --- | --- |
| **Task（任务）** | 一条可执行命令，如 `build`、`test`、`lint`、`dev` |
| **Pipeline / Tasks** | `turbo.json` 里声明的任务关系与配置（v2 叫 `tasks`，v1 叫 `pipeline`） |
| **`dependsOn`** | 声明前置任务，如"构建前先构建依赖包" |
| **Cache（缓存）** | 根据输入文件哈希判断能否复用上次结果 |
| **`outputs`** | 声明任务产物路径，决定缓存哪些文件 |
| **Remote Cache** | 团队共享的缓存服务（Vercel 或自建） |
| **Workspace** | 工作区，`apps/*`、`packages/*` 下的每个子包 |

## 4. 最小上手

```bash
npx create-turbo@latest my-project
cd my-project
npm run dev
```

自动生成的 `turbo.json`（v2 语法）大致长这样：

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {}
  }
}
```

三个关键字段的含义：

- **`dependsOn: ["^build"]`** —— `^` 表示"**先跑所有依赖包的 build**"。所以 `apps/web` 构建前，它会先构建 `packages/ui`。
- **`outputs: ["dist/**"]`** —— 告诉 Turbo 哪些是产物，要纳入缓存。
- **`cache: false` + `persistent: true`** —— `dev` 是常驻进程，不缓存、不能退出。

然后在根目录执行：

```bash
turbo run build        # 按依赖顺序并行构建所有包
turbo run build --filter=web   # 只构建 web 及其依赖
turbo run lint test    # 一条命令跑多个任务
```

第二次执行 `turbo run build`，如果没有任何文件变化，你会看到：

```
Tasks:    3 successful, 3 total
Cached:   3 cached, 3 total      ← 全部命中缓存，几乎瞬间完成
```

## 5. 适用边界（什么时候不该用）

| 场景 | 建议 |
| --- | --- |
| 只有一个独立项目 | **别用**。Turborepo 只对多包仓库有意义 |
| 包之间几乎没有共享代码 | 收益有限，先确认是否真需要 Monorepo |
| 团队只有 1～2 人、构建本来只要几秒 | 收益感知不明显 |
| 前后端 + 共享类型包（典型全栈项目） | **非常适合**，是 Turborepo 的主流场景 |

---

# 第三部分：两者如何在一个项目里共存

典型全栈项目的结构，正好可以同时用上这两者：

```
my-project/                    ← Turborepo 管理的 Monorepo
├── apps/
│   ├── web/                   React 前端
│   └── server/                NestJS 后端
│       └── 里面用 WebSocket 提供实时通知
├── packages/
│   └── shared/                前后端共享的类型定义（如消息格式）
├── turbo.json                 ← 调度这些包的构建
└── package.json
```

它们的**职责完全不重叠**：

| 维度 | WebSocket | Turborepo |
| --- | --- | --- |
| 层面 | 运行时通信 | 开发/构建时工程化 |
| 解决 | 服务器如何实时推消息给浏览器 | 多个子项目如何快速构建 |
| 生效时机 | 用户使用产品时 | 开发者敲命令、CI 打包时 |
| 使用者感受 | 用户（消息秒到） | 开发者（构建从 3 分钟变 10 秒） |

一个很实际的组合用法：把**共享的消息协议类型**放进 `packages/shared`，前端和 WebSocket 服务端 `import` 同一份 TS 类型，改协议时两边同时报错；再用 Turborepo 缓存，让"改一行协议 → 两个 app 重新构建"这个过程依然很快。

---

# 第四部分：常见坑

## WebSocket

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 连接报 `403` / 一直 pending | 握手被代理拦截 | Nginx 配置 `Upgrade` / `Connection` 头转发 |
| 空闲几分钟后自动断 | 中间设备断开空闲连接 | 加心跳 ping/pong |
| 线上 `ws://` 连不上 | HTTPS 页面不能连 `ws://` | 改用 `wss://` |
| 多台服务器时消息只推给部分用户 | 用户分散在不同实例 | Redis Pub/Sub 广播 |
| 重连后消息丢失 | 断线期间的消息没补拉 | 记录消息序号/时间戳，重连后补拉 |
| 连接数涨到几千就卡 | 单进程连接/句柄限制 | 调优系统参数，或多实例 + 负载均衡 |

## Turborepo

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 改了文件但命中旧缓存 | 输入文件/环境变量没被 Turbo 感知 | 检查 `outputs`，环境变量写入 `env` 字段 |
| `turbo.json` 报 schema 错误 | 用了 v1 的 `pipeline` 字段 | v2 改名为 `tasks` |
| `dev` 任务卡住不结束 | 常驻进程被当成普通任务 | 配 `"cache": false, "persistent": true` |
| 子包互相引用报"找不到模块" | workspace 依赖没声明 | 在子包 `package.json` 里写 `"@repo/ui": "*"`（workspace 依赖） |
| CI 每次全量构建 | 没开远程缓存 | 配 `TURBO_TOKEN` / `TURBO_TEAM` 启用 Remote Cache |

---

# 第五部分：术语速查

| 术语 | 英文 / 全称 | 一句话解释 |
| --- | --- | --- |
| 全双工 | Full-Duplex | 双方可同时收发数据 |
| 握手升级 | Protocol Upgrade | HTTP 连接通过 `101` 状态码切换为 WebSocket |
| 帧 | Frame | WebSocket 传输数据的最小单位 |
| 心跳 | Heartbeat / Ping-Pong | 定时探测连接是否还活着 |
| SSE | Server-Sent Events | 服务器单向推送的轻量方案 |
| WSS | WebSocket Secure | 加密版 WebSocket（走 TLS） |
| 单仓库 | Monorepo | 多个项目放在一个 Git 仓库里 |
| 工作区 | Workspace | Monorepo 里的每个子包 |
| 任务管道 | Task Pipeline | 任务间的依赖与执行顺序定义 |
| 构建缓存 | Build Cache | 输入未变时复用上次输出 |
| 远程缓存 | Remote Cache | 团队/CI 共享的缓存服务 |
| 过滤器 | `--filter` | 只对指定包执行命令 |

---

# 第六部分：小结

- **WebSocket** 是"让服务器能主动说话"的协议：一次握手、双向实时，适合聊天、协作、行情、通知。概念简单，难点在**鉴权、心跳、重连、多实例广播**这四件事上。
- **Turborepo** 是"管多个项目的施工调度员"：靠**任务依赖图 + 本地/远程缓存**，让 Monorepo 的构建从"全量重跑"变成"只跑变了的"，可直接节省大量 CI 时间和本地等待时间。
- 两者层次不同、互不替代：一个管**运行时通信**，一个管**开发构建效率**，完全可以（也经常）在同一个全栈项目里搭配使用。

> 下一步可延伸：用 NestJS 的 `@WebSocketGateway` 写带鉴权的 WebSocket 服务、用 Socket.IO 处理重连与房间；Turborepo 与 CI（GitHub Actions）结合、共享类型包的最佳实践。
