# RxJS 与响应、异常拦截：一套接口返回格式的三个组件

> 学习日期：2026-11-05
> 素材来源：小满 NestJS 系列（blog.csdn.net/qq1195566313，专栏 ID 11844396）
> 本篇对应：原文第 15 ~ 17 章
> 适合人群：NestJS 零基础

前面几篇我们让接口能接参数、能收文件了。但如果你把接口返回打印出来看，会发现**很乱**：

- 查成功时，直接返回一个数组 `[{}, {}]`
- 新增成功时，返回一个对象 `{ id: 1 }`
- 报错时，NestJS 又自己返回 `{ statusCode: 404, message: '...', error: 'Not Found' }`

三种形态，前端要写三种判断。真实项目里必须统一成一套格式。

做这件事需要三个组件：**响应拦截器**（包装成功返回）、**异常过滤器**（包装错误返回）、以及它们底层依赖的 **RxJS**。

所以本篇顺序是：先把 RxJS 摸清（否则拦截器里那段 `pipe(map(...))` 只能靠抄），再写这两个组件，最后把整条请求链路串起来。

---

## 一、RxJS 是什么

### 1.1 先用大白话理解

想象你订了一份报纸（不是网购一次性的快递）：

- 你**订报**这个动作，不等于马上拿到报纸，而是登记了一个"以后每周都给我送"的约定 —— 这就是 **Observable（可观察对象）**，它描述的是一个"未来会不断发生的事"。
- 送报员每周来敲门，你可以选择签收 —— 这就是 **subscribe（订阅）**，你的签收动作就是 **Observer（观察者）**。
- 如果你搬家了，要打电话取消订阅 —— 这就是 **unsubscribe（取消订阅）**，不做这件事，送报员会一直往空房子送（内存泄漏）。
- 你还可以在送达前加一道加工：把报纸折成小份、只保留体育版 —— 这就是 **Operators（操作符）**，`map`（加工）、`filter`（筛选）。

对比一下快递（Promise）：快递是**一次性的**，发出就结束，不能取消，也不能一次送多件。而报纸可以**持续送、可取消、可加工**。

### 1.2 专业定义

| 术语 | 英文 | 含义 |
| --- | --- | --- |
| 可观察对象 | `Observable` | 一个"未来可能发出多个值"的数据源，是 RxJS 的核心 |
| 观察者 | `Observer` / `Subscriber` | 接收数据的回调集合，含 `next` / `error` / `complete` |
| 订阅 | `Subscription` | 调用 `subscribe()` 后返回的句柄，代表"已建立的关系"，可 `unsubscribe` |
| 操作符 | `Operators` | 纯函数，通过 `pipe()` 串联，对数据流做加工、筛选、组合 |
| 管道 | `pipe()` | 把多个操作符按顺序串起来的方法 |

**一句话定义**：RxJS 是**基于观察者模式**的异步编程库，用来处理"会连续产生多个值的数据流"（官方叫**响应式编程**，Reactive Programming）。

### 1.3 和 Promise 的关键区别

| 对比项 | Promise | Observable（RxJS） |
| --- | --- | --- |
| 值的数量 | 只能 1 个 | 可以 0 ~ 无限个 |
| 是否立即执行 | `new` 出来就立刻执行 | **不订阅就不执行**（懒执行） |
| 能否取消 | 不能 | 能，`unsubscribe()` |
| 能否重试 | 要自己包一层 | 有 `retry`、`repeat` 等操作符 |
| 是否可加工 | `.then()` 链，能力有限 | `pipe(map, filter, ...)`，几十个操作符 |
| NestJS 里的用途 | 普通异步逻辑 | 拦截器必须返回 `Observable` |

> 小白记住一句：**Promise 是"一次性的结果"，Observable 是"持续的事件流"**。平时写业务代码用 `async/await` 完全够；只有写拦截器（Interceptor）时，才必须接触 RxJS。

### 1.4 为什么 NestJS 里躲不开它

