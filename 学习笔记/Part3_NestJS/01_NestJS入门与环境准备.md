# NestJS 入门与环境准备

> 学习日期：2026-11-05
> 素材来源：小满 NestJS 系列（blog.csdn.net/qq1195566313，专栏 ID 11844396）
> 本篇对应：原文第 1、5、6 章
> 适合人群：NestJS 零基础

本篇解决三个问题：**NestJS 到底是什么**、**怎么装出一个能跑起来的项目**、**怎么用 CLI 命令快速生成代码**。看完你应该能在本地独立跑起一个 NestJS 服务，并看懂默认生成的每个文件是干什么的。

---

## 一、NestJS 是什么

### 1.1 先用大白话理解

用 Node 写后端，最朴素的写法是"来一个请求写一个回调，自己判断路径、自己解析参数、自己拼 JSON"。接口只有三五个时没问题，一旦接口涨到几十个、业务开始分层，你就会发现路由、参数校验、错误处理、数据库调用全搅在一起，改一处牵全身。

NestJS 就是来收拾这个局面的。可以把它类比成**盖房子用的装配式钢结构**：

- **Express** 给你的是砖头、水泥、钢筋——什么都能盖，但结构设计全靠你自己；
- ==**NestJS** 给你的是已经**定好的梁柱体系（模块、控制器、服务）**，你只负责往指定位置填墙体（业务代码），结构稳定性由框架兜底。==

所以 NestJS 不是"另一套 Express"，而是**架在 Express / Fastify 之上的一层工程化框架**。

### 1.2 专业定义

**NestJS** 是一个==用于构建高效、可扩展的 Node.js 服务端应用程序开发框架==（A progressive Node.js framework for building efficient, scalable server-side applications）。

官方介绍里的关键特征：

| 特性 | 英文原名 | 说明 |
| --- | --- | --- |
| 完全支持 TypeScript | TypeScript | 用 TS 编写，天然支持类型检查与装饰器语法 |
| 面向切面编程 | ==AOP==（Aspect-Oriented Programming） | 把日志、鉴权、事务这类"横切关注点"从业务代码中剥离出去统一处理 |
| Spring MVC 风格 | ==Spring MVC style== | 分层结构：Module 组织、Controller 接请求、Service 写业务 |
| 依赖注入与控制反转 | DI（Dependency Injection）/ IoC（Inversion of Control） | 对象由容器创建与装配，不在类内部 `new`，这套设计借鉴自 Angular |
| 可插拔的底层 HTTP 平台 | Express / Fastify | 在两者之上提供抽象，同时把它们的 API 直接暴露给开发者 |

两个关键点值得强调：

1. **TypeScript 不是可选项，而是默认项**。NestJS 的控制器、服务、模块几乎全靠装饰器（Decorator）在运行，而装饰器是 TypeScript 的特性——这也是为什么下一篇笔记要先补装饰器这门前置知识。
2. **底层用的是现成框架，不是自研**。NestJS 官方明确说明：底层运用了 Express 和 Fastify，在它们的基础上提供了一定程度的抽象，同时把平台 API 直接暴露给开发人员，因此可以轻松使用这两个平台生态里无数的第三方模块。



- **Model（模型）**：数据、业务实体、Service 业务逻辑、数据库实体（DTO/Entity）
- **View（视图）**：页面（JSP/Thymeleaf）；现在前后端分离开发，大多不用 View，直接返回 JSON
- **Controller（控制器）**：接收 HTTP 请求、参数校验、调用 Service、返回结果

### 1.3 和前端框架的心智类比

如果你有 Vue / Angular 基础，可以把 NestJS 的概念直接对号入座，理解成本会低很多：

| NestJS 概念 | 对应前端里的什么 | 作用 |
| --- | --- | --- |
| `main.ts` | Vue 的 `main.ts` | 入口文件，启动应用 |
| `AppModule` | 根组件 `App.vue` | 整个应用的组织单元，把所有模块串起来 |
| `Controller` | vue-router 的路由表 | 决定"哪个 URL 由谁来处理" |
| `Service` | Vuex / Pinia 里的 store | 集中存放可复用的业务逻辑 |
| `@Controller()` / `@Get()` | 路由配置对象 | 用装饰器声明式地描述路由 |

### 1.4 官方文档入口

| 类型 | 地址 |
| --- | --- |
| 英文官网 | https://nestjs.com/ |
| 中文文档 | https://docs.nestjs.cn/ |

