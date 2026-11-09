# ECMAScript 6（ES6）新手学习笔记

> 依据 ES6 课件与配套示例代码整理。本文只讨论 **ECMAScript 2015（ES6）**；`async/await`、对象展开、类字段等后续版本特性不在本文范围内。

## 1. ES6 是什么

ECMAScript 是 JavaScript 的语言标准，浏览器和 Node.js 按该标准实现 JavaScript。ES6（又称 ES2015）是一次重要的语言升级，带来了块级作用域、箭头函数、Promise、类、模块等现代 JavaScript 的基础能力。

学习建议：示例可放进浏览器开发者工具 Console 执行；涉及 `import/export` 的示例需要用 `<script type="module">` 或 Node.js 的 ES Module 环境运行。

## 2. `let`：块级作用域变量

`let` 用来声明**可重新赋值**的变量。它与 `var` 最大的差异是作用域和声明行为。

```js
let score = 60;
score = 80; // 合法

if (true) {
  let message = '只在这个代码块内可见';
  console.log(message);
}
// console.log(message); // ReferenceError
```

### 2.1 `let` 的规则

1. 同一作用域内不能重复声明。
2. 具有块级作用域：`if`、`for`、`while`、`{}` 都可以形成作用域。
3. 存在“暂时性死区”（TDZ）：从代码块开始到 `let` 声明执行前，变量不能访问。
4. `let` 不会改变正常的作用域链。

```js
// let user = 'A';
// let user = 'B'; // SyntaxError：重复声明

{
  // console.log(city); // ReferenceError：尚未初始化
  let city = 'Shanghai';
}
```

### 2.2 经典问题：循环绑定事件

`var` 只有函数作用域，循环结束后所有回调通常共享同一个 `i`；`let` 每轮循环都会创建对应的绑定。

```js
const buttons = document.querySelectorAll('button');
for (let i = 0; i < buttons.length; i++) {
  buttons[i].addEventListener('click', () => {
    console.log(`点击了第 ${i + 1} 个按钮`);
  });
}
```

## 3. `const`：不可重新绑定的常量

`const` 用于声明之后**不能再指向另一个值**的变量，且必须在声明时初始化。

```js
const API_BASE_URL = 'https://api.example.com';
// API_BASE_URL = '/v2'; // TypeError
```

`const` 限制的是“变量绑定”，不是对象内容。因此对象和数组仍可修改内部数据。

```js
const user = { name: 'Lin' };
user.name = 'Ming';       // 合法：修改对象属性
user.age = 20;            // 合法：新增属性
// user = { name: 'New' } // 非法：重新绑定
```

实践约定：默认优先用 `const`；确定需要重新赋值时才用 `let`；现代代码中一般不再使用 `var`。

## 4. 解构赋值：按结构取值

解构赋值可从数组或对象中一次取出数据并赋给变量。它不是类型转换，而是按位置（数组）或属性名（对象）匹配。

### 4.1 数组解构

```js
const members = ['孙悟空', '猪八戒', '沙僧'];
const [first, second, third] = members;

const [leader, , last = '唐僧'] = members;
console.log(leader, last); // 孙悟空 沙僧
```

### 4.2 对象解构

对象解构的左侧名称默认必须等于属性名；可重命名并设置默认值。

```js
const profile = {
  name: 'Ada',
  age: 26,
  introduce() { return 'Hello'; }
};

const { name, age: userAge, city = 'Beijing', introduce } = profile;
console.log(name, userAge, city, introduce());
```

常见用途是提取函数参数：

```js
function connect({ host = '127.0.0.1', port = 3306, username, password }) {
  return `${username}:${password}@${host}:${port}`;
}

connect({ username: 'root', password: 'secret' });
```

注意：被解构的值为 `null` 或 `undefined` 会报错。若整个参数可省略，可写 `function f({x} = {}) {}`。

## 5. 模板字符串

