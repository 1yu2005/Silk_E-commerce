# 会话与中间件：Session 登录态与 Middleware 拦截

> 学习日期：2026-11-05
> 素材来源：小满 NestJS 系列（blog.csdn.net/qq1195566313，专栏 ID 11844396）
> 本篇对应：原文第 9、12 章
> 适合人群：NestJS 零基础

03 篇我们把 Controller / Provider / Module 三块拼图拼完了，接口能收参数、能返回数据。但真实的 Web 应用还有两个绕不开的问题：

1. **服务器怎么认出"你"是谁？** HTTP 天生"失忆"，两次请求之间它不记得你。这个问题的答案是 Session 会话。
2. **能不能在请求真正进入控制器之前统一做点事？** 比如拦截非法访问、打日志、处理跨域。这个答案是中间件 Middleware。

本篇用一个**图形验证码登录**案例把第 1 个问题讲透，再系统讲清第 2 个问题。

---

## 一、Session 会话机制

### 1.1 先用大白话理解

想象你去游乐园：

- 你在门口买票进场，工作人员给你**戴上一个手环**，手环上只写了一串编号 `A7X-9921`。
- 之后你去坐过山车、进餐厅，每个项目门口都刷一下手环——工作人员拿着编号去**系统里查**："A7X-9921 是谁？哦，是张三，票还没过期，能进。"
- 手环本身**不承载你的信息**，它只是一个"钥匙"。真正记录你身份的，是游乐园系统的数据库。

对应到 Web：

| 游乐园 | Web |
| --- | --- |
| 手环上的编号 | ==Cookie 里的 SessionID（一串随机字符串）== |
| 系统里你的档案 | 服务器内存中的 session 对象 |
| 刷手环查档案 | ==浏览器每次请求自动带 Cookie，服务器凭 SessionID 找到对应 session== |

==所以一句话：**Session 数据存在服务器，浏览器只拿一个 SessionID（放在 Cookie 里）。**==

### 1.2 专业定义

> **Session（会话）** 是==服务器==为==每个用户的浏览器==创建的一个**会话对象**，用于在多次 HTTP 请求之间保存该用户的状态。这个==session 的标识（SessionID）会通过 **Cookie** 记录到浏览器==，服务器每次凭它来区分不同用户。

三个必记术语：

| 术语 | 英文 | 含义 |
| --- | --- | --- |
| 会话 | Session | ==服务器端==保存的用户状态容器，如 `{ code: '3f9a', userId: 1 }` |
| 会话标识 | SessionID | 一串随机字符串，是找到对应 Session 的钥匙 |
| Cookie | Cookie | ==浏览器本地==存储，用来==承载 SessionID 发给服务器== |

> # 完整工作流程
>
> 前提：==HTTP协议本身是**无状态**的，服务器默认分不清两次请求是不是同一个用户。==
>
> 1. 用户第一次访问后端接口（登录请求）
> 2. ==服务器==收到请求，==**生成唯一的随机字符串：SessionID**==
> 3. 在==服务器内存（或者Redis）==开辟一块空间，==创建Session对象==，用来存放这个用户的数据（userId、登录状态等），并且把==SessionID和这个Session对象绑定==起来
> 4. <u>服务器返回响应的时候，在响应头里带上 `Set-Cookie`，把 **SessionID 写入浏览器的Cookie**</u>
> 5. ==浏览器==收到响应，自动把这个==Cookie存到本地==
> 6. **之后这个浏览器每一次发请求，都会自动带上这个Cookie（里面装着SessionID）发给服务器**
> 7. 服务器拿到请求里的SessionID，拿着这个钥匙去服务器存储里查找对应的Session数据，识别出是哪个用户
> 8. 直到Cookie过期 / Session过期 / 退出登录，这个绑定关系失效
>
> ## 一句话精简版
>
> ==第一次访问：服务端生成Session+SessionID → 通过Set-Cookie把SessionID放到浏览器Cookie里； 后续请求：浏览器自动在Cookie携带SessionID传给服务端 → 服务端用SessionID查到保存在服务端的Session，进而识别出是哪一个用户==。
>
> ```mermaid
> sequenceDiagram
>     autonumber
>     participant B as 浏览器
>     participant S as 服务端应用
>     participant M as Session存储 内存或Redis
> 
>     B->>S: 第一次访问后端接口 发送登录请求 账号加密码
>     S->>S: 校验账号密码通过 生成唯一随机字符串 SessionID
>     S->>M: 开辟空间创建 Session 对象 存入 userId 与登录状态
>     M-->>S: 创建成功 并把 SessionID 与 Session 对象绑定
>     S-->>B: 返回响应 响应头携带 Set-Cookie 写入 SessionID
>     Note over B: 浏览器自动把 Cookie 保存到本地
>     B->>S: 之后每一次请求 自动携带 Cookie 其中装着 SessionID
>     S->>M: 拿 SessionID 当钥匙 在存储中查找对应 Session 数据
>     M-->>S: 命中 返回该用户的 userId 与登录状态
>     S-->>B: 识别出是哪个用户 返回其私有数据
>     Note over B,S: Cookie 过期 或 Session 过期 或主动退出登录 绑定关系失效
> ```
>
> ## 三者分工再梳理
>
> - **Session**：服务器上的容器，存用户状态（真正的数据在这里）
> - **SessionID**：钥匙，用来定位到对应的Session
> - **Cookie**：浏览器的存储空间，负责把这把钥匙（SessionID）在请求里带给服务器
>
> ## 补充坑点（面试常问）
>
> 1. Cookie是存在**客户端（浏览器）**，Session存在**服务端**；用户敏感数据不要放Cookie，放Session
> 2. 如果用户浏览器禁用Cookie，这套session方案就失效了（可以改用URL参数携带sessionId，很少用）
> 3. express-session 默认把Session存在内存，生产环境要换成Redis，不然重启服务session全部丢失、多实例也不能共享登录态
>
> 要不要我顺带对比一下 Session 和 JWT 的区别？这个是高频面试题。



