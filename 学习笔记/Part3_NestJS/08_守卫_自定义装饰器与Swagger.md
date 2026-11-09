# 守卫、自定义装饰器与接口文档：权限控制与 Swagger 一网打尽

> 学习日期：2026-11-05
> 素材来源：小满 NestJS 系列（blog.csdn.net/qq1195566313，专栏 ID 11844396）
> 本篇对应：原文第 21 ~ 23 章
> 适合人群：NestJS 零基础

上一篇讲的是"**进来的数据要合格**"（管道 + DTO 校验）。这一篇换个角度问一句更要命的话：

> 数据是合法的，但**这个人有资格访问吗**？

想象你的后台有个 `DELETE /user/1` 接口。前端传的 id 是合法数字（管道通过）、字段齐全（DTO 通过），可发请求的是一个普通用户 —— 他凭什么能删用户？**管道管的是"数据对不对"，管不了"人配不配"。**

这一篇要解决三件事：

1. **守卫（Guard）**：站在路由门口问"你是谁、你能不能进"。
2. **自定义装饰器**：把"这个接口要求 admin 权限"这话，写成装饰器一行贴在方法上。
3. **Swagger**：把这些接口自动变成一份能点、能试的前端对接文档。

---

## 一、守卫（Guard）是什么

### 1.1 先用大白话理解

把 NestJS 应用想成一栋写字楼：

- **中间件（Middleware）** 是大门保安：查你有没有工牌、给你发个访客贴（往 `req` 上挂用户信息），但他不知道你要去哪个部门。
- **守卫（Guard）** 是**每个部门门口的门禁**：它知道"这扇门是财务室（某个具体接口）"，也知道"进财务室必须财务部员工（角色要求）"。刷卡不对，直接拦下，你连部门里的办事窗口（Controller 方法）都摸不到。
- **管道（Pipe）** 是窗口里的办事员：检查你递的材料填得规不规范。
- **拦截器（Interceptor）** 是窗口外记录办事时长的人。

关键差别：**中间件不认识"部门"，守卫认识。** 因为守卫能拿到"当前请求要去哪个 Controller 的哪个方法"这个信息 —— 这正是它能做精细授权的前提。

### 1.2 专业定义

| 术语 | 英文 | 含义 |
| --- | --- | --- |
| 守卫 | `Guard` | 在路由处理程序执行前，根据运行时条件（权限、角色、ACL）决定请求是否放行的机制 |
| 授权 | Authorization | 判断"已认证的用户有没有权限做这件事" |
| 认证 | Authentication | 判断"你是谁"（通常由中间件或专门的 Passport 策略完成） |
| 守卫接口 | `CanActivate` | 所有守卫必须实现的接口，只有一个 `canActivate()` 方法 |
| 执行上下文 | `ExecutionContext` | 守卫方法收到的参数，能取到请求对象、Controller 类、处理方法 |
| 元数据 | `Metadata` | 挂在类或方法上的自定义数据，靠 `@SetMetadata` 写、靠 `Reflector` 读 |
| 反射器 | `Reflector` | NestJS 提供的工具类，用来读取装饰器写入的元数据 |

**一句话**：守卫（Guard）是一个实现 `CanActivate` 接口、带 `@Injectable()` 的类，它的 `canActivate(context)` 返回 `true` 就放行、返回 `false` 就抛 403，是 NestJS 中做**授权**的标准位置。

### 1.3 它在链路中的位置

原文给了一句非常重要的提示：**守卫在每个中间件之后执行，但在任何拦截器或管道之前执行。**

```
请求
  ↓
Middleware（中间件）        ← 解析 token、往 req 挂 user
  ↓
★ Guard（守卫）★           ← 判权限，这里不通过就 403 结束
  ↓
Interceptor（拦截器，前置）
  ↓
Pipe（管道）               ← 校验参数
  ↓
Controller → Service
  ↓
Interceptor（拦截器，后置）
  ↓
Exception Filter（异常过滤器）
  ↓
响应
```

这个顺序很好记，而且是有原因的：**拦截器和管道都会真正"消费"请求参数并可能访问数据库**，所以权限判断必须在它们之前完成。守卫拒绝的请求，一个字节的业务代码都不会执行。

### 1.4 守卫和中间件到底差在哪

初学者最容易的困惑是："我用中间件判断角色也行啊，为什么要多一个守卫？" 原文其实也明说了：传统 Express 应用里授权一般就是中间件干的。对比一下：

| 维度 | 中间件 Middleware | 守卫 Guard |
| --- | --- | --- |
| 执行时机 | 最早，路由匹配阶段 | 中间件之后，拦截器/管道之前 |
| 能否知道目标处理函数 | **不能**，拿不到 `getHandler()` | **能**，可拿 `getHandler()` / `getClass()` |
| 能否读方法上的元数据 | 不能 | **能**，配合 `Reflector` |
| 典型职责 | 日志、CORS、body 解析、Session、token 解包 | 授权、角色判断、ACL、限流前置判断 |
| 拒绝方式 | `next(err)` 或直接 `res.end()`，手写 | `return false` 或 `throw new ForbiddenException()`，框架接管 |
| 返回值语义 | 无（靠调用 `next()` 推进） | `boolean` / `Promise<boolean>` / `Observable<boolean>` |

**结论**：token 验证这种"与具体路由无关"的事放中间件；"这个路由要求 admin"这种"与具体路由强相关"的事放守卫。

### 1.5 `CanActivate` 接口长什么样

```ts
import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Observable } from 'rxjs';

export interface CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean>;
}
```

三个返回值类型都要支持，意味着守卫里可以：

- 同步判断（查内存里的角色表）→ `boolean`
- 异步查库（从数据库查用户角色）→ `Promise<boolean>`
- 用 RxJS 流（少见）→ `Observable<boolean>`