NestJS 里所有 **Interceptor（拦截器）** 的 `intercept()` 方法，返回值类型都是 `Observable`：

```ts
intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
  return next.handle(); // 返回的就是一个 Observable
}
```

想"在 Controller 返回数据后再加工一遍"，就得用 `next.handle().pipe(map(...))`。这就是本篇后半段要写的东西。RxJS 在 NestJS 里是**内置依赖，不用另外安装**。

---

## 二、RxJS 的三个入门案例

### 2.1 案例一：手写一个 Observable

`Observable` 的构造函数接收一个函数，这个函数会拿到一个 `subscriber`（订阅者），你通过它往外"发值"。

```ts
// 案例：手动创建并订阅一个 Observable
import { Observable } from 'rxjs';

const observable = new Observable<number>((subscriber) => {
  // next：发出一个值（可以发无数次）
  subscriber.next(1);
  subscriber.next(2);
  subscriber.next(3);

  setTimeout(() => {
    // 1 秒后再发一个
    subscriber.next(4);
    // complete：宣布结束（之后不能再 next）
    subscriber.complete();
  }, 1000);
});

// 订阅：不订阅，上面的函数根本不会执行
observable.subscribe({
  next: (value) => console.log(value), // 每收到一个值执行一次
  error: (err) => console.log('出错了', err), // 出错时执行
  complete: () => console.log('结束了'), // 结束时执行
});

// 输出：1 2 3（立刻）→ 4（1 秒后）→ 结束了
```

三个动作对应三件事：

| 动作 | 含义 | 能调用几次 |
| --- | --- | --- |
| `next(value)` | 发出一个值 | 多次 |
| `error(err)` | 发出错误，流立即终止 | 一次（之后不再有 next） |
| `complete()` | 发出结束信号 | 一次 |

> 原文说它"类似于迭代器，next 发出通知，complete 通知完成"，这个类比很准确：迭代器是**你主动去取**（`iterator.next()`），Observable 是**数据主动推给你**（推送 vs 拉取）。

**关键结论：Observable 是懒的。** 上面的 `new Observable(...)` 写完，如果一行 `subscribe()` 都没有，那三行 `next` 一次都不会执行，定时器也不会启动。

### 2.2 案例二：用 `pipe` 加工数据流

`interval(500)` 会每隔 500 毫秒发一个递增数字（0, 1, 2, 3...）。我们只要"偶数"，并把数字包成对象。

```ts
// 案例：interval + map + filter + take
import { interval, take } from 'rxjs';
import { map, filter } from 'rxjs/operators';

const subs = interval(500)
  .pipe(
    // map：加工每个值，把数字变成对象
    map((v) => ({ num: v })),
    // filter：筛选，只留下 num 是偶数的
    filter((v) => v.num % 2 === 0),
  )
  .subscribe((e) => {
    console.log(e); // { num: 0 } { num: 2 } { num: 4 } ...
    // 到 10 就停止，否则 interval 永远不会结束
    if (e.num === 10) {
      subs.unsubscribe();
    }
  });
```

写法注意：

- `pipe()` 里**按顺序**写操作符，数据从左到右流过去：先 `map` 再 `filter`，和数组的 `arr.map().filter()` 顺序完全一致。
- `subscribe()` 的返回值是 **Subscription**，要存成变量才能取消。
- `interval` 是**无限流**，不取消就会一直跑，这在 Node 里会阻止进程退出。

如果只是想"取前 10 个"，用 `take` 更优雅，不用自己判断：

```ts
import { interval, take } from 'rxjs';
import { map, filter } from 'rxjs/operators';

interval(500)
  .pipe(
    take(20), // 最多取 20 个，取完自动 complete
    map((v) => ({ num: v })),
    filter((v) => v.num % 2 === 0),
  )
  .subscribe((e) => console.log(e));
```

### 2.3 案例三：监听事件（了解即可）

RxJS 还能把 DOM 事件、WebSocket、EventEmitter 都变成流，用 `fromEvent`：

