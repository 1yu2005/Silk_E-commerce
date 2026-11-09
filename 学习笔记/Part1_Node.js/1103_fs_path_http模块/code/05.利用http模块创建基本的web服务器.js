// 1. 导入http 模块
const http = require('http')

// 2. 创建 web 服务器实例
const server = http.createServer()

// 3. 为服务器实例绑定 request 事件,监听客户端的请求
server.on('request',function(req,res){
    console.log('Somebody made a request')
})

// 4. 启动服务器
server.listen(80,function(){
    console.log('Server is running at http://127.0.0.1:80')  // 服务器启动成功,监听端口为 80(80端口可以省略，其它端口不可以)
})

