const express = require('express')
const app = express()

// 定义第一个全局中间件
app.use((req,res,next)=>{
    console.log('调用了第一个全局中间件')
    next()
})

// 定义第二个全局中间件
app.use((req,res,next)=>{
    console.log('调用了第二个全局中间件')
    next()
})

// 定义路由处理函数
// 客户端请求到达服务器之后,会按照中间件定义的先后顺序依次进行调用
app.get('/',(req,res)=>{
    res.send('Home Page')
})

app.listen(80,()=>{
    console.log('express server running at http://127.0.0.1')
})