### 1.3 为什么需要 Session：HTTP 是无状态的

**无状态（Stateless）** 的意思是：HTTP 协议本身不记录上次请求发生了什么。你请求了 `/user/create` 登录成功，接着请求 `/user/info`，服务器完全不认识你——它没义务记得上一个请求是谁发的。

想让服务器"记住你"，只有两条路：

| 对比项 | 把数据放 Cookie（客户端） | 把数据放 Session（服务端） |
| --- | --- | --- |
| 数据实际存哪 | 浏览器本地 | 服务器内存 / 外部存储 |
| 浏览器能看到吗 | 能，明文可见、可篡改 | 只能看到一串 SessionID |
| 容量限制 | 约 4KB | 由服务器决定 |
| 安全性 | 低（敏感信息绝不能放） | 较高（数据不落客户端） |
| 适合放什么 | 主题色、语言偏好等无关紧要的设置 | 登录态、验证码答案、购物车 |
| 服务器重启后 | 还在 | 默认的 MemoryStore 会全部丢失 |

> **小白结论**：凡是不想让用户看到、不想被用户改的数据，都放 Session，别放 Cookie。

### 1.4 安装与注册

NestJS 默认底层是 Express，所以可以直接用 Express 生态的中间件。Session 就用官方插件 `express-session`。

==**第一步：安装**==

```bash
# 安装 session 插件   安装运行依赖（插件本体，项目上线也要用）
npm i express-session --save

# 安装类型声明，为了 TS 里有智能提示（仅开发依赖）  TS类型定义包，只开发阶段用，给TS提供代码提示、类型检查，上线打包不会带进去
npm i @types/express-session -D
```

**第二步：在入口文件注册**

Session 是一个**中间件**，要用 `app.use()` 挂上去，位置在 `NestFactory.create()` 之后、`app.listen()` 之前。

```ts
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as session from 'express-session';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 注册 session 中间件：之后所有请求都会经过它
  app.use(
    session({
      secret: 'XiaoMan', // 必填：给 SessionID 签名用的"盐"
      name: 'xm.session', // 浏览器里 cookie 的名字，默认 connect.sid
      rolling: true, // 每次请求都刷新 cookie 的过期时间
      cookie: {
        maxAge: null, // null = 会话 cookie，关闭浏览器即失效
      },
    }),
  );

  await app.listen(3000);
}
bootstrap();
```

**启动成功的标志**：访问任意接口后，打开浏览器开发者工具 → `Application` → `Cookies`，能看到一个名为 `xm.session` 的 Cookie。

> 注意：不传 `secret` 会直接抛错 `TypeError: secret option required for sessions`，这是新手第一个卡点。

### 1.5 核心参数详解