模板字符串使用反引号（`` ` ``）包围。它支持换行和 `${表达式}` 插值，适合拼接文本、HTML 片段和日志。

```js
const name = '张三';
const score = 95;
const message = `${name} 的成绩是 ${score}，结果：${score >= 60 ? '通过' : '未通过'}`;

const list = `
<ul>
  <li>${name}</li>
</ul>`;
```

`${}` 内可以是任意 JavaScript 表达式；不要把不可信的用户输入直接插入 `innerHTML`，否则会产生 XSS 风险。

## 6. 简洁对象字面量

当属性名和变量名相同时可省略右侧；对象方法也可使用简写。

```js
const name = '尚硅谷';
const change = () => console.log('改变');

const school = {
  name,       // 等价于 name: name
  change,     // 等价于 change: change
  improve() { // 等价于 improve: function () {}
    console.log('提升技能');
  }
};
```

## 7. 箭头函数

箭头函数提供更紧凑的函数写法：

```js
const add = (a, b) => a + b;
const square = n => n * n;             // 一个参数可省略圆括号
const log = () => console.log('hello');
const buildUser = name => ({ name });  // 返回对象时需用圆括号包住
```

### 7.1 最重要的差异：`this` 是词法绑定

普通函数的 `this` 由调用方式决定；箭头函数没有自己的 `this`，会捕获**定义位置外层**的 `this`，且不能被 `call/apply/bind` 改变。

```js
const counter = {
  value: 0,
  start() {
    setInterval(() => {
      this.value++;
      console.log(this.value); // this 是 counter
    }, 1000);
  }
};
```

### 7.2 其他限制与选择

- 箭头函数不能作为构造函数，不能配合 `new`。
- 它没有自己的 `arguments`；需要收集参数应使用 rest 参数。
- 对象方法、DOM 事件处理器中若需要由调用方决定 `this`，通常使用普通方法/函数。
- 数组转换、Promise 回调、需要继承外层 `this` 的定时器回调，常适合箭头函数。

```js
button.addEventListener('click', function () {
  console.log(this === button); // true，普通函数更合适
});

const evenNumbers = [1, 6, 9, 10].filter(item => item % 2 === 0);
```

## 8. 函数参数：默认值与 rest 参数

### 8.1 默认参数

当实参是 `undefined` 或未传时，使用默认值；传入 `null` 不会触发默认值。

```js
function createUser(name, role = 'member') {
  return { name, role };
}

createUser('A');          // { name: 'A', role: 'member' }
createUser('B', 'admin'); // { name: 'B', role: 'admin' }
```

通常把带默认值的参数放在末尾，避免调用时必须用 `undefined` 占位。

### 8.2 rest 参数

`...args` 将剩余实参收集为真正的数组，能直接使用 `map`、`filter`、`reduce` 等数组方法；它必须位于形参列表最后。

```js
function sum(...numbers) {
  return numbers.reduce((total, item) => total + item, 0);
}

function report(title, ...messages) {
  console.log(title, messages);
}
```

## 9. 扩展运算符 `...`

在“展开”位置，`...` 将可迭代对象展开为多个元素或参数。与上一节的 rest 参数写法相同，但方向相反：rest 是收集，spread 是展开。

```js
const heroes = ['A', 'B'];
const group = ['Leader', ...heroes];
const copied = [...heroes];

function maxOf(a, b, c) { return Math.max(a, b, c); }
maxOf(...[10, 20, 15]); // 20

const nodes = document.querySelectorAll('div');
const nodeArray = [...nodes]; // 将可迭代的 DOM 集合转数组
```

`[...arr]` 是**浅拷贝**：嵌套对象仍共享引用。

## 10. Symbol：唯一的属性键

`Symbol()` 每次都会产生唯一值，适合避免对象属性名冲突。Symbol 是一种原始数据类型，不能直接与数字或字符串做算术运算。

```js
const id1 = Symbol('id');
const id2 = Symbol('id');
console.log(id1 === id2); // false

