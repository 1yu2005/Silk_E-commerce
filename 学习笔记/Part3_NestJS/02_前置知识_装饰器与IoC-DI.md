# 前置知识：装饰器与 IoC / DI

> 学习日期：2026-11-05
> 素材来源：小满 NestJS 系列（blog.csdn.net/qq1195566313，专栏 ID 11844396）
> 本篇对应：原文第 2、3、4 章
> 适合人群：NestJS 零基础

正式写 NestJS 代码之前，有两门"前置知识"必须先过一遍，否则你会觉得框架在施魔法：

1. **IoC（控制反转）和 DI（依赖注入）**——为什么 NestJS 里从来不写 `new` 一个 Service？
2. **TypeScript 装饰器（Decorator）**——`@Controller()`、`@Get()` 这些带 @ 的写法到底是什么、凭什么能生效？

学完本篇，你会亲手用装饰器实现一个"发出 GET 请求"的小功能，彻底搞懂 NestJS 那些 @ 符号的来历。

---

## 一、IoC 控制反转与 DI 依赖注入

### 1.1 先用大白话理解

想象一家公司要招一个会修电脑的人：

- **传统做法（不用 IoC）**：需要修电脑时，员工自己去外面找人、自己谈价格、自己签合同。想换人？所有人都得重新找一遍。
- **IoC 做法**：公司设一个 HR 部门（==容器==），所有人需要什么服务就向 HR 申请，HR 统一提供。想换供应商？只改 HR 那边的名单，所有人照旧用。

代码里的情况一模一样：如果类 A 需要类 B，传统写法是在 A 内部 `new B()`，A 就被死死绑在 B 上了；换个实现、想测试、想复用都很难。==IoC 的思路是**把"创建对象"这件事交给一个统一的🍋‍🟩🍋‍🟩容器🍋‍🟩🍋‍🟩**，A 只负责"使用"==。

### 1.2 专业定义

==IoC是面向对象的一个设计原则/思想，降低代码之间的耦合度，最常见方法就是DI==

**IoC（Inversion of Control，控制反转）** 的具体定义是：

> 高层模块不应该依赖低层模块，二者都应该依赖其抽象；抽象不应该依赖细节；细节应该依赖抽象。

这句话拆开看：

| 表述 | 含义 |
| --- | --- |
| 高层模块不应该依赖低层模块 | 业务层不应该直接依赖具体的工具类实现 |
| 二者都应该依赖其抽象 | 双方都应该面向接口（抽象）编程 |
| 抽象不应该依赖细节 | 接口不关心具体怎么实现 |
| 细节应该依赖抽象 | 具体实现类去满足接口的约定 |

而**"反转"** 这个词，反转的是**控制权**：

| 对比项 | 传统写法 | IoC 写法 |
| --- | --- | --- |
| 谁创建对象 | 使用方自己 `new` | 容器创建 |
| 谁维护依赖关系 | 使用方自己维护 | 容器维护 |
| 换实现要改哪里 | 每个使用的地方都要改 | 只改容器里的注册 |
| 能否单独测试 | 困难（强耦合） | 容易（可替换成 mock） |

补充：在类中抽象的含义

