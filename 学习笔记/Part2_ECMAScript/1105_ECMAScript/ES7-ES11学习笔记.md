# ES7~ES11 新手学习笔记

> 从 ES2016 到 ES2020，五年五个版本，逐条讲清每个新增能力"解决什么问题、怎么写、哪里会错"。

## 写在前面

### 这份笔记怎么用

1. **按版本顺序读**：第 1 章到第 10 章严格按 ES2016 → ES2020 推进。每个版本内部先讲"最常用的那个特性"，再讲配套的小工具。
2. **对着代码看**：本笔记的每一个知识点，都能在 `D:\自学课程笔记\9_ES6\代码\` 下找到对应的原始示例文件，章节开头会标注文件名。代码后面的注释标明了实际输出，建议直接复制到浏览器控制台跑一遍。
3. **重点看"适用场景"和"易错点"**：ES7~ES11 的知识点大多是"一个方法 + 几条规则"，语法本身不难，难在判断什么时候该用它、以及几个会静默出错的坑（`indexOf` 判断数组、`await` 写在 `forEach` 里、`??` 与 `||` 的差别）。
4. **第 11 章是一次串联演练**：把可选链、空值合并、allSettled、动态 import、正则命名分组放在一个真实的小需求里用一遍，这是检验有没有真正吸收的最快方式。
5. **第 12 章是版本边界清单**：课件里有一批"看起来像这一版、其实是更晚版本"的写法（最典型的是 `#私有字段`），必须在这里核对清楚，否则面试和写文档都会说错版本。

### 版本范围说明

本笔记**只覆盖 ES2016（ES7）至 ES2020（ES11）**。ES6（ES2015）的内容（`let/const`、解构、模板字符串、箭头函数、`class`、`Promise`、`Set/Map`、模块化等）已在同目录的 ES6 笔记里系统讲过，这里**不再重复展开**，只在被新特性"改写"的地方用一句话对照。

需要提醒的是：课件（`尚硅谷前端_ES6.pdf`）本身跨越 ES6~ES11，代码目录里也存在两处版本需要特别交代的写法：

| 写法 | 出现在 | 真实归属 | 说明 |
| --- | --- | --- | --- |
| 类字段声明 `name;` | `ES11\1-私有属性.html` | ES2022（class fields） | 教程放在 ES11 讲，正式进标准是 ES2022 |
| 私有字段 `#age` | `ES11\1-私有属性.html` | ES2022（private class fields） | 教程编写时处于 Stage 3，Chrome 74 已实现，标准版本为 ES2022 |

除此之外的写法都与 ES7~ES11 的版本归属一致。完整核对表见第 12 章。

### 各版本一览

| 版本 | 正式名称 | 本笔记对应章 | 核心新增（本笔记覆盖） | 代码目录 |
| --- | --- | --- | --- | --- |
| ES7 | ES2016 | 第 1 章 | `Array.prototype.includes`、指数运算符 `**` | `ES7\` |
| ES8 | ES2017 | 第 2~3 章 | `async` / `await`、`Object.values` / `entries` / `getOwnPropertyDescriptors` | `ES8\` |
| ES9 | ES2018 | 第 4~5 章 | 对象 rest/spread、正则命名分组 / 反向断言 / `dotAll` | `ES9\` |
| ES10 | ES2019 | 第 6 章 | `Object.fromEntries`、`trimStart` / `trimEnd`、`flat` / `flatMap`、`Symbol.description` | `ES10\` |
| ES11 | ES2020 | 第 7~10 章 | 类私有字段、`Promise.allSettled`、`matchAll`、可选链 `?.`、动态 `import()`、`BigInt`、`globalThis` | `ES11\` |

一句话概括这五个版本的气质：**ES7 是补丁，ES8 是一次范式升级（`async/await`），ES9 到 ES11 全是"语法糖 + 标准库补全"**。真正改变写代码方式的只有 ES8 的 `async/await` 和 ES11 的 `?.` / `??`，其余都是让常用操作少写几行。

### 运行环境准备

代码目录里的示例有两种运行方式，混用会报错，先分清楚：

| 文件类型 | 例子 | 打开方式 | 注意 |
| --- | --- | --- | --- |
| 单文件 HTML（内联 `<script>`） | `ES8\1-async.html` | 双击用浏览器打开即可 | 无跨域请求时够用 |
| 含 ESM 的代码（`import` / `export`） | `ES11\5-动态import加载.html` | **必须**用 Live Server 起 http 服务 | `file://` 协议下 module 会被 CORS 策略拦掉 |
| Node 环境脚本（`require`） | `ES8\3-async和await结合读取文件.js` | `node 3-async和await结合读取文件.js` | 需在 `ES8` 目录下执行，否则读不到 `resources\` |

`ES11\.vscode\settings.json` 里已经把 Live Server 端口固定为 5501：

```json
{
    "liveServer.settings.port": 5501
}
```

所以 `ES11` 目录的两个模块示例，正确访问地址是 `http://127.0.0.1:5501/5-动态import加载.html`。

### 目录

| 章节 | 内容 | 对应代码 |
| --- | --- | --- |
| 1 | ES2016（ES7）：数组 includes 与指数运算符 | `ES7\feature.html` |
| 2 | ES2017（ES8）：async 与 await | `ES8\1-async.html`、`2-await.html`、`3-async和await结合读取文件.js`、`4-async与await封装AJAX请求.html` |
| 3 | ES2017（ES8）：对象方法扩展 | `ES8\5-对象方法扩展.html` |
| 4 | ES2018（ES9）：对象的 rest 与 spread | `ES9\1-对象展开.html` |
| 5 | ES2018（ES9）：正则四项扩展 | `ES9\2-正则命名分组.html`、`3-正则断言.html`、`4-正则dotAll模式.html`、`0-resource.html` |
| 6 | ES2019（ES10）：对象、字符串、数组、Symbol 的补全 | `ES10\1~4` |
| 7 | ES2020（ES11）：类私有字段与动态 import | `ES11\1-私有属性.html`、`5-动态import加载.html`、`js\app.js`、`js\hello.js` |
| 8 | ES2020（ES11）：Promise.allSettled 与 matchAll | `ES11\2-Promise.allSettled.html`、`3-String.prototype.matchAll.html` |
| 9 | ES2020（ES11）：可选链与空值合并 | `ES11\4-可选链操作符.html` |
| 10 | ES2020（ES11）：BigInt 与 globalThis | `ES11\6-BigInt.html`、`7-globalThis.html`、`7-globalThis.js` |
| 11 | 综合实战：把版本特性串起来 | 综合运用 |
| 12 | 版本边界清单 | 全量核对 |
| 13 | 特性速查表与自测 | 复习用 |

---

## 1. ES2016（ES7）：数组 includes 与指数运算符

ES7 是 ES6 之后第一个"小版本"，只加了两个东西：一个数组判断方法、一个运算符。没有任何新语法结构，学习成本很低，但 `includes` 的误用率极高——大量老代码还在用 `indexOf` 判断"数组里有没有某项"，这在两种情况下会给出错误结果。

> 素材对应：`D:\自学课程笔记\9_ES6\代码\ES7\feature.html`
> 注意这个文件里 `includes` 部分是被注释掉的，真正执行的是 `**`；两段都要看。

### 1.1 Array.prototype.includes：判断数组"有没有"

#### 适用场景

只要你的问题是"这个数组里**存不存在**某个值"，就该用 `includes`。典型场景：

- 权限判断：`const roles = ['admin', 'editor']; if (roles.includes(user.role)) { ... }`
- 白名单过滤：`const allow = ['.jpg', '.png']; if (allow.includes(ext)) { ... }`
- 标签筛选：用户点了"前端"标签，判断 `selectedTags.includes('前端')`

#### 基本写法

```js
const mingzhu = ['西游记', '红楼梦', '三国演义', '水浒传'];

// 判断
console.log(mingzhu.includes('西游记')); // true
console.log(mingzhu.includes('金瓶梅')); // false
```

返回值是**布尔值**，`true` 表示存在、`false` 表示不存在。这就是它比 `indexOf` 好用的根本原因：语义直接，不需要做任何额外判断。

#### 为什么不继续用 indexOf

`indexOf` 返回的是**下标**，不是布尔值，所以有两个坑：

| 场景 | `includes` | `indexOf` | 说明 |
| --- | --- | --- | --- |
| `['西游记'].includes('西游记')` | `true` | `0` | `indexOf` 命中第一项时返回 `0`，`0` 在 `if` 里是假值，于是 `if (arr.indexOf(x))` 判断会失效 |
| `[NaN].includes(NaN)` | `true` | `-1` | `indexOf` 内部用 `===` 比较，`NaN === NaN` 为 `false`，所以永远找不到 `NaN` |
| `[undefined].includes()` | `true` | `-1` | 不传参数时 `includes` 按 `undefined` 查，而 `indexOf()` 等价于 `indexOf(undefined)`，反而能找到；这一点上两者行为不同 |

用代码验证一下 `NaN` 那个坑：

```js
console.log([1, 2, NaN].indexOf(NaN));  // -1  ← 明明在数组里，却说没有
console.log([1, 2, NaN].includes(NaN)); // true ← 正确
```

原因在于 `includes` 使用 **SameValueZero** 比较算法，它对 `NaN` 与 `NaN` 判定为相等；而 `indexOf` 用的是严格相等 `===`，`NaN` 与自身不相等。

#### 第二个参数：从哪个位置开始找

```js
const arr = ['a', 'b', 'a'];
console.log(arr.includes('a', 1));   // true  ← 从下标 1 开始找，命中下标 2 的 'a'
console.log(arr.includes('a', 3));   // false ← 从下标 3 开始（越界），什么也没找到

// 负数表示从末尾算起
console.log(arr.includes('a', -1));  // true  ← 从倒数第 1 个开始
```

#### 容易混淆的一点：它不回调

`includes` 的参数是**一个值**，不是函数。如果你想"按条件判断是否存在"（比如"有没有价格大于 100 的商品"），得用 `some`：

```js
const goods = [{ price: 20 }, { price: 120 }];

// 错：includes 只能按值全等比较，对象引用不同永远 false
console.log(goods.includes({ price: 20 })); // false

// 对：按条件判断用 some
console.log(goods.some(item => item.price > 100)); // true
```

| 方法 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- |
| `includes(value)` | 值 | 布尔 | 精确值是否存在（支持 `NaN`） |
| `some(fn)` | 函数 | 布尔 | 是否有元素满足条件 |
| `indexOf(value)` | 值 | 下标 / -1 | 需要位置信息时用 |
| `find(fn)` | 函数 | 元素 / `undefined` | 需要拿到满足条件的元素本身 |

#### 适用版本提示

`includes` 同样存在于 `String.prototype` 上（`'abc'.includes('b')`），但**字符串版是 ES6 就有的**，别记混：ES7 新增的只是数组版。

### 1.2 指数运算符 `**`

#### 适用场景

需要算幂的时候。以前只能写 `Math.pow(2, 10)`，现在可以写 `2 ** 10`。真正有价值的场景是**公式类代码**（复利、面积、衰减、坐标变换）：

```js
// 复利：本金 × (1 + 利率)^年数
const amount = 10000 * (1 + 0.05) ** 10;
console.log(amount); // 16288.946267774418
```

#### 基本写法与输出

```js
console.log(2 ** 10);        // 1024
console.log(Math.pow(2, 10)); // 1024  ← 完全相同
```

`**` 与 `Math.pow` 的计算结果一致，区别只在可读性和结合性（下面会讲）。

#### 右结合：连续幂从右往左算

这一点与 `+`、`*` 不同：

```js
console.log(2 ** 3 ** 2);    // 512   ← 等价于 2 ** (3 ** 2) = 2 ** 9
console.log((2 ** 3) ** 2);  // 64
```

`**` 是**右结合**运算符，所以连续写时从最右边开始算。需要按左结合时应显式加括号。

#### 一元负号的坑

`**` 的优先级高于一元负号，所以下面这行直接是**语法错误**：

```js
// console.log(-2 ** 2);      // SyntaxError: Unary operator used immediately before exponentiation expression
console.log((-2) ** 2);       // 4    ← 负数的平方
console.log(-(2 ** 2));       // -4   ← 2 的平方取负
```

规范这么定是为了避免歧义（`-2 ** 2` 到底是 `(-2)**2` 还是 `-(2**2)`）。写法上记住一条：**底数是负数或带一元运算符时，必须加括号**。

#### 配套的赋值运算符 `**=`

同属 ES7，常被漏掉：

```js
let n = 2;
n **= 3;          // 等价于 n = n ** 3
console.log(n);   // 8
```

#### `Math.pow` 还有没有必要用

| 对比项 | `**` | `Math.pow(base, exp)` |
| --- | --- | --- |
| 可读性 | 公式类代码更直观 | 参数顺序容易写反 |
| 结合性 | 右结合，`2**3**2 = 512` | 无此问题，参数分明 |
| 动态参数 | 需要拼字符串/`eval` 才能动态传，实际写不出来 | `Math.pow(base, n)` 天然支持变量 |
| 建议 | 固定表达式首选 | 指数是变量且追求"无歧义"时可用 |

结论：自己写代码用 `**` 更好读；但见到 `Math.pow` 不要以为是过时写法，两者并存，功能等价。

### 1.3 本章易错点

| 序号 | 错误写法 / 误区 | 实际结果 | 正确做法 |
| --- | --- | --- | --- |
| 1 | `if (arr.indexOf(x)) { }` | 命中第 0 项时 `0` 为假值，判断失�� | `if (arr.includes(x))` 或 `if (arr.indexOf(x) > -1)` |
| 2 | 用 `indexOf` 判断 `NaN` 是否存在 | 永远返回 `-1` | 用 `includes(NaN)` |
| 3 | `goods.includes({ price: 20 })` | `false`，对象比的是引用 | 按条件判断用 `some` |
| 4 | `-2 ** 2` | 抛出语法错误 | `(-2) ** 2` 或 `-(2 ** 2)` |
| 5 | 以为 `2 ** 3 ** 2` 等于 `64` | 实际是 `512`（右结合） | 需要左结合时加括号 |
| 6 | 以为字符串 `includes` 是 ES7 新增 | 字符串版是 ES6 就有 | 只有数组版属 ES7 |
| 7 | 用 `includes` 判断"包含某子串的子项" | 它是全等比较，不是模糊匹配 | 用 `some(item => item.includes(kw))` |

### 1.4 本章小结

- ES7 只有两个特性：`Array.prototype.includes` 与 `**`（含 `**=`），都是"替代旧写法"型改动，不涉及语法结构。
- `includes` 的价值在于**返回布尔值**和**能识别 `NaN`**，这是 `indexOf` 的两个硬伤。
- `**` 与 `Math.pow` 等价，但右结合且不允许一元运算符直接在前，写负数幂时务必加括号。
- 数组 `includes` 只做**值全等**比较，条件判断请用 `some`；字符串 `includes` 属 ES6，不在本章范围内。

---

## 2. ES2017（ES8）：async 与 await

这是 ES7~ES11 里唯一一次**编程范式升级**。在它之前，异步代码只能靠 Promise 的 `.then()` 链来写；有了它，异步代码可以写成看起来像同步的样子，错误也能回到熟悉的 `try/catch`。

> 素材对应：`D:\自学课程笔记\9_ES6\代码\ES8\`
> `1-async.html`（async 的返回值）→ `2-await.html`（await 与错误处理）→ `3-async和await结合读取文件.js`（Node 实操）→ `4-async与await封装AJAX请求.html`（浏览器实操）

### 2.1 先搞清楚它要解决什么问题

ES6 的 Promise 解决了"回调地狱"，但 `.then()` 链写多了依然难读：变量作用域被切碎，错误要 `.catch()` 兜底，多个异步步骤的依赖关系得靠一层层嵌套传值。

```js
// Promise 写法：读三个文件
readWeiXue()
  .then(weixue => {
    console.log(weixue.toString());
    return readChaYangShi();
  })
  .then(chayang => {
    console.log(chayang.toString());
    return readGuanShu();
  })
  .then(guanshu => {
    console.log(guanshu.toString());
  })
  .catch(err => {
    console.log(err);
  });
```

同一件事用 `async/await`：

```js
async function main() {
  const weixue = await readWeiXue();
  console.log(weixue.toString());
  const chayang = await readChaYangShi();
  console.log(chayang.toString());
  const guanshu = await readGuanShu();
  console.log(guanshu.toString());
}
```

两段代码的执行结果完全一样，但第二段里三个变量在同一个作用域，出错了外面包一层 `try/catch` 就行。

一句话理解这两个关键字的关系：**`async` 负责"把函数变成返回 Promise 的函数"，`await` 负责"在 async 函数内部等 Promise 出结果"**。它们是一对，缺一不可。

### 2.2 async 函数：返回值的四条规则

`async` 写在函数声明前，函数就变成 async 函数。它的本质是：**函数体内部仍然同步执行，但返回值被自动包装成 Promise**。

> 对应文件：`ES8\1-async.html`

```js
async function fn() {
  // 情况一：返回一个普通值
  // return '尚硅谷';

  // 情况二：什么都不返回
  // return;

  // 情况三：抛出一个错误
  // throw new Error('出错啦!');

  // 情况四：返回一个 Promise
  return new Promise((resolve, reject) => {
    resolve('成功的数据');
    // reject("失败的错误");
  });
}

const result = fn();

result.then(value => {
  console.log(value);
}, reason => {
  console.warn(reason);
});
```

四条规则汇总：

| 写法 | `fn()` 返回的 Promise 状态 | `.then` 第一个回调收到 | `.then` 第二个回调收到 |
| --- | --- | --- | --- |
| `return '尚硅谷'` | fulfilled | `'尚硅谷'` | 不触发 |
| `return;`（或不写 return） | fulfilled | `undefined` | 不触发 |
| `throw new Error('出错啦!')` | rejected | 不触发 | 那个 `Error` 对象 |
| `return new Promise(resolve => resolve('成功的数据'))` | 跟随内部 Promise，fulfilled | `'成功的数据'` | 不触发 |
| `return new Promise((_, reject) => reject('失败的错误'))` | rejected | 不触发 | `'失败的错误'` |

三个必须记住的结论：

1. **async 函数的返回值一定是 Promise**，哪怕你 `return 1`，拿到的也是 `Promise {<fulfilled>: 1}`。
2. **函数体内部抛出的错误不会炸掉调用处**，而是变成 rejected 的 Promise。这一点很实用：`try/catch` 写在外面接不到，但 `.catch()` 能接到。
3. **`async` 函数被调用时会立即返回一个 pending 的 Promise，同时函数体开始同步执行**，直到遇到第一个 `await` 才交出控制权。所以不要把 `async` 理解成"整个函数延后执行"。

用代码验证第 3 点：

```js
async function demo() {
  console.log('函数体开始执行');  // 同步执行
  const v = await Promise.resolve('等到了');
  console.log(v);                // await 之后的代码进入微任务
}

