const http = require('http')
const server = http.createServer()

// req 是请求对象，包含了与客户端相关的数据和属性
server.on('request',function(req,res){
    // req.url 是客户端请求的URL地址  注意 ：req.url 是一个字符串，包含了客户端请求的所有信息
    // 例如 ：/hello/123  或者 /hello?name=张三&age=18  或者 /
    const url = req.url
    // req.method 是客户端请求的方法
    const method = req.method

    const str = `Your request URL is ${url} ,and request method is ${method}`
    console.log(str)

    // 调用 res.end() 方法，向客户端响应一些内容
    res.end(str)
})
server.listen(80,function(){
    console.log('Server is running at http://127.0.0.1:')  // 服务器启动成功,监听端口为 80(80端口可以省略，其它端口不可以)
})