| 参数 | 作用 | 默认值 | 备注 |
| --- | --- | --- | --- |
| `secret` | 给服务端 Session 签名（可以理解为"加盐"） | **无，必填** | 防伪造，生产环境应放环境变量 |
| `name` | 生成客户端 cookie 的名字 | `connect.sid` | 改成 `xm.session` 可少暴露技术栈 |
| `cookie` | 返回给前端的 cookie 属性 | `{ path: '/', httpOnly: true, secure: false, maxAge: null }` | 见下方逐项说明 |
| `rolling` | 每次请求都强行设置 cookie，**重置过期时间** | `false` | 想实现"半小时无操作才掉线"就开它 |
| `resave` | 即使 session 没改动也重新保存 | `true`（旧版） | 显式设为 `false` 可减少无谓写入 |
| `saveUninitialized` | 未初始化的空 session 是否也存 | `true` | 设为 `false` 可避免给爬虫发一堆空 session |
| `store` | Session 存哪里 | 内存 `MemoryStore` | 生产要换 Redis 等持久化存储 |

**cookie 子配置逐项说明**：

| 子项 | 含义 |
| --- | --- |
| `path: '/'` | 该 cookie 在站点的哪些路径下生效，`/` 表示全站 |
| `httpOnly: true` | 禁止 JS 通过 `document.cookie` 读取，防 XSS 偷 SessionID |
| `secure: false` | 是否只在 HTTPS 下传输。部署到 HTTPS 站点要改成 `true`，否则浏览器不会带 |
| `maxAge: null` | 有效期。`null` 表示**会话 cookie**，关浏览器就没了；写数字则是毫秒数 |
| `sameSite` | 跨站请求是否携带 cookie。前后端不同端口联调时注意此项 |

### 1.6 动手案例：图形验证码登录

需求：前端展示一张验证码图片 → 后端把正确答案存进 session → 用户提交表单 → 后端比对 session 里的答案。整个链路完全不把正确答案传给前端。

#### 1.6.1 后端：安装并生成验证码

```bash
# SVG 验证码生成插件
npm install svg-captcha -S
```

```ts
// src/user/user.controller.ts
import { Controller, Get, Post, Body, Req, Res } from '@nestjs/common';
import * as svgCaptcha from 'svg-captcha';

@Controller('user')
export class UserController {
  // 生成验证码图片
  @Get('code')
  createCaptcha(@Req() req, @Res() res) {
    // 1. 生成验证码：text 是正确答案，data 是 SVG 图片字符串
    const captcha = svgCaptcha.create({
      size: 4, // 生成几个字符
      fontSize: 50, // 文字大小
      width: 100, // 图片宽度
      height: 34, // 图片高度
      background: '#cc9966', // 背景颜色
    });

    // 2. 把正确答案存到 session（只存服务端，不返回给前端）
    req.session.code = captcha.text;

    // 3. 告诉浏览器这是 SVG 图片，并把图片数据返回
    res.type('image/svg+xml');
    res.send(captcha.data);
  }

  // 校验验证码
  @Post('create')
  createUser(@Req() req, @Body() body) {
    // 取出 session 里存的答案（没点过验证码时可能为 undefined）
    const sessionCode = req.session.code ?? '';

    if (sessionCode.toLowerCase() === (body?.code ?? '').toLowerCase()) {
      return { message: '验证码正确' };
    }
    return { message: '验证码错误' };
  }
}
```

**这段代码的三个关键点**：

1. `captcha.text` 是答案，`captcha.data` 是图片。**只有 data 能发给前端**，text 必须留在服务端。
2. `req.session.code = captcha.text` 这一行，才是"服务器记住你"的真正动作。
3. 用了 `@Res()` 就**必须自己 `res.send()`**，否则请求会挂起——这条坑在 03 篇 2.8 节已经踩过一次，这里再犯一次就会发现浏览器图片一直不显示。

#### 1.6.2 前端：Vue3 + Element Plus 页面

```bash
# 安装 Element Plus UI 库
npm install element-plus -S
```

