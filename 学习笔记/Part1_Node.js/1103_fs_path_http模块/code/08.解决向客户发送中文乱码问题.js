const http = require('http')
const server = http.createServer()

server.on('request',function(req,res){
    // 定义一个字符串，包含中文的内容
    const str=`您请求的 ur1地址是${req.url},请求的 method 类型是${req.method}`
    // 为了防止中文显示乱码的问题,需要设置响应头 Content-Type 的值为 text/html; charset=utf-8
    res. setHeader('Content-Type', 'text/html; charset=utf-8')
    // 把包含中文的内容,响应给客户端 ⭐⭐⭐⭐⭐
    res.end(str)   
})
server.listen(80,function(){
    console.log('Server is running at http://127.0.0.1:')  // 服务器启动成功,监听端口为 80(80端口可以省略，其它端口不可以)
})