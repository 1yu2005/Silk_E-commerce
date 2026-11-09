// 在一个自定义模块中，默认情况下，module.exports是一个空对象,即module.exports = {}，所以当外界通过require()方法加载该模块时，返回的是一个空对象。

// 向 module.exports 对象上挂载 username 属性
module.exports.username = '张三'

// 向 module.exports 对象上挂载 sayHello 函数
module.exports.sayHello = function () {
  console.log('大家好，我是' + this.username)
}

const age = 18
module.exports.age = age