> # 类里的抽象（abstract）
>
> 一句话：**抽象就是：只定义“要做什么”，不写“具体怎么做”；把规范定下来，交给子类去实现。**
>
> ## 两个东西：抽象类、抽象方法
>
> **抽象方法**：只有方法声明，**没有方法体**，没有实现逻辑。
>
> > 意思：继承我的子类，==**必须重写实现这个方法**==，不然报错。
>
> ```js
> abstract class Animal {
>   // 抽象方法：只规定要有speak这个方法，不写怎么叫
>   abstract speak(): void
> }
> ```
>
> 这里 `speak()` 就是抽象：**规定能力，不实现细节**
>
> **抽象类（加 abstract 的 class）**
>
> - 不能直接 new 实例化，只能用来被继承
> - 里面可以放普通方法（有实现）+ 抽象方法（无实现）
> - 作用：作为父类模板，统一规范一批子类必须具备的方法
>
> ```js
> abstract class Animal {
>   // 抽象方法：子类必须实现
>   abstract speak(): void
> 
>   // 普通方法，已经写好实现，子类直接继承用
>   run() {
>     console.log('动物奔跑')
>   }
> }
> 
> // 子类继承抽象类，必须实现所有抽象方法
> class Dog extends Animal {
>   speak() {
>     console.log('汪汪')
>   }
> }
> 
> class Cat extends Animal {
>   speak() {
>     console.log('喵喵')
> }
> 
> // ❌ 错误：抽象类不能直接 new
> // const a = new Animal()
> ```
>
> ## 核心含义（区分容易混淆的）
>
> - 封装：把数据和方法打包，隐藏内部细节，对外暴露接口
> - 继承：子类复用父类代码
> - **抽象：提炼共同的行为规范，约束子类必须实现某些功能**
> - 多态：同一个方法，不同子类有不同实现（抽象就是多态的基础）
>
> ## 结合NestJS帮你理解
>
> Nest里经常写抽象类，比如抽象的Repository、抽象服务：
>
> ```js
> abstract class UserRepository {
>   abstract findById(id: number): Promise<User>
> }
> ```
>
> 意思：不管你后面用MySQL、MongoDB实现这个仓库，**都必须要有 findById 这个方法**，定好契约。
>
> ## 
>
> 抽象是一种**契约/规范**：抽象类定义一批子类共同应该拥有的能力，抽象方法只声明签名，不写实现，强制子类去完成实现；抽象类不能实例化。
>
> 要不要我对比一下：抽象类 和 接口 interface 的区别？这个面试高频。



### 1.3 问题现场：未使用 IoC 的代码

先看一段"没用 IoC"的典型代码：

```ts
// 类 A：只负责持有一个名字
class A {
  name: string;
  constructor(name: string) {   // 构造方法，名字固定为 constructor，new 时自动执行
    this.name = name;
  }
}

// 类 B：需要用到 A
class B {
  age: number;
  entity: A;                        // B 依赖 A

  constructor(age: number) {
    this.age = age;
    this.entity = new A('小满');     // ⚠️ 问题在这里：B 内部直接 new A
  }
}

const c = new B(18);
console.log(c.entity.name);         // 小满
```

**问题在哪？**

1. **耦合度非常高**：B 的代码实现直接依赖 A，A 一改构造参数，B 立刻编译报错。
2. **维护成本上升**：两者业务逻辑复杂程度增加后，维护成本与代码可读性都会随之增加。
3. **难以扩展**：假如以后想改成"用 C 代替 A"，B 内部必须改；很难再多引入额外的模块进行功能拓展。

### 1.4 解决方式：引入 ==IoC 容器==

```ts
// 类 A
class A {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}

// 类 C：和 A 结构类似，用来演示"可以随时替换依赖"
class C {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}

// （这里就是一个极简的 IoC 容器），用于解耦  ⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐
class Container {
  private modules: Record<string, any>;

  constructor() {
    this.modules = {};                // 内部用一个⭐对象⭐保存所有注册过的实例
  }

  // 注册：把一个实例以 key 为名存进容器   🥸🥸🥸🥸🥸🥸🥸   
  provide(key: string, module: any) {
    this.modules[key] = module;
  }

  // 获取：按 key 从容器里取出实例
  get(key: string) {
    return this.modules[key];
  }
}

// 1. 先建容器，把需要的实例统统注册进去
const mo = new Container();
mo.provide('a', new A('小满1'));
mo.provide('c', new C('小满2'));

// 2. 使用方只认容器，不再自己 new  ⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐
class B {
  a: any;
  c: any;

  constructor(container: Container) {
    this.a = container.get('a');      // ✅ 从容器取，而不是 new A()  注意参数是 'a' 不是属性a
    this.c = container.get('c');      // ✅ 想换实现只改容器注册处
  }
}

new B(mo);
```