```ts
// 案例：把点击事件变成流（浏览器环境）
import { fromEvent } from 'rxjs';
import { map } from 'rxjs/operators';

const clicks = fromEvent(document, 'click').pipe(
  map((e) => (e.target as HTMLElement).tagName), // 只取被点元素的标签名
);

const sub = clicks.subscribe((tag) => console.log('点击了', tag));

// 不需要时取消监听
// sub.unsubscribe();
```

**但在 NestJS 后端项目里用不到这一段** —— 后端没有 DOM。原文提这一点是为了说明"RxJS 不只能处理异步请求，事件也能统一成流"。如果你以后写 Angular 或 Vue，`fromEvent` 会很常用（Vue 3 里也有 `fromEvent` 的等价写法）。

### 2.4 常用操作符速查

| 操作符 | 作用 | 数组里的对应方法 |
| --- | --- | --- |
| `map` | 加工每个值 | `Array.prototype.map` |
| `filter` | 筛选值 | `Array.prototype.filter` |
| `reduce` | 累积成一个值（流结束后才输出） | `Array.prototype.reduce` |
| `find` / `findIndex` | 找到第一个满足条件就结束 | `Array.prototype.find` |
| `take(n)` | 只取前 n 个 | `arr.slice(0, n)` |
| `first` / `last` | 只取第一个 / 最后一个 | `arr[0]` / `arr.at(-1)` |
| `concat` | 按顺序拼接多个流 | `arr.concat` |
| `tap` | 只做副作用（打日志），不改值 | `forEach` |
| `retry(n)` | 出错后重试 n 次 | 无（Promise 要手写） |
| `fromEvent` | 把事件变成流 | 无 |
| `interval(ms)` | 定时发递增数字 | 无（有 `setInterval`） |
| `of(...)` | 一次性发出若干个值后就完成 | `[...]` |

> **和数组方法的最大不同**：数组方法是**同步一次算完**，RxJS 操作符是**每来一个值就处理一次**，流不停就一直处理。所以 `reduce` 在 RxJS 里不会立刻出结果，必须等 `complete()`。

### 2.5 常见错误与排查

**现象 1：写好了 Observable，但里面的 `console.log` 一次都没打印**

- 原因：**没有 `subscribe()`**。Observable 是懒执行的，不订阅不干活。
- 解决：加 `.subscribe(...)`。

**现象 2：`TypeError: xxx.unsubscribe is not a function`**

- 原因：把 `subscribe()` 的返回值丢了，或者直接对 Observable 本身调 `unsubscribe`。
- 解决：`const sub = obs.subscribe(...)`，然后 `sub.unsubscribe()`。

**现象 3：`error TS2307: Cannot find module 'rxjs/operators'`**

- 原因：RxJS 7 起，操作符可以直接从 `rxjs` 导入，`rxjs/operators` 这个路径在新版本里只是兼容保留。
- 解决：两种都能用，推荐统一写成从 `'rxjs'` 导入：`import { map, filter } from 'rxjs';`

**现象 4：Node 服务启动后跑着跑着 CPU 占用飙升 / `Ctrl+C` 关不掉**

- 原因：`interval`、`fromEvent` 这类**长生命周期的流忘了 `unsubscribe`**，定时器一直在跑。
- 解决：组件销毁/请求结束时 `unsubscribe`，或者用 `take` 自动结束。

---

## 三、响应拦截器：统一成功返回格式

### 3.1 先看问题

现在我们的接口返回长这样（三种形态）：

| 场景 | 现在的返回 |
| --- | --- |
| `GET /user/list` | `[{ "name": "小满" }, { "name": "张三" }]` |
| `POST /user` | `{ "id": 1 }` |
| 找不到资源 | `{ "statusCode": 404, "message": "Cannot GET /xxx", "error": "Not Found" }` |

前端拿到手要先判断"这是数组还是对象？这是不是错误？"——**格式不统一，判断逻辑就会到处都是**。