console.log('调用前');
demo();
console.log('调用后');

// 输出顺序：
// 调用前
// 函数体开始执行
// 调用后
// 等到了
```

#### async 的写法变体

```js
// 1. 函数声明
async function a() { }

// 2. 函数表达式
const b = async function () { };

// 3. 箭头函数
const c = async () => { };

// 4. 对象方法
const obj = {
  async d() { }
};

// 5. class 方法
class Api {
  async get() { }
}
```

### 2.3 await：等待一个 Promise 的结果

`await` 只能写在 async 函数内部，它的作用是"暂停当前函数，等右侧的 Promise settled，再取出结果继续往下执行"。

> 对应文件：`ES8\2-await.html`

```js
// 创建 promise 对象
const p = new Promise((resolve, reject) => {
  // resolve("用户数据");
  reject("失败啦!");
});

// await 要放在 async 函数中
async function main() {
  try {
    let result = await p;
    console.log(result);
  } catch (e) {
    console.log(e);   // 输出：失败啦!
  }
}

main();
```

这个例子只演示了一件事，但它是 `await` 最重要的配套写法：**`await` 一个 rejected 的 Promise 会在这里抛出异常**，所以要么用 `try/catch` 接住，要么让外层 `.catch()` 接住。

```js
// 写法一：try/catch（推荐，能继续往下走）
async function f1() {
  try {
    const data = await request();
    console.log(data);
  } catch (e) {
    console.log('请求失败：', e);
  }
  console.log('后续逻辑照常执行');
}

// 写法二：不接，交给调用者
async function f2() {
  const data = await request();  // 一旦 reject，f2 返回的 Promise 也 reject
  return data;
}
f2().catch(e => console.log('外层捕获：', e));
```

#### await 的三条细则

| 细则 | 说明 | 例子 |
| --- | --- | --- |
| 右侧不是 Promise 也能等 | 会被自动包成 `Promise.resolve(值)`，等一个微任务 | `await 1` 的结果是 `1` |
| 只能在 async 函数内用 | 普通函数里写 `await` 是**语法错误** | 顶层 `await` 要到 ES2022 的模块顶层才允许 |
| 只暂停当前函数，不阻塞主线程 | 事件循环继续跑，其他任务照常执行 | 所以它不会让页面卡死 |

第二条要特别注意版本边界：

```js
// 直接写在普通函数里 → SyntaxError: await is only valid in async functions
function bad() {
  const x = await Promise.resolve(1);
}
```

而下面这种 **模块顶层** 的 `await` 是 ES2022 才支持的，不属于本文范围：

```js
// 只有 <script type="module"> 或在 ESM 模块文件里、且运行环境支持时才合法（ES2022）
// const res = await fetch('/api/list');
```

### 2.4 实战一：用 async/await 顺序读取三个文件（Node）

> 对应文件：`ES8\3-async和await结合读取文件.js`
> 运行方式：`cd ES8` 后执行 `node 3-async和await结合读取文件.js`（`resources\` 是相对路径，必须在 ES8 目录下运行）

这个例子分两步：**先把回调式 API 包装成 Promise，再用 await 顺序等待**。这是实际项目里最常见的改造套路。

第一步，包装。`fs.readFile` 是老式回调 API，直接 await 不了，所以要包一层：

```js
const fs = require("fs");

function readWeiXue() {
  return new Promise((resolve, reject) => {
    fs.readFile("./resources/为学.md", (err, data) => {
      if (err) reject(err);   // 失败：把错误交给 reject
      resolve(data);          // 成功：把 Buffer 交给 resolve
    });
  });
}

function readChaYangShi() {
  return new Promise((resolve, reject) => {
    fs.readFile("./resources/插秧诗.md", (err, data) => {
      if (err) reject(err);
      resolve(data);
    });
  });
}

function readGuanShu() {
  return new Promise((resolve, reject) => {
    fs.readFile("./resources/观书有感.md", (err, data) => {
      if (err) reject(err);
      resolve(data);
    });
  });
}
```

第二步，直接 await：

```js
async function main() {
  let weixue = await readWeiXue();     // 拿到 Buffer
  let chayang = await readChaYangShi();
  let guanshu = await readGuanShu();

  console.log(weixue.toString());      // Buffer 转字符串才能正常显示中文
  console.log(chayang.toString());
  console.log(guanshu.toString());
}

main();
```

输出就是三篇古文的内容（`为学`、`插秧诗`、`观书有感`）。

两个值得强调的点：

1. **`data` 是 Buffer**，直接 `console.log` 打印出的是 `<Buffer e4 b8 ba ...>`，必须 `.toString()` 才是中文。
2. **这里的三个 `await` 是串行的**，总耗时 = 三个文件读取时间之和。如果三者互不依赖，应该并行（见下一节）。

#### 串行 vs 并行：一个必须知道的优化

```js
// 串行：a 读完才读 b，b 读完才读 c
async function serial() {
  const a = await readWeiXue();
  const b = await readChaYangShi();
  const c = await readGuanShu();
  return [a, b, c];
}

// 并行：同时发起三个请求，取齐后一起返回
async function parallel() {
  const [a, b, c] = await Promise.all([readWeiXue(), readChaYangShi(), readGuanShu()]);
  return [a, b, c];
}
```

| 方式 | 代码形态 | 耗时 | 适用 |
| --- | --- | --- | --- |
| 串行 `await` | 一个接一个 | 三段之和 | 后一步依赖前一步的结果 |
| `Promise.all` + `await` | 先全部发起，再一起等 | 三段中最长的那个 | 彼此无依赖的并发请求 |

新手最容易犯的错是：明明三个请求没关系，却写成三个连续 `await`，白白多等好几倍时间。

### 2.5 实战二：用 async/await 封装 AJAX（浏览器）

> 对应文件：`ES8\4-async与await封装AJAX请求.html`
> 需要联网：示例请求的是公开接口，接口失效时把 URL 换成任意可访问的地址即可

```js
// 发送 AJAX 请求，返回的结果是 Promise 对象
function sendAJAX(url) {
  return new Promise((resolve, reject) => {
    // 1. 创建对象
    const x = new XMLHttpRequest();
    // 2. 初始化
    x.open('GET', url);
    // 3. 发送
    x.send();
    // 4. 事件绑定
    x.onreadystatechange = function () {
      if (x.readyState === 4) {            // 请求完成
        if (x.status >= 200 && x.status < 300) {
          resolve(x.response);             // 成功
        } else {
          reject(x.status);                // 失败：HTTP 状态码
        }
      }
    };
  });
}

// 用 async / await 调用
async function main() {
  let result = await sendAJAX("https://api.apiopen.top/getJoke");
  let tianqi = await sendAJAX('https://www.tianqiapi.com/api/?version=v1&city=...');

  console.log(tianqi);
}

main();
```

同一份封装，两种调用方式对比：

```js
// Promise 写法
sendAJAX(url).then(value => {
  console.log(value);
}, reason => {
  console.log('失败', reason);
});

// async/await 写法（可读性更好，出错可用 try/catch 统一处理）
async function main() {
  try {
    const data = await sendAJAX(url);
    console.log(data);
  } catch (status) {
    console.log('请求失败，状态码：', status);
  }
}
```

注意 `reject(x.status)` 这里传的是状态码（数字），不是错误对象。这属于示例的简化，实际项目建议 `reject(new Error('HTTP ' + x.status))`，这样 `.catch` 里能拿到 `message` 和堆栈。

### 2.6 本章易错点

| 序号 | 错误写法 / 误区 | 实际结果 | 正确做法 |
| --- | --- | --- | --- |
| 1 | 在普通函数里写 `await` | `SyntaxError: await is only valid in async functions` | 外层函数加 `async` |
| 2 | `forEach` 里写 `await` | 回调不是 async，直接报错；即便写成 `async` 回调也不会被等待，循环瞬间结束 | 用 `for...of` + `await`，或 `Promise.all` |
| 3 | 只写 `async` 不写 `await`，以为函数会"异步执行" | 函数体照常同步执行，只是返回值被包成 Promise | 想等待某个异步结果就必须 `await` |
| 4 | `try/catch` 包住了 Promise 但没有 `await` | 接不到错误，因为异常发生在异步阶段 | `await` 之后再 `try/catch` |
| 5 | 以为 `await` 会阻塞整个页面 | 只暂停当前 async 函数，主线程继续跑 | 无需担心 |
| 6 | 忘记 `.toString()` 就读 Node 文件 | 打印出一堆 `<Buffer ...>` | `data.toString()` 或 `fs.readFile(path, 'utf8', cb)` |
| 7 | 无依赖的请求写成连续 `await` | 总耗时累加，白白变慢 | 用 `Promise.all([a(), b(), c()])` |
| 8 | 以为 `async` 函数里 `throw` 会同步炸掉调用处 | 实际变成 rejected Promise，外层需要 `.catch` 或 `await` + `try/catch` | 二选一兜底 |

`forEach` 那个坑值得单独演示，因为它静默失效、不报错：

```js
const ids = [1, 2, 3];

// 看起来没问题，实际"看起来"执行完了，但一个结果都等不到
ids.forEach(async id => {
  const data = await fetchData(id);
  console.log(data);
});
console.log('forEach 之后');   // 这句会先打印

// 正确：顺序等待
for (const id of ids) {
  const data = await fetchData(id);
  console.log(data);
}

// 或者：并行等待
const all = await Promise.all(ids.map(id => fetchData(id)));
```

### 2.7 本章小结

- `async` 把函数返回值统一包装成 Promise；`throw` 变成 rejected，`return` 值变成 fulfilled 的值。
- `await` 只在 async 函数内有效，作用是"暂停当前函数取结果"；右侧非 Promise 也能等。
- 错误处理靠 `await` + `try/catch`，或外层 `.catch()`；只写 Promise 不 await 时 `try/catch` 接不到。
- 老式回调 API 要先"包一层 Promise"才能 await，这是 `fs`、`XMLHttpRequest` 这类代码的标准改造套路。
- 无依赖的多个异步任务用 `Promise.all` 并行，别用连续 `await` 串起来。
- 顶层 `await` 属 ES2022，不在本节范围；`forEach + async` 是无效等待，改用 `for...of`。

---

## 3. ES2017（ES8）：对象方法扩展

ES8 在 `Object` 上补了三个静态方法，正好补齐了 ES6 `Object.keys` 留下的空缺：能取到"值"、能取到"键值对"、能取到"属性描述符"。

> 素材对应：`D:\自学课程笔记\9_ES6\代码\ES8\5-对象方法扩展.html`
> 这个文件里大部分语句都被注释了，需要逐个取消注释观察输出；下面按功能拆开讲。

先准备示例对象（与素材一致）：

```js
const school = {
  name: "尚硅谷",
  cities: ['北京', '上海', '深圳'],
  xueke: ['前端', 'Java', '大数据', '运维']
};
```

### 3.1 Object.values：取所有值

#### 适用场景

需要一个对象"值的数组"，而且不关心键名。典型用法：

- 把配置对象的所有取值拼成查询参数
- 统计对象里有多少个非空值
- 与 `Object.keys` 配对，做"键值同时处理"

```js
console.log(Object.keys(school));
// ['name', 'cities', 'xueke']

console.log(Object.values(school));
// ['尚硅谷', ['北京','上海','深圳'], ['前端','Java','大数据','运维']]
```

返回值是**数组**，顺序与 `Object.keys` 一致（普通对象的自有字符串键按"整数键升序 + 其余按插入顺序"排列）。

#### 三个必须知道的限制

```js
const obj = {
  a: 1,
  [Symbol('s')]: 2,   // Symbol 键
  b: 3
};
Object.defineProperty(obj, 'hidden', {
  value: 4,
  enumerable: false   // 不可枚举
});

console.log(Object.values(obj));  // [1, 3]
```

| 限制 | 说明 |
| --- | --- |
| 只取**自有**属性 | 原型链上的属性不取（要遍历原型用 `for...in`） |
| 只取**可枚举**属性 | `enumerable: false` 的属性不出现 |
| 不取 **Symbol** 键 | 需要 Symbol 键用 `Object.getOwnPropertySymbols` |

#### 小实战：求对象数值之和

```js
const scores = { math: 90, english: 85, code: 95 };

// ES8 之前
const sum1 = Object.keys(scores).reduce((acc, k) => acc + scores[k], 0);

// ES8
const sum2 = Object.values(scores).reduce((acc, v) => acc + v, 0);

console.log(sum2); // 270
```

### 3.2 Object.entries：取键值对数组

#### 适用场景

需要**同时**拿到键和值，最常见的两个用途：转成 `Map`、遍历时同时用键和值。

```js
console.log(Object.entries(school));
// [
//   ['name', '尚硅谷'],
//   ['cities', ['北京','上海','深圳']],
//   ['xueke', ['前端','Java','大数据','运维']]
// ]
```

每一项都是 `[key, value]` 的二元数组，这正好是 `Map` 构造函数能吃的格式：

```js
// 用 entries 直接创建 Map
const m = new Map(Object.entries(school));
console.log(m.get('cities'));  // ['北京', '上海', '深圳']
```

对比一下"不用 entries 要怎么写"：

```js
// ES8 之前：先 keys 再手动取值
const m1 = new Map();
Object.keys(school).forEach(k => m1.set(k, school[k]));

// ES8：一行
const m2 = new Map(Object.entries(school));
```

#### 遍历写法

```js
// 配合解构，一行拿到键和值
Object.entries(school).forEach(([key, value]) => {
  console.log(key, value);
});

// 也可以配合 for...of
for (const [key, value] of Object.entries(school)) {
  console.log(`${key} = ${value}`);
}
```

#### 顺带一个特性：数组上的 entries

`entries` 不是对象专属，`Array.prototype.entries` 也有（ES6 就有），返回的是**迭代器**而不是数组，需要用 `for...of` 或展开：

```js
const arr = ['a', 'b'];
console.log([...arr.entries()]);   // [[0,'a'], [1,'b']]
console.log(Object.entries(arr));  // [['0','a'], ['1','b']]  ← 注意键变成了字符串
```

注意最后一行的差异：`Object.entries` 把数组当普通对象处理，索引变成了**字符串** `'0'`、`'1'`。

### 3.3 Object.getOwnPropertyDescriptors：取属性描述符

#### 适用场景

这是三个方法里最少用、但在"精确复制"场景下不可替代的一个。最典型的用途是**实现一个真正保留 getter/setter 与可枚举性的拷贝**。

```js
console.log(Object.getOwnPropertyDescriptors(school));
// {
//   name:   { value: '尚硅谷', writable: true, enumerable: true, configurable: true },
//   cities: { value: [...],     writable: true, enumerable: true, configurable: true },
//   xueke:  { value: [...],     writable: true, enumerable: true, configurable: true }
// }
```

每个属性的描述对象包含四个字段：

| 字段 | 含义 | 默认值（用 `defineProperty` 定义时） |
| --- | --- | --- |
| `value` | 属性值 | `undefined` |
| `writable` | 能否被重新赋值 | `false` |
| `enumerable` | 能否被 `for...in` / `Object.keys` 遍历到 | `false` |
| `configurable` | 能否被删除、能否改描述符 | `false` |
| `get` / `set` | 访问器函数（与 `value`、`writable` 互斥） | `undefined` |

#### 为什么需要它：普通拷贝会丢 getter

```js
const source = {
  firstName: 'San',
  lastName: 'Zhang',
  get fullName() {
    return this.firstName + ' ' + this.lastName;
  }
};

// 普通展开 / Object.assign：getter 被"求值"成了普通属性
const copy1 = { ...source };
console.log(Object.getOwnPropertyDescriptor(copy1, 'fullName').get); // undefined
copy1.firstName = 'Si';
console.log(copy1.fullName);  // 'San Zhang'  ← 不再联动了

// ES8：把描述符原样搬过去
const copy2 = Object.create(
  Object.getPrototypeOf(source),
  Object.getOwnPropertyDescriptors(source)
);
copy2.firstName = 'Si';
console.log(copy2.fullName);  // 'Si Zhang'  ← getter 保住了
```

这就是 `Object.getOwnPropertyDescriptors` 的核心价值：**它能拿到 `get`/`set`、`enumerable` 等信息，而 `Object.assign` 只能拿到"值"**。

| 拷贝方式 | getter/setter | 不可枚举属性 | 原型 | 属性描述符 |
| --- | --- | --- | --- | --- |
| `{ ...obj }` | 丢失（求值成值） | 丢失 | 丢失 | 丢失 |
| `Object.assign({}, obj)` | 丢失 | 丢失 | 丢失 | 丢失 |
| `Object.create(proto, getOwnPropertyDescriptors(obj))` | 保留 | 保留 | 保留 | 保留 |

注意：以上都是**浅拷贝**，嵌套对象仍然是同一引用。

### 3.4 补充：Object.create 的第二参数

素材里还留了一段被注释的代码，用来说明描述符的写法。这个 API 本身**属于 ES5**，不属于 ES8，但它是理解描述符最好的例子：

```js
const obj = Object.create(null, {
  name: {
    // 设置值
    value: '尚硅谷',
    // 属性特性
    writable: true,
    configurable: true,
    enumerable: true
  }
});
// 结果：{ name: '尚硅谷' }，且该对象没有原型（Object.getPrototypeOf(obj) === null）
```

| 参数 | 作用 |
| --- | --- |
| 第一参数 | 新对象的原型；传 `null` 表示无原型（纯粹的字典对象） |
| 第二参数 | 属性描述符集合，格式与 `Object.getOwnPropertyDescriptors` 的返回值一致 |

这正好解释了为什么这两者能直接配对使用——**描述符的"输出格式"和"输入格式"是同一套**。

### 3.5 补充：ES8 同批新增的字符串方法（代码目录未覆盖）

ES8 还加了两个字符串填充方法，课件代码目录里没有示例，但面试常问，补在这里：

```js
// padStart(目标长度, 填充字符)
console.log('5'.padStart(3, '0'));      // '005'
console.log('2024-1-1'.padStart(12, '*')); // '***2024-1-1'