**本质**：==其实就是写了一个中间件（Container），来收集依赖，主要是为了**解耦**、减少维护成本==。使用方 B 从头到尾都不知道 A 的构造参数是什么，也不需要知道。

==提供者 ——> 中间件（容器）——>使用者   使用者直接从中间件中取需要的东西，而不用与提供者打交道==

### 1.5 DI 依赖注入

==**DI（Dependency Injection，依赖注入）** 和 IoC 其实是**同根生**，本质上就是同一个东西。==

之所以又起了个新名字，是因为 IoC 的概念比较含糊——它可能只被理解为"容器控制对象"这一个层面，很难让人想到"谁来维护对象之间的关系"。所以 2004 年大师级人物 **Martin Fowler** 给出了一个更具体的名字：**依赖注入（Dependency Injection）**。

它的核心表述很简单：**类 A 依赖类 B 的常规表现是在 A 中使用 B 的实例**，而==依赖注入把"拿到 B 的实例"这件事从 A 内部搬到了 A 外部。==

| 方式 | 谁来提供依赖 |
| --- | --- |
| 自己 `new` | A 自己 |
| 依赖注入 | ==外部（容器或调用方）通过参数等方式"注入"进来== |

**依赖注入的三种常见形式**：

```ts
class Logger {
  log(msg: string) {
    console.log(msg);
  }
}

// 形式一：构造器注入（Constructor Injection）—— NestJS 唯一支持的方式
class UserService1 {
  constructor(private logger: Logger) {}  // 由外部传进来
}

// 形式二：属性注入（Property Injection）
class UserService2 {
  logger!: Logger;                        // 由外部赋值
}

// 形式三：Setter 注入
class UserService3 {
  private logger!: Logger;
  setLogger(logger: Logger) {
    this.logger = logger;
  }
}
```

> **重要**：==NestJS 只支持**构造器注入**==。这就是为什么你在 NestJS 里看到的依赖永远写在 `constructor(...)` 的参数里。  🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩

### 1.6 IoC 与 DI 的关系

| 对比项 | IoC（控制反转） | DI（依赖注入） |
| --- | --- | --- |
| 定位 | 一种**设计原则 / 思想** | 一种**具体实现手段** |
| 关注点 | 谁控制对象的创建权 | 依赖以什么方式被提供 |
| 关系 | 上位概念 | IoC 的一种落地方式（最常用的一种） |
| 提出者 | 较早的软件设计理念 | Martin Fowler 于 2004 年命名 |

一句话：**IoC 是目的，DI 是手段**。

### 1.7 在 NestJS 里的落地预告

回到上一篇笔记里看到的那段代码，现在应该能看懂了：

```ts
// src/app.controller.ts
@Controller()
export class AppController {
  // 这一行就是依赖注入：不需要自己 new AppService()
  // 只要在构造器里声明，Nest 内部会自动实例化并注入
  constructor(private readonly appService: AppService) {}
}
```

```ts
// src/app.module.ts
@Module({
  providers: [AppService],   // 把 AppService 交给容器管理
})
export class AppModule {}
```

对应关系：

| 我们手写的极简容器 | NestJS 里的角色 |
| --- | --- |
| `class Container` | NestJS 内置的 IoC 容器（由 `NestFactory.create()` 创建） |
| `container.provide('a', ...)` | Module 里的 `providers: [AppService]` |
| `container.get('a')` | 构造器参数声明（Nest 自动完成 get + 注入） |

所以 NestJS 里的 Service 必须满足两个条件才能被注入：**① 用 `@Injectable()` 标记；② 在某个 Module 的 `providers` 里注册。**

---

## 二、TypeScript 装饰器基础

### 2.1 先用大白话理解

