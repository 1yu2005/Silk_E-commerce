// 1. 导入 express
const express = require('express')

// 2. 创建 web 服务器
const app = express()

// 4.监听客户端的GET和POST请求，并向客户端响应具体内容
app.get('/user',(req,res)=>{
// 调用 express 提供的 res.send()方法,向客户端响应一个 JSON 对象
	res.send({name:'小雨',age:18,gender:'男'})
})
app.post('/user',(req,res)=>{
    //调用 express 提供的res. send()方法,向客户端响应一个 文本字符串
	res.send('请求成功')
})
app.get('/',(req,res)=>{
    // 通过 req.query 可以获取到客户端发送过来的 查询参数
    // 注意:默认情况下;req.query 是一个空对象
    console.log(req.query) // 可以通过 console.log(req) 可以在终端查看 req 对象的所有属性

    res.send(req.query)
})
// 注意：这里的 :id 是一个动态的参数
app.get('/user/:id/:name',(req,res)=>{
    // req.params 是动态匹配到的URL参数,默认也是一个空对象
    console.log(req.params)
    res.send(req.params)
})

// 3. 调用 app.listen(端口号,启动成功后的回调函数),启动服务器
app.listen(80,()=>{
	console.log('express server running at http://127.0.0.1')
})