```vue
<!-- src/components/Login.vue -->
<template>
  <div class="wraps">
    <el-form label-width="100px" :model="formLabelAlign" style="max-width: 460px">
      <el-form-item label="账号">
        <el-input v-model="formLabelAlign.name" />
      </el-form-item>
      <el-form-item label="密码">
        <el-input type="password" v-model="formLabelAlign.password" />
      </el-form-item>
      <el-form-item label="验证码">
        <div style="display: flex">
          <el-input v-model="formLabelAlign.code" />
          <!-- 点击图片换一张 -->
          <img @click="resetCode" :src="codeUrl" alt="" />
        </div>
      </el-form-item>
      <el-form-item>
        <el-button @click="submit">登录</el-button>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';

// 验证码图片地址（/api 会被 vite 代理转发到后端）
const codeUrl = ref<string>('/api/user/code');

// 点击图片重新请求：加个随机数，绕开浏览器缓存
const resetCode = () => (codeUrl.value = '/api/user/code?' + Math.random());

const formLabelAlign = reactive({
  name: '',
  password: '',
  code: '',
});

const submit = async () => {
  await fetch('/api/user/create', {
    method: 'POST',
    body: JSON.stringify(formLabelAlign),
    headers: {
      'content-type': 'application/json', // 少了这行，后端 @Body() 拿到的是空对象
    },
  }).then((res) => res.json());
};
</script>

<style>
/* 让表单在页面垂直水平居中（样式细节不影响功能，可自行调整） */
.wraps {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
}
html,
body,
#app {
  height: 100%;
  margin: 0;
}
</style>
```

#### 1.6.3 前端代理解决跨域

前端跑在 `localhost:5173`，后端在 `localhost:3000`，端口不同就是跨域。用 Vite 的 `dev` 代理可以最省事地解决（Cookie 也能正常工作）：

```ts
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      // 所有 /api 开头的请求，转发到后端
      '/api': {
        target: 'http://localhost:3000/',
        changeOrigin: true,
        // 转发前把 /api 前缀去掉：/api/user/code → /user/code
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
```

> 为什么用代理而不是后端加 CORS？因为**代理之后，浏览器眼里前后端是同一个源**，Cookie 天然能带上，不用折腾 `credentials`、`sameSite` 这些配置。联调阶段强烈推荐这种方式。

### 1.7 一次验证码登录的完整链路

把上面三段代码串起来看，一次登录到底发生了什么：

```
① 页面加载，<img src="/api/user/code">
        ↓ （Vite 代理把 /api 去掉）
② 后端 GET /user/code
   · svgCaptcha.create() → 得到 text='3f9a'、data='<svg>...'
   · req.session.code = '3f9a'        ← 只存服务器
   · 响应头 Set-Cookie: xm.session=AbC123...
        ↓
③ 浏览器做两件事：
   · 把 SVG 图片画出来给用户看
   · 把 xm.session=AbC123 存进 Cookie
        ↓
④ 用户输入 '3f9a'，点登录，POST /user/create
   浏览器自动带上 Cookie: xm.session=AbC123
        ↓
⑤ 后端凭 AbC123 找到对应 session，读出 code='3f9a'
   与 body.code 比对 → 返回 { message: '验证码正确' }
```

**整个过程中，正确答案一次都没有出现在网络响应里**（除了画成图片）。这就是 Session 的安全价值：如果用 Cookie 存答案，用户打开开发者工具就能直接看到。

### 1.8 常见错误与排查

**报错 1：`TypeError: secret option required for sessions`**

- 原因：`session()` 没传 `secret`，或者写成了 `app.use(session)`（漏了调用，只挂了函数本身）。
- 解决：`app.use(session({ secret: 'XiaoMan' }))`，注意是**调用** `session()`。

**报错 2：`TypeError: Cannot read properties of undefined (reading 'toLocaleLowerCase')`**

- 原因：用户没先请求 `/user/code` 就直接提交表单，`req.session.code` 是 `undefined`，调 `.toLowerCase()` 就炸了。
- 解决：像 1.6.1 的代码那样先兜底 `req.session.code ?? ''`，再判断空值并给前端提示"请先获取验证码"。

**现象 3：图片一直加载不出来，接口 pending 到超时**

- 原因：`@Res() res` 注入了但没调 `res.send()`。
- 解决：`res.type(...)` 后必须 `res.send(captcha.data)` 或 `res.end()`。

**现象 4：验证码永远提示"错误"，但明明输对了**

- 原因 A：前端用 `localhost:5173` 直连后端 `3000` 端口，触发了跨域，浏览器**默认不发送/接收第三方 Cookie**，导致后端每次请求都是一个新 session。
- 原因 B：请求 `/user/code` 时返回了新 SessionID 的 `Set-Cookie`，但提交时浏览器没带上旧 cookie。
- 解决：用 1.6.3 的代理方案；或后端开 CORS 且前端 fetch 加 `credentials: 'include'`、后端 `credentials: true`。