装饰器就像**快递箱上的标签**：箱子还是那个箱子，内容一个字没改，但贴了"易碎""加急"的标签后，快递员就会对它采取特殊处理。

代码里也一样：**装饰器==不修改类/方法本身的逻辑==，而是给它们==附加额外的"元信息"或行为==**。NestJS 之所以能靠 `@Controller('/user')` 就知道该把哪个 URL 交给哪个类处理，靠的就是这些标签。

### 2.2 专业定义

**装饰器（Decorator）** 是一种特殊的类型声明，它==可以附加在**类、方法、属性、参数**上面==。

它的语法是在目标前加 `@` 符号，紧跟一个函数（或返回函数的表达式）：

```ts
@装饰器
class 某个类 {}
```

**装饰器执行的时机非常关键**：它==在**类被定义时**就执行了，而不是在类被使用时==。这解释了后面那个"为什么没调用方法却发出了请求"的疑惑。

### 2.3 必须先开启 tsconfig 配置

`npm i -g ts-node`   用于 运行一个ts文件，例如：ts-node index.ts

装饰器在 TypeScript 里属于实验性特性，**不开启配置直接用会报错**。需要在项目的 `tsconfig.json` 的 `compilerOptions` 中开启：

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,     // 开启装饰器语法支持
    "emitDecoratorMetadata": true       // 编译时输出类型元数据（NestJS 依赖它做依赖注入）
  }
}
```

| 配置项 | 作用 | 不开会怎样 |
| --- | --- | --- |
| `experimentalDecorators` | 允许使用 `@` 装饰器语法 | 编译报错，装饰器完全不可用 |
| `emitDecoratorMetadata` | 把参数类型等信息写入元数据 | 语法能过，但 NestJS 无法推断构造器参数类型，依赖注入失效 |

> 用 `nest new` 创建的项目，这两项默认已经开启，不用手动改。如果你是在空目录里自己搭环境（就像本节的练习），就必须自己补上。

### 2.4 类装饰器（Class Decorator）

**写法**：`@装饰器` 直接加在 `class` 上方。

**参数**：装饰器函数会自动把 **class 的构造函数**作为第一个参数传入，参数名通常叫 `target`。

**能做什么**：通过 `target.prototype` 可以给这个类的所有实例自定义添加属性和方法。

```ts
// 类装饰器：给类动态添加一个 name 属性
function decorators(target: any) {
  target.prototype.name = '小满';      // target 就是 Xiaoman 这个构造函数
}

@decorators                            // 用 @ 应用装饰器
class Xiaoman {
  constructor() {}
}

const xiaoman: any = new Xiaoman();
console.log(xiaoman.name);             // 输出：小满
```

**运行结果**：`小满`

注意 `xiaoman` 类里根本没写 `name` 属性，它是由装饰器在原型上"贴"上去的。

| 参数位置 | 参数名 | 传入的是什么 |
| --- | --- | --- |
| 第 1 个 | `target` | 被装饰类的构造函数（constructor） |

### 2.5 属性装饰器（Property Decorator）

**写法**：`@装饰器` 加在类的**属性**上。

**参数**：会接收两个参数：

1. 原型对象（`target`）
2. 属性的名称（`key`）

```ts
// 属性装饰器：类型用 TS 内置的 PropertyDecorator
const currency: PropertyDecorator = (target: any, key: string | symbol) => {
  console.log(target, key);            // 打印原型对象和属性名
};

class Xiaoman {
  @currency                            // 装饰 name 这个属性
  public name: string;

  constructor() {
    this.name = '';
  }