// padEnd
console.log('5'.padEnd(3, '0'));        // '500'

// 常见用法：时间补零
const pad = n => String(n).padStart(2, '0');
console.log(`${pad(9)}:${pad(5)}`);     // '09:05'
```

| 场景 | 写法 | 结果 |
| --- | --- | --- |
| 数字补零 | `'7'.padStart(2, '0')` | `'07'` |
| 对齐输出 | `'abc'.padEnd(6, '-')` | `'abc---'` |
| 超出长度 | `'abcdef'.padStart(3, '0')` | `'abcdef'`（不截断，原样返回） |
| 不传填充字符 | `'7'.padStart(3)` | `'  7'`（默认空格） |

### 3.6 本章易错点

| 序号 | 错误写法 / 误区 | 实际结果 | 正确做法 |
| --- | --- | --- | --- |
| 1 | `Object.values` 期望拿到原型链上的属性 | 拿不到，只取自有属性 | 遍历原型用 `for...in` + `hasOwnProperty` 过滤 |
| 2 | 期望 `Object.entries` 带出 Symbol 键 | 不带 | `Object.getOwnPropertySymbols` 单独取 |
| 3 | `new Map(Object.entries(arr))` 期望键是数字 | 键是字符串 `'0'`、`'1'` | 需要数字索引用 `arr.entries()` |
| 4 | 以为 `{...obj}` 能完整复制对象 | getter 变普通值、不可枚举属性丢失、原型丢失 | 需要完整复制时用 `Object.create` + `getOwnPropertyDescriptors` |
| 5 | 以为 `getOwnPropertyDescriptors` 能做深拷贝 | 只是浅拷贝，嵌套引用不变 | 深拷贝用 `structuredClone` |
| 6 | 把 `Object.create` 当成 ES8 新 API | 它是 ES5 的 | 只有 `values`/`entries`/`getOwnPropertyDescriptors` 属 ES8 |
| 7 | `Object.values(null)` | `TypeError: Cannot convert undefined or null to object` | 先判空：`Object.values(obj || {})` |

### 3.7 本章小结

- `Object.values(obj)` 取值的数组，`Object.entries(obj)` 取 `[key, value]` 数组，两者都只处理**自有可枚举字符串键**。
- `Object.entries` + `new Map()` 是对象转 Map 最短写法；配合数组解构可以一行拿到键值。
- `Object.getOwnPropertyDescriptors` 的价值在于**保留 getter/setter 与描述符**，是"精确克隆"的唯一内置方案，但仍是浅拷贝。
- `Object.create(proto, descriptors)` 与它是同一套描述符格式，一个读一个写。
- 同版本还带来 `padStart`/`padEnd`，是补零对齐的标准写法。

---

## 4. ES2018（ES9）：对象的 rest 与 spread

ES6 把 `...` 给了数组，ES9 把同一个符号给了对象。这一个改动带来的收益比想象中大：**对象的"提取剩余"和"浅合并"从此不用再手写循环**。

> 素材对应：`D:\自学课程笔记\9_ES6\代码\ES9\1-对象展开.html`
> 文件里的注释写得很清楚，是本节的关键前提：
> > Rest 参数与 spread 扩展运算符在 ES6 中已经引入，不过 ES6 中只针对数组；在 ES9 中为对象提供了像数组一样的 rest 参数和扩展运算符。

### 4.1 先分清 rest 与 spread

同一个 `...`，出现在**赋值/解构左边**是 rest（收集），出现在**右边**是 spread（展开）：

| 写法 | 名称 | 位置 | 作用 | 结果形态 |
| --- | --- | --- | --- | --- |
| `const { a, ...rest } = obj` | rest | 解构左侧 | 把剩余属性聚成一个新对象 | 对象 |
| `const newObj = { ...obj }` | spread | 对象字面量内 | 把对象属性摊开 | 对象 |
| `function f({ a, ...rest })` | rest | 参数列表 | 收集剩余参数 | 对象 |
| `f(...args)` 传对象 | spread | 调用处 | 摊开为实参 | 不是对象用法，属数组/可迭代 |

判断口诀：**"往回收"是 rest，"往外撒"是 spread**。

### 4.2 rest：函数参数里提取剩余属性

#### 适用场景

这是对象 rest 最实用的一处：**从配置对象里挑出几个已知字段，剩下的打包带走**。常见于封装 HTTP 请求、数据库连接、组件参数透传。

> 对应素材代码：

```js
function connect({ host, port, ...user }) {
  console.log(host);
  console.log(port);
  console.log(user);
}

connect({
  host: '127.0.0.1',
  port: 3306,
  username: 'root',
  password: 'root',
  type: 'master'
});

// 输出：
// 127.0.0.1
// 3306
// { username: 'root', password: 'root', type: 'master' }
```

参数位置上的 `{ host, port, ...user }` 做了两件事：先把 `host`、`port` 解构出来单独用；再把**除这两个键之外的所有自有可枚举属性**收集进 `user`。

#### 为什么它比"删属性"好

```js
// ES9 之前：拿到剩余参数只能先拷贝再 delete
function connectOld(config) {
  const rest = Object.assign({}, config);
  delete rest.host;
  delete rest.port;
  console.log(rest);
}

// ES9：一步完成，且不修改原对象
function connectNew({ host, port, ...rest }) {
  console.log(rest);
}
```

| 对比项 | rest 解构 | 拷贝 + `delete` |
| --- | --- | --- |
| 是否修改原对象 | 否 | 若忘了先拷贝就会改掉原对象 |
| 代码量 | 1 行 | 3 行以上，字段越多越冗长 |
| 可读性 | 一眼看出"剔除了哪些键" | 需要读完全部 `delete` |

#### 两个硬规则

```js
// 规则一：rest 必须在最后
// const { a, ...rest, b } = obj;   // SyntaxError: Rest element must be last element

// 规则二：rest 不能再给默认值
// const { a, ...rest = {} } = obj; // SyntaxError
```

### 4.3 spread：对象合并（浅合并）

#### 适用场景

- 合并多个对象的属性（配置覆盖、状态更新）
- 生成"改了某几个字段"的新对象，保留其余字段（React/状态管理里最常见的写法）
- 快速浅拷贝

> 对应素材代码：把四个技能对象合并成一个英雄对象

```js
const skillOne = { q: '天音波' };
const skillTwo = { w: '金钟罩' };
const skillThree = { e: '天雷破' };
const skillFour = { r: '猛龙摆尾' };

const mangseng = { ...skillOne, ...skillTwo, ...skillThree, ...skillFour };

console.log(mangseng);
// { q: '天音波', w: '金钟罩', e: '天雷破', r: '猛龙摆尾' }
```

素材注释里写的 `...skillOne => q: '天音波', w: '金钟罩'` 是一种"脑内模拟"——`{ ...skillOne }` 相当于把 `q: '天音波'` 原样搬进新对象的大括号里。

#### 关键规则：同名属性后者覆盖前者

```js
const base = { theme: 'light', lang: 'zh', debug: false };
const userConfig = { theme: 'dark', debug: true };

const merged = { ...base, ...userConfig };
console.log(merged);
// { theme: 'dark', lang: 'zh', debug: true }
//   ↑ 被覆盖            ↑ 保留      ↑ 被覆盖
```

这个"后覆盖前"的特性正是"默认配置 + 用户配置"能一行写完的原因。反过来说，**顺序写反了就是 bug**：

```js
const wrong = { ...userConfig, ...base };  // 用户配置被默认值覆盖，等于没配
```

#### 与 Object.assign 的关系

```js
const a = { ...base, ...userConfig };
const b = Object.assign({}, base, userConfig);
// a 与 b 的键值完全一致

// 差异：Object.assign 会修改第一个参数（目标对象）
const c = Object.assign(base, userConfig); // base 被改掉了！
```

| 对比项 | 对象 spread | `Object.assign` |
| --- | --- | --- |
| 是否修改原对象 | 不修改，总是产生新对象 | 修改第一个参数，除非传 `{}` |
| 返回值 | 新对象 | 目标对象（同一个引用） |
| 触发 setter | 不触发（直接定义属性） | 会触发目标对象上的 setter |
| 可读性 | 声明式，一目了然 | 需要约定俗成传 `{}` |
| 版本 | ES2018 | ES6 |

结论：**新代码统一用 spread**，只有需要"往已有对象上打补丁"时才用 `Object.assign(target, ...)`。

#### 必须警惕：这是浅拷贝

```js
const state = {
  user: { name: 'San' },
  tags: ['a']
};

const next = { ...state };
next.user.name = 'Si';       // 改的是同一个 user 对象

console.log(state.user.name); // 'Si'  ← 原对象跟着变了
console.log(next.tags === state.tags); // true ← 数组也是同一引用
```

需要真正的深拷贝时，用 `structuredClone(obj)`（新环境）或递归/`JSON` 方案（注意 `JSON` 方案会丢函数、`undefined`、`Date` 变字符串）。

#### 一个小坑：展开 null / undefined 是安全的

```js
console.log({ ...null, a: 1 });      // { a: 1 }
console.log({ ...undefined, a: 1 }); // { a: 1 }
```

与 `Object.assign` 不同，`{...null}` 不会报错（规范里做了特殊处理），但 `Object.assign({}, null)` 也不报错，只有 `Object.keys(null)` 才报错，别把这几件事混在一起记。

### 4.4 数组的 rest/spread 与对象版对照

为避免版本记混，把两版的归属列清：

| 能力 | 语法 | 归属 | 例子 |
| --- | --- | --- | --- |
| 数组 rest（函数参数） | `function f(...args)` | ES6 | `f(1,2,3)` → `args = [1,2,3]` |
| 数组 rest（解构） | `const [a, ...rest] = arr` | ES6 | `rest = [2,3]` |
| 数组 spread | `[...arr1, ...arr2]` | ES6 | `[1,2,3]` |
| 对象 rest（参数/解构） | `const { a, ...rest } = obj` | **ES2018** | `rest = {其余键}` |
| 对象 spread（字面量） | `{ ...obj1, ...obj2 }` | **ES2018** | 合并对象 |

一句话记住：**数组的 `...` 是 ES6，对象的 `...` 是 ES9**。这条在笔试里被问到的频率极高。

### 4.5 本章易错点

| 序号 | 错误写法 / 误区 | 实际结果 | 正确做法 |
| --- | --- | --- | --- |
| 1 | `const { a, ...rest, b } = obj` | `SyntaxError: Rest element must be last element` | rest 放最后 |
| 2 | 以为 `{...obj}` 是深拷贝 | 嵌套引用共享，改一处两处都变 | 用 `structuredClone` |
| 3 | 合并顺序写反 `{...user, ...defaults}` | 用户配置被默认值覆盖 | 默认值在前，覆盖项在后 |
| 4 | 用 `{...arr}` 复制数组 | 得到的是 `{0:'a',1:'b'}` 这样的对象，不是数组 | 数组用 `[...arr]` |
| 5 | 以为对象 spread 能带走不可枚举属性 | 只能带走自有可枚举属性 | 需要完整复制用 `getOwnPropertyDescriptors` |
| 6 | 在数组字面量里 spread 对象 | `TypeError: obj is not iterable` | `{...}` 只能用于对象字面量，数组内需要可迭代对象 |
| 7 | 以为 `{...obj}` 会触发 getter 并保留 getter | getter 会被求值成普通值 | 保留 getter 用 `Object.create` + 描述符 |

第 7 条与上一章呼应，再给一段对照代码：

```js
const src = {
  a: 1,
  get b() { return this.a + 1; }
};

const copy = { ...src };
console.log(Object.getOwnPropertyDescriptor(copy, 'b').get); // undefined
console.log(copy.b); // 2  ← 值被"拍平"了，之后不再联动
```

### 4.6 本章小结

- 对象版的 rest/spread 属 **ES2018**，数组版属 ES6，这是最容易记混的版本边界之一。
- rest 出现在解构/参数位，负责"收集剩余属性"；spread 出现在字面量里，负责"摊开合并"。
- 合并时**后者覆盖前者**，所以"默认值在前、覆盖项在后"必须写对。
- 与 `Object.assign` 相比，spread 更安全（不修改原对象、不触发 setter），优先使用。
- 全部是**浅拷贝**，嵌套对象与数组需另行处理。

---

## 5. ES2018（ES9）：正则四项扩展

ES9 给正则加了四样东西：**命名捕获分组**、**反向断言**、**`s`（dotAll）标志**、**Unicode 属性转义**。前三样在课件代码里都有完整示例，本节逐个讲透；第四样只在实战章节一笔带过。

> 素材对应：`D:\自学课程笔记\9_ES6\代码\ES9\`
> `2-正则命名分组.html` → `3-正则断言.html` → `4-正则dotAll模式.html`
> `0-resource.html` 是 dotAll 示例要解析的原始 HTML，先看清它的结构：
> ```html
> <ul>
>   <li><a>肖生克的救赎</a><p>上映日期: 1994-09-10</p></li>
>   <li><a>阿甘正传</a><p>上映日期: 1994-07-06</p></li>
> </ul>
> ```

### 5.1 命名捕获分组：给分组起名字

#### 适用场景

凡是"从一段文本里抓出多个字段"的活都适用，尤其是**解析结构固定的字符串**：HTML 片段、日志行、URL 参数、日期字符串。字段一多，`result[1]`、`result[2]` 这种下标就彻底不可维护了。

#### 先说旧写法的问题

> 素材里被注释掉的那段就是旧写法：

```js
let str = '<a href="http://www.atguigu.com">尚硅谷</a>';

// 旧写法：普通捕获组，靠下标取值
const regOld = /<a href="(.*)">(.*)<\/a>/;
const resultOld = regOld.exec(str);
console.log(resultOld);
// ['<a href="http://www.atguigu.com">尚硅谷</a>', 'http://www.atguigu.com', '尚硅谷', index: 0, input: '...', groups: undefined]

console.log(resultOld[1]); // 'http://www.atguigu.com'  ← 1 是什么？必须回看正则
console.log(resultOld[2]); // '尚硅谷'
```

`result[1]` 的含义完全依赖"正则里第几个括号"，一旦正则需要修改（比如前面多插一个分组），所有下标全部错位。

#### 新写法：`(?<名字>...)`

```js
let str = '<a href="http://www.atguigu.com">尚硅谷</a>';

// 分组命名
const reg = /<a href="(?<url>.*)">(?<text>.*)<\/a>/;

const result = reg.exec(str);

console.log(result.groups.url);   // 'http://www.atguigu.com'
console.log(result.groups.text);  // '尚硅谷'
```

语法要点：`(?<名字>` 中的 `<名字>` 就是分组的名字，合法标识符即可；取值统一走 **`result.groups.名字`**。

#### 与旧写法的对比

| 对比项 | 普通捕获组 | 命名捕获组 |
| --- | --- | --- |
| 语法 | `(.*)` | `(?<url>.*)` |
| 取值 | `result[1]` | `result.groups.url` |
| 正则增删分组后 | 所有下标错位，隐患极大 | 名字不变，代码无需改 |
| 可读性 | 需对照正则数字括号 | 名称即语义 |
| 同名分组 | 不允许 | 同一正则内不允许重名，但可用 `\k<name>` 引用 |
| 未匹配到的分组 | `undefined` | `undefined` |

#### 一个补充：`exec` 与 `match` 都能拿到 groups

```js
const str = '2024-05-31';
const reg = /(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})/;

// exec（正则对象方法）
console.log(reg.exec(str).groups);   // { year: '2024', month: '05', day: '31' }

// match（字符串方法），带 g 标志时会丢掉 groups，不要带 g
console.log(str.match(reg).groups);  // { year: '2024', month: '05', day: '31' }
```

最后一条是高频坑：**`/.../g` 配合 `match` 时只返回全部整体匹配的字符串数组，`groups` 就没了**。

### 5.2 反向断言：根据"前面是什么"来匹配

#### 先分清四种断言

断言（assertion）不消耗字符，只做"旁边有没有"的判断。ES9 新增的是**反向**那两种；正向的两种在 ES3/ES5 时代就有了，属于**语法回顾**，不算 ES9 新特性——这一点在面试里经常被挖坑。

| 名称 | 语法 | 中文叫法 | 含义 | 归属 |
| --- | --- | --- | --- | --- |
| 正向肯定断言 | `(?=...)` | 前瞻 / lookahead | 后面**必须**是… | ES3 |
| 正向否定断言 | `(?!...)` | 负向前瞻 | 后面**不能**是… | ES3 |
| 反向肯定断言 | `(?<=...)` | 后顾 / lookbehind | 前面**必须**是… | **ES2018** |
| 反向否定断言 | `(?<!...)` | 负向后顾 | 前面**不能**是… | **ES2018** |

记忆法：带 `<` 的是"往回看"（反向），不带 `<` 的是"往前看"（正向）；带 `!` 的是"否定"。

#### 素材代码与输出

> 对应文件：`ES9\3-正则断言.html`

```js
let str = 'JS5211314你知道么555啦啦啦';

// 正向断言：匹配"后面跟着'啦'的数字"
const reg1 = /\d+(?=啦)/;
console.log(reg1.exec(str));
// ['555', index: 13, input: 'JS5211314你知道么555啦啦啦', groups: undefined]

// 反向断言：匹配"前面是'么'的数字"
const reg2 = /(?<=么)\d+/;
console.log(reg2.exec(str));
// ['555', index: 13, input: 'JS5211314你知道么555啦啦啦', groups: undefined]
```

两段结果一样，但筛的条件完全不同：第一个靠"后面的字"定位，第二个靠"前面的字"定位。

注意 `5211314` 那段为什么没被匹配：`/\d+(?=啦)/` 要求数字后紧跟 `啦`，而 `5211314` 后面是 `你`，失败；`/(?<=么)\d+/` 要求数字前是 `么`，`5211314` 前面是 `S`，也失败。所以两段都落在 `555` 上。

#### 素材文件里的一个真实报错

打开 `3-正则断言.html` 会看到这样两行同时存在（都用了 `const reg`、`const result`）：

```js
const reg = /\d+(?=啦)/;
const result = reg.exec(str);

// 反向断言
const reg = /(?<=么)\d+/;      // SyntaxError: Identifier 'reg' has already been declared
const result = reg.exec(str);
```

**这不是语法特性问题，是"同一作用域重复声明 `const`"**。练习时要注释掉一组再跑另一组，否则整段 `<script>` 直接不执行。这类"课件里为节省篇幅把两种写法写在一起"的情况很常见，遇到整段代码没反应，先看控制台报错。

#### 实用场景

```js
// 1. 取价格数字，不含货币符号
'￥199'.match(/(?<=￥)\d+/)[0];        // '199'