我们希望所有成功请求都长这样：

```json
{
  "data": "真正的业务数据",
  "status": 0,
  "message": "成功",
  "success": true
}
```

所有失败请求都是另一种固定格式（第 4 章讲）。

**这个"给所有返回值统一套壳"的动作，就该由拦截器（Interceptor）来做。**

### 3.2 拦截器（Interceptor）是什么

**大白话**：拦截器像公司门口的**前台**。所有人（请求）进来要过前台登记（前置逻辑），事情办完出去也要过前台检查一遍再放行（后置逻辑）。前台能改你带出去的东西 —— 比如把你带出去的一堆散装文件装进统一的手提袋（统一返回格式）。

**专业定义**：拦截器（**Interceptor**）是受**面向切面编程（AOP，Aspect-Oriented Programming）**启发的机制，能在方法执行前后插入逻辑。官方列出的五种能力：

| 能力 | 说明 |
| --- | --- |
| 在函数执行之前/之后绑定额外逻辑 | 打日志、计时 |
| **转换从函数返回的结果** | 统一返回格式（本篇重点） |
| **转换从函数抛出的异常** | 与异常过滤器配合 |
| 扩展基本函数行为 | 加缓存、超时 |
| 根据条件完全重写函数 | 缓存命中时直接返回，不进 Controller |

和中间件的区别：中间件只认 `req/res`，**不知道"接下来要执行哪个 Controller 的哪个方法"**；拦截器能通过 `ExecutionContext` 拿到这些信息，还能拿到方法**返回值**。

### 3.3 写响应拦截器

先建目录 `src/common/`，在里面建 `response.ts`：

```ts
// src/common/response.ts
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

// 统一返回结构：泛型 T 表示真实业务数据的类型
interface ResponseData<T> {
  data: T; // 业务数据
  status: number; // 业务状态码，0 表示成功
  message: string; // 提示信息
  success: boolean; // 是否成功
}

@Injectable()
export class ResponseInterceptor<T = any>
  implements NestInterceptor<T, ResponseData<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ResponseData<T>> {
    // next.handle() 执行真正的 Controller 方法，返回一个 Observable
    return next.handle().pipe(
      // map：等 Controller 的返回值出来后，把它包进标准结构
      map((data) => ({
        data,
        status: 0,
        success: true,
        message: '成功',
      })),
    );
  }
}
```

> 原文给 `message` 填的是口语化文案（"牛逼"），这里换成中性的「成功」，逻辑完全一样。真实项目里 `message` 一般由后端约定或直接复用一个常量。

### 3.4 这段代码逐行拆解

| 代码 | 含义 |
| --- | --- |
| `implements NestInterceptor` | 声明这是一个拦截器，必须实现 `intercept` 方法 |
| `T = any` | 泛型默认值，让这个拦截器能适配任意类型的返回值 |
| `NestInterceptor<T, ResponseData<T>>` 的两个泛型 | 分别是「进来的数据类型」和「出去的数据类型」 |
| `context: ExecutionContext` | 上下文对象，能拿到请求、响应、当前 Controller 类和方法（本篇没用到，但必须先声明） |
| `next: CallHandler` | "下一个处理者"，调用 `next.handle()` 才会真正执行 Controller |
| `next.handle()` | 返回 **Observable**，里面装着 Controller 的返回值 |
| `pipe(map(...))` | 等值出来时加工一下，这是 RxJS 的用法 |
| `map((data) => ({...}))` | `data` 就是 Controller `return` 的东西，外面套一层壳 |

**`next.handle()` 是理解拦截器的钥匙**：它是一个"占位符"，代表"后面的活儿"。你可以：

- 在它**之前**写代码 → 前置逻辑（打日志）
- 在它**之后**用 `pipe` 加工 → 后置逻辑（改返回格式）
- 干脆**不调用**它 → Controller 根本不会执行（做缓存时就这么干，直接返回缓存值）

### 3.5 注册为全局拦截器

