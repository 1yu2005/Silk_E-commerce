// 在外界使用require 导入一个自定义模块的时候，得到的成员
// 就是 那个模块中，通过 module.exports 指向的对象。

const m = require('./04.自定义模块.js')  // 后缀可以省略
console.log(m)    
// 输出内容：
// { username: '张三', sayHello: [Function: sayHello], age: 18 }
