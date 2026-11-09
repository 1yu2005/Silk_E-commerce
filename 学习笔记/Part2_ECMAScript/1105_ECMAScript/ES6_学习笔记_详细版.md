# 前置内容

- ECMA：  

  **ECMA**(European Computer Manufacturers Association)中文名称为**欧洲计算机制造商协会**,这个**组织**的目标是评估、开发和认可电信和计算机标准。1994年后该组织改名为Ecma国际。

- ECMAScript：

  **ECMAScript** 是由Ecma 国际通过ECMA-262 标准化的**脚本程序设计语言**。 ECMA-262 这个标准由委员会TC39每年都在维护，并且每年都会产生一个新版本，因此有ES6（2015年6月）、ES7（2016年）、……ES16（2025年6月）

> 可以这样准确表述：
>
> > **ECMAScript** 是一种**由标准定义**的**脚本编程语言规范**。 **ECMA-262** 是定义 ECMAScript 的正式标准文档，由 Ecma International 维护。==随着 ECMA-262 持续发布新版本，ECMAScript 也不断演进，形成了 **ES5、ES6（ES2015）、ES2016、ES2017……ESxx** 等不同版本==。 **JavaScript** 是 ECMAScript 最广泛使用的实现；浏览器和 Node.js 都通过 JavaScript 引擎实现并运行 ECMAScript 标准规定的语法和功能。
>
> 它们的关系可以概括为：
>
> ```
> ECMA-262
>    └─ 定义 ECMAScript 语言规范
>         ├─ ES5
>         ├─ ES6 / ES2015
>         ├─ ES2016（也常称 ES7）
>         ├─ ES2017（也常称 ES8）
>         └─ ESxx（泛指后续版本）
>              └─ JavaScript 在浏览器、Node.js 等运行环境中实现和使用这些规范
> ```
>
> 补充两点：
>
> - `ES6` 与 `ES2015` 是同一个版本。自 2015 年起，标准通常按年份发布，因此更推荐说 `ES2015`、`ES2020` 等，而非 `ES7`、`ES8`。
> - JavaScript 除了 ECMAScript 规定的语言能力，还会结合运行环境提供额外 API。例如浏览器提供 `document`、`window`，Node.js 提供 `fs`、`http` 等；这些 API 不属于 ECMAScript 标准本身。
>
> 
>
> 更严谨地说，**ECMAScript 是==一门编程语言的标准规范==**，而不是像 JavaScript 那样的具体运行时实现。
>
> 不过日常交流中，==**也常把 ECMAScript 称为“一门脚本语言”，因为该规范确实完整定义了语言本身的核心内容**==，例如：
>
> ```
> let count = 1
> const add = (a, b) => a + b
> 
> class User {
>   constructor(name) {
>     this.name = name
>   }
> }
> ```
>
> 而==真正执行这些代码的是具体实现==，例如：
>
> - 浏览器中的 JavaScript==引擎==：V8、SpiderMonkey、JavaScriptCore
> - Node.js：主要使用 V8 引擎
>
> 可以这样区分：==🥸🥸🥸🥸🥸🥸🥸🥸🥸🥸🥸🥸🥸🥸🥸🥸🥸🥸🥸🥸🥸🥸🥸🥸🥸🥸🥸🥸🥸🥸🥸🥸🥸🥸🥸==
>
> ```
> ECMAScript：规定 JavaScript 核心语法和行为的语言🥸🥸标准🥸🥸
> JavaScript：对 ECMAScript 的实现，并结合运行环境提供额外 API
> Node.js / 浏览器：提供 JavaScript 的🥸🥸运行环境🥸🥸  
> V8：负责解析、编译和执行 JavaScript 的🥸🥸引擎🥸🥸
> 
> 补充：运行环境=引擎+API(内置、自定义、第三方包)+事件循环/任务调度等基础设施  ⭐⭐⭐⭐⭐
> ```
>
> 所以，把 **ECMAScript 说成“JavaScript 的标准规范”最准确；把它说成“一门脚本语言”也不算错，只是没有强调它作为标准的角色。**
>
>  
>
> ==**补充：API分类** 🥸🥸🥸🥸🥸🥸🥸==
>
> 1. **ECMAScript 内置API（语言本身）** Array、Promise、Symbol、Math、JSON 等，V8引擎实现，浏览器、Node都自带。
> 2. **运行环境原生API（环境自带）** 浏览器：DOM、BOM、fetch、setTimeout Node：fs、path、http、process 由浏览器内核 / Node 的libuv等底层提供，不属于ES规范。
> 3. **自定义API（自己封装）** 你自己写函数、类、模块，对外暴露方法，就是你自己的API。 比如你封装一个 `getUserInfo()`，其他代码调用它，这就是自定义API。
>
> ```js
> // 自定义API
> function getUserInfo(id) {
>   return { id, name: "xxx" }
> }
> export { getUserInfo }
> ```
>
>   4.**第三方API（npm包）** 别人写好发布到npm，你安装后引入使用。 比如 axios、lodash、mongoose、   nestjs 这些。 <u>本质上也是别人写好的**自定义代码封装**，只是打包上传到npm仓库共享。</u>
>
> > 注意：npm包只是JS代码封装，底层最终还是依赖上面两类：ES内置API + 运行环境API（fs、http等）
>
> ------
>
> ### 一条完整链路总结
>
> ECMAScript标准 → V8引擎实现语言能力 → 运行环境（浏览器/Node）挂载环境API → 你可以==基于上面==这些，写自己的自定义API → 别人写好的自定义API打包上传npm，就是第三方npm包API
>
> ### 一个小区分点
>
> 还有一种容易混的：**后端对外的接口（HTTP接口，也常叫API）**，比如 `/api/login`，这是网络接口，和上面JS代码层面的API不是同一个东西。
>
> 简单一句话： ==ES和运行环境是地基；自定义API、npm第三方包，是在地基之上盖出来的房子==。
>
> 一个极简层级图
>
> ```
> ┌─────────────────────────────────────────────────────────┐
> │  业务层：自定义API（自己封装函数/类/模块）、第三方npm包API │
> └───────────────────────┬─────────────────────────────────┘
>                         │ 依赖下面两层能力
> ┌───────────────────────▼─────────────────────────────────┐
> │  运行环境层（浏览器 / Node.js）                          │
> │  包含：V8引擎 + 环境原生API + 事件循环、任务调度等基础设施 │
> │  ✅ 浏览器环境API：DOM、BOM、fetch、setTimeout            │
> │  ✅ Node环境API：fs、path、http、process                  │
> └───────────────────────┬─────────────────────────────────┘
>                         │ 引擎实现ES标准
> ┌───────────────────────▼─────────────────────────────────┐
> │  ECMAScript（JS语言标准）                                │
> │  ✅ 语法规则 + 语言内置API（Array、Promise、Symbol、Math） │
> └─────────────────────────────────────────────────────────┘
> ```

> ### 补充说明
>
> 1. 底层：**ECMAScript 只是纸面规范，V8 引擎负责把它实现出来**
> 2. 运行环境 = V8 引擎 + 环境独有的 API + 调度机制；V8 裸跑是没有 DOM、fs 的
> 3. 上层的自定义 API、npm 第三方包，全部是基于底层这两套 API 来写的，属于应用封装
> 4. 额外区分：HTTP 接口（后端 `/api/login`）是网络接口，不属于 JS 语言里的 API，是另外一回事

# ES6 新手学习笔记

> ES6（ECMAScript 2015），从基础语法到异步与工程化逐步递进。

## 写在前面

### 这份笔记怎么用

1. **按顺序读**：15 章是按"知识依赖 + 难度"排的。第 2–7 章是每天都要用的语法，务必先吃透；第 8–10 章（Symbol / 迭代器 / Promise）是理解现代框架源码的门槛；第 11–14 章偏应用与工程化。
2. **对着代码看**：每个知识点都配了可直接运行的示例，代码后面的注释标明了输出结果。遇到不懂的，直接把代码贴进浏览器 Console 跑一遍。
3. **踩一遍坑**：每章末尾都有"易错点"或"常见坑"表格，里面都是真实会报错或得到错误结果的写法。看懂报错信息比背语法有用。
4. **自测**：第 15 章有 15 道自测题和一份特性速查表，复习时从那里过一遍。

### 版本范围说明

本笔记**只覆盖 ES6（ES2015）**。课件里会出现少量 ES6 之后才有的写法（如对象的 `...` 展开、`Object.values`），正文在必要处**明确标注真实版本**，并统一汇总在第 15.2 节的"版本边界清单"里，避免把版本记错。一句话概括边界：**ES6 是地基（新语法、新数据结构、新编程范式），ES2016 之后基本是加方法、加语法糖**——唯一例外是 ES2017 的 `async/await`，它把 ES6 的 Promise 与生成器思路固化成了语法。

### 目录

