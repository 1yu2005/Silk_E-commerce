// 导入自定义的格式化时间的模块
const TIME = require('./09.dateFormat.js')

// 调用格式化时间的方法
// console.log(TIME.dateFormat(new Date()))
const dt = new Date()
const newDT = TIME.dateFormat(dt)
console.log(newDT)

// 输出内容：
// 2023-11-04 10:20:30