遇到本篇没覆盖的细节，优先查官方文档，中文文档质量足够应付入门阶段。

---

## 二、底层 HTTP 平台：Express 与 Fastify

### 2.1 三者的关系

NestJS 自己不直接处理 HTTP 请求，它把这件事委托给一个**底层平台适配器（Adapter）**：

```
你的业务代码（Controller / Service）
        ↓
NestJS 核心（路由匹配、依赖注入、管道等）
        ↓
HTTP 适配器（Adapter）
        ↓
Express（默认）  或  Fastify
```

NestJS **内置支持的平台只有两个**：Express 和 Fastify，其中**默认使用 Express**。

### 2.2 Express（默认）

| 维度 | 说明 |
| --- | --- |
| 定位 | Node.js 生态里历史最久、使用最广的==Web 框架== |
| 优势 | 能够快速构建服务端应用程序，学习成本非常低，容易上手 |
| 生态 | 中间件（Middleware）生态极其丰富，遇到问题基本都能搜到现成答案 |
| 适用 | 新手入门、绝大多数常规业务项目 |

因为默认就是 Express，所以执行 `nest new` 创建项目后你不需要做任何配置，直接就能用。

### 2.3 Fastify（唯二的内置平台）

Fastify 是 NestJS 官方支持的第二个平台，原文列出的六大特性：

| 特性 | 说明 |
| --- | --- |
| 高性能 | 官方介绍中提到，Fastify 是这一领域最快的 Web 框架之一，取决于代码的复杂性，最多可处理每秒 3 万次请求 |
| 可扩展 | 通过钩子（hook）、插件（plugin）和装饰器（decorator）提供完整的可扩展性 |
| 基于 Schema | 推荐用 JSON Schema 做路由（route）验证及输出内容序列化，Fastify 内部会把 schema 编译成高效函数执行 |
| 日志 | 日志非常重要且代价高昂，Fastify 选用 Pino 作为日志记录器以降低成本 |
| 对开发人员友好 | 使用友好，帮助处理日常工作，同时不牺牲性能与安全性 |
| 支持 TypeScript | 持续维护 TypeScript 类型声明文件，支持不断成长的 TS 社区 |

### 2.4 Express 与 Fastify 对比

| 对比维度 | Express | Fastify |
| --- | --- | --- |
| 默认平台 | ✅ 是（零配置） | ❌ 需手动切换 |
| 性能（吞吐量） | 一般 | 更高，官方宣传可达每秒 3 万请求 |
| 学习成本 | 极低，资料最多 | 略高，需要理解 hook / plugin 概念 |
| 参数校验 | 通常靠额外中间件 | 内置 JSON Schema 校验与序列化 |
| 日志 | 需自行接入 | 内置 Pino |
| 生态成熟度 | 最成熟 | 成熟但在国内资料相对少 |
| 适合场景 | 入门学习、常规业务 | 高并发、对性能敏感的服务 |

**给新手的建议**：先用默认的 Express 把 NestJS 的模块、控制器、服务、依赖注入这些核心概念学明白；等业务真的遇到性能瓶颈，再考虑换 Fastify——因为 NestJS 已经做了适配层，切换成本主要集中在个别平台专有 API 上。

### 2.5 补充：如何切换到 Fastify

素材没有展开这一步，按 NestJS 官方写法补充（属于"Express / Fastify 平台选择"这一主题范围内）：

```bash
# 1. 安装 Fastify 适配器
npm i @nestjs/platform-fastify
```

```ts
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  // 原来是 NestFactory.create(AppModule)，换成指定 FastifyAdapter
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  await app.listen(3000);
}
bootstrap();
```

> 现阶段不用急着切，知道"底层可以换"这件事就够了。

---

## 三、环境准备与创建项目

### 3.1 前置条件

| 依赖 | 要求 | 检查命令 |
| --- | --- | --- |
| Node.js | 建议 LTS 版本（NestJS 8 及以上建议 Node 16+，越新的 Nest 版本要求越高） | `node -v` |
| npm | 随 Node 一起安装 | `npm -v` |
| 编辑器 | VS Code，建议装 TypeScript 相关插件 | — |

### 3.2 安装 CLI

NestJS 提供官方命令行工具 **Nest CLI**，全局装一次即可长期使用：

```bash
# -g 表示全局安装，装完后任何目录都能用 nest 命令
npm i -g @nestjs/cli
```