- [1. ES6 概述与运行环境](#1-es6-概述与运行环境)
- [2. 变量声明：let 与 const](#2-变量声明let-与-const)
- [3. 变量的解构赋值](#3-变量的解构赋值)
- [4. 模板字符串](#4-模板字符串)
- [5. 对象与函数的书写简化](#5-对象与函数的书写简化)
- [6. 箭头函数](#6-箭头函数)
- [7. rest 参数与 spread 扩展运算符](#7-rest-参数与-spread-扩展运算符)
- [8. Symbol](#8-symbol)
- [9. 迭代器与生成器](#9-迭代器与生成器)
- [10. Promise 与异步编程](#10-promise-与异步编程)
- [11. Set 与 Map](#11-set-与-map)
- [12. class 类与继承](#12-class-类与继承)
- [13. 数值扩展与对象方法扩展](#13-数值扩展与对象方法扩展)
- [14. 模块化](#14-模块化)
- [15. 知识点总表与自测](#15-知识点总表与自测)

---

## 1. ES6 概述与运行环境

### 1.1 先分清三个名词：ECMA、ECMAScript、ECMA-262

初学 ES6 时最容易卡在名词上，先把关系理顺：

| 名词 | 含义 | 记忆要点 |
| --- | --- | --- |
| ECMA | European Computer Manufacturers Association，欧洲计算机制造商协会，1994 年后改称 Ecma 国际 | 一个**标准化组织** |
| ECMAScript | 由 Ecma 国际通过 ECMA-262 标准化的**脚本程序设计语言** | 一门语言的**规范** |
| ECMA-262 | 标准编号，只是 Ecma 众多标准中的一个 | 一份**标准文档** |
| JavaScript | ECMAScript 最广泛使用的**实现** | 真正跑起来的语言 |

可以用一句话概括：**ECMA-262 定义了 ECMAScript 规范，JavaScript 是这套规范的实现**。除了规范定义的语法，JavaScript 在不同运行环境里还会获得额外能力——浏览器给 `window`、`document`，Node.js 给 `fs`、`http`，这些都不属于 ECMAScript 标准本身。

推进 ECMAScript 演进的技术委员会叫 **TC39**（Technical Committee 39），成员以浏览器厂商（苹果、谷歌、微软、英特尔等）为主，定期开会评审新提案。

### 1.2 ECMA-262 版本演进与 ES6 的位置

| 版本 | 年份 | 主要变化 |
| --- | --- | --- |
| 第 1 版 | 1997 | 语言基本语法 |
| 第 2 版 | 1998 | 较小改动 |
| 第 3 版 | 1999 | 正则、异常处理、格式化输出，IE 开始支持 |
| 第 4 版 | 2007 | 过于激进，未发布 |
| 第 5 版 | 2009 | 严格模式、JSON，扩展对象/数组/原型/字符串/日期方法 |
| **第 6 版（ES6）** | **2015** | **模块化、面向对象语法、Promise、箭头函数、let/const、解构赋值等** |
| 第 7 版 | 2016 | 幂运算符 `**`、`Array.prototype.includes` |
| 第 8 版 | 2017 | `async/await` 正式可用、`Object.values` / `Object.entries`、字符串扩展 |

几条必须记住的结论：

1. **ES6 与 ES2015 是同一个版本**。自 2015 年起每年发布一版，规范上更推荐用年份命名（ES2015、ES2020），日常口语里仍常用 ES6、ES7 这种"年份末位 + 1"的旧叫法。
2. **版本号比年份末位大 1**：2015 → ES6，2016 → ES7，依此类推。
3. **ES.next** 是动态指向下一个版本的写法，`ES.next = 最新版本 + 1`。
4. ES6 是**变化最大的一版**，具有里程碑意义：后续版本基本是在 ES6 打好的地基上做增量，所以把 ES6 吃透，后面的 ES2016+ 大多是"加一两个方法"的量级。

兼容性可查 <http://kangax.github.io/compat-table/es6/>。现代浏览器（Chrome / Edge 等）对 ES6 的支持已经完整，学习阶段无需过多担心兼容问题。

### 1.3 为什么要学 ES6

- **内容最多、变化最大**：箭头函数、类、模块、Promise 都是现代前端工程的地基。
- **写起来更简单**：模板字符串替掉 `+` 拼接，解构赋值替掉连续取值，箭头函数省掉 `_this` 备份。
- **岗位必备**：Vue、React、Node.js 的官方文档与源码默认使用 ES6 语法，不学就看不懂别人的代码。

### 1.4 本文的范围说明

课件《尚硅谷前端_ES6》实际覆盖 ES6 到 ES11，但本笔记**只讲 ES6（ES2015）自身的语法**。凡是属于后续版本的内容，正文不写，仅在表格里标注版本归属，例如：

| 特性 | 真实版本 | 处理方式 |
| --- | --- | --- |
| 对象 rest/spread（`const {a, ...rest} = obj`） | ES2018 | 不写入正文 |
| `async/await` | ES2017 | 不写入正文 |
| `Object.values` / `Object.entries` | ES2017 | 不写入正文 |
| `Array.prototype.includes` | ES2016 | 不写入正文 |
| `Promise.prototype.finally` | ES2018 | 不写入正文 |

> 唯一的例外是**对象展开运算符** `{...a, ...b}`：课件把它放在 ES6 的 spread 一节里讲，本文会在第 7 章作为"延伸"标注说明，并明确指出它实际属于 ES2018。

### 1.5 示例代码怎么跑起来

课件代码全部是 `.html` 内嵌 `<script>` 的形式，可以直接双击用浏览器打开，也可以在开发者工具的 Console 里逐段贴入执行。三种常用运行方式：

**方式一：浏览器 Console（最快）**

按 `F12` 打开开发者工具 → Console → 贴代码 → 回车。适合验证一行语法，比如：

```js
let s = Symbol('尚硅谷');
typeof s; // 'symbol'
```

**方式二：HTML 文件（课件用的方式）**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>let 练习</title>
</head>
<body>
  <script>
    let a = 1;
    console.log(a); // 1
  </script>
</body>
</html>
```

**方式三：模块化示例必须用 http 打开**

第 14 章的 `import/export` 不能直接双击 html 运行，必须通过本地服务器（如 VS Code 的 Live Server 插件）访问，原因是浏览器的模块加载受同源策略限制，`file://` 协议下会报 CORS 错误。

> 顺带一提，课件 `ES6_module/.vscode/settings.json` 里把 Live Server 端口设为 5501，就是为了避开端口冲突。

### 1.6 学习路线图

按下面的顺序学，后一章依赖前一章，不要跳：

| 阶段 | 章节 | 难度 | 核心能力 |
| --- | --- | --- | --- |
| 语法基础 | 2 变量声明、3 解构赋值、4 模板字符串 | ★ | 写出更清晰的赋值与拼接 |
| 书写简化 | 5 对象与函数简化、6 箭头函数、7 rest/spread | ★★ | 少写重复代码，理解 `this` |
| 数据结构 | 8 Symbol、9 迭代器与生成器、11 Set/Map | ★★★ | 读懂 `for...of` 的底层 |
| 异步与面向对象 | 10 Promise、12 class | ★★★★ | 处理异步、组织对象模型 |
| 工程化 | 13 扩展方法、14 模块化 | ★★★ | 拆文件、组项目 |

### 1.7 本章小结

- ECMA 是组织，ECMA-262 是标准，ECMAScript 是规范，JavaScript 是实现。
- ES6 = ES2015，是变化最大的一版，本文只讲这一版。
- 示例可在浏览器 Console 或 html 文件里跑；涉及 `import/export` 的必须走 http 服务。

---

## 2. 变量声明：let 与 const



### 2.1 先看 var 留下的三个坑

ES6 之前只有 `var`，它有三个被诟病已久的行为：

```js
// 坑 1：变量提升，声明前就能访问，值是 undefined
console.log(song); // undefined（不报错）
var song = '恋爱达人';

// 坑 2：没有块级作用域，if/for 里声明的变量会"泄漏"到外面
if (true) {
  var girl = '周扬青';
}
console.log(girl); // '周扬青'，居然能访问

// 坑 3：同一作用域可以重复声明，后者覆盖前者且不报错
var star = '罗志祥';
var star = '小猪';
```

`let` 和 `const` 就是针对这三点做的修正。



### 2.2 ==let==：==块级==作用域的==变量==

`let` 用于声明**可以被重新赋值**的变量。

```js
// 声明方式：可以先声明后赋值
let a;
let b, c, d;
let e = 100;
let f = 521, g = 'iloveyou', h = [];
```

四条特性，逐条验证：

**① ==不允许重复声明==**

```js
let star = '罗志祥';
let star = '小猪'; // SyntaxError: Identifier 'star' has already been declared
```

**② ==块级==作用域**

`{}`、`if`、`else`、`for`、`while` 都会形成块级作用域，`let` 声明的变量只在块内有效。

```js
{
  let school = '尚硅谷';
  console.log(school); // 尚硅谷
}
console.log(school); // ReferenceError: school is not defined
```

**③ 不存在变量提升（暂时性死区 TDZ）**

```js
console.log(song); // ReferenceError: Cannot access 'song' before initialization
let song = '恋爱达人';
```

从进入作用域到 `let` 声明执行完之前，这段区间叫**暂时性死区（Temporal Dead Zone）**，访问会直接抛错，而不是像 `var` 那样给个 `undefined`。这与"变量提升后值为 undefined"有本质区别：**报错比静默给错值更安全**。

```js
// TDZ 的另一种表现：typeof 也不再安全
typeof undeclaredVar; // 'undefined'（从未声明过的变量，typeof 不报错）
typeof song;          // ReferenceError（已声明但还在 TDZ 中）
let song = '恋爱达人';
```

**④ 不影响作用域链**

块里的 `let` 变量，对块内的函数依然可见，作用域链查找逻辑不变：

```js
{
  let school = '尚硅谷';
  function fn() {
    console.log(school); // 尚硅谷：沿着作用域链向上找到块作用域里的 school
  }
  fn();
}
```



### 2.3 经典案例：为什么循环绑定事件要用 let

课件 `let-实践案例.html` 的例子：三个 `div`，点击哪个就变粉。

```html
<style>
  .item { width: 100px; height: 50px; border: solid 1px rgb(42, 156, 156); float: left; margin-right: 10px; }
</style>

<div class="item"></div>
<div class="item"></div>
<div class="item"></div>

<script>
  let items = document.getElementsByClassName('item');

  for (let i = 0; i < items.length; i++) {
    items[i].onclick = function () {
      items[i].style.background = 'pink';
    };
  }
</script>
```

效果：点第 1 个变粉，点第 2 个变粉，互不干扰。

如果把 `let i` 换成 `var i`，三个回调拿到的是**同一个** `i`——循环结束时 `i === 3`，`items[3]` 是 `undefined`，点击时会报 `Cannot read properties of undefined`。

原因在于 `let` 在 `for` 循环中**每轮迭代都会创建一个新的绑定**，回调函数各自捕获自己那一轮的 `i`。这是 ES6 最实用的一处改善，也是面试高频题。

> 顺便提一个写法细节：这里的回调其实也可以用 `this` 代替 `items[i]`，因为普通函数作为事件回调时 `this` 指向触发事件的元素。但**不能用箭头函数**，箭头函数的 `this` 是静态的，会指向外层作用域（详见第 6 章）。

### 2.4 ==const==：声明==常量==

`const` 用于声明**不允许再指向其他值**的变量。五条特性： ⭐

```js
// ① 声明必须⭐赋初始值⭐
const A; // SyntaxError: Missing initializer in const declaration

// ② 标识符⭐一般大写⭐（团队约定，非强制）
const SCHOOL = '尚硅谷';

// ③ 不允许重复声明
const SCHOOL = 'ATGUIGU'; // SyntaxError

// ④ 值不允许修改
SCHOOL = 'ATGUIGU'; // TypeError: Assignment to constant variable

// ⑤ ⭐块级⭐作用域
{
  const PLAYER = 'UZI';
}
console.log(PLAYER); // ReferenceError
```

**最容易被误解的一点：对象和数组"还能改"**

即 ==用const声明对象或者数组时，里面的值是能更改的，因为并没有改变 变量指向的地址，只是这个地址所指向的内容发生了变化==

```js
const TEAM = ['UZI', 'MXLG', 'Ming', 'Letme'];
TEAM.push('Meiko');    // 合法！  
TEAM[0] = 'JackeyLove'; // 合法！
console.log(TEAM.length); // 5

const CONFIG = { host: 'localhost', port: 3306 };
CONFIG.port = 3307;    // 合法！

TEAM = ['new'];        // TypeError：不允许换一个数组
```

原因：`const` ==锁的是**变量与值之间的绑定关系**（栈内存里的**地址**）==，而不是**值内部的内容**（堆内存里的数据）。数组元素和对象属性属于堆内存内容，地址不变，改它们不算"改变绑定"。

==如果确实需要连内容都锁死，可以用 `Object.freeze()`（注意是浅冻结）==：

```js
const CONFIG = Object.freeze({ host: 'localhost', port: 3306 });
CONFIG.port = 3307;    // 严格模式下抛 TypeError，非严格模式静默失败
console.log(CONFIG.port); // 3306
```

### 2.5 let、const、var 对比

| 对比项 | var | let | const |
| --- | --- | --- | --- |
| 作用域 | 函数作用域 | 块级作用域 | 块级作用域 |
| 变量提升 | 有，值为 `undefined` | 有声明但处于 TDZ，访问报错 | 同 let |
| 重复声明 | 允许 | 报错 | 报错 |
| **必须初始化** | 否 | 否 | 是 |
| **能否重新赋值** | 能 | 能 | 不能（对象内容可改） |
| 挂到 `window` 上 | 是（全局时） | 否 | 否 |
| 典型用途 | 兼容老代码 | 需要变化的**变量** | **常量**、对象、数组、函数引用 |

最后一行值得单独说明，它解释了为什么 `for (var i...)` 里的 `i` 会污染全局：

```js
var x = 1;
console.log(window.x); // 1
let y = 2;
console.log(window.y); // undefined
```

### 2.6 实践建议

1. ==**默认用 `const`**，只有确实需要重新赋值时才改成 `let`==。这个习惯能大幅减少"变量被谁改过"的排查成本。
2. **基本不使用 `var`**，除非维护老代码。
3. ==声明对象/数组/函数引用时优先 `const`——因为改内容不算重新赋值==，日常开发中几乎不需要换引用。
4. 常量名全大写是约定，如 `const MAX_SIZE = 100;`、`const BASE_URL = '/api';`。

### 2.7 本章小结

- `let`：块级作用域、不可重复声明、无变量提升（TDZ）、不影响作用域链。
- `const`：必须初始化、不可重新赋值、块级作用域，但对象属性与数组元素可以改。
- `for` + `let` 每轮一个新绑定，是替代 `var` 闭包问题的标准写法。
- 日常三原则：默认 `const`、必要时 `let`、基本不用 `var`。

---



## 3. 变量的解构赋值

### 3.1 什么是解构

ES6 允许==**按照一定模式，从数组或对象中提取值，对变量进行赋值**，这个过程叫解构赋值（Destructuring）==。

传统写法要一行一个：

```js
const arr = ['张学友', '刘德华', '黎明', '郭富城'];
// 老写法
let zhang = arr[0];
let liu = arr[1];
let li = arr[2];
let guo = arr[3];
```

解构写法一行搞定：

```js
let [zhang, liu, li, guo] = arr;
console.log(zhang, liu, li, guo); // 张学友 刘德华 黎明 郭富城
```

==解构的本质是**模式匹配**：等号左边是"模子"，右边按位置或按属性名往里填值。==

### 3.2 数组解构（按位置匹配）

let **[** xx,xx,xx**]** = 数组   ==[]==

```js
// ① 基本用法
const F4 = ['小沈阳', '刘能', '赵四', '宋小宝'];
let [xiao, liu, zhao, song] = F4;

// ② 跳过某些位置：用空位占位   
let [, , third] = F4;
console.log(third); // 赵四

// ③ 默认值：右侧对应位置是 undefined 时才生效
let [a = 1, b = 2] = [10];
console.log(a, b); // 10 2

// ④ 剩余元素：收集到数组里
let [first, ...others] = F4;
console.log(first);  // 小沈阳
console.log(others); // ['刘能', '赵四', '宋小宝']🥸...xx 得到一个数组🥸🥸🥸

// ⑤ 解构失败：多出来的变量是 undefined
let [x, y, z, w, v] = [1, 2];
console.log(v); // undefined
```

注意一条严格规则：**数组解构时右边必须是==可迭代对象==**（数组、字符串、Set、Map、`arguments` 等），普通对象不行。 🥸🥸🥸🥸🥸🥸🥸

```js
let [p, q] = { 0: 'a', 1: 'b' }; // TypeError: {} is not iterable
```

### 3.3 对象解构（按==属性名匹配==）

==变量名必须和属性名同名==

let **{**xx,xx,xx**}** = 对象  =={}==

```js
const zhao = {
  name: '赵本山',
  age: '不详',
  xiaopin: function () {
    console.log('我可以演小品');
  }
};

// 变量名必须与属性名同名 ⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐
let { name, age, xiaopin } = zhao;  // 相当于声明了三个变量，并对这三个变量进行赋值
console.log(name);   // 赵本山
console.log(age);    // 不详
xiaopin();           // 我可以演小品

// 只取其中一个
let { xiaopin } = zhao;
```

对象解构的几个进阶写法：

```js
const user = { id: 1, nickname: '小明', city: '北京' };

// ① 重命名：原名: 新名
let { nickname: userName, city: home } = user;
console.log(userName, home); // 小明 北京

// ② 默认值：属性不存在（或为 undefined）时生效
let { age = 18, vip = false } = user;
console.log(age, vip); // 18 false

// ③ 重命名 + 默认值 同时用
let { age: userAge = 20 } = user;

// ④ 嵌套解构
const res = { code: 200, data: { list: [1, 2, 3], total: 3 } };
let { data: { total } } = res;
console.log(total); // 3
```

第 ④ 种写法里，`data` 只是"路径"不是变量名——**解构嵌套对象时，外层名称不会生成变量**。这点新手最容易搞混，如果需要同时拿到 `data` 本身，要写成：

```js
let { data, data: { total } } = res;
```

### 3.4 复杂解构：数组与对象混着用

课件里的经典例子：

```js
let wangfei = {
  name: '王菲',
  age: 18,
  songs: ['红豆', '流年', '暧昧', '传奇'],
  history: [
    { name: '窦唯' },
    { name: '李亚鹏' },
    { name: '谢霆锋' }
  ]
};

let { songs: [one, two, three], history: [first, second, third] } = wangfei;

console.log(one);        // 红豆
console.log(second);     // { name: '李亚鹏' }
console.log(second.name); // 李亚鹏
```

解读一下模式：`songs: [one, two, three]` 的意思是"先按属性名 `songs` 进入，再按位置取出前三项"，`history` 同理。

### 3.5 函数参数的解构

==解构最实用的场景之一，出现在函数参数上。==

```js
// 老写法：参数是对象，函数里一行行取
function printUser(user) {
  console.log(user.name, user.age);
}

// 解构写法：直接在形参位置解构   对象解构
function printUser({ name, age }) {
  console.log(name, age);
}
printUser({ name: '小明', age: 20 }); // 小明 20
```

课件 `参数默认值.html` 里的例子，解构 + 默认值 + 剩余参数一起用：

```js
function connect({ host = '127.0.0.1', username, password, port }) {
  console.log(host);
  console.log(username);
  console.log(password);
  console.log(port);
}

connect({
  username: 'root',
  password: 'root',
  port: 3306
});
// 输出：127.0.0.1 root root 3306
// host 没传，用了默认值
```

这种写法在 Vue、React 的组件传参里极为常见：

```js
// React 里随处可见
const Button = ({ type = 'primary', size = 'medium', children }) => { /* ... */ };
```

> 坑：参数解构默认**不能省略整个实参**。`connect()` 会直接报 `Cannot destructure property 'host' of 'undefined'`。要兜底得写成 `function connect({ host = '127.0.0.1' } = {})`。

### 3.6 其他常见用法

**① 交换两个变量的值（不用中间变量）**

```js
let x = 1, y = 2;
[x, y] = [y, x];
console.log(x, y); // 2 1
```

**② 函数返回多个值**

```js
function getPosition() {
  return { x: 100, y: 200 };
}
let { x, y } = getPosition();
console.log(x, y); // 100 200
```

**③ 提取模块中的多个方法**

```js
import { reactive, computed } from 'vue';
```

**④ 结合循环处理对象数组**

```js
const users = [{ name: 'A', age: 18 }, { name: 'B', age: 20 }];
for (const { name, age } of users) {
  console.log(`${name} 今年 ${age} 岁`);
}
```

### 3.7 三个易错点

| 易错点 | 错误写法 | 正确写法 | 说明 |
| --- | --- | --- | --- |
| 已声明变量再解构，语句以 `{` 开头 | `{ name } = obj;` | `({ name } = obj);` 或 `let { name } = obj;` | JS 会把行首 `{` 当代码块，需用小括号包成表达式 |
| 数组解构用于对象 | `let [x] = { x: 1 };` | `let { x } = { x: 1 };` | 数组解构要求右侧可迭代 |
| 默认值只对 `undefined` 生效 | `let { a = 1 } = { a: null };` | —— | `a` 得到 `null`，不是 `1` |

### 3.8 本章小结

- 解构 = 按模式取值：数组按**位置**，对象按**属性名**。
- 三种增益写法：重命名（`原名: 新名`）、默认值（`= 值`）、剩余收集（`...rest`）。
- 函数参数解构是使用频率最高的场景，配合默认值可替代大量"取值 + 判空"代码。
- 记住两个坑：行首 `{` 要用括号包裹；默认值只对 `undefined` 生效。

---

## 4. 模板字符串

### 4.1 第三种字符串声明方式

ES6 之前声明字符串只有单引号和双引号，ES6 增加了用==**反引号**==（`` ` ``，键盘左上角 Esc 下方那个键）声明的模板字符串。

```js
let str = `我也是一个字符串哦!`;
console.log(str, typeof str); // 我也是一个字符串哦! string
```

它比引号版多了两个能力：**可以换行**、**可以插值**。

### 4.2 能力一：字符串里直接换行

老写法拼多行 HTML 必须用 `\n` 或 `+` 连接，可读性极差：

```js
// ES5：又长又容易错
var ul = '<ul>\n' +
         '  <li>沈腾</li>\n' +
         '  <li>玛丽</li>\n' +
         '  <li>魏翔</li>\n' +
         '  <li>艾伦</li>\n' +
         '</ul>';
```

模板字符串里怎么写就怎么显示：

```js
let str = `<ul>
            <li>沈腾</li>
            <li>玛丽</li>
            <li>魏翔</li>
            <li>艾伦</li>
          </ul>`;
```

**缩进会原样保留**，所以控制台里看到的排版和源码一致。如果不想让缩进进到 HTML 里，可以把反引号内容顶格写，或在渲染前用 `.replace(/\n\s+/g, '')` 之类处理。

### 4.3 能力二：`${}` 插值

==`${}` 里可以放**任意表达式**，执行结果会被**转成字符串**拼进去。==

```js
// 变量
let star = '魏翔';
let out = `${star}是我心目中最搞笑的演员!!`;
console.log(out); // 魏翔是我心目中最搞笑的演员!!

// 运算表达式
let a = 10, b = 20;
console.log(`${a} + ${b} = ${a + b}`); // 10 + 20 = 30

// 三元表达式
let score = 85;
console.log(`成绩：${score >= 60 ? '及格' : '不及格'}`); // 成绩：及格

// 函数调用
const getPrice = (n) => `¥${(n * 0.8).toFixed(2)}`;
console.log(`折后价：${getPrice(100)}`); // 折后价：¥80.00

// 对象属性 / 数组元素
const user = { name: '小明' };
const tags = ['前端', 'ES6'];
console.log(`${user.name} 的标签：${tags[0]}`);
```

### 4.4 嵌套与转义

模板字符串可以嵌套，嵌套层用外层反引号即可（ES6 允许反引号互相嵌套）：

```js
const list = ['甲', '乙', '丙'];
const html = `<ul>
  ${list.map(item => `<li>${item}</li>`).join('')}
</ul>`;
console.log(html);
// <ul>
//   <li>甲</li><li>乙</li><li>丙</li>
// </ul>
```

需要在内容里写反引号或 `${` 时，用反斜杠转义：

```js
console.log(`价格是 \`99\` 元`);   // 价格是 `99` 元
console.log(`插值写法是 \${name}`); // 插值写法是 ${name}
```

### 4.5 标签模板（了解）

函数名紧跟模板字符串的写法叫**标签模板**，函数会收到"字符串片段数组 + 各插值"：

```js
function tag(strings, ...values) {
  console.log(strings); // ['你好，', '，今年', '岁']
  console.log(values);  // ['小明', 20]
  return '处理后的结果';
}

const name = '小明';
const age = 20;
tag`你好，${name}，今年${age}岁`;
```

实际项目中用于防止 XSS 转义、国际化翻译等。新手知道有这个语法即可。

### 4.6 使用场景与注意点

**推荐用模板字符串的场合**

| 场景 | 老写法 | 模板字符串 |
| --- | --- | --- |
| 变量拼接 | `'我叫' + name + '，今年' + age + '岁'` | `` `我叫${name}，今年${age}岁` `` |
| 多行 HTML 片段 | 拼接 + `\n` | 直接换行 |
| 生成 DOM 模板 | 字符串数组 join | `map(() => \`...\`).join('')` |
| 带格式输出 | `fmt.Sprintf` 风格手写 | `` `¥${price.toFixed(2)}` `` |

**注意点**

1. **反引号与单双引号不能混用**：`` `abc' `` 就是语法错误。
2. **插值结果一定是字符串**：`${null}` 得到 `"null"`，`${undefined}` 得到 `"undefined"`，`${[1,2]}` 得到 `"1,2"`，`${{a:1}}` 得到 `"[object Object]"`——对象要用 `JSON.stringify()` 或取具体属性。
3. **不要在模板里塞复杂逻辑**：三元已经接近上限，多层嵌套的三元建议提到函数里。
4. 模板字符串仍是字符串，`.length`、`slice`、`includes` 等方法照常用。

### 4.7 本章小结

- 模板字符串用反引号声明，支持换行和 `${}` 插值。
- `${}` 内放表达式，结果一律转成字符串。
- 官方推荐：**遇到字符串与变量拼接就使用模板字符串**，可读性远高于 `+`。

---

## 5. 对象与函数的书写简化

ES6 允许在"变量名与属性名相同" “方法写成函数"这类高频场景下==**省掉一部分字符**==。这些简化不影响语义，只是让代码更短、更像 JSON。

### 5.1 属性简写

当对象的属性名和变量名相同时，可以只写一个。

```js
// ES5
let name = '尚硅谷';
let change = function () {
  console.log('我们可以改变你!!');
};
const school = {
  name: name,
  change: change,
  improve: function () {
    console.log('我们可以提高你的技能');
  }
};

// ES6：属性简写 + 方法简写  🥸🥸🥸🥸🥸🥸🥸
const school2 = {
  name,                 // 等价于 name: name
  change,               // 等价于 change: change
  improve() {           // 等价于 improve: function () {}
    console.log('我们可以提高你的技能');
  }
};

console.log(school2.name); // 尚硅谷
school2.change();          // 我们可以改变你!!
```

注意 `improve()` 这种**方法简写**和 `improve: () => {}` 并不等价——前者是普通函数（有自己 `this`，但**不能**用 `new` 构造），后者是箭头函数（`this` 静态，见第 6 章）。

### 5.2 计算属性名

属性名可以是一个表达式，用 `[]` 包起来：

```js
const key = 'level';
const obj = {
  [key]: 'high',
  [`${key}Num`]: 3
};
console.log(obj); // { level: 'high', levelNum: 3 }
```

这套写法在需要动态生成键名的场合非常有用，比如根据用户输入构造表单对象。

### 5.3 函数参数的默认值

ES6 允许在**形参位置直接写默认值**：

```js
// ① 基本用法
function add(a, b = 10) {
  return a + b;
}
console.log(add(1, 2)); // 3
console.log(add(1));    // 11：b 用了默认值
console.log(add(1, undefined)); // 11：显式传 undefined 也会走默认值

// ② 默认值可以是表达式（每次调用时求值）
let x = 1;
function fn(a = x + 1) {
  console.log(a);
}
fn();  // 2
x = 10;
fn();  // 11

// ③ 默认值可以引用前面的参数
function greet(name, msg = `你好，${name}`) {
  console.log(msg);
}
greet('小明'); // 你好，小明

// ④ 参数默认值与解构结合
function axios({ url, method = 'GET', data = {} }) {
  console.log(method, url, data);
}
axios({ url: '/api/user' }); // GET /api/user {}
```

三条必须记住的规则：

1. ==**只有实参为 `undefined` 时才用默认值**，`null`、`0`、`''`、`false` 都不会触发默认值==。

```js
function f(a = 100) { console.log(a); }
f();          // 100
f(undefined); // 100
f(null);      // null
f(0);         // 0
f('');        // ''
```

2. ==**有默认值的参数应放在参数列表末尾**，否则中间的参数无法省略。==

```js
function g(a = 1, b) { return [a, b]; }
console.log(g(undefined, 2)); // [1, 2]，第一个必须显式给 undefined
```

3. 设置了默认值后，函数的 `length` 属性会变化：`length` 等于**第一个有默认值参数之前**的形参个数。

```js
function h(a, b, c = 3) {}
console.log(h.length); // 2
```

> 参数默认值确实属于 ES6，但课件把它放在"函数参数"一节，与 rest 参数一起讲。它与 rest 的组合写法（`function f(a = 1, ...rest) {}`）在第 7 章展开。

### 5.4 为什么这些"小简化"值得单独学

简化语法本身不难，难的是**读懂别人写的简写**。真实项目里高频出现这样的代码：

```js
const { data, status } = response;
const params = { page, size, keyword };

const request = {
  url: '/api/list',
  method: 'post',
  data,
  headers: { 'Content-Type': 'application/json' },
  transform(res) {
    return res.data;
  }
};
```

不认识简写时，`data,` 这一行看起来像漏写了什么；熟悉之后反而觉得啰嗦的 `data: data` 更碍眼。第 3 章的"对象解构"与本章的"属性简写"是同一套符号的两种方向——==**解构是"从对象里拿出来"，简写是"把变量塞进去"**==，对照记忆效率最高。

### 5.5 本章小结

- 属性简写：`{ name }` 等价于 `{ name: name }`。
- 方法简写：`{ fn() {} }` 等价于 `{ fn: function () {} }`。
- 计算属性名：`{ [expr]: value }`。
- 参数默认值只对 `undefined` 生效，且应置于参数列表末尾。

---

## 6. 箭头函数

箭头函数是 ES6 使用频率最高的特性，也是新手最容易踩坑的特性——**坑几乎全在 `this` 上**。

### 6.1 基本语法

```js
// 声明一个函数
let fn = function () {};
let fn2 = (a, b) => {
  return a + b;
};
```

==省略规则==一共三条：

| 情况 | 写法 |
| --- | --- |
| 参数只有一个 | **可以省掉括号**：`let f = a => a * 2;` |
| 没有参数 / 多个参数 | **括号不能省**：`let f = () => 1;`、`let f = (a, b) => a + b;` |
| 函数体只有一条语句 | 可以省掉 `{}` 和 `return`，该条语句结果自动成为返回值 |

```js
// 完整写法
let add = (a, b) => { return a + b; };
// 省略 return
let add2 = (a, b) => a + b;

// 返回对象字面量时必须用小括号包住，否则 {} 会被当成函数体
let getUser = () => ({ name: '小明' });
console.log(getUser()); // { name: '小明' }
```

最后这条是高频错误：

```js
let wrong = () => { name: '小明' }; // 返回 undefined，{} 被当成函数体
```

### 6.2 特性一：`this` 是静态的（最重要）

==普通函数里的 `this` 指向**调用者**，<u>会随调用方式变化</u>；==

==箭头函数**没有自己的 `this`**，它内部 `this` 指向 🥸**定义时所在作用域**🥸的 `this`，并且永远不会变。==

```js
function getName() {
  console.log(this.name);
}
let getName2 = () => {
  console.log(this.name);
};

// 设置 window 对象的 name 属性
window.name = '尚硅谷';
const school = {
  name: 'ATGUIGU'
};

// 直接调用：普通函数的 this 默认指向 window（非严格模式）
getName();        // 尚硅谷
getName2();       // 尚硅谷

// 用 call 改变 this
getName.call(school);   // ATGUIGU：成功改变 普通函数里的this指向调用者
getName2.call(school);  // 尚硅谷：call 对箭头函数无效！
```

课件 `箭头函数.html` 里最后这行 `getName2.call(school)` 的输出正是 `尚硅谷`，这就是"静态"的含义——==**任何方式都改不了箭头函数的 `this`（始终指向定义时所在的作用域，即这个函数的外层），`call`、`apply`、`bind` 全部失效**==。

### 6.3 特性二：不能作为构造函数

箭头函数没有 `[[Construct]]` 内部方法，也不能 `new`：

```js
let Person = (name) => { this.name = name; };
let p = new Person('小明'); // TypeError: Person is not a constructor
```

### 6.4 特性三：没有 `arguments`

```js
let fn = () => {
  console.log(arguments); // ReferenceError: arguments is not defined
};
```

需要收集实参时用 rest 参数（第 7 章）：`let fn = (...args) => console.log(args);`

### 6.5 特性四：不能使用 `yield`，不能用箭头函数写生成器

```js
let gen = () => { yield 1; }; // SyntaxError
```

### 6.6 经典应用：解决定时器里的 `this` 问题

这是课件 `箭头函数实践.html` 的例子，也是理解"静态 this"的最佳案例。

```html
<div id="ad"></div>

<script>
  // 老写法：用 _this 备份 this
  let ad = document.getElementById('ad');
  ad.addEventListener('click', function () {
    let _this = this;
    setTimeout(function () {
      _this.style.background = 'pink';
    }, 2000);
  });

  // 箭头函数写法：外层 this 直接穿透进来
  let ad2 = document.getElementById('ad');
  ad2.addEventListener('click', function () {
    setTimeout(() => {
      this.style.background = 'pink';
    }, 2000);
  });
</script>
```

为什么可行：`setTimeout` 里的回调是箭头函数，==它定义在 `addEventListener` 那个普通函数内部，所以它的 `this` 就是外层函数的 `this`——也就是被点击的 `div`==。而如果外层也用箭头函数，`this` 就会一路向上找到 `window`，而不是 `div`。

### 6.7 应用二：数组方法中的简写

```js
const arr = [1, 3, 5, 7, 9];

// filter：取出大于 5 的
const result = arr.filter(item => item > 5);
console.log(result); // [7, 9]

// map：每个元素乘 2
console.log(arr.map(n => n * 2)); // [2, 6, 10, 14, 18]

// reduce：求和
console.log(arr.reduce((sum, n) => sum + n, 0)); // 25
```

这几行是现代前端代码中出现频率最高的箭头函数形态。注意 `filter(item => item > 5)` 里，函数体是表达式，省掉了 `return`。

### 6.8 什么时候**不能**用箭头函数

这是比"会用"更重要的知识：

| 场景 | 为什么不能用 | 应该怎么写 |
| --- | --- | --- |
| 对象的方法 | `this` 会指向外层（如 `window`），拿不到对象自身 | 用方法简写 `{ fn() {} }` |
| 原型方法 | 同上，拿不到实例 | `Person.prototype.fn = function () {}` |
| 事件回调且需要 `this` 指向元素 | `this` 不指向绑定元素 | 普通函数 |
| 需要 `arguments` | 箭头函数没有 `arguments` | 普通函数或 rest 参数 |
| 需要 `new` 的构造函数 | 不能 `new` | `class` 或普通函数 |
| 需要 `yield` 的生成器 | 语法不支持 | `function*` |

对象方法这个坑最容易犯：

```js
const user = {
  name: '小明',
  sayHi: () => {
    console.log(this.name); // undefined：this 指向 window
  }
};
user.sayHi();

// 正确写法
const user2 = {
  name: '小明',
  sayHi() {
    console.log(this.name); // 小明
  }
};
```

### 6.9 箭头函数与普通函数对比

| 对比项 | 普通函数 | 箭头函数 |
| --- | --- | --- |
| `this` | ==动态，随调用方式变化，指向调用者== | ==静态，取定义时外层作用域== |
| `arguments` | 有 | 无（用 rest 代替） |
| `new` | 可以 | 不可以 |
| `prototype` | 有 | 无 |
| `call/apply/bind` | 生效 | 对 `this` 无效 |
| `yield` | 配合 `function*` 可用 | 不可用 |
| 适合位置 | 对象方法、构造函数、事件回调 | 回调、数组方法、需要保持 `this` 的场景 |

### 6.10 本章小结

- 箭头函数是函数表达式的简写，三条省略规则：单参省括号、单语句省 `{}` 和 `return`、返回对象要加括号。
- 核心差异是 `this` 静态绑定，`call` 也改不动；因此没有 `new`、没有 `arguments`、不能 `yield`。
- 判断口诀：**需要"当前对象"就用普通函数，只是"传个逻辑"就用箭头函数。**

---

## 7. rest 参数与 spread 扩展运算符

两个特性都写作==`...`==，语法长得一样，**方向相反**：

- **rest（剩余==参数==）**：把多个零散的值**收集**成一个数组 —— 放在函数形参位置（末尾）、数组/对象解构的左边。   ==打包==     ==放在函数形参位置的末尾==
- **spread（扩展==运算符==）**：把一个数组/可迭代对象**展开**成多个值 —— 放在实参位置、数组/对象字面量里。          ==解包==    ==调用函数时，作为实参传递给形参==

一句口诀：**左边收，右边展**。

### 7.1 rest 参数：收集实参

==放在函数形参位置的末尾==

```js
// ES5：用 arguments，是伪数组，不能直接调数组方法
function date() {
  console.log(arguments); // Arguments(3) ['1', '2', '3']，伪数组
}
date('1', '2', '3');

// ES6：用 rest 参数，得到真正的数组
function date2(...args) {
  console.log(args); // ['1', '2', '3']，真数组
  console.log(args.filter(a => a !== '2')); // ['1', '3']，数组方法可直接用
}
date2('1', '2', '3');
```

`arguments` 和 rest 的差别：

| 对比项 | `arguments` | rest 参数 |
| --- | --- | --- |
| 类型 | 伪数组（Array-like） | 真==数组== |
| 数组方法 | 不能直接用（要 `Array.from`） | 可直接用 |
| 是否包含所有形参 | 包含全部实参 | ==只收集**未命名**的剩余实参== |
| 箭头函数中 | 不可用，箭头函数中没有该参数 | 可用 |

==**必须在参数列表的最后一位**==：

```js
function fn(a, b, ...rest) {
  console.log(a, b, rest);
}
fn(1, 2, 3, 4, 5); // 1 2 [3, 4, 5]

// 以下写法是语法错误
function wrong(...rest, a) {} // SyntaxError: Rest parameter must be last formal parameter
```

rest 与参数默认值组合：

```js
function f(a = 1, ...rest) {
  console.log(a, rest);
}
f();           // 1 []
f(2, 3, 4);    // 2 [3, 4]
```

rest 与解构组合（取对象/数组的"剩余部分"）：

```js
// 数组解构
let [first, ...others] = [1, 2, 3, 4];
console.log(first, others); // 1 [2, 3, 4]

// 对象解构（注意：对象 rest 属于 ES2018，非 ES6）
const { name, ...rest } = { name: '小明', age: 18, city: '北京' };
console.log(name, rest); // 小明 { age: 18, city: '北京' }
```

> 版本提醒：**对象解构里的 rest** 与 **对象字面量里的 spread** 都是 ES2018（ES9）的内容，课件为讲清 `...` 的完整用法一并演示。学习时按 ES6 主线记，写项目时正常用即可。

### 7.2 spread 扩展运算符：展开

==调用函数时，作为实参传递给形参==

**① 合并数组**

```js
const arr1 = [1, 2, 3];
const arr2 = [4, 5, 6];

// 老写法
const arrOld = arr1.concat(arr2);

// 新写法
const arr = [...arr1, ...arr2];
console.log(arr); // [1, 2, 3, 4, 5, 6]

// 也可以在首尾插入元素
const arr3 = [0, ...arr1, 3.5, ...arr2, 7];
console.log(arr3); // [0, 1, 2, 3, 3.5, 4, 5, 6, 7]
```

**② 数组的克隆（浅拷贝）**

```js
const arr4 = [1, 2, 3];
const clone = [...arr4];
clone.push(4);
console.log(arr4);  // [1, 2, 3]，原数组不受影响
console.log(clone); // [1, 2, 3, 4]
```

**③ 将伪数组转为真数组**

```js
// 常见伪数组：DOM 集合、arguments
const divs = document.querySelectorAll('div');
const arrDivs = [...divs];        // ES6 写法
// 等价写法：Array.from(divs) / Array.prototype.slice.call(divs)

function fn() {
  return [...arguments];
}
console.log(Array.isArray(fn(1, 2, 3))); // true
```

**④ 作为函数实参展开**

```js
function sum(...nums) {
  return nums.reduce((a, b) => a + b, 0);
}
const nums = [1, 2, 3, 4];
console.log(sum(...nums)); // 10

// 求最大值：不用再写 apply
console.log(Math.max(...nums)); // 4
// 老写法：Math.max.apply(null, nums)
```

**⑤ 展开字符串、Set 等可迭代对象**

```js
console.log([...'hello']);        // ['h', 'e', 'l', 'l', 'o']
console.log([...new Set([1, 1, 2])]); // [1, 2]
```

**⑥（ES2018 延伸）展开对象**

```js
const obj1 = { a: 1, b: 2 };
const obj2 = { c: 3, d: 4 };

const merged = { ...obj1, ...obj2 };   // 合并
const cloned = { ...obj1 };            // 浅拷贝
const override = { ...obj1, b: 99 };   // 覆盖同名属性

console.log(merged);   // { a: 1, b: 2, c: 3, d: 4 }
console.log(override); // { a: 1, b: 99 }
```

这个写法在现代项目里极常用（如 React 的 props 透传、状态更新），但请记住它**只做浅拷贝**，嵌套对象仍是共享引用：

```js
const src = { nested: { v: 1 } };
const copy = { ...src };
copy.nested.v = 2;
console.log(src.nested.v); // 2：嵌套层被一起改了
```

### 7.3 怎么判断眼前这个 `...` 是 rest 还是 spread

🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩

看它在**赋值号的哪一边**，以及**是否出现在形参位置**：

```js
let [a, ...b] = [1, 2, 3];   // rest：在左边，收集
let c = [1, ...b];            // spread：在右边，展开

function f(...args) {}        // rest：形参位置
f(...[1, 2, 3]);              // spread：实参位置
```

一个反直觉的点：**同一个 `...` 在函数形参里只能用于 rest**，在函数调用实参里只能用于 spread，两者不会混淆。

🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩

### 7.4 常见坑

| 坑 | 说明 |
| --- | --- |
| 用 spread 深拷贝 | `[...arr]`、`{...obj}` 都是浅拷贝，嵌套引用不会复制 |
| 把 rest 放中间 | 语法错误，rest 必须是最后一个形参 |
| 展开不可迭代对象 | `[...{a:1}]` 报 `not iterable`；展开对象要用 `{...obj}` 而不是 `[...obj]` |
| 展开大数组的性能 | `Math.max(...bigArray)` 参数过万可能栈溢出，超大数组应改用 `reduce` |
| 箭头函数里用 `arguments` | 箭头函数没有 `arguments`，必须用 rest 参数 |

### 7.5 本章小结

- `...` 一个符号两种身份：rest 收（数组解构、函数形参），spread 展（数组/对象字面量、函数实参）。
- rest 必须放最后，得到的是**真数组**，比 `arguments` 好用。
- spread 的五大用途：合并、克隆、伪数组转数组、传参展开、可迭代对象转数组。
- 课件中"展开对象"与"对象解构 rest"实属 ES2018，按延伸知识理解。

---

## 8. Symbol

ES6 引入了一种新的原始**数据类型** Symbol,**表示独一无二的值**。它是JavaScript 语言的第七种数据类型,是一种**==类似于字符串==的数据类型**。

> 澄清上面这句课件原话：这里的"第七种数据类型"是把引用类型 `object` 也算进去的说法，落实到**原始数据类型**上，`Symbol` 是**第六种原始类型**。原始类型共 6 种：`undefined`、`null`、`boolean`、`number`、`string`、`symbol`；`object` 是引用类型，不属于原始类型。二者合计才是下面说的"7 种数据类型"。

Symbol 特点

- Symbol的值是唯一的,用来解决命名冲突的问题

- Symbol 值不能与其他数据进行运算

- Symbol 定义的对象属性不能使用for ... in 循环遍历,但是**可以使用Reflect.ownKeys 来获取对象的所有键名**

🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩

JS的7种数据类型：

USONB: you are so nuibility
u undefined
s string symbol
o object
n null number
b boolean

🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩

### 8.1 为什么需要 Symbol

ES5 的对象属性名都是字符串，带来两个无法回避的问题：

```js
// 问题 1：命名冲突
const obj = { name: '小明' };
// 第三方库也往 obj 上写 name，直接覆盖
obj.name = '第三方库的值';

// 问题 2：想给对象加个"内部属性"，又不想被外部误改
```

`Symbol` 的定位就是：==**独一无二的值，适合做对象的属性名**，从源头避免命名冲突==。

Symbol 本身的值没有 “内容”，括号里的只是【描述文本（description）】

`Symbol()` 每次调用生成一个独一无二的原始值；括号里的字符串只是一段描述，仅用来阅读调试，不参与相等判断，**即使描述相同，Symbol 本身依然是不同的值。**

`Symbol.for('xxx')` 会去**全局注册表**查找，有就复用，没有才新建。

### 8.2 创建与基本特征

`Symbol` 是 ES6 引入的**第六种原始数据类型**（前五种：`undefined`、`null`、`boolean`、`number`、`string`）。再加上引用类型 `object`，合计才是 JavaScript 的 7 种数据类型。

```js
// 创建
let s = Symbol();
console.log(s, typeof s); // Symbol() 'symbol'

// 可以传字符串作为描述（仅用于调试识别，不影响唯一性）
let s2 = Symbol('尚硅谷');
let s3 = Symbol('尚硅谷');
console.log(s2 === s3); // false —— 描述相同，值也不同

// 不能使用 new
let s4 = new Symbol(); // TypeError: Symbol is not a constructor
```

四条硬规则：

1. **不能 `new`**，因为 Symbol 是原始值，不是对象，没有构造函数。
2. **不能与其他类型运算**，比较也不行。

```js
let s = Symbol();
console.log(s + 1);        // TypeError: Cannot convert a Symbol value to a number
console.log(s > 0);        // TypeError
console.log(`${s}`);       // 字符串模板会报错 TypeError（隐式转字符串）
console.log(s.toString()); // 手动转换可以：'Symbol()'
console.log(String(s));    // 'Symbol()'
```

3. **不能用 `for...in` 遍历**，`Object.keys()`、`Object.getOwnPropertyNames()`、`JSON.stringify()` 都拿不到。

```js
let s1 = Symbol('a');
const obj = {
  name: '小明',
  [s1]: 'symbol 值',   // 用 Symbol 做键必须用 [] 计算属性名
  age: 18
};

console.log(Object.keys(obj));  // ['name', 'age'] —— 没有 symbol
console.log(JSON.stringify(obj)); // {"name":"小明","age":18}
for (let k in obj) console.log(k); // name / age
```

这一点常被用来做"私有/内部属性"：外部遍历看不见，也就不会误改。

4. ==**描述字符串相同，值也不同**==（`Symbol('a') !== Symbol('a')`）。

### 8.3 `Symbol.for`：全局注册表

如果需要=="同一个描述拿到同一个 Symbol"，用 `Symbol.for()`，它会在全局注册表里查找，没有才创建==：

```js
let s1 = Symbol.for('尚硅谷');
let s2 = Symbol.for('尚硅谷');
console.log(s1 === s2); // true

let s3 = Symbol('尚硅谷');
console.log(s1 === s3); // false：普通 Symbol 不进注册表

// 通过 key 反查描述
console.log(Symbol.keyFor(s1)); // '尚硅谷'
```

对比记忆：🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩

| 方式 | 是否进全局注册表 | 同描述是否相等 | 典型用途 |
| --- | --- | --- | --- |
| `Symbol('x')` | 否 | 否 | 对象私有键，一次一份 |
| `Symbol.for('x')` | 是 | 是 | 跨模块共享的键 |

### 8.4 作为对象属性名的实际操作

由于 Symbol 键不参与常规遍历，读写时要走专门的 API：

```js
let game = {
  name: '狼人杀',
  up() { console.log('升级'); }
};

// 添加 Symbol 属性
let methods = {
  up: Symbol(),
  down: Symbol()
};
game[methods.up] = function () { console.log('我可以上升'); };
game[methods.down] = function () { console.log('我可以下降'); };

// 直接在字面量里定义
const youxi = {
  name: '狼人杀',
  [Symbol('say')]: function () { console.log('我可以发言'); }
};

// 读取：必须用同一个 Symbol 引用
game[methods.up](); // 我可以上升

// 想拿到所有 Symbol 键
console.log(Object.getOwnPropertySymbols(game)); // [Symbol(), Symbol()]
console.log(Reflect.ownKeys(game));              // ['name', 'up', Symbol(), Symbol()]
```

> 注意 `Reflect` 属于 ES6 新增的内置对象，这里用它一次性拿到"字符串键 + Symbol 键"。课件里大量使用该 API，认识即可。

### 8.5 内置的 Symbol 值（了解）

除了自建 Symbol，JS 内置了一批 **well-known symbols**，用来定制对象的底层行为：

| 内置 Symbol | 作用 |
| --- | --- |
| `Symbol.hasInstance` | 定制 `instanceof` 的判定逻辑 |
| `Symbol.isConcatSpreadable` | 控制 `Array.prototype.concat` 时是否可展开 |
| `Symbol.iterator` | 定义默认迭代器（第 9 章） |
| `Symbol.toPrimitive` | 定制对象转原始值的规则 |
| `Symbol.toStringTag` | 定制 `Object.prototype.toString` 的输出 |
| `Symbol.species` / `Symbol.match` / `Symbol.replace` 等 | 正则、派生对象相关 |

课件给了一个 `hasInstance` 的直观例子：

```js
class Person {
  static [Symbol.hasInstance](param) {
    console.log('我被用来检测类型了');
    console.log(param);
    return false; // 自定义判定：永远返回 false
  }
}

let o = {};
console.log(o instanceof Person); // 我被用来检测类型了 → {} → false
```

正常情况下 `o instanceof Person` 为 `false`，但这里能看到自定义的 `Symbol.hasInstance` 被调用——说明 `instanceof` 的判定权可以交给我们自己。

### 8.6 使用建议

1. **优先用 `Symbol()`**，只有确实需要跨模块共享键时才用 `Symbol.for()`。
2. Symbol 适合做**约定的内部标记**，不要拿它当普通数据属性使用——它天然不可枚举，调试和序列化都拿不到。
3. 别把 Symbol 当"真正的私有"：`Object.getOwnPropertySymbols()` 仍能拿到，真正的私有字段要等 ES2022 的 `#field`。
4. 传给 `Symbol()` 的描述字符串只用于 `console` 调试显示，**与唯一性无关**。

### 8.7 本章小结

- Symbol 是第六种原始类型，用 `Symbol()` 创建，值唯一，不能 `new`、不能运算。
- 主要用途：作为对象属性名避免命名冲突；Symbol 键不会被 `for...in`、`Object.keys`、`JSON.stringify` 遍历到。
- `Symbol.for` 走全局注册表，同描述相等；`Symbol.keyFor` 可反查描述。
- 内置 `Symbol.iterator`、`Symbol.hasInstance` 等用于定制对象底层行为，是理解第 9 章迭代器的前置知识。

---

## 9. 迭代器与生成器

这两个概念在语法上不难，难在"为什么要引入它们"。理解了一条主线就通了：==**迭代器统一了"怎么一个个取值"，生成器则让"写一个迭代器"变得极其简单**==。

### 9.1 迭代器（Iterator）是什么

迭代器**是一种接口**，<u>为各种不同的数据结构提供统一的访问机制</u>。任何数据结构只要部署了 Iterator 接口，就可以用 `for...of` 遍历。

ES6 规定，这个**接口的名字叫 `Symbol.iterator`——它本身是个函数**，调用后返回一个**迭代器对象**，该对象身上**有 `next()` 方法**。每次调用 `next()` 返回一个包含两个属性的对象：

```js
{ value: 当前值, done: 布尔值 }  // done 为 true 表示遍历结束
```

==**原生具备 Iterator 接口**的数据结构==：

| 类型 | 举例 |
| --- | --- |
| Array | `[1, 2, 3]` |
| Arguments | 函数内的 `arguments` |
| Set / Map | `new Set([1, 2])` |
| String | `'abc'` |
| TypedArray | `new Uint8Array([1, 2])` |
| NodeList | `document.querySelectorAll('div')` |

==注意 **Object 没有** Iterator 接口==，所以对象不能直接 `for...of`，这就是第 9.4 节自定义迭代器的动机。

### 9.2 手动使用迭代器

```js
const xiyou = ['唐僧', '孙悟空', '猪八戒', '沙僧'];

// 1. 获取迭代器对象
let iterator = xiyou[Symbol.iterator]();
console.log(iterator); // Array Iterator {}

// 2. 反复调用 next()
console.log(iterator.next()); // { value: '唐僧',   done: false }
console.log(iterator.next()); // { value: '孙悟空', done: false }
console.log(iterator.next()); // { value: '猪八戒', done: false }
console.log(iterator.next()); // { value: '沙僧',   done: false }
console.log(iterator.next()); // { value: undefined, done: true }
```

工作流程可以概括为三步：

🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩

1. 创建一个指针对象，指向数据结构的起始位置；
2. 第一次调用 `next()`，指针自动指向第一个成员；
3. 每调用一次 `next()` 就向后移动一位，直到 `done: true`。

🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩

`for...of` 其实就是这套流程的语法糖：

```js
for (let item of xiyou) {
  console.log(item); // 依次输出四个名字
}
```

**`for...of` 与 `for...in` 的区别**

| 对比项 | `for...in` | `for...of` |
| --- | --- | --- |
| 遍历内容 | ==键名（下标或属性名）==，且会遍历原型链上的可枚举属性 | ==键值（成员本身）== |
| 适用对象 | 数组、对象都行 | 需具备 Iterator 接口（对象不行） |
| 数组场景 | 得到 `'0'`、`'1'` 字符串下标 | 得到元素值 |
| 与 Symbol 键 | 遍历不到 | 不涉及 |

```js
const arr = ['a', 'b'];
for (let k in arr) console.log(k);   // '0' '1'
for (let v of arr) console.log(v);   // 'a' 'b'
```

### 9.3 自定义迭代器：让对象可以被 `for...of`

课件里的 `banji`（班级）案例：一个对象内部有数组，也希望被 `for...of` 遍历。做法是给它部署 `Symbol.iterator`：

```js
const banji = {
  name: '终极一班',
  stus: ['xiaoming', 'xiaoning', 'xiaotian', 'knight'],

  [Symbol.iterator]() {
    let index = 0;
    let _this = this; // 保存 this，指向 banji
    return {
      next: () => {
        if (index < _this.stus.length) {
          const result = { value: _this.stus[index], done: false };
          index++;
          return result;
        } else {
          return { value: undefined, done: true };
        }
      }
    };
  }
};

// 现在可以直接遍历
for (let v of banji) {
  console.log(v); // xiaoming / xiaoning / xiaotian / knight
}
```

关键点：

1. `[Symbol.iterator]` 必须返回一个**带 `next` 方法的对象**；
2. `next` 内部要维护自己的游标（这里是 `index`），每次调用只前进一步；
3. 用箭头函数写 `next` 时，`this` 会指向上层，所以要提前用 `_this` 保存 `banji`——这正好是第 6 章"箭头函数 this 静态"的应用。

在实际开发中，比起手写上面这一坨，我们更常用**生成器**来实现同样的效果（见 9.6）。

### 9.4 生成器（Generator）基础

一句话：**yield 是暂停器 + 产出值**，只能写在带 `*` 的生成器函数里面，普通函数不能用
==`yield`：暂停函数，把后面的值交出去；下次调用 `.next()`，从暂停的位置继续往下跑，函数**不会结束**==

生成器函数是一种特殊的函数，写法是在 `function` 后面加一个星号 `*`：

```js
function* gen() {
  console.log('第一步');
  yield '第一段';
  console.log('第二步');
  yield '第二段';
  console.log('第三步');
  yield '第三段';
}

let iterator = gen();
console.log(iterator); // Object [Generator] {}

// 🥸🥸调用 next() 🥸🥸才会执行函数体，且每次只执行到下一个 yield
console.log(iterator.next()); // 第一步 → { value: '第一段', done: false }
console.log(iterator.next()); // 第二步 → { value: '第二段', done: false }
console.log(iterator.next()); // 第三步 → { value: '第三段', done: false }
console.log(iterator.next()); // { value: undefined, done: true }
```

三条核心规则：

🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩

1. ==**调用生成器函数不会立即执行函数体**，只返回一个迭代器对象==；
2. ==每次调用 `next()`，执行到下一个 `yield` 就**暂停**，把 `yield` 后面的值作为 `value` 交出；==
3. 函数执行完毕或遇到 `return`，`done` 变成 `true`。

🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩🍋‍🟩

==因为生成器函数返回的对象本身就是**迭代器**，所以可以直接 `for...of`：==

```js
function* gen2() {
  yield 'aaa';
  yield 'bbb';
  yield 'ccc';
}
for (let v of gen2()) {
  console.log(v); // aaa / bbb / ccc
}
```

==`return` 一旦出现，后续 `yield` 全部失效：==

```js
function* gen3() {
  yield 'a';
  return 'b';
  yield 'c'; // 永远到不了
}
const it = gen3();
console.log(it.next()); // { value: 'a', done: false }
console.log(it.next()); // { value: 'b', done: true }
console.log(it.next()); // { value: undefined, done: true }
```

### 9.5 给 `next()` 传参

==`next(value)` 的参数会成为**上一个 `yield` 表达式的返回值**：==

```js
function* gen(arg) {
  console.log(arg);          // AAA

  let one = yield 111;
  console.log(one);          // BBB

  let two = yield 222;
  console.log(two);          // CCC

  let three = yield 333;
  console.log(three);        // DDD
}

let iterator = gen('AAA');		// 此时不会执行函数体，即不会有任何输出
console.log(iterator.next());        // AAA \n { value: 111, done: false }
console.log(iterator.next('BBB'));   // BBB → { value: 222, done: false }
console.log(iterator.next('CCC'));   // CCC → { value: 333, done: false }
console.log(iterator.next('DDD'));   // DDD → { value: undefined, done: true }
```

这是生成器最反直觉的一点：**第一次 `next()` 传入的参数会被丢弃**，因为没有"上一个 yield"可以接收它；`gen('AAA')` 的参数才是函数的初始实参。

### 9.6 生成器的三大实战场景

**场景一：异步任务的同步化写法（课件核心案例）**

传统写法要层层嵌套：

```js
setTimeout(() => {
  console.log(111);
  setTimeout(() => {
    console.log(222);
    setTimeout(() => {
      console.log(333);
    }, 3000);
  }, 2000);
}, 1000);
```

嵌套三层还能忍，嵌套五层就是"回调地狱"。用生成器改造后是**线性的**：

```js
function one() {
  setTimeout(() => {
    console.log(111);
    iterator.next();   // 这一步做完，告诉生成器继续
  }, 1000);
}
function two() {
  setTimeout(() => {
    console.log(222);
    iterator.next();
  }, 2000);
}
function three() {
  setTimeout(() => {
    console.log(333);
    iterator.next();
  }, 3000);
}

function* gen() {
  yield one();
  yield two();
  yield three();
}

let iterator = gen();
iterator.next();
// 1s 后输出 111，再过 2s（即第 3s）输出 222，再过 3s（即第 6s）输出 333，代码是平铺的
```

思路：**把异步代码放进 `yield` 里，等异步完成后再调用 `next()` 推进**。虽然原始生成器要手动调 `next()`，但这正是 `async/await` 的雏形（ES2017 就是在这个思路上加语法糖）。

**场景二：按顺序加载数据（模拟真实业务）**

```js
// 模拟接口
function getUsers() {
  setTimeout(() => {
    let data = '用户数据';
    iterator.next(data);   // 把数据回传给生成器
  }, 1000);
}
function getOrders() {
  setTimeout(() => {
    let data = '订单数据';
    iterator.next(data);
  }, 1000);
}
function getGoods() {
  setTimeout(() => {
    let data = '商品数据';
    iterator.next(data);
  }, 1000);
}

function* gen() {
  let users = yield getUsers();
  console.log(users);          // 用户数据
  let orders = yield getOrders();
  console.log(orders);         // 订单数据
  let goods = yield getGoods();
  console.log(goods);          // 商品数据
}

let iterator = gen();
iterator.next();
```

这就是"先取用户，再按用户 ID 取订单，再按订单取商品"的三段串行请求。注意这里的 `iterator` 必须先声明再被上面三个函数引用，所以 `let iterator = gen()` 写在最后——**函数提升 + 变量引用顺序**在这里要留意。

**场景三：用生成器实现自定义遍历**

把 9.3 的 `banji` 用生成器重写，代码量骤减：

```js
const banji = {
  name: '终极一班',
  stus: ['xiaoming', 'xiaoning', 'xiaotian', 'knight'],
  *[Symbol.iterator]() {   // 生成器方法直接返回迭代器
    for (let i = 0; i < this.stus.length; i++) {
      yield this.stus[i];
    }
  }
};

for (let v of banji) {
  console.log(v);
}
```

`*[Symbol.iterator]()` 里的 `this` 就是 `banji`，比手写 `_this` 干净得多。

### 9.7 本章小结

- 迭代器接口 = `Symbol.iterator` + 返回带 `next()` 的对象，`next()` 交出 `{ value, done }`。
- `for...of` 只认 Iterator 接口；对象默认没有，需要自己部署。
- 生成器函数 `function*` 有两个暂停开关：`yield` 交出值并暂停，`next()` 恢复执行；`next(value)` 可给上一个 `yield` 传值。
- 生成器把"异步嵌套"改写成"顺序执行"，是理解 `async/await` 的必要铺垫。

---

## 10. Promise 与异步编程

Promise 是 ES6 对异步编程最大的改造。它的价值不在于"语法新"，而在于把**横向嵌套**的回调改成**纵向链式**的调用。

### 10.1 先看问题：回调地狱

读三个文件，要求后一个文件的内容依赖前一个的结果，用传统回调只能嵌套：

```js
const fs = require('fs');

fs.readFile('./resource/为学.md', (err, data1) => {
  fs.readFile('./resource/插秧诗.md', (err, data2) => {
    fs.readFile('./resource/观书有感.md', (err, data3) => {
      let result = data1 + '\n' + data2 + '\n' + data3;
      console.log(result);
    });
  });
});
```

三个文件还能读，五个以上就会出现"向右生长的金字塔"，异常处理也无从下手——每一层都要单独判 `err`，漏一个就吞错误。这种代码被称为**回调地狱（回调金字塔）**。

### 10.2 Promise 的基本结构与三种状态

```js
// 实例化
const p = new Promise((resolve, reject) => {
  // 执行器函数：同步执行，里面写异步任务
  setTimeout(() => {
    const data = '用户数据';
    // 成功时调用 resolve，失败时调用 reject
    resolve(data);
  }, 1000);
});

// 用 then 接收结果
p.then(
  value => console.log('成功：', value),   // 对应 resolve
  reason => console.log('失败：', reason)  // 对应 reject
);
```

三条必须掌握的性质：

| 状态 | 含义 | 触发方式 |
| --- | --- | --- |
| `pending`（待定） | 初始状态，既没成功也没失败 | `new Promise` 后默认 |
| `fulfilled`（已兑现 / 成功） | 已得到结果 | 调用 `resolve(value)` |
| `rejected`（已拒绝） | 已失败 | 调用 `reject(reason)`，或执行器抛错 |

> 术语辨析：`resolved`（已决议）与 `fulfilled`（已兑现）**不是同义词**。`resolved` 只表示"结果已确定、不能再改"，包含两种去向——被兑现（fulfilled）或被拒绝（rejected）；甚至 `resolve(另一个待定 Promise)` 时，状态会先变成 resolved 而仍停留在 pending 等待那个 Promise 落定。所以描述状态请统一用 `pending → fulfilled / rejected`。

1. **状态只能从 pending 变为 fulfilled 或 rejected，且只能变一次**，之后再调 `resolve/reject` 无效。
2. 状态一旦确定，`then` 里的回调就会被放入微任务队列，等同步代码执行完再跑。
3. **执行器函数是同步执行的**（只是里面的异步任务不阻塞），这一点常被考到。

```js
console.log('1');
const p = new Promise((resolve) => {
  console.log('2');       // 同步执行
  resolve('done');
});
p.then(v => console.log('4')); // 微任务，最后跑
console.log('3');
// 输出：1 2 3 4
```

Promise 的**优点**：支持链式调用解决回调地狱，指定回调更灵活（可以先拿到 Promise 再挂 `then`）。**缺点**：无法取消，错误需要 `catch` 兜底，`pending` 状态下无法得知进度。

### 10.3 `then` 方法与返回值规则（重点）

`then` 的第一个参数是成功回调，第二个参数是失败回调。它**总是返回一个新的 Promise**，这个新 Promise 的状态由回调的返回值决定——这是链式调用能成立的根本原因。

```js
const p = new Promise((resolve, reject) => {
  setTimeout(() => resolve('用户数据'), 1000);
});

const result = p.then(
  value => {
    console.log(value);              // 用户数据
    // return 一个非 Promise 值 → 新 Promise 状态变为 fulfilled，值就是这个返回值
    return 'ok';
  },
  reason => {
    console.warn(reason);
  }
);

console.log(result); // Promise { <pending> } → 稍后变为 fulfilled
```

三种返回值对应三种结果，务必记住：

| 回调的返回值 | 新 Promise 的状态 | 下游 `then` 收到的值 |
| --- | --- | --- |
| 非 Promise 的普通值（数字、字符串、对象、undefined） | `fulfilled` | 该返回值 |
| 一个 Promise 对象 | 跟随这个 Promise 的状态 | 该 Promise 的结果 |
| 抛出异常 `throw new Error()` | `rejected` | 进入下游的失败回调 / `catch` |

```js
Promise.resolve(1)
  .then(v => v + 1)                 // 普通值 → 2
  .then(v => { throw new Error('出错了'); }) // 抛错 → rejected
  .then(v => console.log('不会执行'))
  .catch(err => console.log(err.message)); // 出错了
```

**值的穿透**：如果 `then` 没传回调（或传了 `null`），值会直接穿透到下一个 `then`。

```js
Promise.resolve('a')
  .then()                 // 没传回调
  .then(v => console.log(v)); // 'a'
```

### 10.4 `catch` 方法

`catch(onRejected)` 等价于 `then(null, onRejected)`，专门兜住链路上任意一环的错误：

```js
const p = new Promise((resolve, reject) => {
  setTimeout(() => reject('出错了'), 1000);
});

p.catch(reason => console.warn(reason)); // 出错了
```

**实践建议**：链式调用时只在**末尾写一个 `catch`**，不要每个 `then` 都配失败回调——这正是 Promise 相对回调嵌套的优势：

```js
getUser()
  .then(user => getOrders(user.id))
  .then(orders => getGoods(orders[0].id))
  .then(goods => console.log(goods))
  .catch(err => console.error('任意一环失败都会到这里：', err)); // 统一兜底
```

### 10.5 实践一：封装文件读取

Node.js 早期的 `fs.readFile` 只支持回调，用 Promise 包一层就能链式调用：

```js
const fs = require('fs');

// 封装：成功 resolve 数据，失败 reject 错误
const p = new Promise((resolve, reject) => {
  fs.readFile('./resource/为学.md', (err, data) => {
    if (err) reject(err);
    else resolve(data);
  });
});

p.then(value => {
  console.log(value.toString());
}, reason => {
  console.log('读取失败：', reason);
});
```

更进一步，可以封装成通用函数（这也是后面所有 Promise API 的鼻祖）：

```js
function readFile(path) {
  return new Promise((resolve, reject) => {
    fs.readFile(path, (err, data) => {
      err ? reject(err) : resolve(data);
    });
  });
}

// 链式读取三个文件，摆脱嵌套
readFile('./resource/为学.md')
  .then(data1 => {
    console.log(data1.toString());
    return readFile('./resource/插秧诗.md');   // 返回 Promise，交给下一个 then
  })
  .then(data2 => {
    console.log(data2.toString());
    return readFile('./resource/观书有感.md');
  })
  .then(data3 => {
    console.log(data3.toString());
  })
  .catch(err => console.log('出错：', err));
```

对比 10.1 的嵌套写法：三个文件变成三行平铺的 `then`，错误只兜一次——**这就是 Promise 解决回调地狱的具体形态**。

### 10.6 实践二：封装 AJAX

```js
const p = new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', 'https://api.apiopen.top/getJoke');

  // 先挂监听，再 send
  xhr.onreadystatechange = function () {
    if (xhr.readyState === 4) {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response);          // 成功
      } else {
        reject(xhr.status);             // 失败
      }
    }
  };

  xhr.send();
});

p.then(value => {
  console.log(value);
}, reason => {
  console.error(reason);
});
```

这个模式在早期项目里到处都是。现在的 `fetch`、`axios` 本身就是 Promise 化的，原理一致。

### 10.7 组合方法：`all` 与 `race`（ES6 内置）

除了实例方法，`Promise` 构造函数上还有两个静态方法，用于协调多个 Promise。

**`Promise.all(iterable)`：全部成功才算成功**

```js
const p1 = new Promise((resolve) => setTimeout(() => resolve('P1 成功'), 1000));
const p2 = Promise.resolve('P2 成功');
const p3 = Promise.resolve('P3 成功');

const result = Promise.all([p1, p2, p3]);
result.then(values => {
  console.log(values); // ['P1 成功', 'P2 成功', 'P3 成功']，顺序与传入顺序一致
}).catch(err => console.log(err));
```

只要有一个失败，整体就进入 `rejected`（"一票否决"），适合"多个接口都拿到数据后才渲染页面"的场景。

**`Promise.race(iterable)`：第一个确定状态的说了算**

```js
const p1 = new Promise((resolve) => setTimeout(() => resolve('P1 快'), 1000));
const p2 = new Promise((resolve) => setTimeout(() => resolve('P2 慢'), 2000));

Promise.race([p1, p2]).then(value => {
  console.log(value); // P1 快
});
```

典型用途：请求超时控制、多个镜像源取最快的一个。

**`Promise.resolve` / `Promise.reject`** 用于快速造一个已确定状态的 Promise，写测试或返回默认值时很方便。

### 10.8 常见误区

| 误区 | 正确理解 |
| --- | --- |
| "`new Promise` 里的代码是异步的" | 执行器函数**同步执行**，只有回调时机是异步的 |
| "`then` 里 `return` 的值能直接拿到" | `then` 总是返回**新 Promise**，要接着 `then` 或 `await` |
| "忘记 `return` 也能串起来" | 回调里 `return readFile(...)` 漏写 `return`，下一个 `then` 拿到的是 `undefined` |
| "在 `then` 里 `throw` 不会被捕" | 会，变成 `rejected`，能被后续 `catch` 接住 |
| "`catch` 只能放在最后" | 可以放在中间，但那样它**只捕获它前面**的错误 |
| "`resolve` 之后再 `reject` 还能改状态" | 不能，状态只能确定一次 |

### 10.9 本章小结

- Promise 三状态：`pending` → `fulfilled` / `rejected`，只能变一次。
- `then(onFulfilled, onRejected)` 返回**新 Promise**，其状态由回调返回值（普通值 / Promise / 抛错）决定。
- `catch` 统一兜错，链式调用只在末尾写一次。
- 封装异步 API 的固定套路：把回调式接口包成 `return new Promise((resolve, reject) => {...})`。
- `Promise.all` 一票否决、`Promise.race` 先到先得。

---

## 11. Set 与 Map

ES6 新增的两个数据结构，弥补了数组"去重难"和对象"键只能是字符串"的短板。

### 11.1 Set：成员唯一的集合

`Set` 是一组**无序、不重复**的值。最常用的卖点就是**自动去重**。

```js
// 创建
let s = new Set();          // 空集合
let s2 = new Set([1, 2, 3, 4, 5, 4, 3, 2, 1]);
console.log(s2);            // Set(5) { 1, 2, 3, 4, 5 } —— 自动去重
console.log(s2.size);       // 5，注意是属性不是方法，不带括号

// 常用 API
s.add('小明');              // 添加，返回 Set 本身，可链式
s.add('小红');
s.add('小明');              // 重复添加无效
console.log(s);             // Set(2) { '小明', '小红' }

console.log(s.has('小明')); // true：判断是否存在
s.delete('小红');           // 删除指定值
console.log(s.size);        // 1
s.clear();                  // 清空
console.log(s.size);        // 0
```

**遍历**：Set 部署了 `Symbol.iterator` 接口，所以可以用 `for...of` 和 `forEach`。

```js
const set = new Set(['a', 'b', 'c']);

for (let v of set) {
  console.log(v); // a / b / c
}

set.forEach(v => console.log(v)); // 同上
```

**三个高频应用**

```js
// ① 数组去重（最常用）
const arr = [1, 2, 2, 3, 3, 3, 4];
const unique = [...new Set(arr)];
console.log(unique); // [1, 2, 3, 4]
// 也可以用 Array.from(new Set(arr))

// ② 交集
const a = new Set([1, 2, 3, 4]);
const b = new Set([3, 4, 5, 6]);
const intersection = [...a].filter(x => b.has(x));
console.log(intersection); // [3, 4]

// ③ 并集
const union = [...new Set([...a, ...b])];
console.log(union); // [1, 2, 3, 4, 5, 6]

// ④ 差集（在 a 中不在 b 中）
const difference = [...a].filter(x => !b.has(x));
console.log(difference); // [1, 2]
```

**关于"重复"的判定**：Set 使用 `SameValueZero` 算法，与 `===` 基本一致，唯一例外是 `NaN` 被认为等于自身。

```js
console.log([...new Set([NaN, NaN])].length); // 1
console.log([...new Set([1, '1'])].length);   // 2：类型不同，不算重复
console.log([...new Set([{a:1}, {a:1}])].length); // 2：对象引用不同
```

### 11.2 Map：键可以是任意类型的字典

对象的键只能是字符串（或 Symbol），`Map` 的键可以是**任意类型**，包括对象、函数。

```js
// 创建
let m = new Map();
let m2 = new Map([['k1', '值1'], ['k2', '值2']]); // 传入二维数组，每一项是 [键, 值]

// 常用 API
const key = { id: 1 };
m.set('name', '小明');     // 键是字符串
m.set(key, '对象作为键');   // 键是对象
m.set(1, '数字作为键');

console.log(m.get('name')); // 小明
console.log(m.get(key));    // 对象作为键
console.log(m.size);        // 3

console.log(m.has('name')); // true
m.delete('name');           // 删除
m.clear();                  // 清空
```

**遍历**

```js
const map = new Map([['a', 1], ['b', 2]]);

// 直接遍历得到 [key, value] 数组
for (let item of map) {
  console.log(item); // ['a', 1]  ['b', 2]
}

// 解构写法更常用
for (let [k, v] of map) {
  console.log(k, v); // a 1   b 2
}

// 三个专用迭代器
for (let k of map.keys()) console.log(k);    // a b
for (let v of map.values()) console.log(v);  // 1 2
for (let [k, v] of map.entries()) console.log(k, v);

// 可以使用 forEach
map.forEach((value, key) => console.log(key, value));
```

### 11.3 Map 与 Object 对比

| 对比项 | Object | Map |
| --- | --- | --- |
| 键的类型 | 只能是字符串 / Symbol | 任意类型（对象、函数、数字都行） |
| 键的顺序 | 整数键会被提前，顺序不严格 | 严格按插入顺序 |
| 元素个数 | 需要 `Object.keys(obj).length` 手动算 | `map.size` 直接读 |
| 遍历 | 需要 `for...in` 或 `Object.keys`，且包含原型链风险 | 原生可迭代，`for...of` 直接用 |
| 性能 | 频繁增删键时表现一般 | 频繁增删场景更优 |
| 原型链干扰 | 有（`obj.toString` 等） | 无 |
| 适用场景 | 结构固定的配置、简单数据、需要 JSON 序列化 | 键类型多样、频繁增删、需要稳定顺序 |

**一个典型的选择场景**

```js
// 需要以 DOM 节点为键缓存状态时，Object 无能为力
const cache = new Map();
const el = document.querySelector('#app');
cache.set(el, { clicked: true });
console.log(cache.get(el));
```

`Map` 转对象、对象转 Map 也很方便：

```js
// Object → Map
const obj = { a: 1, b: 2 };
const map = new Map(Object.entries(obj));

// Map → Object（键会被转成字符串）
const back = Object.fromEntries(map);
```

> 提醒：`Object.entries` 属 ES2017、`Object.fromEntries` 属 ES2019，这里只是说明转换方式，不在 ES6 范围内。

### 11.4 补充：WeakSet 与 WeakMap

ES6 同时提供了弱引用版本，它们**只能存对象**，且**不可遍历、没有 `size`**，用于"不阻止垃圾回收"的场景（如给 DOM 元素挂内部数据，元素被移除后自动释放）。

```js
const ws = new WeakSet();
const obj = {};
ws.add(obj);
console.log(ws.has(obj)); // true
// ws.size 是 undefined，不能遍历
```

新手阶段知道存在即可，主要用 Set 和 Map。

### 11.5 本章小结

- `Set`：唯一值集合，`add/has/delete/clear/size`，去重首选 `[...new Set(arr)]`。
- `Set` 的交并差要自己用 `filter` + `has` 组合实现。
- `Map`：任意类型键的有序字典，`set/get/has/delete/clear/size`，原生可迭代。
- 选型口诀：**只要值不重复 → Set；只要键不是字符串或需要稳定顺序 → Map**。

---

## 12. class 类与继承

`class` 是 ES6 里"看起来最不像 JavaScript"的特性。但它是**语法糖**：底层仍然是原型链，只是写法向 Java、C++ 靠拢，让面向对象更直观。

### 12.1 从 ES5 构造函数说起

```js
// ES5 写法
function Phone(brand, price) {
  this.brand = brand;
  this.price = price;
}

// 方法必须挂在原型上，否则每个实例都存一份，浪费内存
Phone.prototype.call = function () {
  console.log('我可以打电话!!');
};

let huawei = new Phone('华为', 5999);
huawei.call();          // 我可以打电话!!
console.log(huawei.brand); // 华为
```

ES6 的 `class` 完全等价，但写法干净了很多：

```js
class Phone {
  // 构造方法，名字固定为 constructor，new 时自动执行
  constructor(brand, price) {
    this.brand = brand;
    this.price = price;
  }

  // 方法自动挂到原型上，且不需要逗号分隔
  call() {
    console.log('我可以打电话!!');
  }
}

let huawei = new Phone('华为', 5999);
huawei.call();
console.log(huawei.brand);
```

### 12.2 class 的四条硬规则

```js
// ① 必须用 new 调用
Phone(); // TypeError: Class constructor Phone cannot be invoked without 'new'

// ② class 不会变量提升（函数声明会）
const p = new Person(); // ReferenceError: Cannot access 'Person' before initialization
class Person {}

// ③ class 内部默认是严格模式，无需写 'use strict'
class A { constructor() { undeclared = 1; } } // 抛 ReferenceError

// ④ 原型方法不可枚举
console.log(Object.keys(Phone.prototype)); // []
```

第 ④ 点很实用：`for...in` 遍历实例时不会把类方法算进去。

### 12.3 类的方法除了 constructor，还有几种

| 方法类型 | 写法 | 归属 | 调用方式 |
| --- | --- | --- | --- |
| 构造方法 | `constructor() {}` | 类本身（`new` 时执行） | `new Phone()` |
| 实例方法 | `call() {}` | `Phone.prototype` | `实例.call()` |
| 静态方法 | `static only() {}` | 类本身 | `Phone.only()` |
| 静态属性 | `static type = '手机'` | 类本身 | `Phone.type` |
| 访问器 | `get price() {}` / `set price(v) {}` | `Phone.prototype` | `实例.price` |

### 12.4 继承：extends 与 super

```js
class Phone {
  constructor(brand, price) {
    this.brand = brand;
    this.price = price;
  }
  call() {
    console.log('我可以打电话!!');
  }
}

// 智能手机继承手机
class SmartPhone extends Phone {
  constructor(brand, price, color, size) {
    super(brand, price);   // 相当于调用父类构造函数，必须写在 this 之前
    this.color = color;
    this.size = size;
  }

  photo() {
    console.log('我可以拍照!!');
  }

  playGame() {
    console.log('我可以玩游戏!!');
  }
}

const xiaomi = new SmartPhone('小米', 1999, '黑色', '4.7inch');
xiaomi.call();      // 我可以打电话!! —— 继承自父类
xiaomi.photo();     // 我可以拍照!!   —— 子类扩展
console.log(xiaomi.brand, xiaomi.color); // 小米 黑色
```

关于 `super` 的三条要点：

1. **子类写了 `constructor` 就必须调用 `super()`**，否则抛错：`Must call super constructor in derived class before accessing 'this'`。
2. 如果子类**不写 `constructor`**，默认会隐式调用 `super(...args)`，可以省略。
3. `super` 还有第二种用法：**在方法里调用父类的同名方法**。

```js
class SmartPhone extends Phone {
  call() {
    super.call();            // 先执行父类逻辑
    console.log('我还可以视频通话'); // 再扩展
  }
}
```

这种方式叫**方法重写（override）**，是继承里最实用的部分：既复用父类行为，又加上子类差异。

### 12.5 静态成员

`static` 修饰的属性和方法属于**类本身**，不属于实例：

```js
class Phone {
  static type = '手机';        // 静态属性
  static change() {            // 静态方法
    console.log('我可以改变世界');
  }
}

let nokia = new Phone();
console.log(nokia.type);   // undefined：实例访问不到静态属性
console.log(Phone.type);   // '手机'
nokia.change();            // TypeError: nokia.change is not a function
Phone.change();            // 我可以改变世界
```

静态方法内部的 `this` 指向**类本身**：

```js
class MathUtil {
  static PI = 3.14;
  static area(r) {
    return this.PI * r * r;   // this 指向 MathUtil
  }
}
console.log(MathUtil.area(2)); // 12.56
```

两条注意：

- `static` **不能修饰 `constructor`**，`constructor` 本身就是"创建实例"的入口。
- 静态成员会被子类继承：`class B extends A {}` 后，`B.staticFn()` 依然可调用。

> 版本提醒：`static type = '手机'` 这种"静态属性"写法属于 **ES2022** 的 class fields 语法，课件为演示方便直接使用。在 ES6 时代要写成"先声明类，再挂属性"：
>
> ```js
> class Phone {
>   static change() {
>     console.log('我可以改变世界');
>   }
> }
> Phone.type = '手机'; // 类声明之后手动挂静态属性
> ```
>
> `static` **方法**本身是 ES6 就有的，不属于后续版本。
>
> 另外注意**别用 `name` 当这个属性名**：`name` 是函数（包括类）自带的**不可写**属性，`Phone.name = '手机'` 这种赋值会被静默忽略，`Phone.name` 读到的仍是类名 `'Phone'`。因此示例统一改用 `type`。

### 12.6 getter 与 setter

给属性加"读写拦截"，可以在赋值时做校验、在读取时做计算：

```js
class Phone {
  get price() {
    console.log('价格属性被读取了');
    return 'iloveyou';   // 读取时返回的内容
  }

  set price(newVal) {
    console.log('价格属性被修改了');
    // 这里可以做校验、格式化
  }
}

let s = new Phone();
console.log(s.price);       // 价格属性被读取了 → iloveyou
s.price = 'free';           // 价格属性被修改了
```

注意：如果 `get` 里 `return` 的是另一个内部变量，记得在 `set` 里同步更新，否则会出现"读到的和写进去的不一致"。这一点与 Vue 2 的响应式原理（`Object.defineProperty` 的 getter/setter）是同一套思路。

### 12.7 class 与 ES5 构造函数的关系

`class` 并不是新的继承模型，底层依旧是原型。验证一下：

```js
class Phone {}
console.log(typeof Phone);                       // 'function' —— 类本质是函数
console.log(Phone.prototype.constructor === Phone); // true
console.log(Object.getPrototypeOf(Phone.prototype) === Object.prototype); // true
```

子类的原型链是一条两条链的结构（这是 `extends` 的实质）：

```js
class A {}
class B extends A {}
const b = new B();

console.log(Object.getPrototypeOf(B) === A);            // true：静态成员继承
console.log(Object.getPrototypeOf(b) === B.prototype);   // true：实例链
console.log(Object.getPrototypeOf(B.prototype) === A.prototype); // true：方法继承
```

理解了这三行，就理解了 `class` 的所有行为来源。

### 12.8 常见坑

| 坑 | 说明 |
| --- | --- |
| 方法间加逗号 | `class` 内方法之间**不能**写逗号，写了会语法错误（这是与对象字面量最大的区别） |
| 忘记 `new` | 类必须 `new`，直接调用抛错 |
| 子类 `this` 在 `super()` 之前使用 | 抛错，`super` 必须先执行 |
| 在方法里把普通函数当回调 | `this` 会丢，用箭头函数或 `bind` 保住 |
| 以为 class 提升 | 不提升，`new` 必须写在声明之后 |

### 12.9 本章小结

- `class` 是原型继承的语法糖，`typeof` 仍是 `'function'`。
- `constructor` 定义实例属性，类体方法自动挂原型且不可枚举，方法之间不加逗号。
- 继承用 `extends` + `super`；子类构造器必须先调 `super()`，方法里可用 `super.method()` 复用父类逻辑。
- `static` 成员属于类本身，实例访问不到；`get`/`set` 用于读写拦截。

---

## 13. 数值扩展与对象方法扩展

这一章的内容都很"碎"，但每一个都对应一个真实痛点。学的时候不必背，记住"遇到什么问题来查这张表"即可。

### 13.1 Number.EPSILON：解决浮点误差

JavaScript 用 IEEE 754 双精度浮点数表示数字，小数运算存在精度损失：

```js
console.log(0.1 + 0.2);            // 0.30000000000000004
console.log(0.1 + 0.2 === 0.3);    // false
```

原因是 `0.1` 和 `0.2` 在二进制里都是无限循环小数，只能近似存储。这不是 JS 独有的 bug，所有遵循该标准的语言都一样。

ES6 引入了 `Number.EPSILON`，表示**大于 1 的最小浮点数与 1 的差**，值约为 `2.220446049250313e-16`。它的用途是作为"可接受的误差范围"：

```js
function equal(a, b) {
  return Math.abs(a - b) < Number.EPSILON;
}

console.log(equal(0.1 + 0.2, 0.3)); // true
```

工程上还可以用 `abs(a-b) < Math.pow(10, -n)` 做"保留 n 位"的宽松比较（如比较金额时按分比较）。

### 13.2 二进制与八进制字面量

ES6 新增了两种字面量写法（此前只能用十六进制 `0x`）：

```js
let b = 0b1010;   // 二进制，等于十进制的 10
let o = 0o777;    // 八进制，等于十进制的 511
let d = 100;      // 十进制
let x = 0xff;     // 十六进制，等于 255

console.log(b, o, d, x); // 10 511 100 255
```

注意前缀区分：`0b` 二进制、`0o` 八进制、`0x` 十六进制，字母大小写都行（`0B`、`0O`、`0X`）。历史上老式八进制写作 `0777`（无字母），在严格模式下是非法的，ES6 的 `0o777` 就是为了统一规范。

### 13.3 Number 的新静态方法

这五个方法与全局函数同名但**行为更严格**——它们不会强制类型转换，传非数字一律返回 `false` 或 `NaN`：

| 方法 | 作用 | 对比全局函数的差异 |
| --- | --- | --- |
| `Number.isFinite(n)` | 判断是否有限数 | `isFinite('100')` → `true`（先转数字）；`Number.isFinite('100')` → `false` |
| `Number.isNaN(n)` | 判断是否 `NaN` | `isNaN('abc')` → `true`；`Number.isNaN('abc')` → `false` |
| `Number.parseInt(s, radix)` | 转整数 | 行为与全局 `parseInt` 一致，只是挂到了 Number 上 |
| `Number.parseFloat(s)` | 转浮点数 | 同上 |
| `Number.isInteger(n)` | 判断是否整数 | `Number.isInteger(5.0)` → `true`（`5.0` 就是 `5`） |

```js
console.log(Number.isFinite(100));    // true
console.log(Number.isFinite(100.5));  // true
console.log(Number.isFinite(-100));   // true
console.log(Number.isFinite(Infinity)); // false
console.log(Number.isFinite('100'));  // false —— 不做隐式转换

console.log(Number.isNaN(NaN));       // true
console.log(Number.isNaN('abc'));     // false —— 不做隐式转换

console.log(Number.parseInt('12px')); // 12
console.log(Number.parseFloat('3.14abc')); // 3.14

console.log(Number.isInteger(5));     // true
console.log(Number.isInteger(5.5));   // false
console.log(Number.isInteger('5'));   // false
```

**实践建议**：判断"是不是数字"时优先用 `Number.isFinite` 而不是 `typeof x === 'number'`——因为 `typeof NaN === 'number'` 也是 `true`，会漏掉 `NaN` 和 `Infinity`。

### 13.4 Math 的新方法

| 方法 | 作用 | 示例 |
| --- | --- | --- |
| `Math.trunc(x)` | 直接抹掉小数部分（不四舍五入） | `Math.trunc(4.9)` → `4`，`Math.trunc(-4.9)` → `-4` |
| `Math.sign(x)` | 判断正负零 | 正数 `1`，负数 `-1`，零 `0` |

```js
console.log(Math.trunc(4.9));   // 4
console.log(Math.trunc(-4.9));  // -4  （与 Math.floor(-4.9) 得 -5 不同）
console.log(Math.trunc(123.456)); // 123

console.log(Math.sign(100));    // 1
console.log(Math.sign(0));      // 0
console.log(Math.sign(-100));   // -1
```

`Math.trunc` 与 `Math.floor` 的差异只在负数上：`floor` 向负无穷取整，`trunc` 朝零截断。取"去掉小数"的语义时用 `trunc` 更准确。

### 13.5 Object.is：更严格的相等判断

`Object.is(a, b)` 与 `===` 大体一致，只有两处不同：

```js
console.log(Object.is(1, 1));           // true
console.log(Object.is('a', 'a'));       // true
console.log(Object.is({}, {}));         // false（引用不同）

// 差异 1：NaN 与自身
console.log(NaN === NaN);               // false
console.log(Object.is(NaN, NaN));       // true

// 差异 2：正负零
console.log(+0 === -0);                 // true
console.log(Object.is(+0, -0));         // false
```

用途：判断两个值是否"真的同一个值"，尤其需要区分 `NaN` 时。日常比较仍以 `===` 为主。

### 13.6 Object.assign：对象合并

把一个或多个源对象的**可枚举自有属性**复制到目标对象：

```js
const config1 = {
  host: 'localhost',
  port: 3306,
  name: 'root',
  pass: 'root',
  test: 'test'
};

const config2 = {
  host: 'http://atguigu.com',
  port: 33060,
  name: 'atguigu.com',
  pass: 'iloveyou',
  test2: 'test2'
};

console.log(Object.assign(config1, config2));
// { host: 'http://atguigu.com', port: 33060, name: 'atguigu.com',
//   pass: 'iloveyou', test: 'test', test2: 'test2' }
```

三个关键行为：

1. **第一个参数是目标对象，会被直接修改并作为返回值返回**。想保留原对象，用空对象做目标：`Object.assign({}, a, b)`。
2. **同名属性后者覆盖前者**（`config2` 覆盖了 `config1` 的 host、port 等）。
3. **是浅拷贝**：嵌套对象只复制引用，源对象改了会影响结果。

```js
const source = { nested: { v: 1 } };
const target = Object.assign({}, source);
target.nested.v = 2;
console.log(source.nested.v); // 2 —— 浅拷贝的证据
```

在 ES2018 之后对象展开运算符 `{ ...a, ...b }` 能实现同样效果，二者都做浅拷贝。

### 13.7 原型操作：setPrototypeOf 与 getPrototypeOf

```js
const school = {
  name: '尚硅谷'
};

const cities = {
  xiaoqu: ['北京', '上海', '深圳']
};

// 直接设置原型（效果等同于 school.__proto__ = cities）
Object.setPrototypeOf(school, cities);
console.log(school);
// 可以在 school 上访问到 xiaoqu 了
console.log(school.xiaoqu); // ['北京', '上海', '深圳']

// 读取原型
console.log(Object.getPrototypeOf(school) === cities); // true
```

`Object.setPrototypeOf` 是 `__proto__` 的规范替代写法，因为 `__proto__` 只是浏览器实现的"事实标准"，不是 ECMAScript 标准语法。不过**性能敏感场景应避免在运行时修改原型**（会破坏内联缓存），更好的做法是在创建时用 `Object.create(proto)`。

### 13.8 其他对象方法（版本提醒）

下表这些方法常被误认为 ES6，实际是后续版本，只做提示，不展开：

| 方法 | 真实版本 | 作用 |
| --- | --- | --- |
| `Object.values(obj)` | ES2017 | 取所有值组成的数组 |
| `Object.entries(obj)` | ES2017 | 取 `[key, value]` 二维数组 |
| `Object.fromEntries(arr)` | ES2019 | 二维数组转对象 |
| `Object.getOwnPropertyDescriptors` | ES2017 | 获取属性描述符集合 |

ES6 本身对 `Object` 的扩展主要是 `Object.is`、`Object.assign`、`Object.setPrototypeOf`，以及第 5 章讲的属性简写、第 8 章讲的 `Object.getOwnPropertySymbols`。要注意 `Object.getPrototypeOf` 是 **ES5.1 已有**的方法，13.7 节只是用它来验证原型链，不属于 ES6 新增。

### 13.9 本章小结

- 浮点比较用 `Number.EPSILON` 做误差容忍，不要直接用 `===`。
- 新字面量：`0b` 二进制、`0o` 八进制；新的 `Number.is*` 系列不做隐式转换，比全局函数更安全。
- `Math.trunc` 截断取整、`Math.sign` 判断符号。
- `Object.is` 与 `===` 的差异仅在 `NaN` 与 `±0`。
- `Object.assign(target, ...sources)` 修改并返回 target，是浅拷贝，同名属性后者覆盖前者。

---

## 14. 模块化

前面 13 章讲的都是"单个文件内怎么写"。模块化解决的是**跨文件怎么组织**——把一个大项目拆成若干独立、可复用的模块，这也是现代前端工程的起点。

### 14.1 为什么需要模块化

| 好处 | 说明 |
| --- | --- |
| 防变量污染 | 每个模块有自己的作用域，不会把变量全挂到 `window` 上 |
| 高复用 | 一个工具模块可以被多处 `import` |
| 可维护 | 改一个模块不影响其他模块的内部实现 |
| 依赖清晰 | 每个文件头部写明引入了什么，结构一目了然 |

模块化演进历史：ES6 之前社区有 **CommonJS**（Node.js 使用）和 **AMD**（`RequireJS`）、**CMD**（`SeaJS`），各写各的、互不兼容。ES6 在语言层面统一了模块规范，现在浏览器原生的 `import/export` 就是它。

### 14.2 模块的三个关键特性

```js
// 1. 模块内的变量默认是局部的，不会污染全局
let a = 1;

// 2. 模块有自己的顶层作用域，且自动是严格模式
// 3. 一个模块被多处引入，只执行一次（单例），导出的是同一份引用
```

### 14.3 暴露数据：三种 `export` 方式

课件用 `m1.js`、`m2.js`、`m3.js` 三个文件演示了三种写法。

**① 分别暴露**——声明时就 export

```js
// m1.js
export let school = '尚硅谷';

export function teach() {
  console.log('我们可以教给你开发技能');
}
```

**② 统一暴露**——先声明，最后集中 export

```js
// m2.js
let school = '尚硅谷';

function findJob() {
  console.log('我们可以帮助你找工作!!');
}

export { school, findJob };
```

**③ 默认暴露**——`export default`，一个模块只能有一个

```js
// m3.js
export default {
  school: 'ATGUIGU',
  change: function () {
    console.log('我们可以改变你!!');
  }
};
```

三种方式的区别：

| 方式 | 语法 | 导入时的写法 | 一个模块能有几个 |
| --- | --- | --- | --- |
| 分别暴露 | `export let x` / `export function f` | `import { x, f }` | 多个 |
| 统一暴露 | `export { x, f }` | `import { x, f }` | 多个 |
| 默认暴露 | `export default {...}` | `import m from './m3.js'` | **仅一个** |

### 14.4 导入数据：三种 `import` 方式

```js
// ① 通用的导入方式：整体导入，用命名空间访问
import * as m1 from './src/js/m1.js';
console.log(m1.school); // 尚硅谷
m1.teach();             // 我们可以教给你开发技能

// ② 解构赋值形式：按名字精确导入
import { school, teach } from './src/js/m1.js';
import { school as m2School, findJob } from './src/js/m2.js';  // 重命名避免冲突

// ③ 简便形式：只针对默认暴露
import m3 from './src/js/m3.js';
console.log(m3.school); // ATGUIGU
m3.change();            // 我们可以改变你!!
```

注意第 ② 种里 `import { school, teach }` 和 `import { school as m2School }` 的区别：因为 `m1` 和 `m2` 都导出了 `school`，同时导入会冲突，必须用 `as` 重命名。

**默认暴露的另一种导入写法**：如果同时想拿默认和具名，可以混用。

```js
import m3, { something } from './src/js/m3.js'; // 默认在前，具名在后
```

### 14.5 一个完整的模块化示例

课件 `ES6_module/src/js/` 下的结构：`m1.js`、`m2.js`、`m3.js` 三个模块，`app.js` 作为入口统一管理。

```js
// app.js
import * as m1 from './m1.js';
import * as m2 from './m2.js';
import * as m3 from './m3.js';

console.log(m1.school);  // 尚硅谷
console.log(m2.school);  // 尚硅谷
console.log(m3.default.school); // ATGUIGU —— 默认暴露在命名空间里叫 default
```

然后在 html 里引入入口文件，**必须声明 `type="module"`**：

```html
<script type="module">
  import * as m1 from './src/js/m1.js';
  console.log(m1.school);
</script>

<!-- 或者引用入口文件 -->
<script type="module" src="./src/js/app.js"></script>
```

### 14.6 为什么必须用 http 打开

双击 html（`file://` 协议）时，浏览器会报：

```
Access to script at 'file:///.../m1.js' from origin 'null' has been blocked by CORS policy
```

原因：ES6 模块加载受同源策略约束，`file://` 协议的 origin 是 `null`，不算合法同源。解决办法是起一个本地静态服务器：

- VS Code 装 **Live Server** 插件，右键 html → `Open with Live Server`；
- 或用 `npx http-server`、`python -m http.server` 等命令。

课件的 `.vscode/settings.json` 里配置了 `"liveServer.settings.port": 5501`，就是统一端口、避免多人协作冲突。

### 14.7 工程化：Babel 转译 + Browserify 打包

ES6 模块在现代浏览器里可以直接用，但遇到需要兼容旧浏览器、或者项目变大需要打包成一个文件时，就要借助工具。课件演示了这套经典流程：

**第一步：用 Babel 把 ES6 语法转成 ES5**

```bash
npm install --save-dev babel-cli babel-preset-env browserify
npx babel src/js -d dist/js --presets=babel-preset-env
```

`babel-preset-env` 是一个"预设集合"，把 ES6+ 语法（`let`、箭头函数、`class`、模板字符串等）统一降级为 ES5 写法。

**第二步：用 Browserify 把 `import/export` 打包成浏览器能识别的单文件**

```bash
npx browserify dist/js/app.js -o dist/bundle.js
```

因为 Babel 只负责语法降级，**不处理模块依赖关系**，打包工具负责把多个 `import` 串成一个文件。

**第三步：页面引入打包产物**

```html
<script src="./dist/bundle.js"></script>
```

`package.json` 里通常把这两步固化成脚本：

```json
{
  "scripts": {
    "build": "babel src/js -d dist/js --presets=babel-preset-env && browserify dist/js/app.js -o dist/bundle.js"
  }
}
```

现在这套组合基本被 **Webpack / Vite** 取代，但原理不变：**转译 + 打包**。理解这两步，就能理解为什么 Vite 项目里 `import` 能直接跑。

### 14.8 六条使用注意

1. **导入的绑定是只读的**：`import { a } from './m.js'` 之后不能 `a = 1`，会报 `Assignment to constant variable`。
2. **`import` 会提升到模块顶部**：写在哪一行都会先执行导入（编译阶段处理）。
3. **必须是顶层语句**：不能写在 `if`、函数内——因为模块的依赖关系要在**编译时**静态分析，这是 `import/export` 与 CommonJS 的 `require` 最本质的区别。
4. **模块只执行一次**：多个文件都 `import './a.js'`，`a.js` 的顶层代码只跑一遍。
5. **循环依赖要小心**：`a.js` 导入 `b.js`、`b.js` 又导入 `a.js`，可能拿到 `undefined`。设计时应尽量保持单向依赖。
6. **路径必须写扩展名或多带 `./`**：`import x from 'm1'` 会失败，浏览器不像 Node 那样自动补 `.js`。

```js
// 正确
import { a } from './m1.js';
import { a } from '../utils/m1.js';

// 错误
import { a } from 'm1.js';   // 缺少 ./，会被当成包名
```

### 14.9 本章小结

- 模块化的价值：作用域隔离、复用、可维护、依赖清晰；ES6 统一了此前 CommonJS/AMD/CMD 的碎片化。
- 三种暴露：分别暴露、统一暴露、默认暴露（只能一个）；三种导入：命名空间 `* as`、解构 `{}`、简便默认。
- 浏览器运行必须 `<script type="module">` 且通过 http 访问。
- 工程化两步走：Babel 转译语法，打包工具处理依赖（Browserify → 如今是 Webpack/Vite）。

---

## 15. 知识点总表与自测

### 15.1 ES6 特性速查表

| 章节 | 特性 | 一句话要点 | 常见坑 |
| --- | --- | --- | --- |
| 2 | `let` | 块级作用域、不可重复声明、有 TDZ | 声明前访问会报错，不是 `undefined` |
| 2 | `const` | 必须初始化、绑定不可改 | 对象属性、数组元素仍可改 |
| 3 | 解构赋值 | 数组按位置、对象按属性名 | 行首 `{}` 要包括号；默认值只对 `undefined` 生效 |
| 4 | 模板字符串 | 反引号 + `${}` + 可换行 | 对象插值得到 `[object Object]` |
| 5 | 对象简写 | `{ name }`、`fn() {}`、`[expr]: v` | 方法简写 ≠ 箭头函数 |
| 5 | 参数默认值 | 只对 `undefined` 生效 | 有默认值的参数应放末尾 |
| 6 | 箭头函数 | `this` 静态、不能 `new`、无 `arguments` | 不能当对象方法、事件回调取不到元素 `this` |
| 7 | rest / spread | 左边收、右边展 | rest 必须最后；`[...obj]` 报错 |
| 8 | Symbol | 第六种原始类型，值唯一 | 不能被遍历/JSON 序列化，不能用 `new` |
| 9 | 迭代器 | `Symbol.iterator` + `next()` 返回 `{value, done}` | 普通对象默认不可 `for...of` |
| 9 | 生成器 | `function*` + `yield` + `next()` | 第一次 `next()` 传参被丢弃 |
| 10 | Promise | 三状态、`then` 返回新 Promise、可链式 | 回调里忘记 `return` |
| 11 | Set | 唯一值集合 | `size` 是属性不是方法 |
| 11 | Map | 任意类型键的有序字典 | 用对象遍历拿不到 Map 内容 |
| 12 | class | 原型继承的语法糖 | 方法间不能加逗号；子类先 `super()` |
| 13 | Number | `EPSILON`、`0b/0o`、`is*` 系列 | `Number.isNaN('abc')` 是 `false` |
| 13 | Object | `is`、`assign`、`setPrototypeOf` | `assign` 是浅拷贝且修改第一个参数 |
| 14 | 模块化 | `export` / `import`、`type="module"` | 必须 http 访问；导入是只读绑定 |

### 15.2 版本边界清单

本笔记严格限定 ES6（ES2015）。下面这些常用写法**不属于** ES6，学习时不要记错版本：

| 写法 | 实际版本 |
| --- | --- |
| `async` / `await` | ES2017 |
| `Object.values` / `Object.entries` | ES2017 |
| `Array.prototype.includes` | ES2016 |
| `**` 幂运算符 | ES2016 |
| 对象展开 `{ ...a }`、对象 rest `{ ...rest }` | ES2018 |
| `Promise.prototype.finally` | ES2018 |
| 正则命名捕获组、`s` 标志 | ES2018 |
| 可选链 `?.`、空值合并 `??` | ES2020 |
| `BigInt`、`globalThis` | ES2020 |
| 类私有字段 `#x`、`static x = 1` 静态字段、类静态块 | ES2022 |

记住大致规律即可：**ES6 定了地基，ES2016-ES2022 主要是加方法、加语法糖，没有新增范式级的特性**——除了 `async/await`（它把 ES6 的 Promise 与生成器思路正式固化成了语法）。

### 15.3 学习建议

1. **按代码量排序投入精力**：实际项目里出现频率最高的是 `let/const`、箭头函数、解构、模板字符串、`import/export`，这五项要练到"不看文档随手写"。`Symbol`、生成器属于"理解即可，用时再查"。
2. **每个特性都亲手改错一次**：本文每个坑都给了错误写法，把它们贴进 Console 看真实报错。报错信息是最高效的老师。
3. **不要过早记忆 API**：`Number.isInteger`、`Math.trunc` 这类方法记住"存在"比记住"怎么用"更重要，IDE 会提示。
4. **理解而非背诵 `this`**：箭头函数的坑第 6 章已经讲透，判断标准始终是"这个函数需不需要自己的 `this`"。
5. **动手写一个小模块**：用 `export` 拆 3 个文件（工具函数、数据、入口），跑一次 Live Server。这一步能同时打通第 14 章和第 3、5 章。

### 15.4 自测题

先自己回答，再对照下方答案。

1. `let` 与 `var` 的区别有哪三条？
2. 为什么 `const` 声明的数组还能 `push`？
3. `const { a: { b } } = obj` 之后，`a` 是不是一个可用变量？
4. 模板字符串里输出 `${{ x: 1 }}` 会得到什么？
5. 用箭头函数实现"点击元素 2 秒后变粉"，为什么外层不能用箭头函数？
6. `function f(...args, a) {}` 有什么问题？
7. `Symbol('a') === Symbol.for('a')` 的结果？
8. `for (let v of { a: 1 })` 会怎样？怎么修复？
9. `function* g() { yield 1; return 2; }`，连续调用两次 `next()` 的结果分别是？
10. `p.then(v => { p2.then(...) })` 与 `p.then(v => p2)` 的区别？
11. `Promise.all` 与 `Promise.race` 的区别？
12. `[1, 2, 1, 3]` 去重的三种写法？
13. 什么情况下必须用 `Map` 而不能用普通对象？
14. 子类构造函数为什么必须先调用 `super()`？
15. 为什么 ES6 模块必须用 http 打开，不能双击 html？

<details>
<summary>参考答案（点击展开）</summary>

1. 块级作用域、不可重复声明、不存在变量提升（TDZ 访问报错）。
2. `const` 锁的是"变量到值的绑定"，数组元素在堆内存里，改元素不算换绑定。
3. 不是。`a` 只是路径，没有生成变量；要同时拿到需写 `const { a, a: { b } } = obj`。
4. `"[object Object]"`，需要 `JSON.stringify` 或取具体属性。
5. 因为箭头函数的 `this` 静态，取的是外层函数的 `this`；`setTimeout` 里的箭头函数能拿到元素 `this`，是因为外层是普通函数。
6. 语法错误，rest 参数必须是最后一个形参。
7. `false`（普通 Symbol 不进全局注册表，与 `Symbol.for` 的值一定不同）。
8. 报 `is not iterable`；给对象部署 `Symbol.iterator`，或用 `Object.keys/entries` 先转成可迭代结构。
9. 第一次 `{ value: 1, done: false }`，第二次 `{ value: 2, done: true }`。
10. 前者返回 `undefined`，下游 `then` 立刻拿到 `undefined` 并继续；后者返回 `p2`，下游会**等 p2 完成**后再执行。
11. `all` 要全部成功（一票否决，结果按传入顺序）；`race` 取第一个确定状态的（可为成功也可为失败）。
12. `[...new Set(arr)]`、`Array.from(new Set(arr))`、`arr.filter((v, i) => arr.indexOf(v) === i)`。
13. 键需要是对象/函数等非字符串类型，或需要稳定插入顺序、需要直接读 `size` 时。
14. 子类没有自己的 `this`，`this` 由父类构造函数创建并返回，所以必须在访问 `this` 前先执行 `super()`。
15. 模块加载受同源策略约束，`file://` 的 origin 是 `null`，会触发 CORS 报错。

</details>