**现象 5：启动日志里有一条警告 `Warning: connect.session() MemoryStore is not designed for a production environment...`**

- 原因：默认存储是内存 `MemoryStore`，多进程不共享、重启即丢。
- 解决：**开发阶段可以直接忽略**；生产环境要换成 Redis 等持久化 store（这部分属于部署话题，本篇不展开）。

**现象 6：改完代码热更新后，刚登录的状态突然没了**

- 原因：`start:dev` 会重启 Node 进程，内存里的 session 全部清空；同时旧 SessionID 已失效。
- 解决：属于预期行为。调试登录态时尽量别频繁重启，或改用持久化 store。

---

## 二、中间件 Middleware

### 2.1 先用大白话理解

中间件就像**机场安检传送带**。

- 每个旅客（请求）想登机（进入 Controller），都必须先过安检机（中间件）。
- 安检机能做的事：看一眼证件（读请求）、往箱子上贴个标签（改请求对象）、记录一下（打日志）、发现违禁品直接拦下不让走（结束请求）、或者检查完放行到下一道关卡（`next()`）。
- **关键在于**：如果安检员既不拦人、也不说"通过"，那旅客就永远卡在那儿——这就是"忘记调用 `next()` 导致请求挂起"。

### 2.2 专业定义  ⭐⭐⭐⭐⭐

> **中间件（Middleware）** 是==在**路由处理程序之前**==调用的==函数==。==中间件函数可以访问请求对象（`req`）和响应对象（`res`）。==

它可以执行以下任务：

- 执行任何代码（打日志、统计耗时、鉴权判断）。
- 对请求和响应对象进行修改（往 `req` 上挂 `user` 信息、往响应头塞东西）。
- 结束请求-响应周期（直接 `res.send()`，后面的都不走了）。
- 调用堆栈中的下一个中间件函数（`next()`）。
- ==**如果当前中间件没有结束请求-响应周期，它必须调用 `next()` 把控制权交给下一个中间件，否则请求会被挂起。**==

最后这条是本节第一红线，务必刻进脑子。

### 2.3 类式（可依赖注入）中间件

NestJS 里的中间件有两种形态，先说"正规军"——**类式中间件（Class Middleware）**：一个实现了 `NestMiddleware` 接口的类，必须提供 `use(req, res, next)` 方法。

```ts
// src/middleware/logger.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable() // 加了它才能被依赖注入（比如注入 Service 做鉴权）
export class Logger implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // 这里可以写任何你想在"进入 Controller 之前"做的事
    console.log('请求方法：', req.method);
    console.log('请求路径：', req.originalUrl);
    console.log('请求时间：', new Date().toLocaleString());

    // ！！必须调用，否则请求挂起
    next();
  }
}
```

**为什么用类而不是函数？** 因为类是 `@Injectable()` 的，可以在构造器里注入 Service：

```ts
// src/middleware/auth.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { UserService } from '../user/user.service';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  // 类式中间件可以注入依赖，这是它比函数式中间件强的地方
  constructor(private readonly userService: UserService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const token = req.headers['authorization'];
    const user = await this.userService.findByToken(token as string);

    if (!user) {
      // 不调 next()，直接给响应 → 请求到此结束
      return res.status(401).json({ message: '未登录' });
    }

    // 把用户信息挂到 req 上，后面的 Controller 就能拿到
    (req as any).user = user;
    next();
  }
}
```

> **注意**：这个中间件依赖了 `UserService`，所以它必须注册在**能访问到 `UserService` 的模块上下文里**（即该模块 `providers` 里有 `UserService`，或从别的模块 `imports` 进来）。否则报 `Nest can't resolve dependencies of the AuthMiddleware`。

### 2.4 注册中间件：`configure` + `consumer`

类式中间件写好了不会自动生效，必须**在模块里注册**。步骤是固定的三步：

1. 模块类 `implements NestModule`（实现 `NestModule` 接口）。
2. 实现 `configure(consumer: MiddlewareConsumer)` 方法。
3. 用 `consumer.apply(中间件).forRoutes(路径)` 指定作用范围。

#### 2.4.1 写法一：拦截某个路径下所有方法

```ts
// src/user/user.module.ts
import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { Logger } from '../middleware/logger.middleware';

@Module({
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule implements NestModule {
  // Nest 会自动调用这个方法，把"中间件消费者"传进来
  configure(consumer: MiddlewareConsumer) {
    // apply：要应用哪个中间件
    // forRoutes：作用在哪些路由上（'user' 表示 /user 及其所有子路径）
    consumer.apply(Logger).forRoutes('user');
  }
}
```