const user = { name: 'A' };
user[id1] = 1001;
```

`Symbol.for(key)` 会从全局 Symbol 注册表复用同名 Symbol：

```js
Symbol.for('app.token') === Symbol.for('app.token'); // true
```

ES6 还定义了一组 well-known symbols，例如 `Symbol.iterator`，用于让对象参与语言内置协议。一般业务代码不要随意覆盖它们。

## 11. Set：不重复值集合

`Set` 按值保存成员并自动去重，保留插入顺序，可被 `for...of` 遍历。

```js
const set = new Set([1, 2, 2, 3]);
set.add(4);
set.has(2);       // true
set.delete(1);    // true
console.log(set.size); // 3
set.clear();
```

数组去重与集合运算：

```js
const a = [1, 2, 3, 3];
const b = [3, 4, 4];
const unique = [...new Set(a)];
const bSet = new Set(b);
const intersection = [...new Set(a)].filter(x => bSet.has(x));
const union = [...new Set([...a, ...b])];
const difference = [...new Set(a)].filter(x => !bSet.has(x));
```

对象是否重复看的是引用，而非内容：`new Set([{x: 1}, {x: 1}]).size` 为 `2`。

## 12. Map：键可以是任意类型的映射

普通对象的键主要是字符串或 Symbol；`Map` 的键可以是对象、函数、数字等任意值，并提供清晰的集合 API。

```js
const map = new Map();
const config = { host: 'localhost' };

map.set('name', 'ES6');
map.set(config, ['Beijing', 'Shanghai']);
map.get(config);      // ['Beijing', 'Shanghai']
map.has('name');      // true
map.delete('name');
map.size;

for (const [key, value] of map) {
  console.log(key, value);
}
```

只有保留了作为键的对象引用，才能成功取回对应值。

## 13. 迭代器与 `for...of`

可迭代对象拥有 `Symbol.iterator` 方法，调用后得到迭代器；迭代器的 `next()` 返回 `{ value, done }`。

```js
const chars = ['a', 'b'];
const iterator = chars[Symbol.iterator]();
console.log(iterator.next()); // { value: 'a', done: false }
console.log(iterator.next()); // { value: 'b', done: false }
console.log(iterator.next()); // { value: undefined, done: true }

for (const char of chars) console.log(char);
```

数组、字符串、Set、Map 和生成器结果都可迭代；普通对象默认不可直接 `for...of`。为对象自定义迭代协议时，迭代器必须返回符合上述结构的对象。

```js
const classroom = {
  students: ['小明', '小红'],
  *[Symbol.iterator]() {
    yield* this.students;
  }
};
console.log([...classroom]); // ['小明', '小红']
```

## 14. 生成器（Generator）

生成器函数通过 `function*` 声明，调用后不会立即执行函数体，而是返回迭代器。`yield` 会暂停函数并产出一个值；之后调用 `next()` 才继续。

```js
function* steps() {
  yield '第一步';
  yield '第二步';
  return '完成';
}

const it = steps();
console.log(it.next()); // { value: '第一步', done: false }
console.log(it.next()); // { value: '第二步', done: false }
console.log(it.next()); // { value: '完成', done: true }
```

第一次 `next(value)` 传入的值会被忽略；后续传给 `next(value)` 的 `value` 会成为上一个 `yield` 表达式的结果。

```js
function* conversation() {
  const name = yield '你的名字？';
  const age = yield `${name}，你的年龄？`;
  return { name, age };
}

const c = conversation();
c.next();          // 产出“你的名字？”
c.next('小李');    // 产出“小李，你的年龄？”
c.next(20);        // 返回 { name: '小李', age: 20 }
```

生成器曾用于手动组织异步流程；现代业务异步代码通常优先使用 Promise（以及后续标准的 `async/await`）。

## 15. ES6 的类（Class）

`class` 是基于原型继承的更清晰语法。类中的方法定义在原型上，多个实例共享同一份方法。

```js
class Phone {
  constructor(brand, price) {
    this.brand = brand;
    this.price = price;
  }