安装完成后验证：

```bash
nest --version   # 能打印版本号就说明装好了
```

### 3.3 创建项目

```bash
# 项目名建议用小写 + 中划线，例如 nest-demo
nest new nest-demo
```

执行过程中 CLI 会问你一个问题：**用哪个包管理器（npm / yarn / pnpm）**。新手直接选 `npm` 即可，回车后 CLI 会自动下载依赖、生成目录结构，全程不需要手动改任何配置。

### 3.4 启动项目

创建完成后进入目录，用下面四种方式之一启动：

| 命令 | 实际执行内容 | 用途 |
| --- | --- | --- |
| `npm run start` | `nest start` | 普通启动，改代码后需要手动重启 |
| `npm run start:dev` | `nest start --watch` | **开发时用这个**，监听文件变化自动重启（热更新） |
| `npm run start:debug` | `nest start --debug --watch` | 带调试模式 + 热更新，配合 VS Code 断点使用 |
| `npm run start:prod` | `node dist/main` | 生产环境，直接跑编译后的 `dist` 产物 |

> 新手最常踩的坑：用 `npm run start` 启动后发现"我改了代码怎么没反应"，就是因为没用 `start:dev`，它不会自动重启。

启动成功后浏览器访问 `http://localhost:3000`，页面上会显示 **Hello World!**，说明项目跑通了。

---

## 四、项目目录结构导读

### 4.1 目录树

🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩

`nest new` 生成的核心结构（只列需要关心的部分）： 

```
nest-demo/
├── src/                        # 源码目录，业务代码全在这里
│   ├── app.controller.spec.ts  # 控制器单元测试文件
│   ├── app.controller.ts       # 根控制器：负责接收请求
│   ├── app.module.ts           # 根模块：把控制器和服务组织在一起
│   ├── app.service.ts          # 根服务：负责写业务逻辑
│   └── main.ts                 # 应用入口文件
├── test/                       # 端到端测试（e2e）
├── nest-cli.json               # Nest CLI 配置文件
├── package.json                # 依赖与脚本
├── tsconfig.json               # TypeScript 编译配置
└── tsconfig.build.json         # 打包时的 TS 配置
```

==一个请求进来，流转顺序是：`main.ts`（启动的服务器）→ `AppModule` → `AppController`（匹配路由）→ `AppService`（处理业务）→ 返回结果。==

🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩

### 4.2 `main.ts`：入口文件

作用等同于 Vue 项目里的 `main.ts`：==整个应用从这里启动==。

```ts
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // NestFactory.create(AppModule)：创建应用实例
  // 类比 Vue 的 createApp(App)：绑定一个"根组件"，这里是绑定根模块 AppModule
  const app = await NestFactory.create(AppModule);

  // 监听 3000 端口，启动 HTTP 服务
  await app.listen(3000);
}

bootstrap(); // 立即执行启动函数
```

两行核心代码就两件事：

1. `NestFactory.create(AppModule)` —— 创建一个 app 实例，相当于绑定根模块；
2. `app.listen(3000)` —— 监听一个端口，服务开始对外提供访问。

想换端口，直接改 `3000` 这个数字即可。

### 4.3 `app.module.ts`：根模块

```ts
// src/app.module.ts
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [],                 // 需要引入的其他模块
  controllers: [AppController], // 注册控制器
  providers: [AppService],      // 注册服务（可被依赖注入）
})
export class AppModule {}
```

==它是整个应用的"总装图"：声明有哪些控制器、哪些服务。**新写的控制器和服务必须在这里注册（或在其所属模块注册），否则不生效。**==

### 4.4 `app.controller.ts`：控制器

你可以把它理解成 Vue 的路由——==**决定哪个 URL 由谁来处理**==。

```ts
// src/app.controller.ts
import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()                    // 不写参数 = 根路径 '/'
export class AppController {
  // 依赖注入：不需要自己 new AppService()
  // 只要在构造器里声明参数，Nest 内部会自动实例化并注入进来
  constructor(private readonly appService: AppService) {}

  @Get()                         // 处理 GET 请求，路径就是 @Controller 的路径
  getHello(): string {
    return this.appService.getHello(); // 真正的逻辑交给 service
  }
}
```

修改访问地址也很简单，把路径写进装饰器：

