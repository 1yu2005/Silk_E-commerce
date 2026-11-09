// 1.导入 fs 模块，来操作文件
const fs = require('fs')

// 2.调用fs.readFile方法，读取文件中的内容
//   参数1：读取文件的存放路径
//   参数2：读取文件时侯采用的编码格式，一般默认指定 utf8
//   参数3：回调函数，用于处理读取文件完成后的结果（拿到读取失败和成功的结果 err dataStr）
fs.readFile('./file/1.txt', 'utf8', (err, dataStr) => {
    console.log(err)  // 打印读取失败的结果
    console.log("-----------------")
    console.log(dataStr)  // 打印读取成功的结果
})