`ExecutionContext` 是 `ArgumentsHost` 的子接口，除了能取 `req` / `res`，**多了两个专属方法**：

| 方法 | 返回 | 用途 |
| --- | --- | --- |
| `context.getHandler()` | 当前要执行的**方法**（如 `findAll`） | 读方法级元数据 |
| `context.getClass()` | 当前**Controller 类**（如 `GuardController`） | 读类级元数据 |
| `context.switchToHttp().getRequest()` | Express 的 `Request` | 取 `query`、`headers`、`user` |
| `context.switchToHttp().getResponse()` | Express 的 `Response` | 极少在守卫里用 |
| `context.getType()` | `'http'` / `'ws'` / `'rpc'` | 微服务场景区分传输层 |

`getHandler()` 和 `getClass()` 是守卫的灵魂 —— 没有它们，守卫就退化成"另一个中间件"。

---

## 二、写第一个守卫

### 2.1 用命令生成

```bash
# 生成守卫文件，gu 是 generate guard 的缩写
nest g gu guard/role
```

执行后 CLI 会做两件事：

1. 创建 `src/guard/role/role.guard.ts`，内容是一个"永远放行"的骨架。
2. **自动把这个守卫注册到模块的 `providers` 里**（Nest 8 之后 CLI 会自动注册，老教程可能还要求你手动加，注意核对）。

生成的骨架长这样：

```ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable() // 关键：可以参与依赖注入，能在构造函数里注入 Reflector、UserService 等
export class RoleGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    return true; // 骨架默认放行，先跑起来再改逻辑
  }
}
```

几个容易忽略的点：

- `@Injectable()` **不能省**。省了就没法在构造函数里注入 `Reflector`，Nest 会报依赖解析失败。
- 文件名和类名遵循 `xxx.guard.ts` / `XxxGuard` 的约定，这是社区统一风格。
- 守卫本身是**无状态**的（每次请求都会复用同一个实例），**不要**把"当前用户"存到 `this` 上，那是并发灾难。

### 2.2 手动写一遍：从零实现

不看骨架，自己敲一遍能记得更牢。写个"所有请求一律拦下"的守卫：

```ts
// src/guard/role/role.guard.ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class RoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // 1. 拿到本次请求对应的 Express Request 对象
    const request = context.switchToHttp().getRequest<Request>();

    // 2. 从 query 里取 role 参数（真实项目里应该从 token 解出来）
    const role = request.query.role as string;

    // 3. 只有 admin 放行，其余一律拒绝
    return role === 'admin';
  }
}
```

> 说明：`context.switchToHttp().getRequest<Request>()` 里的泛型参数让 TypeScript 知道返回值是 Express 的 `Request`，这样 `request.query` 才有类型提示。用 `import type` 导入是因为 `Request` 只用于类型，编译后会被擦除。

### 2.3 在 Controller 上使用

守卫要用 `@UseGuards()` 挂上去，**不挂就是一个永远不会执行的类**。素材里的写法：

```ts
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { GuardService } from './guard.service';
import { CreateGuardDto } from './dto/create-guard.dto';
import { RoleGuard } from '../../guard/role/role.guard';

@Controller('guard')
@UseGuards(RoleGuard) // 挂在类上：本 Controller 所有接口都要过这道门禁
export class GuardController {
  constructor(private readonly guardService: GuardService) {}

  @Get()
  findAll() {
    return this.guardService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.guardService.findOne(+id);
  }
}
```

`@UseGuards()` 传的是**类本身**（`RoleGuard`），不是实例（`new RoleGuard()`）。传类的好处是 Nest 帮你实例化，构造函数里注入的依赖会自动填好。

### 2.4 三种作用范围

| 范围 | 写法 | 说明 | 适用场景 |
| --- | --- | --- | --- |
| 方法级 | `@UseGuards(RoleGuard)` 贴在方法上 | 只保护这一个接口 | 最常用，粒度最细 |
| 控制器级 | `@UseGuards(RoleGuard)` 贴在 `@Controller()` 下方 | 保护该 Controller 全部接口 | 整个模块都要登录 |
| 全局 | `app.useGlobalGuards(new RoleGuard())` | 全部接口生效 | 全站登录校验 |

可以叠加多个守卫，**执行顺序是从左到右，任何一个返回 `false` 就立刻终止**：

```ts
@UseGuards(AuthGuard, RoleGuard) // 先过登录校验，再过角色校验
@Get('admin')
findAdmin() {}
```

### 2.5 全局守卫：注意依赖注入的坑

素材里给的是最直接的写法：

```ts
// main.ts
app.useGlobalGuards(new RoleGuard());
```

但这行代码有个**很大的限制**：`new RoleGuard()` 是你自己手动创建的实例，**Nest 的依赖注入容器完全不参与**。所以只要守卫构造函数里注入了 `Reflector`、`UserService` 之类的依赖，这个写法就会炸 —— 相当于 `new RoleGuard(undefined)`。

正确做法是用 `APP_GUARD` 令牌注册：

```ts
// src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RoleGuard } from './guard/role/role.guard';

@Module({
  imports: [/* ... */],
  providers: [
    {
      provide: APP_GUARD, // 框架预留的全局守卫令牌
      useClass: RoleGuard, // 由 DI 容器实例化，构造函数依赖自动注入
    },
  ],
})
export class AppModule {}
```

| 写法 | 能否注入依赖 | 推荐度 |
| --- | --- | --- |
| `app.useGlobalGuards(new RoleGuard())` | 不能 | 仅限无依赖的极简守卫 |
| `{ provide: APP_GUARD, useClass: RoleGuard }` | **能** | 生产环境标准做法 |

### 2.6 `return false` 之后发生了什么