  call() {
    console.log(`${this.brand} 正在通话`);
  }
}

const phone = new Phone('Huawei', 5999);
phone.call();
```

### 15.1 继承、`extends` 与 `super`

子类用 `extends` 继承父类。子类定义了构造器时，必须在访问 `this` 前调用 `super(...)`，由它初始化父类部分。

```js
class SmartPhone extends Phone {
  constructor(brand, price, color) {
    super(brand, price);
    this.color = color;
  }

  photo() { console.log('拍照'); }

  call() { // 覆盖父类同名方法
    console.log('视频通话');
  }
}
```

### 15.2 静态方法和访问器

`static` 方法属于类本身，实例不能直接调用；`get/set` 把方法伪装为属性访问，可用于封装校验。

```js
class Account {
  static createGuest() {
    return new Account('guest');
  }

  constructor(name) {
    this.name = name;
    this._balance = 0;
  }

  get balance() { return this._balance; }
  set balance(value) {
    if (value < 0) throw new RangeError('余额不能为负数');
    this._balance = value;
  }
}
```

> 提醒：`static name = '...'` 这类“类字段”写法不是 ES6；若只面向 ES6，可在类外赋值或只使用静态方法。

## 16. 数值与对象扩展

### 16.1 Number 与 Math

```js
Number.isNaN(NaN);       // true，不会强制转换
Number.isFinite(100);    // true
Number.isInteger(3.0);   // true
Number.parseInt('12px'); // 12
Math.trunc(3.9);         // 3，截去小数部分
Math.sign(-5);           // -1；正数为 1，0 为 0
```

### 16.2 Object

```js
Object.is(NaN, NaN); // true
Object.is(+0, -0);   // false，和 === 不同

const defaults = { host: 'localhost', port: 3306 };
const options = { port: 3307 };
const merged = Object.assign({}, defaults, options);
// Object.assign 是浅拷贝，后面的同名属性会覆盖前面
```

`Object.setPrototypeOf(obj, proto)` 与 `Object.getPrototypeOf(obj)` 可读写原型，但生产代码通常优先使用 `class` 或 `Object.create`，避免随意修改既有对象原型。

## 17. Promise：管理一次异步结果

Promise 代表一个“现在还没有、未来才会得到”的结果，有三种状态：

1. `pending`：等待中。
2. `fulfilled`：成功，携带 value。
3. `rejected`：失败，携带 reason。

状态一旦从 `pending` 变为成功或失败，就不可再次改变。

```js
function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(`已等待 ${ms}ms`), ms);
  });
}

wait(500).then(value => console.log(value));
```

### 17.1 `then`、链式调用与错误处理

`then` 总会返回一个**新的 Promise**。回调返回普通值会使新 Promise 成功；返回 Promise 会等待它；抛出异常会使新 Promise 失败。

```js
function fetchUser(id) {
  return Promise.resolve({ id, name: 'Ada' });
}

fetchUser(1)
  .then(user => ({ ...user, label: `${user.id}-${user.name}` }))
  .then(user => console.log(user.label))
  .catch(error => console.error('请求失败：', error));
```

注意：对象展开 `{ ...user }` 是 ES2018，不属于 ES6。严格 ES6 环境可改为：

```js
fetchUser(1)
  .then(user => Object.assign({}, user, { label: user.id + '-' + user.name }))
  .then(user => console.log(user.label))
  .catch(error => console.error(error));
```

### 17.2 用 Promise 封装 Node.js 回调

```js
const fs = require('fs');

function readText(path) {
  return new Promise((resolve, reject) => {
    fs.readFile(path, 'utf8', (error, data) => {
      if (error) return reject(error);
      resolve(data);
    });
  });
}