  getName() {
    return this.name;
  }
}
```

**输出**：`Xiaoman {}`（原型对象）和 `name`（属性名）。

两个容易忽略的细节：

- 装饰**实例属性**时，`target` 是类的 `prototype`（所以打印出来是空对象形态）；
- 装饰**静态属性**时，`target` 是类的构造函数本身。

### 2.6 方法装饰器（Method Decorator）

**写法**：`@装饰器` 加在类的**方法**上。

**参数**：接收三个参数：

1. 原型对象（`target`）
2. 方法的名称（`key`）
3. 属性描述符（`descriptor`）

其中**属性描述符**是重点，它的常用字段：

| 字段 | 含义 | 对应可配置项 |
| --- | --- | --- |
| `value` | 方法本身的函数体 | 改它可以替换/包装原方法 |
| `writable` | 是否可写 | 可写对应 `writable` |
| `enumerable` | 是否可枚举 | 可枚举对应 `enumerable` |
| `configurable` | 是否可配置 | 可配置对应 `configurable` |

```ts
// 方法装饰器：类型用内置的 MethodDecorator
const currency: MethodDecorator = (
  target: any,
  key: string | symbol,
  descriptor: PropertyDescriptor,      // 第 3 个参数是属性描述符
) => {
  console.log(target, key, descriptor);
};

class Xiaoman {
  public name: string;

  constructor() {
    this.name = '';
  }

  @currency                            // 装饰 getName 方法
  getName(name: string, age: number) {
    return this.name;
  }
}
```

**输出**：原型对象、`'getName'`、一个描述符对象（其 `value` 就是 `getName` 这个函数）。

**方法装饰器是最有用的一类**，因为拿到 `descriptor.value` 就等于拿到了原方法，可以把它包装起来（加日志、加耗时统计、替换实现）。下面第三章就靠它来实现 GET 请求。

### 2.7 参数装饰器（Parameter Decorator）

**写法**：`@装饰器` 加在方法的**某个参数**前面。

**参数**：接收三个参数：

1. 原型对象（`target`）
2. 方法的名称（`key`）
3. 参数在参数列表中的位置（`index`，**从 0 开始**）

```ts
// 参数装饰器：类型用内置的 ParameterDecorator
const currency: ParameterDecorator = (
  target: any,
  key: string | symbol,
  index: number,                       // 第 3 个参数是参数下标，从 0 开始
) => {
  console.log(target, key, index);
};

class Xiaoman {
  public name: string;

  constructor() {
    this.name = '';
  }

  getName(name: string, @currency age: number) {   // age 是第 2 个参数
    return this.name;
  }
}
```

**输出**：原型对象、`'getName'`、`1`（因为 `age` 的下标是 1，`name` 是 0）。

**关键限制**：参数装饰器的**返回值会被忽略**，它通常只用来收集信息。NestJS 里 `@Body()`、`@Param()`、`@Query()` 就是参数装饰器，它们的职责是"标记这个参数该从请求的哪里取值"。

### 2.8 补充：访问器装饰器（Accessor Decorator）

TypeScript 官方定义的五类装饰器中，还有一类是**访问器装饰器**，用来装饰 `get` / `set` 访问器。它的参数和方法装饰器完全一致（`target`、`key`、`descriptor`）：

```ts
const logAccessor: MethodDecorator = (target, key, descriptor) => {
  console.log(`装饰了访问器：${String(key)}`);
};

class User {
  private _age = 0;

  @logAccessor
  get age() {
    return this._age;
  }