// 2. 取 @后面的用户名，但不要把 @ 本身取出来
'hi @tom and @jerry'.match(/(?<=@)\w+/g); // ['tom', 'jerry']

// 3. 排除特定前缀：匹配不是 "http" 开头的 www 域名
'https://a.com  http://b.com'.match(/(?<!s)www/g);
```

第三条要小心：`(?<!s)www` 表示"前面不是 s 的 www"，用在 `https` 这种场景需要更精确的边界处理，实际项目建议直接写完整模式。

### 5.3 dotAll 模式：`s` 标志

#### 问题：`.` 匹配不到换行

`.` 元字符的含义是"除换行符以外的任意单个字符"。所以当目标文本跨行时，`.*` 会在第一个换行处停下：

```js
const str = `<ul>
  <li><a>肖生克的救赎</a><p>上映日期: 1994-09-10</p></li>
</ul>`;

// 不用 s 标志：跨行匹配失败
const regA = /<li>.*?<a>(.*?)<\/a>.*?<p>(.*?)<\/p>/;
console.log(regA.exec(str));  // null
```

绕开的旧办法是写 `[\s\S]*?` 或 `[\d\D]*?`——"任意空白 + 任意非空白 = 任意字符"，非常难读。

#### 解决：加 `s` 标志

> 对应文件：`ES9\4-正则dotAll模式.html`

```js
let str = `
        <ul>
            <li>
                <a>肖生克的救赎</a>
                <p>上映日期: 1994-09-10</p>
            </li>
            <li>
                <a>阿甘正传</a>
                <p>上映日期: 1994-07-06</p>
            </li>
        </ul>`;

// 声明正则：s 让 . 能匹配换行，g 让匹配继续往后找
const reg = /<li>.*?<a>(.*?)<\/a>.*?<p>(.*?)<\/p>/gs;

// 执行匹配（循环取完全部结果）
let result;
let data = [];
while (result = reg.exec(str)) {
  data.push({ title: result[1], time: result[2] });
}

console.log(data);
// [
//   { title: '肖生克的救赎', time: '1994-09-10' },
//   { title: '阿甘正传',     time: '1994-07-06' }
// ]
```

三个技术点全在这段代码里：

| 要点 | 说明 |
| --- | --- |
| `s` 标志 | 让 `.` 也能匹配换行符（`\n`），跨行匹配不再是障碍 |
| `g` 标志 | 让 `exec` 每次从上次结束位置继续，配合 `while` 循环取出全部匹配 |
| `.*?` 加问号 | 非贪婪匹配，避免一口气吃到最后一个 `</p>`；去掉问号只会得到一条结果 |

#### 关于 `exec` 循环的细节

```js
const reg = /a/g;
let m;
while ((m = reg.exec('a1a2a3')) !== null) {
  console.log(m[0], m.index);   // a 0 / a 2 / a 4
}
```

- 正则对象会记住 `lastIndex`，所以同一个正则对象能被连续 `exec`。
- 如果正则**不带 `g`**，`exec` 永远返回第一个匹配，`while` 会变成死循环。这是正则调试里最经典的死循环来源。
- 必须先把 `exec` 的结果赋给变量再判断，写成 `while (reg.exec(str))` 在部分场景下会漏掉最后一个匹配（因为判断用的是返回值本身，若直接拿返回值当条件且同时要用它，容易写错下标）。

#### 与 `[\s\S]` 写法的对比

| 写法 | 可读性 | 版本 |
| --- | --- | --- |
| `.*?` + `s` 标志 | 高，意图明确 | ES2018 |
| `[\s\S]*?` | 低，需要理解"取反类拼任意字符" | ES3 起可用 |
| `[^]*?` | 最低，容易被误读 | — |

老环境（如不支持 `s` 的旧浏览器）仍需用 `[\s\S]`，新项目直接用 `s`。

### 5.4 补充：ES9 同批的正则与异步特性（代码目录未覆盖）

| 特性 | 写法 | 说明 |
| --- | --- | --- |
| Unicode 属性转义 | `/\p{Script=Han}/u` | 按 Unicode 属性匹配，如匹配汉字、Emoji |
| `Promise.prototype.finally` | `p.then(f).catch(g).finally(clean)` | 无论成功失败都执行，用来关 loading |
| 异步迭代 | `for await (const x of asyncIterable) { }` | 在 async 函数里逐个等待异步数据源 |

前两个在业务代码里出现频率很高，各给一个最小例子：

```js
// finally：请求前后开关 loading
let loading = false;
const fetchList = () => {
  loading = true;
  return fetch('/api/list')
    .then(r => r.json())
    .finally(() => { loading = false; });   // 成功、失败都会执行
};

// Unicode 属性转义：判断是否含汉字
console.log(/\p{Script=Han}/u.test('abc中文'));  // true
```

### 5.5 本章易错点

| 序号 | 错误写法 / 误区 | 实际结果 | 正确做法 |
| --- | --- | --- | --- |
| 1 | 同一作用域重复 `const reg`（素材文件现状） | `SyntaxError: Identifier 'reg' has already been declared`，整段脚本不执行 | 分组注释，或改用不同变量名 |
| 2 | 以为 `(?=...)` 是 ES9 新增 | 正向断言 ES3 就有 | ES9 新增的只有 `(?<=)` 与 `(?<!)` |
| 3 | `str.match(/.../g)` 后取 `.groups` | 带 `g` 时 `groups` 为 `undefined` | 用 `exec` + `while`，或用 `matchAll`（ES11） |
| 4 | 在非贪婪场景写 `.*` 不加 `?` | 一次吃到最后一个闭合标签，只得到一条结果 | 用 `.*?` |
| 5 | 用 `while (reg.exec(s))` 但正则没有 `g` 标志 | 无限循环 | 加 `g`，或改用 `matchAll` |
| 6 | 反向断言在不支持的旧环境里用 | 旧浏览器直接把它当普通字符，匹配结果异常 | 目标环境不支持时改用"先捕获再截取" |
| 7 | 以为 `.` 加 `s` 就能匹配一切 | `s` 只让 `.` 匹配换行，其他元字符语义不变 | 需要匹配任意字符仍可用 `[\s\S]` |

### 5.6 本章小结

- 命名捕获分组 `(?<name>...)` 让取值从 `result[1]` 变成 `result.groups.name`，正则改动不再连带改取值代码。
- ES9 新增的断言是**反向**断言 `(?<=)`、`(?<!)`；正向的 `(?=)`、`(?!)` 是旧特性，必须分清。
- `s`（dotAll）标志让 `.` 匹配换行，替代了可读性极差的 `[\s\S]`；配合 `g` + `while(exec)` 可批量提取。
- 素材文件里那处 `const reg` 重复声明是语法错误，不是特性问题，遇到"代码没反应"先看控制台。

---

## 6. ES2019（ES10）：对象、字符串、数组、Symbol 的补全

ES10 是典型的"标准库打补丁"版本：没有任何新语法，四个小方法分别补在 `Object`、`String`、`Array`、`Symbol` 上。每个都很小，但每一个都在实际项目里天天用到。

> 素材对应：`D:\自学课程笔记\9_ES6\代码\ES10\`
> `1-Object.fromEntries.html` → `2-trimStart与trimEnd.html` → `3-Array.prototype.flat与flatMap.html` → `4-Symbol.prototype.description.html`
> 提醒：`1`、`2`、`3` 三个文件的新 API 调用语句都被注释了，取消注释才能看到效果。

### 6.1 Object.fromEntries：entries 的逆运算

#### 适用场景

`Object.entries` 把对象变数组，`Object.fromEntries` 把数组变回对象。它真正的价值不是"还原"，而是**借助数组方法（`map`/`filter`）加工对象，再转回去**。

#### 基本写法

> 对应素材（被注释的第一段）：

```js
// 二维数组 → 对象
const result = Object.fromEntries([
  ['name', '尚硅谷'],
  ['xueke', 'Java,大数据,前端,云计算']
]);
console.log(result);
// { name: '尚硅谷', xueke: 'Java,大数据,前端,云计算' }
```

```js
// Map → 对象
const m = new Map();
m.set('name', 'ATGUIGU');
const result2 = Object.fromEntries(m);
console.log(result2);  // { name: 'ATGUIGU' }
```

#### 与 Object.entries 的关系

> 素材第三段代码演示的正是这个"可逆"关系：

```js
// Object.entries：对象 → 数组（ES8）
const arr = Object.entries({ name: "尚硅谷" });
console.log(arr);  // [['name', '尚硅谷']]

// Object.fromEntries：数组 → 对象（ES10）
console.log(Object.fromEntries(arr));  // { name: '尚硅谷' }
```

| 方法 | 方向 | 版本 | 输入 | 输出 |
| --- | --- | --- | --- | --- |
| `Object.entries(obj)` | 对象 → 数组 | ES2017 | 对象 | `[[k, v], ...]` |
| `Object.fromEntries(iterable)` | 数组 → 对象 | ES2019 | 可迭代的 `[k, v]` 对（数组、Map） | 对象 |

#### 真正的用法：用数组方法加工对象

这是它存在的核心意义。举三个高频场景：

```js
const price = { apple: 5, banana: 3, orange: 8 };

// 1. 打折：所有值乘 0.8
const discounted = Object.fromEntries(
  Object.entries(price).map(([k, v]) => [k, v * 0.8])
);
console.log(discounted);  // { apple: 4, banana: 2.4000000000000004, orange: 6.400000000000001 }

// 2. 过滤：只要价格 >= 5 的
const expensive = Object.fromEntries(
  Object.entries(price).filter(([, v]) => v >= 5)
);
console.log(expensive);   // { apple: 5, orange: 8 }

// 3. 键名转换：加上货币单位
const withUnit = Object.fromEntries(
  Object.entries(price).map(([k, v]) => [k + '_cny', v])
);
console.log(withUnit);    // { apple_cny: 5, banana_cny: 3, orange_cny: 8 }
```

#### 用它做查询参数 / URLSearchParams 互转

```js
const params = new URLSearchParams('?a=1&b=2');
console.log(Object.fromEntries(params));  // { a: '1', b: '2' }

const obj = { q: 'js', page: 2 };
console.log(new URLSearchParams(obj).toString()); // 'q=js&page=2'
```

这是 `fromEntries` 在业务里出现最多的场景：把地址栏参数一次性变成普通对象。

#### 与 `reduce` 写法的对比

```js
// ES10 之前：手工 reduce
const obj1 = Object.entries(price).reduce((acc, [k, v]) => {
  acc[k] = v * 0.8;
  return acc;
}, {});

// ES10：fromEntries + map，声明式、无副作用
const obj2 = Object.fromEntries(Object.entries(price).map(([k, v]) => [k, v * 0.8]));
```

### 6.2 trimStart 与 trimEnd：只去一边的空白

#### 适用场景

`trim()` 会把两边空白都去掉，但有些场合只能去一边：

- 处理用户输入的"金额"：右侧空格要去，左侧空格也要去，但如果是**对齐用的缩进文本**，只想去掉尾部
- 拼接多行文本时清掉行尾的 `\r`、空格
- 模板里保留了首行缩进，只想去掉结尾多余空行

```js
let str = '   iloveyou   ';

console.log(str);              // '   iloveyou   '
console.log(str.trimStart());  // 'iloveyou   '
console.log(str.trimEnd());    // '   iloveyou'
console.log(str.trim());       // 'iloveyou'
```

#### 别名提醒

| 方法 | 别名 | 说明 |
| --- | --- | --- |
| `trimStart()` | `trimLeft()` | 同功能，别名是为兼容旧代码 |
| `trimEnd()` | `trimRight()` | 同上 |

推荐统一用 `trimStart`/`trimEnd`：**方向语义比"左右"更清晰**，尤其在从右往左书写习惯的语言里。

#### 它去掉了哪些字符

不只空格，所有空白字符都会去掉：`\t`（制表符）、`\n`（换行）、`\v`、`\f`、`\r`、以及全角空格 `\u3000` 和 `\u00A0`（不换行空格）。

```js
console.log('\n\t  abc  \r\n'.trimStart());  // 'abc  \r\n'
console.log('\u3000abc'.trimStart());        // 'abc'  ← 全角空格也去掉
```

#### 与 `padStart` 的组合

上一章讲的 `padStart` 是"补"，这里的 `trimStart` 是"去"，两者经常一起出现在表单处理里：

```js
const raw = '  7 ';
const normalized = String(raw).trim();        // '7'
console.log(normalized.padStart(3, '0'));     // '007'
```

### 6.3 Array.prototype.flat 与 flatMap：把嵌套摊平

#### flat：按深度摊平数组

> 对应素材（被注释部分）：

```js
// 一层嵌套
const arr1 = [1, 2, 3, 4, [5, 6]];
console.log(arr1.flat());     // [1, 2, 3, 4, 5, 6]

// 两层嵌套
const arr2 = [1, 2, 3, 4, [5, 6, [7, 8, 9]]];
console.log(arr2.flat());     // [1, 2, 3, 4, 5, 6, [7, 8, 9]]   ← 只摊一层
console.log(arr2.flat(2));    // [1, 2, 3, 4, 5, 6, 7, 8, 9]     ← 摊两层

// 不管几层，全摊平
console.log([1, [2, [3, [4, [5]]]]].flat(Infinity)); // [1, 2, 3, 4, 5]
```

参数规则：

| 参数 | 含义 | 例子结果 |
| --- | --- | --- |
| 不传 | 等价于 `flat(1)`，摊一层 | `[1,[2,[3]]].flat()` → `[1,2,[3]]` |
| 数字 n | 摊 n 层 | `[1,[2,[3]]].flat(2)` → `[1,2,3]` |
| `Infinity` | 无限层，彻底摊平 | 同上 |
| 0 | 不摊，但会**移除空位** | `[1,,2].flat(0)` → `[1,2]` |

#### flatMap：先 map 再摊平一层

> 对应素材（当前实际执行的那段）：

```js
const arr = [1, 2, 3, 4];
const result = arr.flatMap(item => [item * 10]);
console.log(result);   // [10, 20, 30, 40]
```

`flatMap` 等价于 `arr.map(fn).flat(1)`，但它只摊**一层**，这个限制很关键：

```js
// 等价验证
const a = [1, 2].flatMap(x => [[x]]);        // [[1], [2]]
const b = [1, 2].map(x => [[x]]).flat(1);    // [[1], [2]]
// 里面那层 [x] 没有被摊开，因为 flatMap 只摊一层

// 想要彻底摊平，只能 map 之后 flat(Infinity)
const c = [1, 2].flatMap(x => [[x]]).flat(Infinity); // [1, 2]
```

#### flatMap 的价值：一行完成"映射 + 过滤"

`flatMap` 有一个隐藏特性：**返回空数组等于过滤掉该项**（不同于会保留 `undefined` 的 `map`）。

```js
// 场景：过滤奇数并乘 2
const nums = [1, 2, 3, 4, 5];

// map + filter 两步
const r1 = nums.filter(n => n % 2 === 0).map(n => n * 2);  // [4, 8]

// flatMap 一步
const r2 = nums.flatMap(n => n % 2 === 0 ? [n * 2] : []);  // [4, 8]
```

#### 真实场景：拆分标签

```js
const posts = [
  { title: 'A', tags: 'js, css' },
  { title: 'B', tags: 'html' }
];

// 想得到所有标签的扁平数组
const allTags = posts.flatMap(p => p.tags.split(','));
console.log(allTags);  // ['js', ' css', 'html']  ← 注意有空格，需要 trim
console.log(posts.flatMap(p => p.tags.split(',').map(t => t.trim())));  // ['js','css','html']
```

如果不用 `flatMap`，就得写 `posts.map(...).reduce((a, b) => a.concat(b), [])` 或 `map` + `flat`。

#### 与旧写法对比

| 目标 | 旧写法 | ES10 |
| --- | --- | --- |
| 摊平一层 | `arr.reduce((a, b) => a.concat(b), [])` | `arr.flat()` |
| 摊平任意层 | 递归 / `JSON` 技巧 | `arr.flat(Infinity)` |
| 映射后摊平 | `arr.map(f).reduce((a,b) => a.concat(b), [])` | `arr.flatMap(f)` |

第三行那个 `reduce + concat` 是老代码里最常见的"扁平化"手写实现，现在可以直接删掉。

### 6.4 Symbol.prototype.description：读 Symbol 的描述

#### 适用场景

调试、日志输出、把 Symbol 当键时展示可读信息。

> 对应素材：

```js
// 创建 Symbol
let s = Symbol('尚硅谷');

console.log(s.description);   // '尚硅谷'
```

#### 为什么需要它

ES6 创建 Symbol 时传的字符串叫"描述"，但它在 ES10 之前**只能靠 `toString()` 截取**：

```js
const s = Symbol('尚硅谷');

// ES10 之前：只能硬拆字符串
console.log(s.toString());            // 'Symbol(尚硅谷)'
console.log(s.toString().slice(7, -1)); // '尚硅谷'  ← 极其脆弱

// ES10：直接读
console.log(s.description);           // '尚硅谷'
```

| 写法 | 结果 | 问题 |
| --- | --- | --- |
| `s.toString()` | `'Symbol(尚硅谷)'` | 带包装，要自己切 |
| `String(s)` | `'Symbol(尚硅谷)'` | 同上 |
| `s.description` | `'尚硅谷'` | 无包装，直接可用 |
| `Symbol().description` | `undefined` | 没传描述就是 `undefined` |

一个容易忽略的点：`Symbol()` 不传参数时 `description` 是 `undefined`，不是空字符串。

### 6.5 补充：ES10 同批的其他变更（代码目录未覆盖）

| 变更 | 说明 | 影响 |
| --- | --- | --- |
| 可选 catch 绑定 | `try {} catch {}`（省略参数） | 不关心错误对象时少写一个形参 |
| `Array.prototype.sort` 稳定性 | 规范明确要求稳定排序 | 相同键的元素保持原相对顺序，老引擎不保证 |
| `Function.prototype.toString` 修订 | 返回源码原文（含注释与空白） | 依赖 `toString` 做解析的工具更可靠 |
| JSON 超集 | 字符串里允许出现 `U+2028`、`U+2029` | 从 JSON 复制多行文本不再报语法错 |
| `Symbol.prototype.description` | 见 6.4 | — |

可选 catch 绑定给个例子：

```js
// 旧写法：必须声明 err 却用不到，ESLint 还会报 unused
try {
  JSON.parse(str);
} catch (err) {
  console.log('解析失败');
}

