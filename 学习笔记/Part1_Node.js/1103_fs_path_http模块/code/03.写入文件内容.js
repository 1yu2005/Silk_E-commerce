// 1.导入 fs 模块，来操作文件
const fs = require('fs')

//2. 调用 fs.writeFile()方法,写入文件的内容
//   参数1:表示文件的存放路径
//   参数2:表示要写入的内容
//   参数3:回调函数

fs.writeFile('./file/2.txt', 'hello node', function(err) {
    if(err) {
       return console.log('文件写入失败'+err.message)
    }
    console.log("文件写入成功")
})