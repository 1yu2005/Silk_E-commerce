const express = require('express')
const app = express()

// 定义一个最简单的中间件函数
const middleware = (req,res,next)=>{
    console.log('中间件函数被调用了')
    next()  // 把流转给下一个中间件函数或路由处理函数
}

// 将middleware挂载到app对象上,注册为全局生效的中间件
app.use(middleware)

app.get('/',(req,res)=>{
    console.log('调用了首页路由')
    res.send('Home Page')
})

app.get('/user',(req,res)=>{
    console.log('调用了用户路由')
    res.send('User Page')
})

app.listen(80,()=>{
    console.log('express server running at http://127.0.0.1')
})