// ES10：可以直接省略
try {
  JSON.parse(str);
} catch {
  console.log('解析失败');
}
```

### 6.6 本章易错点

| 序号 | 错误写法 / 误区 | 实际结果 | 正确做法 |
| --- | --- | --- | --- |
| 1 | 以为 `Object.fromEntries` 能接收 `{a:1}` | 报 `TypeError: object is not iterable` | 它要的是 `[k,v]` 对的**可迭代对象**，先用 `Object.entries` |
| 2 | 用 `fromEntries` 处理重复键 | 后出现的覆盖先出现的 | 需要累加时先用 `reduce` 合并 |
| 3 | 以为 `flat()` 会无限层摊平 | 只摊一层 | 用 `flat(Infinity)` |
| 4 | 以为 `flatMap` 会摊多层 | 只摊一层 | 再链一个 `flat()` |
| 5 | 用 `map` 返回数组再期望自动摊平 | 得到嵌套数组 | 用 `flatMap` |
| 6 | 在含稀疏空位的数组上用 `map` 期望跳过 | `map` 保留空位 | `flat` 会移除空位，`flatMap` 也一并移除 |
| 7 | `symbol.description` 期望得到空串 | `Symbol()` 时为 `undefined` | 用 `?? ''` 兜底 |
| 8 | 用 `s.toString().replace('Symbol(','')` 取描述 | 描述里有 `)` 时会截错 | 直接用 `.description` |
| 9 | 以为 `trimStart` 只去空格 | 所有空白字符都去掉，含全角空格与换行 | 需要只去空格时用正则 `replace(/^ +/, '')` |

第 9 条再补一个易被忽略的例子：

```js
console.log('\u3000\u3000正文'.trimStart());  // '正文'（全角空格被去掉）
```

### 6.7 本章小结

- `Object.fromEntries` 与 `Object.entries` 互逆，核心价值是"**用数组方法加工对象**"：`entries → map/filter → fromEntries`。
- `URLSearchParams` 与普通对象互转是它最高频的实战场景。
- `trimStart` / `trimEnd` 只去一侧空白，别名是 `trimLeft` / `trimRight`，去的不止空格。
- `flat(n)` 按深度摊平，`Infinity` 全摊平；`flatMap` 等价 `map + flat(1)`，返回空数组即等于过滤。
- `Symbol.prototype.description` 免去了从 `'Symbol(xxx)'` 字符串里截取描述的脏活。
- 本版还有可选 catch 绑定、稳定排序等"看不见但重要"的规范变更。

---

## 7. ES2020（ES11）：类私有字段与动态 import

从这里开始进入 ES11。这一版是 ES7~ES11 里内容最多的一版，本节先讲两个"结构性"特性：**让类的内部状态真正私有**、**让模块可以按需加载**。

> 素材对应：`D:\自学课程笔记\9_ES6\代码\ES11\`
> `1-私有属性.html`（私有字段）→ `5-动态import加载.html` + `js\app.js` + `js\hello.js`（动态 import）

### 7.1 私有字段：`#` 开头，类外真的拿不到

#### 先说清版本归属（重要）

这是本笔记里**唯一一处需要特别纠正版本**的地方。课件把"私有属性"放在 ES11 讲，实际情况是：

| 事实 | 说明 |
| --- | --- |
| 提案阶段 | `#` 私有字段长期处于 Stage 3，课件录制时尚未正式进标准 |
| 浏览器实现 | Chrome 74（2019 年）已实现，所以当时的代码能跑 |
| **正式标准版本** | **ES2022** 才把 class fields（含公有字段声明与 `#` 私有字段）正式纳入规范 |
| 结论 | 代码能跑不等于"属 ES11"；写文档、面试作答时应说 **ES2022** |

同一个文件里的 `name;` 这种**公有字段声明**同样是 ES2022 的类字段语法。本笔记按素材顺序讲，但每个特性都会标真实版本。

#### 素材代码

> 对应文件：`ES11\1-私有属性.html`

```js
class Person {
  // 公有属性
  name;
  // 私有属性
  #age;
  #weight;

  // 构造方法
  constructor(name, age, weight) {
    this.name = name;
    this.#age = age;
    this.#weight = weight;
  }

  intro() {
    console.log(this.name);
    console.log(this.#age);
    console.log(this.#weight);
  }
}

// 实例化
const girl = new Person('晓红', 18, '45kg');

// console.log(girl.name);     // '晓红'   ← 公有，能访问
// console.log(girl.#age);     // SyntaxError: Private field '#age' must be declared in an enclosing class
// console.log(girl.#weight);  // 同上

girl.intro();
// 晓红
// 18
// 45kg
```

#### 为什么 `girl.#age` 是语法错误而不是 `undefined`

这是很多人第一次见会愣住的地方：它不是运行时报错，而是**解析阶段就报错**。因为 `#age` 不是"一个名字奇怪的属性"，而是一套**独立于普通属性的私有名字空间**——私有字段只能在其声明所在的类体内部被引用，类外部连"引用这个语法"都不合法。

#### 适用场景

| 场景 | 为什么需要私有 |
| --- | --- |
| 内部状态不能被外部随意篡改 | 如计数器、缓存、连接句柄 |
| 只暴露受控接口 | 通过 `intro()` 这样的方法读，外部不能直连数据 |
| 避免与外部属性重名冲突 | 私有名字空间独立，`#x` 与 `this.x` 互不干扰 |
| 库作者隐藏实现细节 | 升级实现不影响使用者 |

#### 与旧方案对比

ES11（实际是 ES2022）之前，"私有"只能靠约定或 `WeakMap`：

```js
// 方案一：下划线约定（靠自觉，外部照样能改）
class A {
  constructor() {
    this._age = 18;   // 只是个名字，外部 a._age = 0 依然生效
  }
}

// 方案二：闭包 + WeakMap（真的私有，但写法绕）
const _age = new WeakMap();
class B {
  constructor(age) {
    _age.set(this, age);
  }
  get age() {
    return _age.get(this);
  }
}

// 方案三：# 私有字段（ES2022，语法最直接）
class C {
  #age = 18;
  get age() { return this.#age; }
}
```

| 方案 | 真的私有 | 写法 | 可读性 |
| --- | --- | --- | --- |
| `_age` 约定 | 否 | 简单 | 高 |
| `WeakMap` | 是 | 冗长，需额外维护映射 | 低 |
| `#age` | 是 | 简单，与普通属性一致 | 高 |

#### 私有字段的规则细节

```js
class Counter {
  #count = 0;                 // 可以在声明处给初始值

  #step = 1;

  inc() {
    this.#count += this.#step;
    return this;
  }

  get value() {               // 通过 getter 暴露只读值
    return this.#count;
  }

  // 静态私有成员（同一批语法，ES2022）
  static #instances = 0;
  static create() {
    Counter.#instances++;
    return new Counter();
  }
  static get instances() {
    return Counter.#instances;
  }
}

const c = new Counter().inc().inc();
console.log(c.value);            // 2
console.log(c instanceof Counter); // true

// 检查私有字段是否存在（ES2022 的 in 语法）
console.log(#count in c);        // true
```

几个必须记住的边界：

| 规则 | 说明 |
| --- | --- |
| 必须先在类体里声明 | 不声明就直接 `this.#x = 1` 会报 `Private field must be declared in an enclosing class` |
| 不能用 `delete` | 私有字段不可删除 |
| 子类不能直接访问父类私有字段 | 只能通过父类暴露的方法 |
| 名字空间独立 | `#x` 与 `x` 是两个完全不同的成员，可以共存 |
| 不能动态访问 | 没有 `this['#x']` 这种写法，`Reflect` 也拿不到 |

```js
// 名字空间独立：同名共存
class Demo {
  x = 'public';
  #x = 'private';
  show() {
    console.log(this.x, this.#x);   // 'public' 'private'
  }
}
```

### 7.2 动态 import：把模块当成"用时才下载的资源"

#### 适用场景

ES6 的静态 `import` 有两个硬限制：**必须写在模块顶层**、**不能放在条件语句里**。ES11 的 `import()` 打破了这两条限制：

| 场景 | 说明 |
| --- | --- |
| 路由懒加载 | 进入某页才下载该页的代码 |
| 大体积依赖按需引入 | 富文本编辑器、图表库、`xlsx` 这类几百 KB 的库 |
| 条件加载 | 只有用户点了"导出"才加载导出模块 |
| 语言包 / 主题包 | 根据语言或主题动态选包 |

#### 素材代码：点按钮才加载模块

> 对应文件：`ES11\5-动态import加载.html`

```html
<button id="btn">点击</button>
<script src="./js/app.js" type="module"></script>
```

> `ES11\js\hello.js`（被加载的模块）

```js
export function hello() {
  alert('Hello');
}
```

> `ES11\js\app.js`（入口）

```js
// import * as m1 from "./hello.js";   ← 静态导入：页面一打开就下载，无论用不用
// 获取元素
const btn = document.getElementById('btn');

btn.onclick = function () {
  import('./hello.js').then(module => {
    module.hello();       // 点按钮之后才真正下载并执行 hello.js
  });
};
```

运行要点有两条，缺一不可：

1. **必须用 http 打开**（Live Server，端口 5501）。`file://` 协议下会报 `Failed to fetch dynamically imported module` 或 CORS 错误。
2. **入口 script 必须带 `type="module"`**，否则 `import()` 的路径解析与模块作用域都会出问题。

#### import() 返回的是 Promise

这是它比静态 import 灵活的根本原因：**返回值是 `Promise`，所以能 `.then`、能被 `await`、能 try/catch**。

```js
// 写法一：then
import('./hello.js').then(m => m.hello());

// 写法二：await（需在 async 函数内）
async function load() {
  const m = await import('./hello.js');
  m.hello();
}

// 写法三：按条件加载
async function loadEditor() {
  if (needRichText) {
    const { Editor } = await import('./editor.js');   // 解构拿到具名导出
    return new Editor();
  }
}

// 写法四：配合错误处理（网络断了不会白屏）
try {
  const m = await import('./heavy-module.js');
  m.init();
} catch (e) {
  console.error('模块加载失败', e);
}
```

#### 静态 import 与动态 import 对比

| 对比项 | `import x from './a.js'` | `import('./a.js')` |
| --- | --- | --- |
| 写法位置 | 只能在模块顶层 | 任何位置（函数内、if 里、事件回调里） |
| 时机 | 解析阶段就确定，页面加载即下载 | 执行到该行才发起请求 |
| 返回值 | 绑定（不是 Promise） | **Promise** |
| 能否条件化 | 不能 | 能 |
| 典型用途 | 常规依赖 | 懒加载、按需加载 |
| 归属版本 | ES6 | **ES2020** |

#### 补充：`import.meta`

同一批提案里还有个 `import.meta`，用来在模块内拿到自身信息：

```js
console.log(import.meta.url);   // 当前模块的完整 URL
// 老写法（非标准）：__filename、__dirname，在浏览器里根本不存在
```

它只在模块里可用，普通 `<script>` 里访问 `import.meta` 会直接语法错误。

#### 一个坑：动态 import 的路径必须是"字面量或可静态分析的表达式"

打包工具（webpack/vite）在构建时要预判可能被加载的模块。所以：

```js
// 推荐：字面量，打包器能识别并单独打包
import('./views/Home.js');

// 风险：完全动态拼接，打包器无法分析，可能漏打包
const name = getModuleName();
import('./views/' + name + '.js');

// 折中：给出有限的候选路径，便于静态分析
import(`./views/${name}.js`);
```

在 Vite/webpack 里，第二种写法常常"本地开发正常、打包后 404"，原因就在这里。

### 7.3 本章易错点

| 序号 | 错误写法 / 误区 | 实际结果 | 正确做法 |
| --- | --- | --- | --- |
| 1 | 在类外写 `obj.#field` | `SyntaxError: Private field '#field' must be declared in an enclosing class` | 通过类暴露的方法/getter 访问 |
| 2 | 不声明直接用 `this.#x = 1` | 同样报错 | 先在类体里写 `#x;` 声明 |
| 3 | 以为 `#` 私有字段是 ES11/ES2020 正式特性 | 正式标准版本是 **ES2022** | 写文档时标注 ES2022 |
| 4 | 子类里访问父类 `#field` | 报错，私有字段不继承可访问性 | 父类提供 protected 语义的方法 |
| 5 | `delete this.#x` | 语法错误 | 私有字段不可删除 |
| 6 | `obj['#x']` 动态取私有字段 | `undefined`，取不到 | 私有字段无动态访问方式 |
| 7 | 双击打开含 `import()` 的 HTML | 控制台报 CORS / Failed to fetch | 用 Live Server 起 http 服务 |
| 8 | 忘记 `type="module"` | `import` 语句语法错误 | 入口 script 加 `type="module"` |
| 9 | 动态路径完全拼接 | 打包后 404，本地却正常 | 尽量用字面量或有限模板 |
| 10 | 以为 `import()` 能用 `await` 在顶层 | 顶层 `await` 是 ES2022 且仅模块内可用 | 包在 async 函数里 |

第 10 条给一个对照：

```js
// 模块顶层直接 await：环境支持 ES2022 顶层 await 时才成立
// const m = await import('./a.js');

// 稳妥写法：包一层 async 函数
async function boot() {
  const m = await import('./a.js');
  m.run();
}
boot();
```

### 7.4 本章小结

- `#` 私有字段让"类内部状态"真正不可从外部访问，是 `_name` 约定与 `WeakMap` 方案的语法级替代；**正式标准版本是 ES2022**，课件放在 ES11 属于当时的前瞻讲解。
- 私有字段类外访问是**语法错误**，不是运行时 `undefined`；且必须先声明、不可 `delete`、不可动态访问。
- `import()` 返回 Promise，可在任意位置按条件加载模块，是路由懒加载与大型依赖按需引入的标准手段。
- 动态 import 必须跑在 http 服务上（本项目端口 5501），且入口要写 `type="module"`。
- 完全拼接的模块路径会破坏打包工具的静态分析，写成字面量或有限模板更安全。

---

## 8. ES2020（ES11）：Promise.allSettled 与 String.matchAll

这两个方法解决的是同一类痛点：**"批量操作里，我不希望一个失败就全废"** 和 **"我要拿到全部匹配，而不只是第一个"**。

> 素材对应：`ES11\2-Promise.allSettled.html`、`ES11\3-String.prototype.matchAll.html`

### 8.1 Promise.allSettled：等所有任务"落地"

#### 先看 Promise 四大并发方法的区别

这是面试高频题，一张表说清：

| 方法 | 何时返回 | 成功条件 | 结果形态 | 版本 |
| --- | --- | --- | --- | --- |
| `Promise.all` | 全部成功后 | 有一个 reject 就整体 reject | 值的数组 | ES6 |
| `Promise.race` | **第一个** settled（成功或失败） | 跟随最先落地的那个 | 单个值 / 错误 | ES6 |
| `Promise.allSettled` | **全部** settled | **永不 reject**（除非参数不是可迭代） | `[{status, value/reason}, ...]` | **ES2020** |
| `Promise.any` | 第一个 fulfilled | 全部失败才 reject（`AggregateError`） | 单个值 | **ES2021** |

注意最后一行：`Promise.any` 是 **ES2021**，不属于本文范围，别记成 ES11。

#### 素材代码

> 对应文件：`ES11\2-Promise.allSettled.html`

```js
// 声明两个 promise 对象
const p1 = new Promise((resolve, reject) => {
  setTimeout(() => {
    resolve('商品数据 - 1');
  }, 1000);
});

const p2 = new Promise((resolve, reject) => {
  setTimeout(() => {
    resolve('商品数据 - 2');
    // reject('出错啦!');     ← 取消注释就能看到 p2 变成 rejected
  }, 1000);
});

// 调用 allSettled 方法（素材中被注释）
const result = Promise.allSettled([p1, p2]);
const res = Promise.all([p1, p2]);

console.log(result);
```

两个 Promise 都成功时的输出：

```js
// Promise.allSettled 的结果
[
  { status: 'fulfilled', value: '商品数据 - 1' },
  { status: 'fulfilled', value: '商品数据 - 2' }
]
```

把 `p2` 的 `reject('出错啦!')` 取消注释后：

```js
// Promise.allSettled：依然 resolve，失败项用 status 标记
[
  { status: 'fulfilled', value: '商品数据 - 1' },
  { status: 'rejected',  reason: '出错啦!' }
]

// Promise.all：整体直接 reject，只能拿到那个错误，成功的数据全丢
// Uncaught (in promise) 出错啦!
```

这就是本质差异：**`all` 是"全部成功才算成功"，`allSettled` 是"全部都有结果就算成功"**。

素材文件里 `console.log(res)` 打印的是 `Promise.all` 的结果，而 `res` 这一行本身被注释掉了——**直接运行会报 `ReferenceError: res is not defined`**。这正是课件"注释一部分代码"的常见副作用，练习时先把 `const res = ...` 那行取消注释，或者把 `console.log` 改回 `result`。

#### 结果对象的两种形态

| 状态 | 结构 | 关键字段 |
| --- | --- | --- |
| 成功 | `{ status: 'fulfilled', value }` | `value` 是被 resolve 的值 |
| 失败 | `{ status: 'rejected', reason }` | `reason` 是被 reject 的值 |

注意字段名不一样：成功用 **`value`**，失败用 **`reason`**。写成 `item.value` 去取失败项的值永远拿不到。

#### 适用场景

| 场景 | 为什么用 allSettled |
| --- | --- |
| 首页多个模块并行请求 | 某个模块挂了不该影响整页渲染 |
| 批量上传文件 | 需要知道哪些成功、哪些失败，再重试失败的 |
| 批量发通知 / 批量写库 | 部分失败时仍要汇总完整结果 |
| 健康检查多个服务 | 要一份"每个服务通不通"的完整清单 |

#### 实战：分类汇总成功与失败

```js
const tasks = [
  fetch('/api/a').then(r => r.json()),
  fetch('/api/b').then(r => r.json()),
  fetch('/api/c').then(r => r.json())
];

const results = await Promise.allSettled(tasks);

// 按状态分组（最常用的写法）
const okList = results.filter(r => r.status === 'fulfilled').map(r => r.value);
const failList = results.filter(r => r.status === 'rejected').map(r => r.reason);

console.log(`成功 ${okList.length} 个，失败 ${failList.length} 个`);

// 只关心"有没有失败"，可以用 every / some
const allOk = results.every(r => r.status === 'fulfilled');
if (!allOk) {
  console.warn('存在失败的请求：', failList);
}
```