很多人以为返回 `false` 就是"啥也不返回"，其实不是。Nest 会**自动抛出一个 `ForbiddenException`**，最终前端收到的是标准 403 响应：

```json
{
  "statusCode": 403,
  "message": "Forbidden resource",
  "error": "Forbidden"
}
```

如果觉得默认提示太机械，可以自己抛异常（后面 3.5 节就是这么写的）：

```ts
import { ForbiddenException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

@Injectable()
export class RoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const role = context.switchToHttp().getRequest().query.role;
    if (role !== 'admin') {
      // 自定义提示语，方便前端定位问题
      throw new ForbiddenException('你没有访问该接口的权限');
    }
    return true;
  }
}
```

这些小知识点串起来看：

| 守卫里的动作 | 最终 HTTP 状态 | 说明 |
| --- | --- | --- |
| `return true` | 正常进入 Controller | 放行 |
| `return false` | 403 | 框架自动抛 `ForbiddenException` |
| `throw new UnauthorizedException('请先登录')` | 401 | 未登录用 401 更语义化 |
| `throw new ForbiddenException('权限不足')` | 403 | 已登录但没权限 |
| Promise 里 reject | 500 或对应异常 | 注意 catch，别让异常裸奔 |

> 401 和 403 的区别是面试常问：**401 是"我不知道你是谁"（未认证），403 是"我知道你是谁，但你不能来"（未授权）**。

### 2.7 常见错误提示

| 报错原文 | 原因 | 解决 |
| --- | --- | --- |
| `Nest can't resolve dependencies of the RoleGuard (?)` | `@Injectable()` 漏写，或没在 `providers` 中注册 | 补 `@Injectable()`；用 `nest g gu` 生成或手动加进模块 `providers` |
| `TypeError: Cannot read properties of undefined (reading 'role')` | `new RoleGuard()` 全局注册，导致 `Reflector` 是 `undefined` | 改用 `{ provide: APP_GUARD, useClass: RoleGuard }` |
| 守卫完全不生效 | 只写了类，没挂 `@UseGuards()` | 检查是否在方法、类或全局注册 |
| 每个请求都 403，包括没加注解的接口 | 守卫逻辑默认拒绝，没处理"未标注"的分支 | 在 `canActivate` 里加 `if (!roles) return true` |
| `request.query.role` 类型报错 | `getRequest()` 没传泛型，返回 `any` 或未定义类型 | `getRequest<Request>()` 配合 `import type { Request } from 'express'` |

---

## 三、用元数据做角色控制

### 3.1 为什么不能把角色写死在守卫里

上一节的守卫有个致命问题：**它的规则是硬编码的**。`if (role !== 'admin')` 意味着这个守卫只能做一件事 —— 要求 admin。

可现实中你会遇到：

- `GET /article` —— 任何人都能看
- `GET /user/list` —— 要 `admin`
- `DELETE /user/1` —— 要 `super` 或 `admin`

如果每种规则写一个守卫，最后会有一堆 `AdminGuard`、`SuperGuard`、`AdminOrSuperGuard`…… 灾难。

正确的做法是**把规则从守卫里挪出来，贴在方法上**：

> 守卫保持通用（"读一下这个接口要求什么角色，然后跟当前用户比一比"），**具体要什么角色由每个接口自己声明**。

这就是**元数据（Metadata）+ 反射（Reflector）** 的配合模式。

### 3.2 `@SetMetadata`：给方法贴标签

`@SetMetadata(key, value)` 从 `@nestjs/common` 导入，两个参数：

- 第一个是**键名**（字符串，随便起，建议语义化）；
- 第二个是**值**（任意类型，例子中是一个角色数组）。

```ts
import { Controller, Get, SetMetadata } from '@nestjs/common';

@Controller('guard')
export class GuardController {
  @Get('admin')
  @SetMetadata('role', ['admin']) // 贴标签：这个接口要求 admin
  findAdmin() {
    return '只有 admin 能看到';
  }

  @Get('super')
  @SetMetadata('role', ['super', 'admin']) // 贴标签：super 或 admin 都可以
  findSuper() {
    return 'super 和 admin 能看到';
  }

  @Get('public')
  findAll() {
    return '谁都能看'; // 不贴标签 = 不限制
  }
}
```

`@SetMetadata` 可以贴在**方法**上，也可以贴在**类**（`@Controller` 下方）上表示整个 Controller 的默认规则。

> 原理补充：装饰器本质是执行 `Reflect.defineMetadata(key, value, target)`，把数据挂在类或函数对象内部的一张"隐藏表格"上。**运行时可以通过反射把这表读回来**，这就是"元数据"这个名称的来源。这套机制依赖 `reflect-metadata`（NestJS 启动时会自动加载）。

### 3.3 `Reflector`：反射读取标签

在守卫里注入 `Reflector`，就能把刚才贴的标签读出来：

```ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

@Injectable()
export class RoleGuard implements CanActivate {
  // 注入 Reflector（注意：Reflector 来自 @nestjs/core，不是 @nestjs/common）
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 读取当前处理方法上 'role' 这个键的值
    const roles = this.reflector.get<string[]>('role', context.getHandler());

    const request = context.switchToHttp().getRequest<Request>();

    // 用 URL 上的 ?role=xxx 模拟当前用户的角色
    return roles.includes(request.query.role as string);
  }
}
```

素材里就是这套写法 —— **从 URL 取 `role` 参数，跟方法上声明的角色数组比一比**。真实项目里 `role` 应该来自 JWT 解出来的用户信息，这里用 query 只是为了演示方便。

### 3.4 `Reflector` 四个取值方法

这是本篇最容易混的一组 API，一次性理清：

