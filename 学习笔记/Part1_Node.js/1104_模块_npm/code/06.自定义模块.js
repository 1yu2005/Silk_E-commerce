// 向 module.exports 对象上挂载 username 属性
module.exports.username = '张三'

// 向 module.exports 对象上挂载 sayHello 函数
module.exports.sayHello = function () {
  console.log('大家好，我是' + this.username)
}

// 让 module.exports 指向一个全新的对象   相当于重新给 module.exports 赋值
module.exports = {
    username: '小禹',
    sayHello: function () {
        console.log('大家好，我是' + this.username)
    }
}