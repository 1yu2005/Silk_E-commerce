# AOP 面向切面编程（Aspect Oriented Programming）

一句话：**在不修改原有业务代码的前提下，给代码==统一增加横向通用功能==**。

> 对比 OOP 面向对象：OOP 是纵向把代码拆成类、对象；AOP 是横向切进去，统一织入公共逻辑。

## 先理解：什么是切面（aspect）

很多功能是**散落在各个业务里、和业务无关的==公共逻辑==**： <u>日志打印、接口耗时统计、权限校验、异常捕获、统一返回格式、事务、限流。</u>

如果不用AOP：每个业务方法里面，都手动写一遍日志、权限判断。

```js
// 原始业务代码（耦合）
function addUser() {
  console.log("开始执行"); // 日志
  if(!checkAuth()) throw new Error(); // 权限
  // =========真正业务逻辑=========
  console.log("新增用户");
  // =============================
  console.log("结束，耗时xxx"); // 日志
}
function deleteUser() {
  console.log("开始执行"); // 日志
  if(!checkAuth()) throw new Error(); // 权限
  // 业务
}
```

缺点：重复代码多、业务代码被杂项逻辑污染，改日志要改每一处。

==AOP 的思路：**把这些公共逻辑抽出来单独做成一个切面，在目标方法执行前/后/异常时自动插入进去**，业务代码只保留核心业务。==

## 4个核心术语

1. **切面 Aspect**：封装好的公共模块（比如日志切面）
2. **切点 Pointcut**：规则，用来匹配哪些方法要被切入（比如所有接口控制器方法）
3. **通知 Advice**：切面逻辑什么时候执行
   - Before：目标方法执行**之前**
   - After：目标方法执行**之后**
   - AfterReturning：方法正常返回后
   - AfterThrowing：方法抛出异常时
   - Around：环绕（最强大，包裹目标方法，可以控制要不要执行、修改入参返回值）
4. **织入 Weaving**：把切面逻辑和目标代码结合在一起的过程

## 结合你正在学的 NestJS（重点！Nest大量使用AOP）

==Nest 的拦截器 Interceptor、守卫 Guard、过滤器 ExceptionFilter、装饰器，本质就是AOP思想==：

- 守卫Guard：在接口执行前做权限校验（Before）
- 拦截器Interceptor：环绕，统计耗时、统一包装返回结果（Around）
- 异常过滤器：捕获控制器抛出的异常（AfterThrowing） 👉 你的 Controller 业务代码干干净净，只写业务，权限、日志、统一返回都由切面横向注入。

简单伪代码示意AOP环绕：

```js
// 切面：统计耗时
function timeLog(targetFn) {
  return function(...args) {
    const start = Date.now()
    // 执行原业务函数
    const res = targetFn(...args)
    console.log("耗时：", Date.now() - start)
    return res
  }
}

// 业务函数
function addUser(){
  console.log("新增用户业务")
}

// 织入：给业务函数包一层切面
const addUserWithLog = timeLog(addUser)
addUserWithLog()
```

> 这个就是最简单的AOP，没有改动 `addUser` 本身代码，附加了计时能力。

## AOP 和 OOP 对比

- OOP：**纵向划分**，把功能拆成类、继承、封装，**解决业务模块划分**
- AOP：**横向切面**，抽取散布在多个模块的**通用横切逻辑，解耦**

## 一句话记忆

==**AOP = 横向插公共逻辑，不改原有业务代码，解耦。**==