生效范围：`GET /user`、`POST /user`、`GET /user/1`、`PATCH /user/1`……全部都会先走 `Logger`。

#### 2.4.2 写法二：只拦截指定 HTTP 方法

`forRoutes` 除了字符串，还能传一个对象 `{ path, method }`：

```ts
import {
  Module,
  NestModule,
  MiddlewareConsumer,
  RequestMethod,
} from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { Logger } from '../middleware/logger.middleware';

@Module({
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(Logger).forRoutes({
      path: 'user', // 路径
      method: RequestMethod.GET, // 只拦截 GET 请求
    });
  }
}
```

此时 `POST /user` 不会触发 `Logger`，只有 GET 会。

| `RequestMethod` 值 | 对应方法 |
| --- | --- |
| `RequestMethod.GET` | GET |
| `RequestMethod.POST` | POST |
| `RequestMethod.PUT` | PUT |
| `RequestMethod.PATCH` | PATCH |
| `RequestMethod.DELETE` | DELETE |
| `RequestMethod.ALL` | 所有方法 |

#### 2.4.3 写法三：直接塞 Controller 类

懒人写法——把 Controller 类本身传进去，等价于"这个控制器下的所有路由"：

```ts
import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { Logger } from '../middleware/logger.middleware';

@Module({
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // 直接给 Controller 类，不用手写路径字符串
    consumer.apply(Logger).forRoutes(UserController);
  }
}
```

**三种写法对比**：

| 写法 | 示例 | 作用范围 | 适用场景 |
| --- | --- | --- | --- |
| 字符串路径 | `forRoutes('user')` | `/user` 下所有方法 | 最快、最常见 |
| 对象配置 | `forRoutes({ path: 'user', method: RequestMethod.GET })` | 指定方法 | 只想拦某类请求 |
| Controller 类 | `forRoutes(UserController)` | 该控制器全部路由 | 一个控制器一个中间件时最稳（改路径不用同步改这里） |

#### 2.4.4 一次注册多个中间件

`apply()` 支持多个参数，**按传入顺序依次执行**：

```ts
configure(consumer: MiddlewareConsumer) {
  // 先执行 Logger，再执行 AuthMiddleware
  consumer.apply(Logger, AuthMiddleware).forRoutes('user');
}
```

### 2.5 函数式中间件

不想写成类？也可以直接写一个普通函数。函数式中间件**没有 `@Injectable()`，不能注入依赖**，但胜在简单。

```ts
// src/middleware/simple.middleware.ts
import { Request, Response, NextFunction } from 'express';

// 就是一个普通的 Express 中间件函数
export function simpleMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  console.log('我是一个函数式中间件');
  next();
}
```

注册方式与类式一模一样：

```ts
configure(consumer: MiddlewareConsumer) {
  consumer.apply(simpleMiddleware).forRoutes('user');
}
```

**两种形态怎么选**：

| 对比项 | 类式中间件 | 函数式中间件 |
| --- | --- | --- |
| 写法 | 类 + `implements NestMiddleware` + `use()` | 普通函数 `(req, res, next)` |
| 能否依赖注入 | **能**（可注入 Service） | 不能 |
| 注册方式 | `consumer.apply(X)` | `consumer.apply(X)`（同理） |
| 能否做全局中间件 | 不能 | **能**（`app.use()`） |
| 适用场景 | 需要查库鉴权、复杂逻辑 | 简单日志、纯函数式处理、全局中间件 |

### 2.6 全局中间件（只能函数式）

**这是最容易踩的一个规定：全局中间件只能用函数模式。** 因为类式中间件的注册依赖模块上下文，而全局注册发生在模块系统之外。

全局中间件在 `main.ts` 里用 `app.use()` 挂载，作用于**所有路由**：

```ts
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// 白名单：只有这些路径允许通过
const whiteList = ['/list'];

// 全局中间件（函数模式）
function middleWareAll(req, res, next) {
  console.log(req.originalUrl, '我收全局的');

  if (whiteList.includes(req.originalUrl)) {
    next(); // 在白名单里 → 放行
  } else {
    // 不在白名单 → 直接拦下，请求到此结束
    res.status(403).send({ code: 403, message: '小黑子露出鸡脚了吧' });
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(middleWareAll); // 挂上全局中间件

  await app.listen(3000);
}
bootstrap();
```