| 方法 | 参数 | 行为 | 返回 |
| --- | --- | --- | --- |
| `get(key, target)` | 单个目标（方法或类） | 只读这一个目标上的值 | `T \| undefined` |
| `getAll(key, targets)` | 目标数组 | 分别读，各位置返回各自的值 | `T[]` |
| `getAllAndMerge(key, targets)` | 目标数组 | 都读到后**合并**（数组拼接、对象合并） | `T` |
| `getAllAndOverride(key, targets)` | 目标数组 | **就近覆盖**，数组越靠前优先级越高 | `T \| undefined` |

后两个才是实战首选。原因：你希望方法上的标注能覆盖类上的标注。

```ts
// 类上标注：整个 Controller 要求登录用户角色 ['user']
@Controller('guard')
@SetMetadata('role', ['user'])
export class GuardController {
  // 方法上标注：这个接口要求 ['admin']
  @Get('admin')
  @SetMetadata('role', ['admin'])
  findAdmin() {}
}
```

| 取值方式 | `findAdmin` 结果 | 说明 |
| --- | --- | --- |
| `get('role', context.getHandler())` | `['admin']` | 只能看到方法级 |
| `getAll('role', [handler, cls])` | `[['admin'], ['user']]` | 两个都返回，还得自己判断 |
| `getAllAndMerge` | `['admin', 'user']` | 拼接，语义模糊 |
| `getAllAndOverride` | `['admin']` | **方法优先，推荐** |

### 3.5 完整版 `RoleGuard`

把上面所有内容合并成一个能直接用、还带容错的版本：

```ts
// src/guard/role/role.guard.ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 1. 方法级优先、类级兜底，读取声明的角色要求
    const requiredRoles = this.reflector.getAllAndOverride<string[]>('role', [
      context.getHandler(), // 当前方法
      context.getClass(), // 当前 Controller 类
    ]);

    // 2. 没有任何标注 → 说明这个接口是公开的，直接放行
    //    （这一句很关键，否则未标注的接口会因为 undefined.includes 直接报错）
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    // 3. 取当前用户角色：真实项目应改为从 token / session 里取
    const request = context.switchToHttp().getRequest<Request>();
    const currentRole = (request.query.role ??
      request.headers['x-role']) as string;

    // 4. 比对，命中就放行
    if (requiredRoles.includes(currentRole)) {
      return true;
    }

    // 5. 不命中：给个明确的中文提示，方便前端和日志排查
    throw new ForbiddenException(
      `访问该接口需要 ${requiredRoles.join(' 或 ')} 权限`,
    );
  }
}
```

相比素材里的原始版本，这个版本补了三处：

| 改动 | 原始写法 | 问题 | 修正 |
| --- | --- | --- | --- |
| 读取方式 | `get('role', getHandler())` | 类级标注读不到 | 改 `getAllAndOverride`，方法优先、类兜底 |
| 空值保护 | 直接 `admin.includes(...)` | 未标注接口时 `admin` 是 `undefined`，直接 TypeError → 500 | 加 `if (!requiredRoles) return true` |
| 拒绝方式 | `return false` | 提示是英文 `Forbidden resource` | 抛 `ForbiddenException` 自定义中文提示 |

### 3.6 验证效果

启动项目，用两种请求对打：

```bash
# 1. 带 admin 角色 → 成功，返回业务数据
curl "http://localhost:3000/guard/admin?role=admin"
# {"statusCode":200,"data":"..."}

# 2. 带 user 角色 → 失败，403
curl "http://localhost:3000/guard/admin?role=user"
# {"statusCode":403,"message":"访问该接口需要 admin 权限","error":"Forbidden"}

# 3. 不带角色 → 同样 403
curl "http://localhost:3000/guard/admin"
# {"statusCode":403,"message":"访问该接口需要 admin 权限","error":"Forbidden"}

# 4. 未标注角色的公开接口 → 成功
curl "http://localhost:3000/guard?role=user"
```

方便记的对照表：

| URL | 当前角色 | 方法声明 | 结果 |
| --- | --- | --- | --- |
| `/guard?role=user` | user | 无（公开） | 200 |
| `/guard/admin?role=admin` | admin | `['admin']` | 200 |
| `/guard/admin?role=user` | user | `['admin']` | 403 |
| `/guard/super?role=admin` | admin | `['super','admin']` | 200 |

### 3.7 常见错误提示

| 报错原文 | 原因 | 解决 |
| --- | --- | --- |
| `TypeError: Cannot read properties of undefined (reading 'includes')` | 接口没标 `@SetMetadata`，`reflector.get` 返回 `undefined` | 加空值判断，未标注视为公开 |
| `Reflector` 是 `undefined` | 从 `@nestjs/common` 而不是 `@nestjs/core` 导入，或守卫没用 DI 实例化 | `import { Reflector } from '@nestjs/core'`；用 `APP_GUARD` 注册 |
| 类上标注了角色但方法里读不到 | 用了 `get(key, getHandler())` | 改 `getAllAndOverride(key, [handler, cls])` |
| 修改 `@SetMetadata` 后热更新无效 | 元数据在编译期写入，某些热重载场景不刷新 | 重启一次 `npm run start:dev` |
| 403 但看不出原因 | 使用了默认 `return false` | 改用 `throw new ForbiddenException('具体原因')` |

---

## 四、自定义装饰器

### 4.1 为什么要自定义

回头看上一节的 Controller，已经有点难看了：

```ts
@Get('admin')
@SetMetadata('role', ['admin'])
@UseGuards(RoleGuard)
@ApiBearerAuth()
@ApiResponse({ status: 403, description: '权限不足' })
findAdmin() {}
```

**五行装饰器表达的其实是一件事："这个接口要 admin 权限"。** 这意味着：

- 以后每个需要 admin 的接口，都要把这五行抄一遍；
- 某天把 `RoleGuard` 换成 `JwtGuard`，得全局搜索替换。

NestJS 允许我们**自己造装饰器**，把这一组语义打包成一个 `@Auth('admin')`。这正是本篇的核心技巧之一。