在 `main.ts` 里用 `useGlobalInterceptors` 注册，一次搞定所有接口：

```ts
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/response';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 注册全局响应拦截器
  app.useGlobalInterceptors(new ResponseInterceptor());

  await app.listen(3000);
}
bootstrap();
```

注册后，`GET /user/1` 的返回就从 `{ "id": 1, "name": "小满" }` 变成：

```json
{
  "data": { "id": 1, "name": "小满" },
  "status": 0,
  "success": true,
  "message": "成功"
}
```

### 3.6 另一种注册方式：`APP_INTERCEPTOR`

`useGlobalInterceptors(new ResponseInterceptor())` 的问题是：**手动 `new`，拿不到依赖注入（DI）**，这个拦截器里没法注入 Service。如果需要注入其他服务，用模块 provider 注册：

```ts
// src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ResponseInterceptor } from './common/response';

@Module({
  imports: [],
  controllers: [],
  providers: [
    {
      provide: APP_INTERCEPTOR, // 这是 NestJS 规定的令牌
      useClass: ResponseInterceptor,
    },
  ],
})
export class AppModule {}
```

| 注册方式 | 能依赖注入吗 | 适用 |
| --- | --- | --- |
| `app.useGlobalInterceptors(new X())` | 不能，实例在框架外创建 | 拦截器无依赖 |
| `{ provide: APP_INTERCEPTOR, useClass: X }` | 能 | 拦截器要注入 Service |

### 3.7 常见错误与排查

**现象 1：注册了拦截器，但某些接口返回格式没变、仍是裸数据**

- 原因：那个接口用了 `@Res()` 注入（比如 05 篇的文件下载）。**注入 `@Res()` 后响应由你手动接管，NestJS 不再走拦截器的返回值流程**。
- 解决：只是需要设置响应头/状态码时，改成 `@Res({ passthrough: true })`，这样既能操作响应对象，又能保留 NestJS 的返回值处理。

**现象 2：接口返回变成了 `{ data: { data: ... } }` 套两层**

- 原因：Controller 里自己已经包了一层 `{ data, status, message }`，拦截器又包一层。
- 解决：统一交给拦截器，Controller 只 `return` 业务数据本身。

**现象 3：`TS2564: Property 'xxx' has no initializer` / 泛型报错**

- 原因：`implements NestInterceptor` 没写泛型，或者 `ResponseData<T>` 少写了类型参数。
- 解决：按 3.3 的写法把泛型补齐，或直接把接口定义改成 `interface ResponseData { data: any }` 简化。

**现象 4：上传/下载接口返回 `{}` 或空响应**

- 原因：同现象 1，流式接口 `pipe(res)` 之后返回值是 `undefined`，拦截器包装的 `undefined` 发不出去（响应已经结束了）。
- 解决：这类接口明确不参与统一格式，属于合理例外。

---

## 四、异常过滤器：统一错误返回格式

### 4.1 为什么需要它

成功返回统一了，但**报错时还是 NestJS 自己的格式**：

```json
{
  "statusCode": 404,
  "message": "Cannot GET /xxx",
  "error": "Not Found"
}
```

前端要判断"成功格式"和"错误格式"两套结构。我们希望失败也统一：

```json
{
  "data": "错误提示",
  "status": 404,
  "success": false,
  "path": "/user/1",
  "time": 1663512345678
}
```

**大白话**：异常过滤器（Exception Filter）是公司的**投诉处理窗口**。不管哪个环节出了问题（前台、审批、业务），最后都汇总到这一个窗口，由它按统一话术回复客户 —— 而不是每个部门自己瞎回。

**专业定义**：异常过滤器（**ExceptionFilter**）负责捕获处理流程中抛出的异常，并把异常转换成你想要的自定义响应结构。它通过 `ArgumentsHost` 访问底层平台的 `Request` 和 `Response`，然后用 `Response.json()` 直接控制响应内容。

### 4.2 写异常过滤器