**白名单拦截案例的实际效果**：

| 请求 | 结果 |
| --- | --- |
| `GET /list` | 命中白名单，`next()` 放行，正常返回列表数据 |
| `GET /user` | 不在白名单，直接返回 `403` + 那句"小黑子露出鸡脚了吧" |
| `POST /user/create` | 同样被拦，**根本不会进入 Controller** |

**注意 `req.originalUrl` 的坑**：它包含查询串。`/list?page=1` 的值是 `/list?page=1`，用 `includes` 判断白名单会**匹配失败**。要精确匹配就用 `req.path`，或对 `originalUrl` 做 `split('?')[0]` 处理。

### 2.7 接入第三方中间件（以 cors 为例）

因为底层是 Express，**所有 Express 中间件都能直接用**，包括社区生态里的插件。比如处理跨域：

```bash
npm install cors
npm install @types/cors -D
```

```ts
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as cors from 'cors';

const whiteList = ['/list'];

function middleWareAll(req, res, next) {
  console.log(req.originalUrl, '我收全局的');

  if (whiteList.includes(req.originalUrl)) {
    next();
  } else {
    res.status(403).send({ code: 403 });
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 顺序很重要：cors 注册在前面，跨域相关响应头才能加到被拦截的响应上
  app.use(cors());
  app.use(middleWareAll);

  await app.listen(3000);
}
bootstrap();
```

**为什么 `cors()` 要写在 `middleWareAll` 前面？** 因为 `middleWareAll` 会直接 `res.send()` 结束请求，排在它后面的中间件就不会执行了。如果 `cors()` 在后面，被拦截的 403 响应就**没有跨域头**，前端只会看到"跨域错误"而不是 403，排查时会一头雾水。

> 补充：NestJS 也内置了 `app.enableCors()`，效果等同于 `app.use(cors())`。区别是前者是官方包装、配置项一致；本篇沿用原文的 `cors` 插件写法。

### 2.8 执行顺序

中间件的执行顺序是一条链，理解了它就不会出现"日志少打一条""鉴权没生效"之类的怪问题。

**规则一：中间件一定在 Controller 之前执行。**

```
请求 → 中间件 A → 中间件 B → Controller 方法（真正执行业务）
```

**规则二：同一个 `apply()` 里的多个中间件，按传入顺序执行。**

```ts
// src/main.ts
function first(req, res, next) {
  console.log('① 第一个中间件');
  next();
}

function second(req, res, next) {
  console.log('② 第二个中间件');
  next();
}

// 注册顺序：first → second
app.use(first);
app.use(second);
```

请求任一接口，控制台输出固定为：

```
① 第一个中间件
② 第二个中间件
```

**规则三：谁先 `res.send()` 结束响应，谁后面的都收不到。**

```ts
function blocker(req, res, next) {
  console.log('③ 拦截器');
  res.status(403).send('拦截'); // 到这里请求就结束了
  // 不要既 send 又 next()，会导致 "Cannot set headers after they are sent"
}

app.use(blocker);
app.use(second); // 永远不会执行
```

**可验证的完整顺序实验**：

```ts
// src/main.ts（实验用）
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

function logA(req, res, next) {
  console.log('A：全局中间件 1');
  next();
}

function logB(req, res, next) {
  console.log('B：全局中间件 2');
  next();
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(logA);
  app.use(logB);
  await app.listen(3000);
}
bootstrap();
```

同时在 `UserModule.configure` 里挂上 `Logger`，然后请求 `GET /user`，你会看到 `Logger`（模块级）和 `logA`、`logB`（全局级）**都打印了，且都发生在 Controller 之前**。

> **一个需要注意的点**：全局 `app.use()` 与模块 `configure` 的注册时机不同，两者混用时**谁先谁后取决于注册发生的时刻**，不同版本行为可能有差异。要确认就把 `console.log` 打全，跑一遍看实际输出，别凭印象猜。

**关于中间件与其他机制的边界**：中间件只能拿到 `req` / `res`，拿不到"即将执行的处理函数"和"路由元信息"，因此它适合做**粗粒度**的事（日志、跨域、全局白名单）。更细粒度的拦截（需要知道调用了哪个方法、要拿返回值做加工）属于后续章节的拦截器、守卫、管道，本篇不展开。

### 2.9 常见错误与排查

**报错 1：`Nest can't resolve dependencies of the AuthMiddleware (?). Please make sure that the argument UserService at index [0] is available in the UserModule context.`**