### 4.2 用命令生成

```bash
# 生成装饰器文件，d 是 generate decorator 的缩写
nest g d decorator/role
```

生成 `src/decorator/role/role.decorator.ts`，内容是一个空的 `export const`。文件名约定 `xxx.decorator.ts`。

> 装饰器不是"服务"，所以它**不进 `providers`**。它只是一个普通函数，被 `import` 进来用即可。

### 4.3 案例一：`@Role` 权限装饰器（元数据装饰器）

素材里的写法：

```ts
// src/decorator/role/role.decorator.ts
import { SetMetadata } from '@nestjs/common';

// 接收一个角色数组，转交给 SetMetadata 写入元数据
export const Role = (role: string[]) => {
  // console.log(role, 1); // 调试用：确认装饰器已在启动时执行过
  return SetMetadata('role', role);
};
```

用法（这就是 3.5 节 `RoleGuard` 能读出数据的原因）：

```ts
@Get('admin')
@Role(['admin'])
findAll() {
  return '只有 admin 能看到';
}
```

再进化一版，改成**可变参数**写法，调用时少写一层方括号，更接近官方风格：

```ts
import { SetMetadata } from '@nestjs/common';

// 导出键名常量，守卫和装饰器共用，避免手写字符串写错
export const ROLE_KEY = 'role';

export const Role = (...roles: string[]) => SetMetadata(ROLE_KEY, roles);
```

```ts
@Role('admin', 'super') // 不需要再写 ['admin', 'super']
@Delete(':id')
remove(@Param('id') id: string) {}
```

守卫里把魔法字符串换成常量：

```ts
const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLE_KEY, [
  context.getHandler(),
  context.getClass(),
]);
```

> 别小看 `ROLE_KEY` 这一步。键名一旦写成字符串，守卫里写错了 TypeScript **不会报错**，只会静默地"读不到 → 永远放行"，安全漏洞就是这样来的。

### 4.4 案例二：`createParamDecorator` 参数装饰器

NestJS 内置了 `@Req()`、`@Body()`、`@Query()` 这些**参数装饰器**。当内置的不够用时，可以用 `createParamDecorator` 自己造一个。

素材的例子：造一个 `@ReqUrl()`，直接把当前请求的 URL 注入到参数里。

```ts
// src/decorator/req-url/req-url.decorator.ts
import {
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

// 工厂函数：返回一个参数装饰器
export const ReqUrl = createParamDecorator(
  // data 是使用装饰器时传进来的值（本例传入 '123'）
  // ctx 是执行上下文，和守卫里收到的是同一个东西
  (data: string, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<Request>();
    // 想让参数变成什么，就 return 什么
    return req.url;
  },
);
```

用法：

```ts
import { ReqUrl } from '../../decorator/req-url/req-url.decorator';

@Get()
@Role(['admin'])
findAll(@ReqUrl('123') url: string) {
  console.log(url, 'url'); // 打印 /guard?role=admin
  return this.guardService.findAll();
}
```

这里的 `'123'` 就是传进 `data` 参数的值，本例里没用到它，所以不体现 —— 它的典型用途是"一个装饰器处理多个字段"：

```ts
// 一个通用的取值装饰器：@Value('userId') 取 req.user.userId
export const Value = createParamDecorator(
  (field: string, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    // 支持 a.b.c 这种层级路径
    return field.split('.').reduce((obj, key) => obj?.[key], req);
  },
);
```

更实用的场景：配合守卫/中间件解出来的用户信息，做一个 `@User()`：

```ts
// src/decorator/user/user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const User = createParamDecorator(
  (field: string | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user; // 由中间件 / 守卫写入
    // 不传字段返回整个用户对象；传了字段只返回该字段
    return field ? user?.[field] : user;
  },
);
```

```ts
@Get('profile')
@UseGuards(AuthGuard)
profile(@User('id') userId: number) {
  // 不用再写 @Req() req 再 req.user.id 了
  return this.userService.findOne(userId);
}
```

| 对比 | 传统写法 | 自定义参数装饰器 |
| --- | --- | --- |
| 代码 | `profile(@Req() req) { const id = req.user.id }` | `profile(@User('id') id) { }` |
| 类型 | 整个 `req` 类型很宽，`req.user` 是 `any` | 直接拿到目标字段，类型可控 |
| 复用 | 每个方法重复取值 | 一处定义，处处使用 |

### 4.5 案例三：`applyDecorators` 组合装饰器

这是**最能减少代码量**的一个。`applyDecorators` 能把多个装饰器打包成一个。

```ts
// src/decorator/auth/auth.decorator.ts
import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { RoleGuard, ROLE_KEY } from '../../guard/role/role.guard';

export function Auth(...roles: string[]) {
  return applyDecorators(
    SetMetadata(ROLE_KEY, roles), // 1. 声明需要的角色
    UseGuards(RoleGuard), // 2. 挂上守卫
    ApiBearerAuth(), // 3. Swagger 显示需要 token
    ApiResponse({ status: 403, description: '权限不足' }), // 4. 文档写清失败返回
  );
}
```

于是上一节那五行变成一行：

```ts
@Get('admin')
@Auth('admin')
findAdmin() {
  return this.guardService.findAll();
}

@Delete(':id')
@Auth('admin', 'super')
remove(@Param('id') id: string) {}
```

`applyDecorators` 的两个特点：

- **返回值本身就是装饰器**，所以既能贴方法，也能贴类。
- 可以**嵌套**：`@Auth()` 内部还能再组合别的自定义装饰器。

### 4.6 自定义装饰器的四种类型