#### 常见误区：它是"等待全部"而不是"忽略失败"

```js
// 误区：以为 allSettled 会快
// 事实：它必然等到最慢的那个结束才 resolve

// 误区：以为失败项不会出现在结果里
// 事实：失败项一定会在结果数组中占位，只是 status 是 'rejected'
```

| 误区 | 事实 |
| --- | --- |
| `allSettled` 会丢弃失败项 | 不会，失败项以 `{status:'rejected', reason}` 保留，且**顺序与传入顺序一一对应** |
| `allSettled` 只要有失败就 reject | 不会，它几乎不会 reject |
| `allSettled` 比 `all` 快 | 耗时相同，差异只在失败处理策略 |
| 传入空数组会挂住 | 立即 resolve 为 `[]` |

#### 与 try/catch 的组合

```js
// allSettled 本身不会抛错，所以外层 try/catch 只用于兜底"参数非法"等极端情况
try {
  const results = await Promise.allSettled(tasks);
  // 不需要 catch 单个失败，逐个判 status 即可
} catch (e) {
  // 只有 tasks 不是可迭代对象之类才会到这里
  console.error('参数异常', e);
}
```

### 8.2 String.prototype.matchAll：一次拿到所有匹配

#### 先说旧办法的两个问题

在 `matchAll` 之前，"取出全部匹配"只能这么写：

```js
const str = '<li>1</li><li>2</li>';
const reg = /<li>(.*?)<\/li>/g;

// 写法一：match + g，拿到的是纯字符串数组，没有分组信息
console.log(str.match(reg));   // ['<li>1</li>', '<li>2</li>']  ← 分组不见了

// 写法二：while + exec，能拿分组但要自己维护循环
let m, out = [];
while ((m = reg.exec(str)) !== null) {
  out.push(m[1]);
}
console.log(out);              // ['1', '2']
```

问题在于：**`match` 带 `g` 会丢失分组和 `index`，`while + exec` 啰嗦且容易写成死循环**。

#### matchAll 的写法

> 对应文件：`ES11\3-String.prototype.matchAll.html`

```js
let str = `<ul>
            <li>
                <a>肖生克的救赎</a>
                <p>上映日期: 1994-09-10</p>
            </li>
            <li>
                <a>阿甘正传</a>
                <p>上映日期: 1994-07-06</p>
            </li>
        </ul>`;

// 声明正则（必须有 g 标志）
const reg = /<li>.*?<a>(.*?)<\/a>.*?<p>(.*?)<\/p>/sg;

// 调用方法：返回的是迭代器，不是数组
const result = str.matchAll(reg);

// 方式一：for...of 逐个处理
// for (let v of result) {
//   console.log(v);
// }

// 方式二：展开成数组（素材里的写法）
const arr = [...result];

console.log(arr);
// [
//   ['<li>...1994-09-10</p>', '肖生克的救赎', '1994-09-10', index: 12, input: '...', groups: undefined],
//   ['<li>...1994-07-06</p>', '阿甘正传',     '1994-07-06', index: 118, input: '...', groups: undefined]
// ]
```

三个要点：

| 要点 | 说明 |
| --- | --- |
| 返回值是**迭代器** | 不能直接 `.map` 或 `.length`，要先 `[...result]` 或 `Array.from(result)` |
| **正则必须带 `g`** | 不带 `g` 会抛 `TypeError: String.prototype.matchAll called with a non-global RegExp argument` |
| 每一项都是完整 match 数组 | 含下标、分组、`index`、`input`、`groups`，信息量比 `match(/g)` 大得多 |

#### 直接加工成业务数据

```js
const movies = [...str.matchAll(reg)].map(([, title, time]) => ({ title, time }));
console.log(movies);
// [
//   { title: '肖生克的救赎', time: '1994-09-10' },
//   { title: '阿甘正传', time: '1994-07-06' }
// ]
```

对比上一章 ES9 里 `while (reg.exec(str))` 的写法，这段明显干净：没有手动循环、没有 `lastIndex` 残留问题。

#### 与命名分组配合（ES9 + ES11 的绝配）

```js
const str2 = '2024-05-31 和 2025-01-01';
const reg2 = /(?<y>\d{4})-(?<m>\d{2})-(?<d>\d{2})/g;

const list = [...str2.matchAll(reg2)].map(m => m.groups);
console.log(list);
// [ { y: '2024', m: '05', d: '31' }, { y: '2025', m: '01', d: '01' } ]
```

#### 三种"取全部匹配"方式对比

| 方式 | 分组 | `index` | 写法 | 版本 |
| --- | --- | --- | --- | --- |
| `str.match(/re/g)` | 丢失 | 无 | 最短 | ES3 |
| `while (re.exec(str))` | 有 | 有 | 需手写循环，易死循环 | ES3 |
| `str.matchAll(re)` | 有 | 有 | 一行，返回迭代器 | **ES2020** |

#### 一个前提提醒

`matchAll` 传进去的正则**会保持原对象状态不变**（规范内部会复制一份），所以不像 `exec` 那样受 `lastIndex` 影响。但如果同一个正则对象之前被 `exec` 用过、`lastIndex` 不为 0，`matchAll` 内部复制时会**带上当前 `lastIndex`**，导致漏掉前面的匹配。稳妥做法是每次用 `/.../g` 字面量，或先 `reg.lastIndex = 0`。

```js
const re = /a/g;
re.exec('aaa');          // lastIndex 变成 1
console.log([...('aaa'.matchAll(re))].length);  // 2，不是 3
re.lastIndex = 0;
console.log([...('aaa'.matchAll(re))].length);  // 3
```

### 8.3 本章易错点

| 序号 | 错误写法 / 误区 | 实际结果 | 正确做法 |
| --- | --- | --- | --- |
| 1 | 用 `Promise.all` 处理"允许部分失败"的批量任务 | 一个失败整体 reject，成功数据全丢 | 改用 `Promise.allSettled` |
| 2 | 从失败项取 `item.value` | `undefined` | 失败项的值在 `item.reason` |
| 3 | 以为 `allSettled` 结果会被过滤掉失败项 | 失败项保留占位，顺序与输入一致 | 用 `filter(r => r.status === 'fulfilled')` 筛 |
| 4 | 以为 `allSettled` 会尽快返回 | 必须等最慢的一个结束 | 需要"最快返回"用 `race` |
| 5 | 把 `Promise.any` 当成 ES11 | 它是 **ES2021** | 版本标注要写对 |
| 6 | 素材里 `console.log(res)` 直接运行 | `ReferenceError: res is not defined`（`res` 定义被注释了） | 取消注释或改打印 `result` |
| 7 | `str.matchAll(/re/)` 不带 `g` | `TypeError: matchAll called with a non-global RegExp argument` | 正则加 `g` |
| 8 | `matchAll(...).map(...)` | 迭代器没有 `map` 方法 | 先 `[...result]` 或 `Array.from(result)` |
| 9 | 期望 `matchAll` 返回数组 | 返回迭代器，只能遍历一次 | 需要多次访问时先转成数组 |
| 10 | 复用曾被 `exec` 用过的正则对象 | 受 `lastIndex` 影响，匹配数变少 | 重置 `lastIndex = 0` 或用字面量 |

### 8.4 本章小结

- `Promise.allSettled` 等全部落地且**永不 reject**，结果按输入顺序给出 `{status, value/reason}`；`Promise.all` 是"一个失败全盘失败"。
- 成功项读 `value`，失败项读 `reason`，这是最容易写错的地方。
- 四大并发方法的版本：`all`/`race` 属 ES6，`allSettled` 属 **ES2020**，`any` 属 ES2021。
- `String.prototype.matchAll` 一项返回完整 match 数组（含分组、`index`、`groups`），比 `match(/g)` 和 `while(exec)` 都更实用。
- `matchAll` 必须配 `g` 标志，返回迭代器需先转数组；配合 ES9 的命名分组是最清爽的解析组合。

---

## 9. ES2020（ES11）：可选链与空值合并

这两个语法糖是 ES11 里"改代码风格最多"的两个。它们解决的是同一件事：**读一个可能不存在的深层属性**。写完这两个，业务代码里的 `&&` 长串判断基本可以清空。

> 素材对应：`ES11\4-可选链操作符.html`（只演示了 `?.`，`??` 需自行补测；本节两个都讲）

### 9.1 可选链 `?.`：路径断了就返回 undefined

#### 素材代码

> 对应文件：`ES11\4-可选链操作符.html`

```js
function main(config) {
  // 旧写法：层层 && 判断
  // const dbHost = config && config.db && config.db.host;

  // ES11 写法
  const dbHost = config?.db?.host;

  console.log(dbHost);
}

main({
  db: {
    host: '192.168.1.100',
    username: 'root'
  },
  cache: {
    host: '192.168.1.200',
    username: 'admin'
  }
});
// 输出：192.168.1.100
```

`config?.db?.host` 的读法是：**如果 `config` 是 `null` 或 `undefined`，整个表达式立刻返回 `undefined`，不再往下取；否则继续取 `.db`，再对 `.db` 做同样判断，最后取 `.host`**。

行为验证：

```js
main();                                    // undefined（config 为 undefined）
main({});                                  // undefined（config.db 为 undefined）
main({ db: null });                        // undefined（null 也会短路）
main({ db: {} });                          // undefined（host 不存在，正常取到 undefined）
main({ db: { host: '127.0.0.1' } });        // '127.0.0.1'
```

#### 三种写法形式

| 形式 | 用于 | 例子 |
| --- | --- | --- |
| `obj?.prop` | 访问属性 | `user?.name` |
| `obj?.[expr]` | 动态键 | `list?.[index]`、`map?.[key]` |
| `fn?.()` | 调用函数 | `onSuccess?.()` |
| `obj?.prop.deep` | 只护住第一个 `.` 左边 | `a?.b.c` 中 `a` 为空则短路，但 `a.b` 为空时 `.c` 仍会报错 |

最后一行是新手最容易踩的坑，必须展开说：

```js
// ?. 只对它左边紧邻的那一层生效，不是"整条链都安全"
const a = { b: null };
console.log(a?.b.c);     // TypeError: Cannot read properties of null (reading 'c')
console.log(a?.b?.c);    // undefined  ← 正确：每一层都要写 ?

// 反过来：如果 a 是 undefined，a?.b.c 根本不会执行到 .c
const x = undefined;
console.log(x?.b.c);     // undefined，不报错
```

#### 短路特性：右边整个表达式都不执行

这一点很重要，能用来省掉函数调用的判空：

```js
const obj = null;

// 短路：后面这段完全不会执行
console.log(obj?.fn());            // undefined，不报错

// 有值时才执行
const api = { save() { console.log('保存成功'); } };
api?.save();                        // '保存成功'

// 回调可选的场景（非常常用）
function request(config, onSuccess) {
  // ...
  onSuccess?.(data);                // 没传回调就不调用，不用写 if
}
```

改造成本对比：

```js
// 旧写法
const host1 = config && config.db && config.db.host;
const cb1 = typeof onSuccess === 'function' && onSuccess();

// ES11
const host2 = config?.db?.host;
const cb2 = onSuccess?.();
```

#### 绝对不能用的场景

| 禁止用法 | 结果 | 原因 |
| --- | --- | --- |
| 赋值：`obj?.a = 1` | `SyntaxError: Invalid left-hand side in assignment` | 可选链只能读，不能写 |
| `new obj?.Cls()` | `SyntaxError` | 构造函数不能用可选链 |
| 声明：`const a?.b = 1` | `SyntaxError` | 同上 |
| 放在 `?.` 左边的 `delete`：`delete obj?.a` | 合法但需谨慎 | 只在 `obj` 存在时删除 |
| `super?.()` | `SyntaxError` | 不允许 |

需要"安全写入"时的代替写法：

```js
// 想实现 obj.a.b = 1，且 obj.a 可能不存在
if (obj.a == null) obj.a = {};
obj.a.b = 1;

// 或用更为谨慎的合并
obj.a = { ...(obj.a ?? {}), b: 1 };
```

#### 与 `&&` 链的差别

| 对比项 | `a && a.b && a.b.c` | `a?.b?.c` |
| --- | --- | --- |
| 空值判断范围 | 会拦 `0`、`''`、`false`（假值全部短路） | 只拦 `null` / `undefined` |
| 可读性 | 越长越难读 | 与普通取属性几乎一样 |
| 类型推断 | TS 中常被推断为联合类型 | 同样有类型收窄，但更准确 |
| 版本 | 任何版本 | ES2020 |

第一条差异会引发真实 bug：

```js
const cfg = { retry: 0 };

// 旧写法：retry 是 0（假值），直接短路成 0，后面取不到
console.log(cfg.retry && cfg.retry.max);   // 0

// 可选链：0 不是 null/undefined，继续取
console.log(cfg.retry?.max);               // undefined
```

#### 与数组、函数配合

```js
const list = null;
console.log(list?.[0]);          // undefined   动态键
console.log(list?.[0]?.name);    // undefined

const users = [{ name: 'a' }];
console.log(users?.[0]?.name);   // 'a'

// 结合默认值
console.log(users?.[5]?.name ?? '匿名');  // '匿名'
```

### 9.2 空值合并 `??`：只在 null / undefined 时兜底

#### 适用场景

给变量"取默认值"时，**只希望在真正没有值时兜底**。`||` 做不到这一点，因为 `0`、`''`、`false`、`NaN` 都是假值，会被一起兜掉。

```js
// 场景一：分页参数，用户传 0 表示"不分页"
const size = params.size || 10;   // 错：传 0 被兜成 10
const size2 = params.size ?? 10;  // 对：0 被保留

// 场景二：开关型配置
const enabled = config.enabled || true;   // 永远是 true，false 被兜掉（经典 bug）
const enabled2 = config.enabled ?? true;  // false 被正确保留

// 场景三：空字符串是合法值
const title = data.title || '未命名';     // '' 会被替换掉
const title2 = data.title ?? '未命名';    // '' 被保留
```

#### 行为对照表

| 值 | `v \|\| '默认'` | `v ?? '默认'` |
| --- | --- | --- |
| `undefined` | `'默认'` | `'默认'` |
| `null` | `'默认'` | `'默认'` |
| `0` | `'默认'` | `0` |
| `''` | `'默认'` | `''` |
| `false` | `'默认'` | `false` |
| `NaN` | `'默认'` | `NaN` |
| `'abc'` | `'abc'` | `'abc'` |

记住一句话：**`||` 判"假"，`??` 判"空"**。

#### 与 `?.` 组合：最常用的日常写法

```js
function getHost(config) {
  return config?.db?.host ?? '127.0.0.1';
}

console.log(getHost());                         // '127.0.0.1'
console.log(getHost({ db: { host: '10.0.0.1' } })); // '10.0.0.1'
```

顺序上要注意：`?.` 负责"路径断了不报错"，`??` 负责"断了给默认值"，所以永远是 `a?.b ?? default`。

#### 硬规则：不能和 `||`、`&&` 直接混用

```js
// SyntaxError: Nullish coalescing operator(??) requires parens when mixing with logical operators
// const r = a ?? b || c;

// 必须加括号表明优先级
const r1 = (a ?? b) || c;
const r2 = a ?? (b || c);
```

| 混用写法 | 结果 |
| --- | --- |
| `a ?? b \|\| c` | `SyntaxError` |
| `a \|\| b ?? c` | `SyntaxError` |
| `(a ?? b) \|\| c` | 合法 |
| `a && b ?? c` | `SyntaxError` |
| `(a && b) ?? c` | 合法 |

规范故意这么设计，因为两种运算的优先级"难以直觉判断"，强制加括号避免歧义。

#### 常见误用

```js
// 误用一：把 ?? 当成"空字符串也兜底"
const s = '' ?? 'x';    // ''  ← 它不兜空串，需要 || 或显式判断

// 误用二：以为 ?? 会做深拷贝
const obj = { a: 1 } ?? {};   // 原对象引用，不是拷贝

// 误用三：在 ?? 右边写复杂表达式却不加括号，导致优先级意外
const v = a ?? 1 + 2;   // 等价 a ?? 3，通常符合预期，但可读性差
```

#### 一个必须交代的版本提醒

`??=`、`||=`、`&&=`（逻辑赋值运算符）看起来跟 `??` 是一家人，但它们属于 **ES2021**，不在本文范围：

```js
// ES2021 才有：
// a ??= 1;   // 等价 a = a ?? 1
// a ||= 1;
// a &&= 1;

// ES11 范围内的等价写法：
a = a ?? 1;
```

### 9.3 本章易错点

| 序号 | 错误写法 / 误区 | 实际结果 | 正确做法 |
| --- | --- | --- | --- |
| 1 | `a?.b.c`（只护一层） | `a.b` 为 null 时 `TypeError` | 每层都写 `?:`→ `a?.b?.c` |
| 2 | `obj?.a = 1` | `SyntaxError: Invalid left-hand side in assignment` | 先判空再赋值 |
| 3 | 用 `\|\|` 代替 `??` 取默认值 | `0`、`''`、`false` 被错误兜底 | 只在"空值兜底"时用 `??` |
| 4 | `a ?? b \|\| c` | `SyntaxError`，必须加括号 | `(a ?? b) \|\| c` |
| 5 | 以为 `?.` 能防住 `0` 或 `''` | 只防 `null`/`undefined` | 假值场景用 `\|\|` 或显式判断 |
| 6 | `new Foo?.()` | `SyntaxError` | 先判空再 `new` |
| 7 | 期望 `'' ?? 'x'` 得到 `'x'` | 得到 `''` | 用 `'\|\|'` 或 `if (s === '')` |
| 8 | 以为 `??=` 属 ES11 | `??=` 属 **ES2021** | 写 `a = a ?? 1` |
| 9 | 在可选链后直接调用方法却没判空：`a?.b.c()` | 若 `b` 为 null 会报错 | `a?.b?.c?.()` |
| 10 | 用 `?.` 做条件判断：`if (obj?.a > 0)` | `undefined > 0` 为 `false`，不会报错 | 可接受，但别依赖它做数值校验 |

第 8 条再强调一次版本表，避免和其他 ES2021 特性混记：