  set age(val: number) {
    this._age = val;
  }
}
```

**五类装饰器完整对照**： ⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐

| 类型 | 官方类型名 | 可加在 | 参数个数 | 参数含义 |
| --- | --- | --- | --- | --- |
| 类装饰器 | `ClassDecorator` | 类声明 | 1 | 构造函数 |
| 属性装饰器 | `PropertyDecorator` | 属性 | 2 | 原型对象、属性名 |
| 方法装饰器 | `MethodDecorator` | 方法 | 3 | 原型对象、方法名、属性描述符 |
| 访问器装饰器 | `MethodDecorator`（同方法） | `get` / `set` | 3 | 原型对象、访问器名、属性描述符 |
| 参数装饰器 | `ParameterDecorator` | 方法参数、构造器参数 | 3 | 原型对象、方法名、参数下标 |

### 2.9 多个装饰器叠加时的执行顺序

这条属于"知道就少踩坑"的进阶内容，规则有三条：

1. **装饰器表达式自上而下求值**：代码按从上到下的顺序依次计算出每个装饰器函数；
2. **装饰器函数自下而上执行**：真正应用时，最靠近目标的那个先生效；
3. **不同类型之间的应用顺序**：实例成员（方法参数 → 方法/属性）→ 静态成员 → 构造器参数 → 类装饰器。

记忆口诀：**"写得越靠上的越晚执行，类装饰器永远最后执行。"**

验证方式：在装饰器里加减 `console.log` 自己跑一遍，比死记结论更牢。

---

## 三、动手实战：用装饰器实现一个 GET 请求

现在把装饰器用起来。目标是：**不写任何路由、不启任何框架，仅靠一个方法装饰器，让类里的方法自动发起一次 HTTP 请求并把结果打印出来。**

这个练习的意义在于：NestJS 的 `@Get('/list')` 干的就是这件事，先把原理手搓一遍，再看框架就不会懵。

### 3.1 准备工作

```bash
# 安装 axios（用来发 HTTP 请求），-S 表示写入 dependencies
npm install axios -S
```

### 3.2 第一步：定义一个控制器类

先按 NestJS 的命名习惯，写一个空的 `Controller` 类，里面放一个准备被"增强"的方法：

```ts
// 定义控制器
class Controller {
  constructor() {}

  getList() {
    // 这里暂时什么都不写，后续由装饰器把数据"喂"进来
  }
}
```

### 3.3 第二步：定义装饰器工厂

这里有一个**必须理解的点**：为什么不能直接写 `@Get`，而必须写 `@Get('url')`？

因为装饰器默认会被塞入一些参数（`target`、`key`、`descriptor`）。如果我们想额外传入一个 URL，就必须用**装饰器工厂**——**先写一个函数接收自定义参数，再返回一个真正的装饰器函数**。

```
@Get('https://xxx')       ← Get('https://xxx') 是装饰器工厂，返回值才是装饰器
     └── 工厂调用 ──┘  └──── 返回的函数接收 target/key/descriptor ────┘
```

```ts
// 装饰器工厂：接收 url，返回一个方法装饰器
const Get = (url: string): MethodDecorator => {
  return (target, key, descriptor: PropertyDescriptor) => {
    const fnc = descriptor.value;        // 拿到被装饰方法的原始函数

    // 发起 GET 请求，成功时回调原方法
    axios
      .get(url)
      .then((res) => {
        fnc(res, { status: 200 });       // 把响应数据和状态码当作参数传给原方法
      })
      .catch((e) => {
        fnc(e, { status: 500 });         // 失败时把错误传进去
      });
  };
};
```

**这段代码的三个关键动作**：

| 动作 | 代码 | 含义 |
| --- | --- | --- |
| 取原函数 | `const fnc = descriptor.value` | 属性描述符里的 `value` 就是被装饰的方法本体 |
| 发起请求 | `axios.get(url)` | 请求在**装饰器执行时**就发出去了 |
| 反向调用原函数 | `fnc(res, { status: 200 })` | 通过 `descriptor` 描述符里的 `value`，把 axios 的结果"喂"回给使用装饰器的那个函数 |

### 3.4 第三步：完整可运行代码

```ts
// index.ts（练习文件，需在开启 experimentalDecorators 的 TS 环境运行）
import axios from 'axios';

// ====== 装饰器工厂：把 GET 请求封装成一个装饰器 ======
const Get = (url: string): MethodDecorator => {
  return (target, key, descriptor: PropertyDescriptor) => {
    const fnc = descriptor.value;        // 原始方法（getList）
    axios
      .get(url)
      .then((res) => {
        fnc(res, { status: 200 });       // 成功：响应数据 + 状态码
      })
      .catch((e) => {
        fnc(e, { status: 500 });         // 失败：错误对象 + 状态码
      });
  };
};