| 类型 | 创建方式 | 作用对象 | 典型例子 |
| --- | --- | --- | --- |
| 元数据装饰器 | `SetMetadata()` | 类 / 方法 | `@Role('admin')` |
| 参数装饰器 | `createParamDecorator()` | 方法参数 | `@User('id')`、`@ReqUrl()` |
| 组合装饰器 | `applyDecorators()` | 类 / 方法 | `@Auth('admin')` |
| 普通方法装饰器 | 手写 `(target, propertyKey, descriptor)` | 方法 | 打印耗时、缓存结果 |

第四种是纯 TypeScript 装饰器写法（下一篇不涉及，第 02 篇已讲原理），例如打印耗时：

```ts
// 手写方法装饰器：记录方法执行耗时
export function LogTime() {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const original = descriptor.value; // 保存原方法
    descriptor.value = async function (...args: any[]) {
      const start = Date.now();
      const result = await original.apply(this, args); // 调用原方法
      console.log(`${propertyKey} 耗时 ${Date.now() - start}ms`);
      return result;
    };
  };
}
```

### 4.7 常见错误提示

| 报错原文 | 原因 | 解决 |
| --- | --- | --- |
| `Unable to resolve signature of parameter decorator` | `createParamDecorator` 返回的函数直接当普通装饰器用，签名不匹配 | 只用于**方法参数**位置，如 `findAll(@ReqUrl() url: string)` |
| `@Role` 不生效，守卫永远放行 | 装饰器只 `import` 没写在方法上，或键名与守卫读取的不一致 | 统一用 `ROLE_KEY` 常量 |
| `Cannot find module './role.decorator'` | `nest g d decorator/role` 生成到了子目录里 | 检查相对路径层级 |
| 组合装饰器里 `UseGuards` 报循环依赖 | 装饰器文件 import 了守卫，守卫又 import 了装饰器的常量 | 把 `ROLE_KEY` 抽到独立的 `constants.ts` |
| 参数装饰器拿到的 `data` 是 `undefined` | 调用时没传参（`@ReqUrl()`），而你依赖了 `data` | 加默认值或判空 |

---

## 五、Swagger 接口文档

### 5.1 为什么要 Swagger

前面 7 篇写了一大堆接口，但前端的视角是这样的："`GET /user/list` 要传什么？返回什么格式？哪些字段必填？"

靠微信喊、靠 Word 文档传，最后必然过期 —— **代码改了，文档忘了改**。

Swagger 的价值就是：**文档从代码里自动长出来**。你在 Controller 上写注解，它生成一个网页，前端可以直接在网页上点"Try it out"发真实请求。

### 5.2 安装与最小配置

```bash
# @nestjs/swagger 提供 Nest 专用的装饰器和文档生成器
# swagger-ui-express 提供那个漂亮的网页界面
npm install @nestjs/swagger swagger-ui-express
```

在 `main.ts` 里注册（素材的写法，补全了 import）：

```ts
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 1. 用建造者模式拼出一份文档的元信息
  const options = new DocumentBuilder()
    .setTitle('小满接口文档')
    .setDescription('NestJS 学习项目的接口说明')
    .setVersion('1.0')
    .build();

  // 2. 让 Swagger 扫描整个应用（所有 Controller / DTO），生成 JSON 描述
  const document = SwaggerModule.createDocument(app, options);

  // 3. 挂载 UI 页面，第一个参数就是访问路径
  SwaggerModule.setup('/api-docs', app, document);

  await app.listen(3000);
}
bootstrap();
```

启动后浏览器打开 `http://localhost:3000/api-docs` 就能看到页面。

三步走的口诀：**build 配置 → createDocument 扫描 → setup 挂页面**。

补充一个实用选项，让"授权 token"刷新页面后不丢：

```ts
SwaggerModule.setup('/api-docs', app, document, {
  swaggerOptions: {
    persistAuthorization: true, // 记住上次填的 token，调试时省事
  },
});
```

### 5.3 `DocumentBuilder` 常用配置

| 方法 | 作用 |
| --- | --- |
| `.setTitle('标题')` | 文档标题（页面顶部） |
| `.setDescription('描述')` | 文档说明文字 |
| `.setVersion('1.0')` | 版本号 |
| `.addBearerAuth()` | 开启 `Authorization: Bearer` 输入框（JWT 必备） |
| `.addServer('http://localhost:3000')` | 手动指定服务地址 |
| `.addTag('user', '用户模块')` | 给分组补一段说明文字 |
| `.setContact('名字', 'url', 'email')` | 联系人信息 |
| `.setLicense('MIT', 'url')` | 许可证信息 |

### 5.4 `@ApiTags` 分组

刚打开文档时，所有接口**平铺在一页上**，按 Controller 名字粗暴区分，几十个接口根本没法看。素材里也提到了这一点：先解决"乱"的问题。

`@ApiTags('分组名')` 贴在 Controller 上：

```ts
import { ApiTags } from '@nestjs/swagger';

@ApiTags('守卫演示') // 这个 Controller 下的接口都归到"守卫演示"分组
@Controller('guard')
@UseGuards(RoleGuard)
export class GuardController {}
```

页面左侧会按分组折叠，一个 Controller 一个分组，清晰度立刻提升。一个 Controller 也可以打多个 tag：

```ts
@ApiTags('用户', '后台管理')
```

### 5.5 `@ApiOperation` 接口描述

分组解决"找得到"，`@ApiOperation` 解决"看得懂"：

```ts
@Get()
@Role(['admin'])
@ApiOperation({
  summary: '测试 admin 权限', // 列表里显示的短标题
  description: '请求该接口需要在 query 中携带 role=admin', // 点开后的详细说明
})
findAll(@ReqUrl('123') url: string) {
  console.log(url, 'url');
  return this.guardService.findAll();
}
```

| 字段 | 显示位置 | 建议长度 |
| --- | --- | --- |
| `summary` | 接口列表中的一行 | 10 字以内 |
| `description` | 展开后的大段说明 | 可写多行、Markdown |
| `deprecated: true` | 接口标灰、显示"已废弃" | 接口下线过渡期用 |