在 `src/common/` 下建 `filter.ts`：

```ts
// src/common/filter.ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import { Request, Response } from 'express';

// @Catch 参数决定"抓哪类异常"，这里只抓 HttpException 及其子类
@Catch(HttpException)
export class HttpFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    // 1. 切换到 HTTP 平台（还可以切 RPC / WebSocket）
    const ctx = host.switchToHttp();

    // 2. 取出请求和响应对象（泛型只是为了有类型提示）
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    // 3. 取异常自带的状态码，如 404、400
    const status = exception.getStatus();

    // 4. 用 response 直接发送自定义结构
    response.status(status).json({
      data: exception.message, // 错误提示
      time: new Date().getTime(), // 出错时间戳
      success: false,
      path: request.url, // 哪个接口出的错（查日志很有用）
      status, // HTTP 状态码，同时放进 body
    });
  }
}
```

### 4.3 关键点拆解

#### `@Catch()` 抓什么

| 写法 | 抓取范围 |
| --- | --- |
| `@Catch(HttpException)` | 只抓 `HttpException` 及其所有子类（`NotFoundException`、`BadRequestException` 等） |
| `@Catch(NotFoundException, BadRequestException)` | 抓多个指定类型 |
| `@Catch()` | **抓所有异常**，包括普通的 `new Error()` |

NestJS 内置的所有 HTTP 异常（`NotFoundException`、`UnauthorizedException`、`BadRequestException`、`ForbiddenException`…）都继承自 `HttpException`，所以 `@Catch(HttpException)` 能覆盖绝大多数业务报错。

#### `ArgumentsHost` 是什么

`ArgumentsHost` 是一个"宿主适配器"，它抹平了 HTTP、RPC、WebSocket 三种场景的差异：

| 方法 | 用途 |
| --- | --- |
| `host.switchToHttp()` | 切换到 HTTP 场景，返回 `HttpArgumentsHost` |
| `ctx.getRequest<T>()` | 拿请求对象（`req`） |
| `ctx.getResponse<T>()` | 拿响应对象（`res`） |
| `ctx.getNext()` | 拿 `next` 函数 |

#### `getStatus()` 和 `getResponse()` 的区别

| 方法 | 返回 | 用途 |
| --- | --- | --- |
| `exception.getStatus()` | 数字状态码，如 `404` | 直接用于 `res.status()` |
| `exception.getResponse()` | 对象或字符串，`NotFoundException('找不到用户')` 返回 `{ statusCode: 404, message: '找不到用户', error: 'Not Found' }` | 需要更详细的信息时用它 |

> 注意 `exception.message` 通常就是你在装饰器里写的那个字符串，够用了；如果要拿完整的错误对象（含 `error` 字段），改用 `exception.getResponse()`。

### 4.4 注册全局异常过滤器

```ts
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/response';
import { HttpFilter } from './common/filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 全局响应拦截器（成功）
  app.useGlobalInterceptors(new ResponseInterceptor());
  // 全局异常过滤器（失败）
  app.useGlobalFilters(new HttpFilter());

  await app.listen(3000);
}
bootstrap();
```

同样支持 DI 注册方式：`{ provide: APP_FILTER, useClass: HttpFilter }`（`APP_FILTER` 从 `@nestjs/core` 导入）。

### 4.5 补一把：让"所有异常"都统一

`@Catch(HttpException)` 有个**必须知道的缺口**：代码里如果抛的是普通 `Error`（比如 `TypeError: Cannot read properties of undefined`），它**不属于 `HttpException`**，过滤器不会接住，NestJS 会走默认兜底 → 返回 `{ "statusCode": 500, "message": "Internal server error" }`，格式又乱了。

解决办法：写一个 `@Catch()` 全捕获的过滤器，在里面自己判断类型：

```ts
// src/common/all-exception.filter.ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch() // 不传参数 = 抓所有异常
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    // 是 HttpException 就用它自己的状态码，否则一律当 500
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.message
        : '服务器内部错误';

    response.status(status).json({
      data: message,
      time: Date.now(),
      success: false,
      path: request.url,
      status,
    });
  }
}
```