// ====== 定义控制器 ======
class Controller {
  constructor() {}

  // 使用装饰器，并传入一个允许跨域、可直接访问的测试接口
  @Get('https://api.apiopen.top/api/getHaoKanVideo?page=0&size=10')
  getList(res: any, status: any) {
    // 这里的两个参数由装饰器传入，不是自己调用的
    console.log(res.data.result.list, status);
  }
}
```

**运行方式**：保存后直接 ts-node 运行（或编译成 js 后用 node 运行），终端会打印出接口返回的视频列表和 `{ status: 200 }`。

**注意观察一件事**：整段代码从头到尾**没有 `new Controller()`，也没有调用 `getList()`**，但 `console.log` 却执行了。

原因就是前面说的==执行时机——**装饰器在类被定义时就已经执行了**==，`axios.get(url)` 在这一刻就发出了请求，请求回来后反过来调用了 `getList`。这就是装饰器的"声明即执行"特性。

### 3.5 执行流程拆解

```
1. 定义 class Controller 时
        ↓
2. 遇到 @Get('https://...')
   → 先执行 Get('https://...')，得到一个装饰器函数
        ↓
3. 装饰器函数立即被调用，收到 (target, key, descriptor)
   → fnc = descriptor.value（即 getList 函数体）
   → axios.get(url) 开始发请求
        ↓
4. 请求成功 → 调用 fnc(res, { status: 200 })
   → 打印 res.data.result.list 和状态码
```

| 阶段 | 发生了什么 | 谁触发的 |
| --- | --- | --- |
| 装饰器工厂调用 | 接收 url，返回真正的装饰器 | TypeScript 编译后的运行时代码 |
| 装饰器执行 | 取到原函数、发出 HTTP 请求 | 类定义完成时自动触发 |
| 回调执行 | 原方法被调用，打印结果 | axios 的 Promise 回调 |

### 3.6 这个手搓方案的局限

理解了原理，也要看清它和真实框架的差距：

| 局限 | 说明 | NestJS 怎么解决 |
| --- | --- | --- |
| 只能"发出去"，没法"接回来" | 请求结果只能打印，无法作为 HTTP 接口的响应返回给前端 | 控制器方法直接 `return`，由框架序列化成响应 |
| 没有路由 | URL 是写死的远程地址，不是自己服务的路径 | `@Controller('/user')` + `@Get('/list')` 定义路由 |
| 无参数校验 | 传进来什么就是什么 | Pipe + DTO（后续章节） |
| 无统一错误处理 | 只能在 `.catch` 里手动处理 | 异常过滤器（Exception Filter） |
| 没有分层复用 | 逻辑全挤在装饰器里 | Controller / Service / Module 分层 |

所以这个练习的定位很清晰：**它让你看懂 `@Get` 的底层机制，但真正的工程化能力由 NestJS 提供。**

---

## 四、常见错误与排查

| 报错原文 / 现象 | 原因 | 解决 |
| --- | --- | --- |
| `error TS1219: Experimental support for decorators is a feature that is subject to change and may change in a future release.` | 没在 `tsconfig.json` 里开启 `experimentalDecorators` | 加上 `"experimentalDecorators": true` |
| `error TS1206: Decorators are not valid here.` | 装饰器用在了不支持的位置（比如普通函数体内部、语句中间） | 装饰器只能加在类、属性、方法/访问器、参数、`class` 声明上 |
| `error TS1240: Unable to resolve signature of property decorator when called as an expression.` | 装饰器函数的参数签名不对（参数个数或类型不匹配） | 严格按照「属性 2 个参数、方法 3 个参数、参数 3 个参数」定义；或直接使用内置类型 `PropertyDecorator` / `MethodDecorator` / `ParameterDecorator` 标注 |
| `TypeError: Cannot read properties of undefined (reading 'value')` | 装饰器**不是工厂**，被 TS 直接当成装饰器执行，导致 `descriptor` 取到 undefined | 需要传参的装饰器一定要写成「返回函数的函数」：`const Get = (url) => (target, key, descriptor) => {}`，使用时写 `@Get('url')` |
| `@Get` 后面忘了写括号，写成 `@Get` | 工厂函数没有被调用，参数整体错位 | 工厂装饰器必须带括号调用：`@Get('https://...')` |
| `Nest can't resolve dependencies of the AppController (?). Please make sure that the argument AppService at index [0] is available in the AppModule context.` | 依赖注入失败：构造器里声明的服务没有在模块的 `providers` 里注册（或没加 `@Injectable()`） | 把该 Service 加入所属 Module 的 `providers` 数组；确认 Service 上有 `@Injectable()` 装饰器 |
| `npm ERR! code ERESOLVE`（安装 axios 时） | npm 7+ 的 peer 依赖严格校验 | 升级相关依赖；临时方案 `npm install axios -S --legacy-peer-deps` |
| 装饰器里写的 `console.log` 打印了两次 | 装饰器表达式在类定义时求值一次、装饰器函数应用时又执行一次，两处都写了打印 | 检查是否在工厂和返回的函数里都放了 log，属正常现象 |