### 5.6 参数相关：`@ApiParam` / `@ApiQuery` / `@ApiBody`

| 装饰器 | 对应从哪里取参数 | 典型接口 |
| --- | --- | --- |
| `@ApiParam()` | 路径参数 `/user/:id` | `@Param('id')` |
| `@ApiQuery()` | 查询参数 `?page=1` | `@Query('page')` |
| `@ApiBody()` | 请求体 | `@Body()` |

```ts
import { ApiParam, ApiQuery } from '@nestjs/swagger';

@Get(':id')
@ApiParam({ name: 'id', description: '用户 id', required: true, example: 1 })
findOne(@Param('id') id: string) {
  return this.guardService.findOne(+id);
}

@Get()
@ApiQuery({ name: 'role', description: '当前用户角色，如 admin', required: false })
@ApiQuery({ name: 'page', description: '页码，默认 1', required: false, example: 1 })
findPage(@Query() query: any) {
  return query;
}
```

> `@ApiParam` 里的 `name` 必须和 `@Param('id')` 里的名字**完全一致**，否则文档里会出现两个参数，一个叫 `id`（无描述）、一个叫 `xxx`（有描述）。

### 5.7 DTO 相关：`@ApiProperty`

POST 接口的请求体来自 DTO，给 DTO 的每个字段加 `@ApiProperty`：

```ts
// src/guard/dto/create-guard.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString } from 'class-validator';

export class CreateGuardDto {
  @ApiProperty({ description: '姓名', example: '小满' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: '年龄', example: 18 })
  @IsInt()
  age: number;
}
```

`@ApiProperty` 的可用字段：

| 字段 | 作用 | 示例 |
| --- | --- | --- |
| `description` | 字段说明 | `'用户姓名'` |
| `example` | 示例值（UI 里预填） | `'小满'` |
| `required` | 是否必填（默认 `true`） | `false` |
| `default` | 默认值 | `1` |
| `enum` | 枚举可选值（渲染下拉框） | `['admin', 'user']` |
| `type` | 显式指定类型（数组/嵌套时必写） | `[String]`、`UserDto` |
| `format` | 特殊格式提示 | `'date-time'`、`'binary'` |

可选的属性也可以这样写（更简洁）：

```ts
// 只写描述，Nest 会根据 TS 类型自动推断，非必填字段加 @ApiPropertyOptional
import { ApiPropertyOptional } from '@nestjs/swagger';

@ApiPropertyOptional({ description: '昵称，可不填' })
nickname?: string;
```

**一个高频坑**：`@ApiProperty` 只在 DTO 是 **`class`** 时生效。写成 `interface` 编译后就被擦除了，Swagger 页面上请求体是空的（和第 07 篇 `ValidationPipe` 失效是同一个原因）。

还有一类场景 Swagger 看不出来：**文件上传**。这时要用 `@ApiConsumes` + `@ApiBody` 手写 schema：

```ts
@Post('upload')
@ApiConsumes('multipart/form-data')
@ApiBody({
  schema: {
    type: 'object',
    properties: {
      file: { type: 'string', format: 'binary' }, // 声明这是一个文件
      name: { type: 'string' },
    },
  },
})
@UseInterceptors(FileInterceptor('file'))
upload(@UploadedFile() file: Express.Multer.File) {
  return file?.filename;
}
```

### 5.8 `@ApiResponse` 自定义返回信息

默认 Swagger 只知道"返回 200"，不知道你的业务格式（第 06 篇那个 `{ code, data, message }`）。用 `@ApiResponse` 补上：

```ts
import { ApiResponse } from '@nestjs/swagger';

@Post()
@ApiOperation({ summary: '创建用户' })
@ApiResponse({ status: 201, description: '创建成功', type: CreateGuardDto })
@ApiResponse({ status: 403, description: '自定义返回信息，权限不足' })
@ApiResponse({ status: 400, description: '参数校验失败' })
create(@Body() createGuardDto: CreateGuardDto) {
  return this.guardService.create(createGuardDto);
}
```

| 参数 | 说明 |
| --- | --- |
| `status` | HTTP 状态码 |
| `description` | 状态说明 |
| `type` | 返回体对应的类（会渲染成结构树） |
| `isArray` | 返回是数组时设 `true` |

想标注**统一包装格式**（第 06 篇的响应拦截器），可以造一个泛型返回类：

```ts
export class ResponseDto<T> {
  @ApiProperty({ description: '状态码', example: 200 })
  code: number;

  @ApiProperty({ description: '提示信息', example: '成功' })
  message: string;

  data: T;
}
```

### 5.9 `@ApiBearerAuth` 与 JWT

如果接口需要鉴权，希望 Swagger 页面顶部有一个"填 token"的地方，需要**两处配合**：

第 1 处，`main.ts` 的 `DocumentBuilder` 加 `.addBearerAuth()`：

```ts
const options = new DocumentBuilder()
  .setTitle('小满接口文档')
  .setVersion('1.0')
  .addBearerAuth() // 开启 Bearer 认证框
  .build();
```

第 2 处，需要鉴权的接口加 `@ApiBearerAuth()`：

```ts
@Get('admin')
@ApiBearerAuth() // 该接口显示小锁图标，请求会自动带上 Authorization 头
@Role(['admin'])
findAdmin() {}
```

填好 token 后点"Try it out"，浏览器发出的请求头里就会自动多出：

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

和守卫配合的完整链路就通了：**前端填 token → 请求头带 token → 中间件/守卫解出角色 → 守卫比对元数据 → 放行或 403**。

### 5.10 其他常用装饰器