- 原因：类式中间件的构造器注入了 `UserService`，但它被 `apply` 注册在了一个访问不到该 Service 的模块里。
- 解决：把中间件注册在 `providers` 含 `UserService` 的模块；或先在该模块 `imports` 里导入导出了 `UserService` 的模块。

**现象 2：请求一直 pending，浏览器转圈，最后超时**

- 原因：中间件里忘了 `next()`，又没 `res.send()`。Nest 既没收到"放行"也没收到"结束"，只能一直等。
- 解决：检查每条逻辑分支——`if` 分支里 `next()` 了，`else` 分支有没有漏。

**报错 3：`Error [ERR_HTTP_HEADERS_SENT]: Cannot set headers after they are sent to the client`**

- 原因：中间件里既 `res.send()` 又调了 `next()`，导致后面的 Controller 又往同一个响应写了一次。
- 解决：`res.send()` 之后立刻 `return`，不再调 `next()`。

**现象 4：写了全局中间件，但某个接口没被拦截**

- 原因 A：`app.use()` 写在了 `app.listen()` 之后（无效，必须在其之前）。
- 原因 B：`res.send()` 的响应因为 `cors` 顺序问题变成了跨域错误，被误认为"没拦截"。
- 解决：确认 `app.use()` 位置；调整 `cors()` 到最前。

**现象 5：`forRoutes('user')` 生效了，但 `/user/1` 没走中间件**

- 原因：路径写法与实际路由不匹配，比如实际路由是 `/users`（复数）。
- 解决：建议改用 `forRoutes(UserController)`，直接绑类，不会因路径字符串写错而失效。

**现象 6：白名单里明明写了 `/list`，但 `/list?page=1` 还是被拦**

- 原因：`req.originalUrl` 包含查询串。
- 解决：改用 `req.path`，或 `const path = req.originalUrl.split('?')[0]` 后再比对。

---

## 三、本篇小结

| 要点 | 一句话说明 |
| --- | --- |
| Session 是什么 | 服务器端为每个浏览器创建的会话对象，数据存服务端，浏览器只拿 SessionID |
| Cookie 与 Session 分工 | Cookie 是"手环编号"，Session 是"系统里的档案" |
| 为什么需要 | HTTP 无状态，不记得上次请求是谁，靠 Session 维持登录态 |
| 安装 | `npm i express-session --save` + `npm i @types/express-session -D` |
| 注册 | `app.use(session({ secret, name, rolling, cookie }))`，位置在 `create()` 与 `listen()` 之间 |
| `secret` | 必填，给 SessionID 签名的盐；不传直接抛错 |
| `cookie.maxAge` | `null` = 会话 cookie（关浏览器失效）；数字 = 毫秒有效期 |
| `rolling` | 每次请求重置过期时间，实现"无操作才掉线" |
| 验证码案例核心 | `captcha.text` 存 session，`captcha.data` 返给前端；答案永不出现在响应里 |
| `@Res()` 提醒 | 注入后必须自己 `res.send()`，否则请求挂起（与 03 篇 2.8 节同一个坑） |
| 跨域联调 | 优先用 Vite `dev` 代理，同源后 Cookie 才能正常往返 |
| 默认存储 | `MemoryStore` 存内存，重启即丢、多进程不共享；生产换 Redis |
| 中间件定义 | 在路由处理程序**之前**调用的函数，可访问 `req` / `res` |
| 第一红线 | 没结束响应就**必须** `next()`，否则请求挂起 |
| 类式中间件 | `@Injectable()` + `implements NestMiddleware` + `use(req,res,next)`，可注入依赖 |
| 函数式中间件 | 普通 `(req,res,next)` 函数，不能注入依赖，但能做全局中间件 |
| 注册三步 | `implements NestModule` → `configure(consumer)` → `apply(X).forRoutes(...)` |
| `forRoutes` 三种写法 | 字符串路径、`{ path, method }` 对象、Controller 类 |
| 全局中间件 | 只能函数式，`app.use()` 挂载，可在 `listen()` 之前 |
| 白名单拦截 | 用 `req.path` 判断，别用带查询串的 `req.originalUrl` |
| 执行顺序 | 中间件整体在 Controller 之前；`apply()` 内按传入顺序；`res.send()` 之后的都不执行 |
| 第三方中间件 | Express 生态插件可直接 `app.use()`，如 `cors`；顺序上 `cors()` 要放最前 |
|||