---

## 五、本篇小结

| 要点 | 一句话说明 |
| --- | --- |
| IoC 的定义 | 高层模块不依赖低层模块，二者都依赖抽象；抽象不依赖细节，细节依赖抽象 |
| IoC 的核心动作 | 把「创建对象」的控制权从使用方反转给容器 |
| 不用 IoC 的后果 | 类之间强耦合，维护成本高、可读性差、难以扩展和测试 |
| 容器的本质 | 一个提供 `provide`（注册）和 `get`（获取）的中间件，用来收集依赖 |
| DI 的由来 | 与 IoC 同根生，因 IoC 概念含糊，2004 年 Martin Fowler 命名为「依赖注入」 |
| DI 的核心表述 | 类 A 依赖类 B，不再在 A 内部 `new B()`，而是由外部把 B 传进来 |
| 注入方式 | 构造器注入、属性注入、Setter 注入；NestJS **只支持构造器注入** |
| IoC 与 DI 的关系 | IoC 是设计原则，DI 是实现手段 |
| 装饰器的定义 | 一种特殊的类型声明，可附加在类、方法、属性、参数上 |
| 必须开启的配置 | `experimentalDecorators: true` + `emitDecoratorMetadata: true` |
| 类装饰器 | 1 个参数：构造函数；可通过 `prototype` 给实例加属性方法 |
| 属性装饰器 | 2 个参数：原型对象、属性名 |
| 方法装饰器 | 3 个参数：原型对象、方法名、属性描述符（含 `value`/`writable`/`enumerable`/`configurable`） |
| 访问器装饰器 | 与方法装饰器同签名，装饰 `get` / `set` |
| 参数装饰器 | 3 个参数：原型对象、方法名、参数下标（从 0 开始）；返回值被忽略 |
| 执行顺序 | 表达式自上而下求值，函数自下而上执行；类装饰器永远最后执行 |
| 装饰器工厂的必要性 | 需要传自定义参数时必须用「返回函数的函数」，使用时带括号 `@Xxx(params)` |
| 实战 GET 请求的关键 | `descriptor.value` 拿到原方法，`axios` 请求完成后用 `fnc(结果, 状态)` 反向调用 |
| 执行时机 | 装饰器在**类定义时**就执行，所以不写 `new` 和手动调用也会触发 |
| 落地到 NestJS | Module 对应容器注册，构造器参数对应容器取值，Service 需 `@Injectable()` + `providers` 注册 |
|||
