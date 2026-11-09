 // console.log() 作用：打印指定的内容

// 1.导入 fs 模块，来操作文件
const fs = require('fs')

// 2.调用fs.readFile方法，读取文件中的内容
fs.readFile('./file/3_grade.txt', 'utf8', (err, dataStr) => {
// 3.判断读取是否成功
    if(err) {   // 读取失败，err 值为一个错误对象；读取成功，err 为 null
       return console.log('文件读取失败'+err.message)
    }
    // console.log("文件读取成功" + dataStr)    文件读取成功小黑=33 小霞=99 小王=38 小雨=100

    // 4.1 先把成绩的数据,按照空格进行分割
    const arrOld = dataStr.split(" ")

    // 4.2 循环分割后的数组,对每一项数据,进行字符串的替换操作
    const arrNew = []
    arrOld.forEach(item => {
        arrNew.push(item.replace("=", "："))
    })
    // console.log(arrNew)    [ '小黑：33', '小霞：99', '小王：38', '小雨：100' ]

    // 4.3 把新数组中的每一项,进行合并,得到一个新的字符串
    const strNew = arrNew.join("\r\n")   // \r\n 表示换行符
    console.log(strNew)

    // 5.调用 fs.writeFile()方法,写入文件的内容
    fs.writeFile('./file/3_grade_new.txt', strNew, function(err) {
        if(err) {
            return console.log('成绩写入失败'+err.message)
        }
        console.log("成绩写入成功")
    })
    
})