| 特性 | 真实版本 | 归类 |
| --- | --- | --- |
| `?.` 可选链 | ES2020 | 本文覆盖 |
| `??` 空值合并 | ES2020 | 本文覆盖 |
| `??=` / `\|\|=` / `&&=` | ES2021 | 本文范围外 |
| `String.prototype.replaceAll` | ES2021 | 本文范围外 |
| `Promise.any` | ES2021 | 本文范围外 |
| 数字分隔符 `1_000` | ES2021 | 本文范围外 |

### 9.4 本章小结

- `?.` 只短路 `null`/`undefined`，且**只对紧邻左边一层生效**，链上每一层都要写。
- 它能用于属性、动态键、函数调用；不能用于赋值、`new`、`super`。
- `?.` 相比 `&&` 链的好处是**不会误伤 `0` / `''` / `false`**。
- `??` 只在 `null`/`undefined` 时兜底；`||` 会把所有假值一起兜掉，这是取默认值最经典的 bug 来源。
- `??` 与 `||`、`&&` 混用必须加括号，否则语法错误；`??=` 等逻辑赋值属 ES2021。

---

## 10. ES2020（ES11）：BigInt 与 globalThis

一个是"数字不够用了"，一个是"全局对象的名字不统一"。两个都是补漏型特性，但 BigInt 涉及 JS 最基础的数值模型，值得完整讲一遍。

> 素材对应：`ES11\6-BigInt.html`、`ES11\7-globalThis.html`、`ES11\7-globalThis.js`

### 10.1 BigInt：突破 2^53 的整数

#### 先说问题：Number 的安全整数边界

JavaScript 的 `Number` 是 IEEE 754 双精度浮点，尾数只有 53 位，所以能精确表示的整数上限是 `2^53 - 1`。超出之后，运算结果会**悄悄失真**，不报错。

> 素材代码（`6-BigInt.html` 中实际执行的部分）：

```js
// 大整数的最大安全值
let max = Number.MAX_SAFE_INTEGER;
console.log(max);      // 9007199254740991
console.log(max + 1);  // 9007199254740992   ← 还能正确表示
console.log(max + 2);  // 9007199254740992   ← 错！应该是 9007199254740993
```

`max + 2` 与 `max + 1` 输出了同一个数字，这就是精度丢失。在 ES11 之前，遇到这种需求只能上第三方大数库（如 `big.js`、`bignumber.js`）。

#### BigInt 的两种创建方式

> 素材代码（被注释的部分）：

```js
// 方式一：字面量加后缀 n
let n = 521n;
console.log(n);          // 521n
console.log(typeof n);   // 'bigint'

// 方式二：BigInt() 函数
console.log(BigInt(123));    // 123n
// console.log(BigInt(1.2)); // RangeError: The number 1.2 cannot be converted to a BigInt because it is not an integer
```

规则：**只能把整数转成 BigInt**，小数会抛 `RangeError`。

#### 素材代码：用 BigInt 修复精度

```js
let max = Number.MAX_SAFE_INTEGER;

console.log(BigInt(max));            // 9007199254740991n
console.log(BigInt(max) + BigInt(1)); // 9007199254740992n
console.log(BigInt(max) + BigInt(2)); // 9007199254740993n  ← 正确了
```

更常见的写法是用 `n` 后缀：

```js
const big = BigInt(Number.MAX_SAFE_INTEGER);
console.log(big + 1n);  // 9007199254740992n
console.log(big + 2n);  // 9007199254740993n
```

#### 硬规则：不能和 Number 混算

```js
// console.log(1n + 1);     // TypeError: Cannot mix BigInt and other types, use explicit conversions
console.log(1n + 1n);        // 2n
console.log(Number(1n) + 1); // 2
console.log(1n + BigInt(1)); // 2n
```

这条设计是为了避免"隐式转换导致精度问题"，代价是每次运算都要显式统一类型。

#### BigInt 与 Number 的差异清单

| 对比项 | Number | BigInt |
| --- | --- | --- |
| 能否表示小数 | 能 | 不能 |
| 精度 | 53 位安全整数 | 任意精度（受内存限制） |
| `typeof` | `'number'` | `'bigint'` |
| 与自身运算 | 直接算 | 直接算 |
| 混类型运算 | — | `TypeError` |
| 除法 | 有小数 | **向零截断**，`7n / 2n === 3n` |
| `Math` 方法 | 全部可用 | **全部不可用**（`Math.max(1n,2n)` 报错） |
| `+` 一元运算符 | 可用 | 报错（`+1n` 不支持） |
| `JSON.stringify` | 支持 | **抛 `TypeError`** |
| 比较运算 | 支持 | 支持，可与 Number 直接比较大小 |
| 位运算 | 32 位 | 任意位 |

几个对照实验：

```js
console.log(7n / 2n);        // 3n     ← 截断，不是 3.5
console.log(7n % 2n);        // 1n
console.log(2n ** 64n);      // 18446744073709551616n

// 比较运算可以混用，不会报错
console.log(1n < 2);         // true
console.log(1n == 1);        // true（宽松相等）
console.log(1n === 1);       // false（严格相等，类型不同）

// JSON 序列化会直接失败
// JSON.stringify({ id: 1n });  // TypeError: Do not know how to serialize a BigInt

// 趟过这个坑的标准做法
console.log(JSON.stringify({ id: 1n }, (k, v) => typeof v === 'bigint' ? v.toString() : v));
// '{"id":"1"}'
```

#### 适用场景

| 场景 | 说明 |
| --- | --- |
| 数据库 `BIGINT` 主键 | 雪花 ID、推文 ID 常见 19 位数字，用 Number 会失真 |
| 高精度金额（分/厘） | 避免浮点误差，如 `1999n` 表示 19.99 元 |
| 密码学 / 哈希计算 | 大整数运算 |
| 时间戳纳秒级 | 高精度计时 |
| 位掩码超过 32 位 | Number 位运算只有 32 位 |

**不适合的场景**：普通计数、UI 数值、需要小数的运算、需要传给 `Math`、需要直接 `JSON.stringify` 送后端的地方。这些场景统一用 Number 更省事。

#### 一个实战注意点：后端返回大 ID 会失真

这是生产事故常客：后端返回 `{"id": 1234567890123456789}`，前端 `JSON.parse` 之后 `id` 已经不是原值了。

```js
const raw = '{"id": 1234567890123456789}';
const obj = JSON.parse(raw);
console.log(obj.id);            // 1234567890123456800  ← 尾数被改
console.log(obj.id.toString());  // '1234567890123456800'

// 补救：让后端把大整数作为字符串返回，前端按需转 BigInt
const safe = JSON.parse('{"id":"1234567890123456789"}', (k, v) =>
  /^\d{16,}$/.test(v) ? BigInt(v) : v
);
console.log(safe.id);   // 1234567890123456789n
```

工程上的通行做法仍是**后端把大 ID 序列化成字符串**，因为 `JSON` 本身没有大整数类型，前端强转 BigInt 之后又会遇到"不能 `JSON.stringify`"的连带问题。

### 10.2 globalThis：一个名字拿到全局对象

#### 问题：全局对象的名字因环境而异

| 环境 | 全局对象名 |
| --- | --- |
| 浏览器主线程 | `window` |
| 浏览器 Worker | `self` |
| Node.js | `global` |
| 旧版标准提法 | `this`（仅非严格模式顶层）/ `frames`（浏览器） |
| **统一标准（ES11）** | **`globalThis`** |

以前写同构代码（既跑浏览器又跑 Node）只能这样：

```js
const getGlobal = () =>
  typeof window !== 'undefined' ? window :
  typeof global !== 'undefined' ? global :
  typeof self !== 'undefined' ? self : this;
```

ES11 之后一行解决。

#### 素材代码

> 对应文件：`ES11\7-globalThis.html`、`ES11\7-globalThis.js`，内容相同：

```js
console.log(globalThis);
```

浏览器里打印出来就是 `Window` 对象；Node 里打印出来是 `Object [global]`。

```js
// 验证：等于当前环境的全局对象
console.log(globalThis === window);   // 浏览器：true
console.log(globalThis === global);   // Node：true
console.log(globalThis === self);     // Worker：true
```

#### 适用场景

| 场景 | 写法 |
| --- | --- |
| 挂载全局工具（小心污染） | `globalThis.__APP_VERSION__ = '1.0.0'` |
| 同构代码里访问全局 | `globalThis.setTimeout(...)` |
| 判断当前环境 | `typeof globalThis.window !== 'undefined'` |
| polyfill 挂载 | `globalThis.MyLib = MyLib` |

```js
// 同构获取 fetch（老环境兜底）
const getFetch = () => globalThis.fetch ?? require('node-fetch');

// 环境判断
const isBrowser = typeof globalThis.window !== 'undefined';
const isNode = typeof globalThis.process !== 'undefined';
```

#### 三个注意点

1. **不要用它替代明确的 `window` / `global`**。业务代码里写 `window.xxx` 意图更清楚，`globalThis` 主要给跨环境库用。
2. **它不能"创建"全局对象**，只是引用；赋值给它确实会挂到全局，等于污染命名空间，生产代码慎用。
3. **模块顶层 `this` 是 `undefined`**，不是 `globalThis`：

```js
// 普通 <script>（非严格模式）里
console.log(this === globalThis);   // true

// <script type="module"> 或 ESM 里
console.log(this);                  // undefined  ← 模块顶层 this 不再是全局对象
console.log(globalThis);            // 依然能拿到全局对象
```

第 3 条是很容易搞混的一点：**模块化之后 `this` 不再等于全局对象，`globalThis` 才是可靠入口**。

### 10.3 补充：ES11 其余变更（代码目录未覆盖）

| 变更 | 说明 | 备注 |
| --- | --- | --- |
| `for-in` 顺序规范 | 明确规定属性枚举顺序（整数键升序、字符串键按插入序） | 依赖顺序也有了标准依据 |
| `String.prototype.matchAll` | 见第 8 章 | — |
| `Promise.allSettled` | 见第 8 章 | — |
| `import.meta` | 见第 7 章 | 仅模块内可用 |
| 可选链与空值合并 | 见第 9 章 | — |
| 动态 `import()` | 见第 7 章 | — |
| `BigInt` | 见 10.1 | — |
| `globalThis` | 见 10.2 | — |

### 10.4 本章易错点

| 序号 | 错误写法 / 误区 | 实际结果 | 正确做法 |
| --- | --- | --- | --- |
| 1 | `1n + 1` | `TypeError: Cannot mix BigInt and other types` | 统一类型：`1n + 1n` 或 `Number(1n) + 1` |
| 2 | `BigInt(1.5)` | `RangeError: not an integer` | 先取整再转 |
| 3 | `Math.max(1n, 2n)` | `TypeError: Cannot convert a BigInt value to a number` | BigInt 不能用 `Math`，手写比较 |
| 4 | `JSON.stringify({ id: 1n })` | `TypeError: Do not know how to serialize a BigInt` | 用 `replacer` 转字符串，或后端直接给字符串 |
| 5 | `1n === 1` 期望为 `true` | `false`，类型不同 | 用 `==` 或先转换类型 |
| 6 | `7n / 2n` 期望 `3.5n` | `3n`，小数部分被截断 | BigInt 不能表示小数，金额用最小单位 |
| 7 | `+1n` | `TypeError: Cannot convert a BigInt value to a number` | 一元 `+` 不支持 BigInt |
| 8 | 以为 `globalThis` 只是 `window` 的别名 | Node 里是 `global`，Worker 里是 `self` | 它是跨环境引用的统一名字 |
| 9 | 模块里想用 `this` 拿全局 | 模块顶层 `this` 是 `undefined` | 用 `globalThis` |
| 10 | 用 `Number()` 转超大 BigInt | 精度丢失，`Number(9007199254740993n)` → `9007199254740992` | 保持 BigInt 或用字符串传输 |

最后一条补个演示：

```js
const big = 9007199254740993n;
console.log(Number(big));          // 9007199254740992  ← 转回 Number 就丢了
console.log(big.toString());       // '9007199254740993'  ← 字符串安全
```

### 10.5 本章小结

- `Number` 的安全整数上限是 `2^53 - 1`，超过后运算会静默失真；`BigInt` 提供任意精度整数。
- 创建方式：`521n` 或 `BigInt(123)`；小数转 BigInt 抛 `RangeError`。
- BigInt 与 Number **不能混算**，且不支持 `Math`、一元 `+`、`JSON.stringify`；除法向零截断。
- 大 ID、高精度金额、大位运算用 BigInt；UI 数值与小数运算继续用 Number。
- `globalThis` 统一了 `window`/`global`/`self`，是跨环境访问全局对象的唯一标准入口；模块顶层 `this` 已不再是全局对象。

---

## 11. 综合实战：把 ES7~ES11 用在一处

前面按版本拆开讲，容易"学完就忘"。本章给三个由浅入深的完整例子，每个例子都标明用到了哪几版特性，把散点连成线。

### 11.1 实战一：安全的配置读取器（ES8 + ES11）

**需求**：从多层配置对象里读值，缺失时给默认值，绝不因为路径断掉而报错。

```js
// 需求：getConfig(config, 'db.host', '127.0.0.1')
function getConfig(config, path, defaultValue) {
  const value = path
    .split('.')                                // ['db', 'host']
    .reduce((acc, key) => acc?.[key], config);  // ES11 可选链：中途 null 就停

  return value ?? defaultValue;                 // ES11 空值合并：只兜 null/undefined
}

const config = {
  db: { host: '192.168.1.100', port: 3306 },
  cache: null,
  retry: 0                                      // 0 是合法值
};

console.log(getConfig(config, 'db.host', 'localhost'));  // '192.168.1.100'
console.log(getConfig(config, 'db.port', 3306));         // 3306
console.log(getConfig(config, 'cache.host', 'no-cache')); // 'no-cache'（cache 是 null）
console.log(getConfig(config, 'cache.host.x', 'x'));      // 'x'（深层也安全）
console.log(getConfig(config, 'retry', 3));               // 0  ← 0 被正确保留，没被兜底
```

**用到的特性**：

| 特性 | 版本 | 作用 |
| --- | --- | --- |
| `reduce` | ES5 | 逐层下钻 |
| `?.` | ES2020 | 任一层是 `null`/`undefined` 就短路 |
| `??` | ES2020 | 只对空值兜底，保住 `0`、`''`、`false` |

**对照旧写法**：

```js
// ES11 之前
function getConfigOld(config, path, defaultValue) {
  let cur = config;
  for (const key of path.split('.')) {
    if (cur == null) return defaultValue;
    cur = cur[key];
  }
  return cur === undefined || cur === null ? defaultValue : cur;
}
```

两种写法都正确，新版胜在**意图直接**：`?.` 表达"可能没有"，`??` 表达"没有就给默认"，代码本身就是注释。

### 11.2 实战二：批量请求的健壮汇总（ES8 + ES11）

**需求**：并行请求 N 个接口，任何一个失败都不能影响整体，最后要拿到"成功数据列表 + 失败原因列表"。

```js
// 模拟请求：参数为 (数据, 是否成功)
const fakeFetch = (name, ok) => new Promise((resolve, reject) => {
  setTimeout(() => {
    ok ? resolve({ name, data: `${name} 的数据` }) : reject(new Error(`${name} 请求失败`));
  }, 200);
});

const tasks = [
  fakeFetch('商品列表', true),
  fakeFetch('用户信息', false),
  fakeFetch('推荐位', true)
];

async function loadAll() {                          // ES8 async
  const results = await Promise.allSettled(tasks);  // ES11 allSettled：永不整体失败

  const okList = results
    .filter(item => item.status === 'fulfilled')
    .map(item => item.value);

  const failList = results
    .filter(item => item.status === 'rejected')
    .map(item => item.reason.message);              // 失败项读 reason，不是 value

  return { okList, failList, total: results.length };
}

loadAll().then(r => {
  console.log(r.total);    // 3
  console.log(r.okList);   // [{name:'商品列表',...}, {name:'推荐位',...}]
  console.log(r.failList); // ['用户信息 请求失败']
});
```

**扩展：给失败项做重试**（更接近生产写法）

```js
async function retryFailed(tasks, retries = 1) {
  let results = await Promise.allSettled(tasks);
  let pending = results
    .map((r, i) => (r.status === 'rejected' ? tasks[i] : null))
    .filter(Boolean);

  for (let i = 0; i < retries && pending.length; i++) {
    const retryResults = await Promise.allSettled(pending);
    results = results
      .filter(r => r.status === 'fulfilled')
      .concat(retryResults);
    pending = retryResults
      .map((r, idx) => (r.status === 'rejected' ? pending[idx] : null))
      .filter(Boolean);
  }

  return results;
}
```

**用到的特性**：`async/await`（ES2017）、`Promise.allSettled`（ES2020）、数组 `filter/map`（ES5）、`?.` 可选用于日志打印。

### 11.3 实战三：从一段 HTML 里解析数据（ES10 + ES11）

**需求**：把多行 HTML 里所有条目的标题与日期抽出来，并做去重、分组统计。

```js
const html = `
  <ul>
    <li><a>肖生克的救赎</a><p>上映日期: 1994-09-10</p></li>
    <li><a>阿甘正传</a><p>上映日期: 1994-07-06</p></li>
    <li><a>这个杀手不太冷</a><p>上映日期: 1994-09-14</p></li>
    <li><a>肖生克的救赎</a><p>上映日期: 1994-09-10</p></li>
  </ul>`;

// 1. 定义正则：s 让 . 匹配换行（ES2018），g 让 matchAll 全部匹配
const reg = /<li>\s*<a>(?<title>.*?)<\/a>\s*<p>上映日期:\s*(?<date>.*?)<\/p>/gs;
//                                                                  ↑ ES2018 命名分组

// 2. 抽取（ES2020 matchAll）
const movies = [...html.matchAll(reg)].map(m => m.groups);
console.log(movies);
// [
//   { title: '肖生克的救赎', date: '1994-09-10' },
//   { title: '阿甘正传', date: '1994-07-06' },
//   { title: '这个杀手不太冷', date: '1994-09-14' },
//   { title: '肖生克的救赎', date: '1994-09-10' }
// ]

// 3. 按标题去重（用 Map 保序，Map 属 ES6）
const unique = [...new Map(movies.map(m => [m.title, m])).values()];
console.log(unique.length);   // 3

// 4. 按年份分组（Object.fromEntries：ES2019）
const byYear = Object.fromEntries(
  Object.entries(
    unique.reduce((acc, m) => {
      const year = m.date.slice(0, 4);
      (acc[year] ??= []).push(m.title);   // ← ??= 属 ES2021，ES11 请写下方写法
      return acc;
    }, {})
  ).map(([year, list]) => [year, list.flatMap(t => t)])   // flatMap：ES2019
);

// ES11 范围内等价写法（把 ??= 换掉）
const byYear11 = unique.reduce((acc, m) => {
  const year = m.date.slice(0, 4);
  acc[year] = acc[year] ?? [];      // 用 ?? 判断（ES2020）
  acc[year].push(m.title);
  return acc;
}, {});

console.log(byYear11);
// { '1994': ['肖生克的救赎', '阿甘正传', '这个杀手不太冷'] }
```

