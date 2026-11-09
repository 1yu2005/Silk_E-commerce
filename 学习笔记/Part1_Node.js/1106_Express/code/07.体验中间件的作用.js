const express = require('express')
const app = express()

// 定义一个最简单的中间件函数
const middleware = (req,res,next)=>{
    //获取到请求到达服务器的时间
    const time = Date.now()
    // 为req对象，挂载自定义属性，从而把时间共享给后面的所有路由
    req.startTime = time

    next()  // 把流转给下一个中间件函数或路由处理函数
}

// 将middleware挂载到app对象上,注册为全局生效的中间件
app.use(middleware)

app.get('/',(req,res)=>{
    res.send('Home Page' + req.startTime)
})

app.get('/user',(req,res)=>{
    res.send('User Page' + req.startTime)
})

app.listen(80,()=>{
    console.log('express server running at http://127.0.0.1')
})