> 500 这种"内部错误"的真实堆栈**不要返回给前端**（会泄露代码结构），用 `Logger.error(exception)` 打到服务端日志里，前端只给一句「服务器内部错误」就够了。

### 4.6 常见错误与排查

**现象 1：抛了 `new Error('xxx')`，但自定义格式没生效，返回默认 500**

- 原因：`@Catch(HttpException)` 抓不到非 `HttpException`。
- 解决：改用 `@Catch()` 全捕获（4.5），或统一抛 `BadRequestException` 这类内置异常。

**现象 2：报错 `TS2559: Type 'HttpFilter' has no properties in common with type 'ExceptionFilter'` / 或者方法没被识别**

- 原因：类上写了 `implements ExceptionFilter` 但 `catch` 方法名拼错（写成 `handler`、`catchException` 等）。
- 解决：方法名必须是 **`catch`**，签名是 `(exception, host: ArgumentsHost)`。

**现象 3：报错 `ERR_HTTP_HEADERS_SENT: Cannot set headers after they are sent`**

- 原因：在过滤器里 `response.json(...)` 之后，Controller 或拦截器又往响应写了东西。常见于自己同时用了 `@Res()` 手动 `res.send()` 又注册了全局过滤器。
- 解决：一个响应只写一次；用了 `@Res({ passthrough: true })` 就不要再手动 `send`。

**现象 4：跨域时报错前端拿不到错误信息，控制台只显示 CORS 错误**

- 原因：异常过滤器直接 `response.json()`，绕过了 NestJS 的 CORS 中间件处理（或 `cors` 注册在过滤器之后）。
- 解决：确保 `app.enableCors()` 在启动早期调用；复杂场景下在过滤器里手动补 `Access-Control-Allow-Origin` 头。

**现象 5：`ValidationPipe` 的校验错误返回的格式是数组，和统一格式不一致**

- 原因：`BadRequestException` 的 `message` 在 DTO 校验失败时是**字符串数组**，直接塞进 `data` 就是 `{"data": ["name 不能为空"]}`。
- 解决：需要数组就保留；需要字符串就在过滤器里判断 `Array.isArray(message) ? message[0] : message`。

---

## 五、把三个组件串起来：完整请求链路

### 5.1 一趟请求的完整旅程

```
客户端请求
    ↓
① Middleware（中间件）        ← 04 篇：只管 req/res，不知道要进哪个方法
    ↓
② Guard（守卫）               ← 后续章节：判断"你有没有权限进来"
    ↓
③ Interceptor 前置逻辑        ← 本篇：next.handle() 之前的部分
    ↓
④ Pipe（管道）                ← 下一篇：转换 + 校验参数
    ↓
⑤ Controller → Service → 数据库
    ↓
⑥ Interceptor 后置逻辑        ← 本篇：pipe(map(...)) 统一包装成功结果
    ↓
响应客户端

任何一步抛出异常：
    ↓
Exception Filter（异常过滤器）→ 统一错误格式 → 响应客户端
```

### 5.2 四个组件对比

| 组件 | 英文 | 能拿到什么 | 典型用途 | 顺序 |
| --- | --- | --- | --- | --- |
| 中间件 | Middleware | `req` / `res` / `next` | 日志、CORS、Session | 1 |
| 守卫 | Guard | `ExecutionContext` | 鉴权、角色校验 | 2 |
| 拦截器 | Interceptor | `ExecutionContext` + **返回值** | 统一返回格式、耗时统计、缓存 | 3（前后各一次） |
| 管道 | Pipe | 参数的 `value` + `metadata` | 类型转换、DTO 校验 | 4 |
| 过滤器 | ExceptionFilter | 异常 + `ArgumentsHost` | 统一错误格式 | 异常时 |

### 5.3 一次真实交互长什么样