readText('./article.md')
  .then(text => console.log(text))
  .catch(error => console.error(error.message));
```

必须在出错时 `reject(error)`，成功时 `resolve(data)`；不要忽略回调中的错误参数。

## 18. ES6 模块（Module）

模块让一个文件只暴露明确的能力，避免变量污染全局。ES6 模块默认严格模式、只执行一次，并且 `import` 必须在模块顶层。

### 18.1 导出

```js
// math.js：分别导出
export const PI = 3.14159;
export function add(a, b) { return a + b; }

// user.js：统一导出
const name = 'Ada';
function login() { console.log('login'); }
export { name, login };

// config.js：默认导出，每个模块最多一个
export default { apiBase: '/api' };
```

### 18.2 导入

```js
import { PI, add as sum } from './math.js';
import * as user from './user.js';
import config from './config.js';

console.log(sum(1, 2), PI, user.name, config.apiBase);
```

浏览器中使用：

```html
<script type="module" src="./app.js"></script>
```

模块路径通常需要写出 `.js` 后缀，并且浏览器应通过本地开发服务器访问，而不是直接双击 `file://` 页面。课件配套代码中的 `m1.js`、`m2.js`、`m3.js` 分别对应分别导出、统一导出和默认导出。

## 19. 综合练习：用 ES6 整理数据

下面的例子综合使用 `const`、解构、默认参数、模板字符串、箭头函数、Set、Map、`for...of` 与 Promise。代码保持 ES6 兼容。

```js
function summarizeStudents(students, passingScore = 60) {
  const uniqueNames = new Set();
  const scoreByName = new Map();

  for (const { name, score = 0 } of students) {
    uniqueNames.add(name);
    scoreByName.set(name, score);
  }

  const passed = students
    .filter(({ score = 0 }) => score >= passingScore)
    .map(({ name }) => name);

  return {
    total: uniqueNames.size,
    passed,
    report: `共 ${uniqueNames.size} 人，通过：${passed.join('、')}`,
    scoreByName
  };
}

const result = summarizeStudents([
  { name: '小明', score: 88 },
  { name: '小红', score: 59 },
  { name: '小明', score: 88 }
]);

Promise.resolve(result)
  .then(({ report }) => console.log(report))
  .catch(error => console.error(error));
```

## 20. 学习检查清单

- 能解释 `let`、`const` 和 `var` 的作用域差别，并优先使用 `const`。
- 能写出数组/对象解构，理解默认值与重命名。
- 能判断箭头函数的 `this` 来自哪里，知道何时不该使用它。
- 能区分 rest（收集）和 spread（展开），知道拷贝数组是浅拷贝。
- 能用 Set 去重、用 Map 保存非字符串键的映射。
- 能说清可迭代对象、迭代器、生成器和 `for...of` 的关系。
- 能用 `class`、`extends`、`super` 表达继承。
- 能用 `then/catch` 编写有错误处理的 Promise 链。
- 能区分命名导出与默认导出，并通过 ES Module 导入模块。

## 21. 常见误区速查

| 误区 | 正确理解 |
| --- | --- |
| `const` 对象不能改 | 不能重新赋值变量，但可以改对象内部属性。 |
| 箭头函数更适合所有函数 | 需要动态 `this` 的对象方法、事件回调通常用普通函数。 |
| `...` 永远表示扩展 | 形参中通常是 rest 收集；调用/数组字面量中通常是 spread 展开。 |
| Set 会按对象内容去重 | 对象按引用比较，两个字面量对象是两个不同值。 |
| `then` 只是注册回调 | `then` 还会返回新 Promise，是链式流程的关键。 |
| `export default` 可以有多个 | 一个模块最多一个默认导出，但可以有多个命名导出。 |
| 所有现代写法都是 ES6 | `async/await`、对象展开、类字段等属于后续标准，应单独学习。 |

---