这段特意保留了一处 `??=`，用来提醒：**它看起来和 ES11 的 `??` 很像，但属 ES2021**。写笔记、答面试题时这个边界要分清。

**用到的特性汇总**：

| 步骤 | 特性 | 版本 |
| --- | --- | --- |
| 正则跨行 | `s` 标志 | ES2018 |
| 分组取值 | `(?<title>...)` + `groups` | ES2018 |
| 全部匹配 | `matchAll` | ES2020 |
| 去重保序 | `Map` | ES6 |
| 对象转数组 | `Object.entries` | ES2017 |
| 数组转对象 | `Object.fromEntries` | ES2019 |
| 摊平 | `flatMap` / `flat` | ES2019 |
| 空值兜底 | `??` | ES2020 |

### 11.4 三个实战的"版本标签"回顾

把三例用到的特性按版本排一次，可以直观看到"每个版本各补了哪块砖"：

| 版本 | 在实战里出现的角色 |
| --- | --- |
| ES7 | 未直接出现（这版只有 `includes` 与 `**`，实战中用得不算多，但 `includes` 常见于"数组是否包含某权限"判断） |
| ES8 | `async/await` 是三个实战的骨架 |
| ES9 | 对象 spread 合并配置、正则命名分组与 `s` 标志 |
| ES10 | `Object.fromEntries`、`flatMap` 做数据整形 |
| ES11 | `?.`、`??`、`allSettled`、`matchAll` 承担"健壮性"职责 |

一句话总结这五个版本的分工：**ES8 给了异步的写法，ES9/ES10 给了数据处理的工具，ES11 给了让代码不崩的护栏。**

### 11.5 本章小结

- 真实项目里几乎不会"只用某一版"，而是 ES7~ES11 混着用，关键是能分清每个写法的归属。
- `?.` + `??` 是配置读取的标准组合；`Promise.allSettled` 是批量请求的标准兜底；`matchAll` + 命名分组是文本解析的标准组合。
- 实战三演示了混用时的边界陷阱：`??=` 属 ES2021，不能算进 ES11。

---

## 12. 版本边界清单：别把后续版本当 ES7~ES11

这一章是本笔记的"防错清单"。课件录制时间较早，代码里混入了一些**当时是提案、后来才进标准**的写法；另外不少常见 API 被人误记成 ES11。全部汇总如下，写文档、答面试前建议先扫一眼。

### 12.1 最容易搞错的六条

| 写法 | 课件出现位置 | 真实版本 | 说明 |
| --- | --- | --- | --- |
| `name;`（类公有字段声明） | `ES11\1-私有属性.html` | **ES2022** | 类字段（class fields）正式进标准是 ES2022 |
| `#age`、`#weight`（`#` 私有字段） | `ES11\1-私有属性.html` | **ES2022** | 长期 Stage 3，Chrome 74 已实现，但标准版本是 ES2022 |
| `static #x`（静态私有字段） | 常见于同批教程 | **ES2022** | 与类字段同批 |
| `#method() {}`（私有方法） | 常见于同批教程 | **ES2022** | 私有方法也是 ES2022 |
| 顶层 `await`（模块顶层直接 await） | 部分教程沿用 | **ES2022** | 只能在 ESM 顶层用，普通脚本不行 |
| `??=` / `\|\|=` / `&&=` | 本笔记第 11 章特意标注 | **ES2021** | 逻辑赋值运算符，和 `??` 不是一批 |

**最重要的一条**：`#` 私有字段写文档时标 **ES2022**。如果面试官问"ES11 有什么新特性"，答案里不该出现私有字段（除非你补一句"提案阶段就在讨论，正式标准是 ES2022"）。

### 12.2 完整版本对照表（ES6 之后）

| 版本 | 年份 | 特性 | 归属确认 |
| --- | --- | --- | --- |
| ES2015 (ES6) | 2015 | `let`/`const`、箭头函数、模板字符串、解构、`class`、`Promise`、`Symbol`、`Map`/`Set`、`for...of`、模块化、`...`（数组） | 详见 ES6 笔记，本文不重复 |
| ES2016 (ES7) | 2016 | `Array.prototype.includes`、`**` 幂运算 | ✅ 本文第 1 章 |
| ES2017 (ES8) | 2017 | `async`/`await`、`Object.values`、`Object.entries`、`Object.getOwnPropertyDescriptors`、`String.prototype.padStart`/`padEnd`、函数参数尾逗号 | ✅ 本文第 2、3 章 |
| ES2018 (ES9) | 2018 | 对象 rest/spread、`Promise.prototype.finally`、正则命名分组、反向断言、`s` 标志、Unicode 属性转义、异步迭代 `for await...of` | ✅ 本文第 4、5 章 |
| ES2019 (ES10) | 2019 | `Object.fromEntries`、`trimStart`/`trimEnd`、`flat`/`flatMap`、`Symbol.prototype.description`、可选 `catch` 绑定、JSON 超集、`sort` 稳定性 | ✅ 本文第 6 章 |
| ES2020 (ES11) | 2020 | `?.`、`??`、`BigInt`、`Promise.allSettled`、`String.prototype.matchAll`、`globalThis`、动态 `import()`、`import.meta` | ✅ 本文第 7~10 章 |
| ES2021 | 2021 | `??=`/`\|\|=`/`&&=`、`Promise.any`、`String.prototype.replaceAll`、数字分隔符 `1_000`、`WeakRef`、`FinalizationRegistry` | ❌ 范围外 |
| ES2022 | 2022 | 类字段（公有/私有 `#`）、私有方法、`static` 字段与静态块、顶层 `await`、`.at()`、`Object.hasOwn`、`Error.cause` | ❌ 范围外 |
| ES2023 | 2023 | `findLast`/`findLastIndex`、Hashbang 语法、复制数组时改用不可变方法 | ❌ 范围外 |

### 12.3 被误认为"新版特性"的老东西

反向也有：不少写法被以为是 ES11 才有的，其实很早就有了。

| 写法 | 真实版本 | 常被误认为 |
| --- | --- | --- |
| 正向断言 `(?=)` / `(?!)` | ES3 | ES9 的新正则特性 |
| `[\s\S]` 匹配任意字符 | ES3 | ES9 `s` 标志的替代品 |
| `Array.prototype.reduce`/`filter`/`map` | ES5 | 常和 ES6 混 |
| `Object.create(obj, descriptors)` | ES5 | ES8 的 `getOwnPropertyDescriptors` |
| `Promise` 本身 | ES6 | 常和 `allSettled` 一起误记为 ES11 |
| 数组 spread `[...arr]` | ES6 | 与对象 spread（ES2018）混淆 |
| 函数参数尾逗号 | ES2017 | 常被认为是 ES6 |
| `try {} catch {}`（省略参数） | ES2019 | 常被误记为 ES2020+ |

### 12.4 版本速记口诀

按版本记"每版一句话"：

| 版本 | 一句话 | 关键词 |
| --- | --- | --- |
| ES7 | "包含与乘方" | `includes`、`**` |
| ES8 | "异步落地，对象补值" | `async/await`、`values`/`entries` |
| ES9 | "对象也能 `...`，正则能起名" | 对象 rest/spread、命名分组、`s` |
| ES10 | "四个小工具，摊平最常用" | `fromEntries`、`flat`/`flatMap`、`trimStart/End` |
| ES11 | "三个问号保命，大数全局补齐" | `?.`、`??`、`BigInt`、`allSettled`、`globalThis` |

"三个问号"指 `?.`、`??` 和 `?` 在 `matchAll` 场景里的非贪婪写法——这是个助记说法，不是严格表述。

### 12.5 本章小结

- 类字段与 `#` 私有字段属 **ES2022**，课件放在 ES11 是前瞻讲解，写文档要标对版本。
- `??=`、`Promise.any`、`replaceAll`、数字分隔符属 **ES2021**，不在本文范围。
- 正向断言、`[\s\S]`、`map/filter/reduce`、`Promise` 都是老特性，别误记为 ES9/ES11。
- 记版本靠"一句话 + 关键词"，比死记特性清单更稳。

---

## 13. 速查表与自测

### 13.1 按 API 查版本（速查表）

遇到"这个写法是哪一版"的问题，先查这张表。

#### 数组

| API | 作用 | 版本 |
| --- | --- | --- |
| `includes(v)` | 是否包含某值（能判 `NaN`） | ES2016 |
| `flat(n)` | 按深度摊平 | ES2019 |
| `flatMap(fn)` | 映射后摊平一层 | ES2019 |
| `find`/`findIndex` | 找第一个符合条件的元素 | ES6 |
| `at(i)` | 支持负索引 | ES2022 |

#### 对象

| API | 作用 | 版本 |
| --- | --- | --- |
| `Object.values(obj)` | 取所有值 | ES2017 |
| `Object.entries(obj)` | 取键值对数组 | ES2017 |
| `Object.getOwnPropertyDescriptors(obj)` | 取全部属性描述符 | ES2017 |
| 对象 spread `{...a}` | 浅合并 / 浅拷贝 | ES2018 |
| 对象 rest `{a, ...rest}` | 收集剩余属性 | ES2018 |
| `Object.fromEntries(iter)` | `[k,v]` 数组转对象 | ES2019 |
| `Object.hasOwn(o, k)` | 替代 `hasOwnProperty` | ES2022 |

#### 字符串

| API | 作用 | 版本 |
| --- | --- | --- |
| `padStart(n, s)` / `padEnd` | 补长 | ES2017 |
| `trimStart()` / `trimEnd()` | 去单侧空白 | ES2019 |
| `matchAll(re)` | 取全部匹配（返回迭代器） | ES2020 |
| `replaceAll(a, b)` | 全部替换（不用正则 `g`） | ES2021 |

#### 异步 / Promise

| API | 作用 | 版本 |
| --- | --- | --- |
| `Promise` | 基础 | ES2015 |
| `async` / `await` | 异步同步化写法 | ES2017 |
| `.finally(fn)` | 无论成败都执行 | ES2018 |
| `for await...of` | 异步迭代 | ES2018 |
| `Promise.allSettled` | 等全部落地，永不整体失败 | ES2020 |
| `Promise.any` | 第一个成功即返回 | ES2021 |

#### 正则

| 写法 | 作用 | 版本 |
| --- | --- | --- |
| `(?=)` / `(?!)` | 正向肯定 / 否定断言 | ES3 |
| `(?<name>...)` | 命名捕获分组 | ES2018 |
| `(?<=)` / `(?<!)` | 反向肯定 / 否定断言 | ES2018 |
| `s` 标志 | `.` 匹配换行 | ES2018 |
| `\p{...}` + `u` | Unicode 属性转义 | ES2018 |

#### 语法 / 运行时

| 写法 | 作用 | 版本 |
| --- | --- | --- |
| `**` / `**=` | 幂运算 | ES2016 |
| `?.` | 可选链 | ES2020 |
| `??` | 空值合并 | ES2020 |
| `??=` 等 | 逻辑赋值 | ES2021 |
| `import()` | 动态加载模块 | ES2020 |
| `import.meta` | 模块自身信息 | ES2020 |
| `BigInt` / `521n` | 任意精度整数 | ES2020 |
| `globalThis` | 跨环境全局对象 | ES2020 |
| `#field` / 类字段 | 私有字段与字段声明 | ES2022 |
| 顶层 `await` | 模块顶层等待 | ES2022 |

### 13.2 一页纸备忘录：最容易写错的十处

| 序号 | 要点 | 错误写法 → 正确写法 |
| --- | --- | --- |
| 1 | `includes` 能判 `NaN`，`indexOf` 不能 | `[NaN].indexOf(NaN)` → `[NaN].includes(NaN)` |
| 2 | `**` 右结合，负数要加括号 | `-2 ** 2` → `(-2) ** 2` |
| 3 | rest 必须在最后 | `{a, ...rest, b}` → `{a, b, ...rest}` |
| 4 | 合并顺序决定谁覆盖谁 | `{...user, ...defaults}` → `{...defaults, ...user}` |
| 5 | 数组展开≠对象展开 | `[...obj]` → `{...obj}` |
| 6 | 取默认值用 `??` 不用 `\|\|` | `v \|\| 10` → `v ?? 10`（`0` 要保留时） |
| 7 | `?.` 只护一层 | `a?.b.c` → `a?.b?.c` |
| 8 | `matchAll` 必须带 `g`，返回迭代器 | 直接 `.map` → `[...s.matchAll(re)].map` |
| 9 | `allSettled` 失败项读 `reason` | `item.value` → `item.reason` |
| 10 | BigInt 不能与 Number 混算 | `1n + 1` → `1n + 1n` |

### 13.3 自测题（30 题，含答案）

#### A. 版本判断（10 题）

| 题号 | 题目：下列写法属哪一版？ | 答案 |
| --- | --- | --- |
| 1 | `[1,2].includes(2)` | ES2016（ES7） |
| 2 | `2 ** 8` | ES2016（ES7） |
| 3 | `const { a, ...rest } = obj` | ES2018（ES9） |
| 4 | `Object.values(obj)` | ES2017（ES8） |
| 5 | `str.matchAll(/a/g)` | ES2020（ES11） |
| 6 | `class A { #x = 1 }` | ES2022（不是 ES11） |
| 7 | `a ?? b` | ES2020（ES11） |
| 8 | `a ??= b` | ES2021 |
| 9 | `[1,[2,[3]]].flat(2)` | ES2019（ES10） |
| 10 | `Promise.any([p1, p2])` | ES2021 |

#### B. 输出预测（10 题）

```js
// 11. 输出什么？
console.log([1, 2, NaN].indexOf(NaN), [1, 2, NaN].includes(NaN));
```
答：`-1 true`。`indexOf` 用严格相等，`NaN !== NaN`；`includes` 用 SameValueZero，能匹配 `NaN`。

```js
// 12. 输出什么？
console.log(2 ** 3 ** 2);
```
答：`512`。`**` 右结合，等价 `2 ** (3 ** 2)`。

```js
// 13. 输出什么？
const a = { x: 1, y: 2 };
const { x, ...rest } = a;
console.log(rest, a);
```
答：`{ y: 2 } { x: 1, y: 2 }`。rest 不修改原对象。

```js
// 14. 输出什么？
const d = { t: 'light' }, u = { t: 'dark' };
console.log({ ...d, ...u }.t, { ...u, ...d }.t);
```
答：`'dark' 'light'`。后者覆盖前者。

```js
// 15. 输出什么？
console.log(Object.fromEntries([['a',1],['a',2]]));
```
答：`{ a: 2 }`。重复键后者覆盖。

```js
// 16. 输出什么？
console.log([1,2,3].flatMap(v => v > 1 ? [v] : []));
```
答：`[2, 3]`。返回空数组等于过滤。

```js
// 17. 输出什么？
console.log(' a '.trimEnd() + '|');
```
答：`' a|'`。只去尾部空白，保留左侧空格。

```js
// 18. 输出什么？
console.log(1n === 1, 1n == 1);
```
答：`false true`。严格相等比较类型，宽松相等会转换。

```js
// 19. 输出什么？
console.log(7n / 2n);
```
答：`3n`。BigInt 除法向零截断。

```js
// 20. 输出什么？
const o = null;
console.log(o?.a.b);
```
答：`undefined`。`o` 为空，后面的 `.b` 整个被短路。

#### C. 情境选择（10 题）

| 题号 | 场景 | 该用什么 | 理由 |
| --- | --- | --- | --- |
| 21 | 判断数组中是否有某值，且可能含 `NaN` | `includes` | ES7，能匹配 `NaN` |
| 22 | 从配置对象里排除 `host`、`port`，其余透传 | 对象 rest `({host, port, ...rest})` | ES9，不修改原对象 |
| 23 | 批量请求 10 个接口，任一失败不影响其他 | `Promise.allSettled` | ES11，永不整体 reject |
| 24 | 从多行 HTML 抽所有电影名 | `matchAll` + `s` + `g` | ES11 + ES9 |
| 25 | 用户可能传 0 作为合法值，不能兜成默认 | `??` | 只兜 `null`/`undefined` |
| 26 | 深层配置读取，路径可能断 | `?.` | ES11，短路不报错 |
| 27 | 雪花 ID（19 位）不能失真 | `BigInt` 或后端返回字符串 | ES11；工程上优先字符串 |
| 28 | 把对象变成查询字符串 | `Object.entries` + `URLSearchParams` | ES8 + Web API |
| 29 | 把二维数组拍平一层 | `flat()` | ES10 |
| 30 | 判断当前是浏览器还是 Node | `globalThis.window` / `globalThis.process` | ES11 `globalThis` |

### 13.4 学习路线建议

| 阶段 | 重点 | 自我检验方式 |
| --- | --- | --- |
| 第一遍（1 天） | ES7 + ES8：`includes`、`**`、`async/await` | 能把 `.then` 链改写成 `async/await`，并说出 `forEach + async` 为什么不行 |
| 第二遍（1 天） | ES9 + ES10：对象 `...`、正则、`flat/flatMap`、`fromEntries` | 能写出"`entries → map → fromEntries`"改造对象；能解析一段跨行 HTML |
| 第三遍（1 天） | ES11：`?.`、`??`、`allSettled`、`BigInt`、`globalThis` | 能说出 `??` 与 `\|\|` 的差异、`allSettled` 与 `all` 的差异 |
| 复盘（半天） | 第 12、13 章：版本边界与速查表 | 30 道自测题正确率 90% 以上 |

### 13.5 本章小结

- 速查表按"数组/对象/字符串/异步/正则/语法"分类，遇到不确定的版本先查表。
- "最容易写错的十处"覆盖了本笔记 90% 的实际踩坑点。
- 30 道自测题里，A 组考版本归属，B 组考执行结果，C 组考场景选型——这三类是面试与实战的共同考点。
- 版本边界是本笔记最需要反复确认的部分：**`#` 私有字段属 ES2022，`??=` 属 ES2021**。
*（内容由AI生成，仅供参考）*