```ts
// 假设 Controller 里这么写
@Get(':id')
findOne(@Param('id', ParseIntPipe) id: number) {
  if (id > 100) {
    throw new NotFoundException('用户不存在'); // HttpException 子类
  }
  return { id, name: '小满' };
}
```

| 请求 | 走的路径 | 返回 |
| --- | --- | --- |
| `GET /user/1` | 拦截器包装成功 | `{"data":{"id":1,"name":"小满"},"status":0,"success":true,"message":"成功"}` |
| `GET /user/abc` | `ParseIntPipe` 抛 `BadRequestException` → 过滤器 | `{"data":"Validation failed (numeric string is expected)","success":false,"status":400,"path":"/user/abc","time":...}` |
| `GET /user/999` | Controller 抛 `NotFoundException` → 过滤器 | `{"data":"用户不存在","success":false,"status":404,"path":"/user/999","time":...}` |

**注意最后两行**：成功走拦截器，失败走过滤器，**两条路互不干扰**。这也是为什么"统一格式"必须两个组件一起上 —— 只做拦截器，错误还是乱七八糟的。

---

## 六、本篇小结

| 要点 | 一句话说明 |
| --- | --- |
| RxJS 是什么 | 基于观察者模式的异步库，处理"持续产生多个值"的数据流 |
| 为什么 NestJS 要学 | 拦截器的 `intercept()` 必须返回 `Observable`，且 RxJS 是内置依赖不用装 |
| 三大核心概念 | `Observable`（发值）、`subscribe`（订阅）、`Operators`（加工） |
| 懒执行 | 不调 `subscribe()`，Observable 里的代码一行都不执行 |
| 三种通知 | `next`（发值，多次）、`error`（出错，终止）、`complete`（结束） |
| `pipe()` | 把操作符按顺序串联，数据从左往右流 |
| 常见操作符 | `map` / `filter` / `take` / `reduce` / `tap` / `interval` / `fromEvent` |
| 与数组方法的区别 | 数组一次算完；RxJS 每来一个值算一次，`reduce` 要等 `complete` |
| 内存泄漏 | `interval`、`fromEvent` 这类无限流必须 `unsubscribe` 或用 `take` 收尾 |
| 拦截器定义 | 受 AOP 启发，可在方法前后插入逻辑；能拿到返回值 |
| `next.handle()` | 代表"真正的 Controller"，不调用它 Controller 就不执行 |
| 响应拦截器核心 | `next.handle().pipe(map(data => ({ data, status: 0, success: true, message: '成功' })))` |
| 拦截器注册 | `app.useGlobalInterceptors(new X())`；需要 DI 时用 `APP_INTERCEPTOR` |
| `@Res()` 例外 | 注入 `@Res()` 后拦截器包装失效，需要设头就用 `@Res({ passthrough: true })` |
| 异常过滤器定义 | 捕获异常并自定义响应结构，通过 `ArgumentsHost` 拿 `req` / `res` |
| `@Catch` 参数 | `@Catch(HttpException)` 只抓内置 HTTP 异常；`@Catch()` 抓全部 |
| `@Catch(HttpException)` 的缺口 | 普通 `Error`（如 TypeError）抓不到，会退回默认 500 格式 |
| `getStatus()` vs `getResponse()` | 前者拿数字状态码，后者拿完整错误对象 |
| `switchToHttp()` | `ArgumentsHost` 适配 HTTP/RPC/WS 的入口，HTTP 场景必写 |
| 过滤器注册 | `app.useGlobalFilters(new HttpFilter())`；DI 版用 `APP_FILTER` |
| 安全提醒 | 500 的真实堆栈只写日志，不回给前端 |
| 成功与失败两条路 | 成功走拦截器，失败走过滤器，两个都要配才叫"统一格式" |
| 组件顺序 | 中间件 → 守卫 → 拦截器(前) → 管道 → Controller → 拦截器(后)；异常统一走过滤器 |
*（内容由AI生成，仅供参考）*
