const express = require('express')
const app = express()

app.listen(80,()=>{
    console.log('express server running at http://127.0.0.1')
})

// 挂载路由模块
// app.use(require('./05.router'))

// 1.导入路由模块
const router = require('./05.router')

// 2.注册路由模块
app.use(router)