```ts
// src/app.controller.ts（改造后：访问 http://localhost:3000/get/hello）
import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller('/get')              // 类级别的路径前缀
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('/hello')                 // 方法级别路径，最终拼接为 /get/hello
  getHello(): string {
    return this.appService.getHello();
  }
}
```

### 4.5 `app.service.ts`：服务

==这个文件主要实现业务逻辑。控制器当然也能直接写逻辑，但那样写出来的代码是**一次性的、无法复用的**；放到 service 里，别的模块需要时就能直接复用。==

```ts
// src/app.service.ts
import { Injectable } from '@nestjs/common';

@Injectable()                    // 标记这个类"可被依赖注入"
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }
}
```

### 4.6 三个文件的协作关系

🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩

| 文件 | 英文原名 | 职责 | 一句话类比 |
| --- | --- | --- | --- |
| `app.module.ts` | Module | 组织单元，注册控制器与服务 | 公司的组织架构图 |
| `app.controller.ts` | Controller | 接收请求、解析参数、返回响应 | 前台：接待并转交需求 |
| `app.service.ts` | Service | 承载可复用的业务逻辑 | 业务部门：真正干活 |

**一个重要的纪律**：==控制器里不写业务逻辑，只做"接收 → 转交 → 返回"==。这条纪律在后续所有章节里都会反复出现。

---

## 五、CLI 常用命令：`nest g`

`nest g` 是 `nest generate` 的缩写，用来**生成代码文件**。NestJS 的 CLI 命令设计得非常像 Angular（原文明确提到"他的命令和 angular 很像"）。

### 5.1 先看帮助

```bash
nest --help
```

会列出所有可用命令。忘了命令名就敲这个。

### 5.2 三个最基础的生成命令

以"生成一个用户模块"为例，按顺序执行：

```bash
# 1. 生成 controller（controller 的缩写是 co）  
nest g co user    # user 表示的是文件夹的名称
# 生成 src/user/user.controller.ts

# 2. 生成 module（module 的缩写是 mo）
nest g mo user
# 生成 src/user/user.module.ts

# 3. 生成 service（service 的缩写是 s）
nest g s user
# 生成 src/user/user.service.ts
```

每一步执行后 CLI 会告诉你生成了哪些文件，并且**自动把新生成的类注册到对应的 Module 里**（不需要你手动改 `app.module.ts`），这是 CLI 最省事的地方。

但三条命令一条条敲还是慢，NestJS 提供了更快的方案。

### 5.3 一条命令生成完整 CRUD：`nest g resource`

```bash
nest g resource xiaoman
```

执行后会交互式地问两个问题：

| 提问 | 建议选择 | 说明 |
| --- | --- | --- |
| What transport layer do you use? | **REST API** | 生成标准 REST 风格接口 |
| Would you like to generate CRUD entry points? | **Y** | 生成增删改查全套模板 |

生成完成后，你会==得到一套标准的 **CRUD 模板**（Controller、Service、Module、DTO、实体类等文件一次到位）==。

一个容易忽略的细节：**第一次执行 `nest g resource` 时，除了生成文件，它还会自动调用 npm 帮你安装一些额外的插件/依赖；之后再执行就不会重复安装了。**

### 5.4 常用生成命令速查表

| 命令 | 简写 | 生成物 | 说明 |
| --- | --- | --- | --- |
| `nest g application` | `nest g app` | 应用 | 生成一个独立子应用 |
| `nest g controller xxx` | `nest g co xxx` | 控制器 | 接收请求 |
| `nest g service xxx` | `nest g s xxx` | 服务 | 业务逻辑 |
| `nest g module xxx` | `nest g mo xxx` | 模块 | 组织单元 |
| `nest g resource xxx` | — | 全套 CRUD | 一条命令搞定模块+控制器+服务 |
| `nest g middleware xxx` | `nest g mw xxx` | 中间件 | 请求前后处理 |
| `nest g guard xxx` | `nest g gu xxx` | 守卫 | 鉴权拦截 |
| `nest g interceptor xxx` | `nest g in xxx` | 拦截器 | 请求/响应增强 |
| `nest g pipe xxx` | `nest g pi xxx` | 管道 | 参数校验与转换 |
| `nest g filter xxx` | `nest g f xxx` | 异常过滤器 | 统一错误处理 |
| `nest g decorator xxx` | `nest g d xxx` | 自定义装饰器 | 封装重复逻辑 |
| `nest g class xxx` | `nest g cl xxx` | 普通类 | 如 DTO、实体 |
| `nest g provider xxx` | `nest g pr xxx` | 提供者 | 可注入的自定义类 |