| 装饰器 | 用途 |
| --- | --- |
| `@ApiHeader({ name, description })` | 描述自定义请求头（如 `X-Tenant-Id`） |
| `@ApiConsumes('multipart/form-data')` | 声明请求体类型（文件上传必用） |
| `@ApiProduces()` | 声明响应类型 |
| `@ApiExcludeEndpoint()` | 某个接口不在文档里显示（内部接口） |
| `@ApiHideProperty()` | 某个 DTO 字段不在文档里显示（如密码） |
| `@ApiExtraModels(Cls)` | 注册额外模型（泛型/嵌套类常需要） |
| `@ApiPropertyOptional()` | 非必填字段的简写 |

顺手记两个实用写法：

```ts
// 1. 内部调试接口不对外暴露
@Get('debug')
@ApiExcludeEndpoint() // 文档里看不到，但接口本身仍可访问
debug() {}

// 2. 敏感字段不显示在文档里
export class UserDto {
  @ApiProperty({ description: '密码' })
  @ApiHideProperty() // 但别指望这个隐藏响应，还要在返回时删掉字段
  password: string;
}
```

### 5.11 常见错误提示

| 报错原文 | 原因 | 解决 |
| --- | --- | --- |
| `Cannot find module '@nestjs/swagger'` | 依赖没装 | `npm install @nestjs/swagger swagger-ui-express` |
| 访问 `/api-docs` 404 | `SwaggerModule.setup()` 没调用，或路径与静态资源路由冲突 | 检查 `setup` 的第一个参数，改成 `/docs` 之类不冲突的路径 |
| 页面上请求体是空的 | DTO 写成了 `interface`，或 DTO 没在 Controller 的类型位置出现 | DTO 改 `class`；或加 `@ApiExtraModels()` + `@ApiBody({ type })` |
| 文档里字段没有类型 | 用了 `any` 或联合类型 `string \| number` | 在 `@ApiProperty({ type: String })` 里显式指定 |
| `@ApiBearerAuth` 加了但没有小锁 | `DocumentBuilder` 里漏了 `.addBearerAuth()` | 两处都要写 |
| `@ApiParam` 描述的参数和实际不符 | `name` 与 `@Param('id')` 名字不一致 | 保证完全一致 |
| 生产环境把接口文档暴露了 | `setup` 没做环境判断 | 只在非生产环境挂载（见下） |

生产环境关掉文档的写法：

```ts
// 仅当不是生产环境时才挂载接口文档
if (process.env.NODE_ENV !== 'production') {
  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('/api-docs', app, document);
}
```

---

## 六、本篇小结

| 要点 | 一句话说明 |
| --- | --- |
| 守卫是什么 | 决定"这个请求配不配被处理"的授权机制，实现 `CanActivate` 接口 |
| 执行顺序 | 中间件 → **守卫** → 拦截器 → 管道 → Controller |
| 守卫 vs 中间件 | 守卫能拿到 `getHandler()` / `getClass()`，所以能做"按接口"的精细授权 |
| 生成守卫 | `nest g gu guard/role`，会自动注册到模块 `providers` |
| `@Injectable()` 不能省 | 省了就拿不到 `Reflector` 等注入依赖 |
| 三种作用范围 | 方法级、控制器级、全局（`APP_GUARD`） |
| 全局守卫的坑 | `new RoleGuard()` 无法注入依赖，要用 `{ provide: APP_GUARD, useClass: RoleGuard }` |
| `return false` 的结果 | Nest 自动抛 `ForbiddenException`，HTTP 403 |
| 401 与 403 | 401 = 不知道你是谁；403 = 知道你是谁但不让你进 |
| 授权规则放哪里 | 不放守卫里，用 `@SetMetadata` 贴到方法上，守卫只负责"读 + 比对" |
| `Reflector` 来源 | `@nestjs/core`，不是 `@nestjs/common` |
| 推荐读取方法 | `getAllAndOverride(key, [handler, cls])`，方法级覆盖类级 |
| 空值保护必写 | 未标注接口时 `get` 返回 `undefined`，不判空直接 TypeError → 500 |
| 键名用常量 | `ROLE_KEY` 抽成常量，避免字符串写错导致"永远放行" |
| 自定义装饰器命令 | `nest g d decorator/role`，生成 `xxx.decorator.ts`，不进 `providers` |
| 元数据装饰器 | `SetMetadata()` + 工厂函数，如 `@Role('admin')` |
| 参数装饰器 | `createParamDecorator()`，可以造 `@User('id')`、`@ReqUrl()` |
| 参数装饰器的 `data` | 使用装饰器时括号里传的值，常用于"一个装饰器处理多个字段" |
| 组合装饰器 | `applyDecorators()` 把元数据 + 守卫 + 文档注解打包成一个 `@Auth('admin')` |
| Swagger 安装 | `npm install @nestjs/swagger swagger-ui-express` |
| 三步注册 | `DocumentBuilder().build()` → `createDocument()` → `setup('/api-docs', ...)` |
| `@ApiTags` | 给接口分组，解决"一页几十个接口找不到" |
| `@ApiOperation` | `summary` 是列表短标题，`description` 是详细说明 |
| 参数注解对应关系 | `@ApiParam`→路径、`@ApiQuery`→查询串、`@ApiBody`→请求体 |
| `@ApiProperty` 的前提 | DTO 必须是 `class`，`interface` 会被编译擦除 |
| 文件上传文档 | `@ApiConsumes('multipart/form-data')` + `@ApiBody` 手写 schema |
| `@ApiResponse` | 补充非 200 状态码的说明和返回结构 |
| `@ApiBearerAuth` | 需要两处：`DocumentBuilder.addBearerAuth()` + 接口上 `@ApiBearerAuth()` |
| 生产环境 | 用 `NODE_ENV` 判断，别把接口文档暴露到公网 |
*（内容由AI生成，仅供参考）*
