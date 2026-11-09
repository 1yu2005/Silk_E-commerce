const express = require('express')
const app = express()

// 1.定义中间件函数
const mw1 = (req,res,next)=>{
    console.log('调用了局部生效的中间件1')
    next()
}

// 2.定义路由处理函数  mw1 只会在该路由中生效
app.get('/',mw1,(req,res)=>{
    res.send('Home Page')
})

// 3.定义路由处理函数
app.get('/user',(req,res)=>{
    res.send('User Page')
})

app.listen(80,()=>{
    console.log('express server running at http://127.0.0.1')
})