> 上表后几项（middleware / guard / interceptor / pipe / filter）对应的概念在后续章节才会展开，这里先知道"能用一条命令生成"即可。

### 5.5 两个实用参数

```bash
# --dry-run：只预演，不真正写文件。用来确认命令会生成什么，防止生成错位置
nest g co order --dry-run

# --no-spec：不生成 .spec.ts 测试文件，只留业务文件（新手阶段可以减少干扰）
nest g s order --no-spec
```

### 5.6 生成文件的命名规则

| 命令 | 生成文件 | 类名 |
| --- | --- | --- |
| `nest g co user` | `user.controller.ts` | `UserController` |
| `nest g mo user` | `user.module.ts` | `UserModule` |
| `nest g s user` | `user.service.ts` | `UserService` |

文件名和类名由 CLI 按固定规范自动生成，所以**命名统一用小写**（如 `user`、`order-item`），不要写成 `User`，否则生成的文件名会很别扭。

---

## 六、常见错误与排查

| 报错原文 / 现象 | 原因 | 解决 |
| --- | --- | --- |
| `nest : 无法将"nest"项识别为 cmdlet、函数、脚本文件或可运行程序的名称` | CLI 未全局安装，或 npm 全局 bin 目录不在系统 PATH 中 | 重新执行 `npm i -g @nestjs/cli`；仍报错则检查 `npm config get prefix` 并把该目录加入 PATH；临时替代方案：`npx @nestjs/cli new 项目名` |
| `Error: listen EADDRINUSE: address already in use :::3000` | 3000 端口被其他程序占用（常见：上一个 Nest 进程没关） | 改 `main.ts` 里的端口号；或 `netstat -ano \| findstr :3000` 查到 PID 后用 `taskkill /PID 进程号 /F` 结束占用进程 |
| 改了代码，刷新页面还是旧结果 | 用 `npm run start` 启动，没有监听文件变化 | 改用 `npm run start:dev` |
| `Cannot find module '@nestjs/core'` 之类的模块找不到 | 没有执行依赖安装，或不在项目根目录 | `cd` 到项目根目录执行 `npm install` |
| `npm ERR! code ERESOLVE`（安装依赖时） | npm 7+ 的严格 peer 依赖校验 | 优先升级依赖版本；临时方案 `npm install --legacy-peer-deps` |
| 执行 `nest g co user` 后接口访问 404 | 新控制器没有注册到模块的 `controllers` 数组里 | 检查所属 Module 的 `controllers`；用 CLI 生成时会自动注册，手写文件时需要自己加 |
| `Nest can't resolve dependencies of the AppController (?)` | 控制器依赖的服务没有在模块 `providers` 里注册（依赖注入失败） | 把对应 Service 加入所属 Module 的 `providers` 数组，详见下一篇笔记 |

---

## 七、本篇小结

| 要点 | 一句话说明 |
| --- | --- |
| NestJS 定位 | 基于 Node.js 的高效、可扩展服务端框架，完全支持 TypeScript |
| 三大设计借鉴 | AOP 面向切面编程、Spring MVC 分层风格、Angular 的 IoC / DI |
| 底层平台 | 只内置 Express（默认）和 Fastify 两个，在其上做抽象并暴露原生 API |
| 选哪个平台 | 新手用默认 Express；高并发场景再考虑 Fastify |
| 安装 CLI | `npm i -g @nestjs/cli`，全局一次装好 |
| 创建项目 | `nest new 项目名`，过程中选择包管理器 |
| 开发启动 | `npm run start:dev`（热更新），生产用 `npm run start:prod` |
| 入口文件 | `main.ts`：`NestFactory.create(AppModule)` + `app.listen(3000)` |
| 三个核心文件 | `app.module.ts` 装配、`app.controller.ts` 接请求、`app.service.ts` 写逻辑 |
| 依赖注入初体验 | 构造器参数 `private readonly appService: AppService` 不需要自己 new |
| 生成单个文件 | `nest g co/mo/s 名称`（controller / module / service） |
| 生成整套 CRUD | `nest g resource 名称`，选 REST API + Y，一次生成全套模板 |
| 命名规范 | 名称一律小写，CLI 自动派生出 `XxxController`、`XxxService` 等类名 |
|||
