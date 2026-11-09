# 数据库与 TypeORM：从建库到事务的完整实战

> 学习日期：2026-11-05
> 素材来源：小满 NestJS 系列（blog.csdn.net/qq1195566313，专栏 ID 11844396）
> 本篇对应：原文第 24 ~ 28 章
> 适合人群：NestJS 零基础

---

前面九篇我们做的事，本质都是"把请求处理得漂亮"：路由能分发、参数能校验、响应能统一、权限能拦住、日志能记录。但有一个问题一直没解决——**数据存在哪？**

你是不是也这样干过：把数据放在 Service 里的一个数组里，`const users = []`，接口一重启，数据全没了。

这一篇就是来解决这个问题的。它是整套笔记里最长、也最重的一篇，因为它把"外行"和"能干活的工程师"之间那道最关键的墙推倒了：**让数据真正落地到数据库**。

我们分七章走：

| 章节 | 你会得到什么 |
|---|---|
| 一 | 搞懂数据库、ORM、TypeORM 到底各是什么 |
| 二 | 把 NestJS 真正连上 MySQL，写出能启动的配置 |
| 三 | 学会用"类"描述"表"，掌握实体（Entity）全部常用装饰器 |
| 四 | 写出人生第一个完整 CURD 接口，前端能直接调 |
| 五 | 学会一对多、多对多，把数据拆表存、联合查 |
| 六 | 学会事务，保证"转账不会只扣钱不加钱" |
| 七 | 一张知识地图 + 27 条小结 |

---

## 一、数据库入门：数据该放在哪

### 1.1 先用大白话理解：从"内存数组"到"硬盘仓库"

**生活化比喻**：

你开了一家奶茶店。

- **把数据放内存**（Service 里的数组）＝ 把当天所有订单**写在店员的记事本上**。下班一关门（服务重启），记事本一扔，昨天的账全没了。
- **把数据放数据库**（MySQL）＝ 把订单**录入收银系统的硬盘**。哪怕停电、关机、换台电脑，明天打开电脑，昨天的账还在。

所以数据库的第一个价值，四个字：**持久化存储**（Persistence，指的是数据写到硬盘上，断电不丢）。

但数据库不止是"能存住"，它还自带三个记事本做不到的能力：

| 能力 | 生活化解释 | 技术说法 |
|---|---|---|
| 快速查找 | 一万张单子里找"张三"的单，记事本要一张张翻，数据库一秒就有 | 索引（Index） |
| 不出错账 | 两个人同时改同一笔余额，不会互相覆盖成乱码 | 并发控制（Concurrency Control） |
| 不记半笔 | 转账时扣钱和加钱要么都成，要么都不成 | 事务（Transaction） |

**专业定义**：数据库（Database）是按一定结构组织、存储在硬盘上的数据集合，并提供查询、更新、并发控制与事务能力。我们常说的 MySQL、PostgreSQL、SQL Server 都属于**关系型数据库**（Relational Database，简称 RDBMS），意思是数据以"表格 + 表格之间有关联"的方式组织。

### 1.2 关系型数据库的最小认知：四个词就够用

你只要先记住四个词，后面所有内容都能挂上去：

```
数据库（Database）
 └─ 表（Table）          一个表 = 一类东西，比如 user 表只放用户
     ├─ 列（Column）      一列 = 一个属性，比如 name、age
     ├─ 行（Row）         一行 = 一条数据，比如"张三, 18"
     └─ 主键（Primary Key）  这一行的唯一身份证号，比如 id = 3
```

**生活化比喻**：一个 Excel 文件就是"数据库"，里面的工作表就是"表"，表头就是"列"，每一行记录就是"行"，而主键就是"序号"那一列——只不过数据库的序号不会重复、不会空、还会自动增长。

再说两个马上要用到的概念：

- **外键（Foreign Key）**：A 表的一列，存的是 B 表的主键值。比如 `tags` 表里存一个 `userId = 3`，就表示"这条标签属于 3 号用户"。这就是"表与表关联"的物理实现。
- **SQL（Structured Query Language）**：操作数据库的语言，`SELECT / INSERT / UPDATE / DELETE` 就是它的四大基本动作，也是 CURD 的源头。

### 1.3 原生 SQL 的痛：为什么我们还需要 ORM

最原始的写法是直接用 SQL 字符串跟数据库对话。假设要查用户列表并做分页，你要写：

```sql
-- 原生 SQL：方括号里的内容要你自己拼字符串
SELECT id, name, `desc` FROM user
WHERE name LIKE '%张%'
ORDER BY id DESC
LIMIT 0, 10;
```

能跑，但写起来有四根刺：

| 痛点 | 具体表现 |
|---|---|
| 字符串拼接易被注入 | 如果把 `'%${keyWord}%'` 直接拼进 SQL，用户输入 `' OR 1=1 --` 就能拖库（SQL 注入） |
| 类型对不上 | 查出来的 `money` 是字符串 `"300"`，`+` 一下就变成 `"300300"` |
| 表结构变了要改一堆地方 | 加个字段，全项目搜 SQL 字符串一个个改 |
| 没有自动补全 | 字段名写错一个字母，只有运行时才报错 |

**ORM 就是来解决这些的**。

**生活化比喻**：ORM 像一位**会说中文的仓库管理员**。你不用去学"数据库方言"（SQL），你只要跟他说"帮我找名字带张、按 id 倒序、第一页十条"，他帮你翻译成 SQL 去执行，再把结果**装进你熟悉的 JS 对象**递给你。

**专业定义**：ORM（Object Relational Mapping，对象关系映射）是把"数据库表"映射成"编程语言里的类"、把"表里的一行"映射成"类的一个实例（对象）"的技术层。你操作对象，ORM 负责翻译成 SQL。

对照一下就明白了：

| 你想干的事 | 原生 SQL 写法 | TypeORM 写法 |
|---|---|---|
| 查所有用户 | `SELECT * FROM user` | `userRepository.find()` |
| 按 id 查一个 | `SELECT * FROM user WHERE id = 3` | `userRepository.findOne({ where: { id: 3 } })` |
| 新增 | `INSERT INTO user (name) VALUES ('张三')` | `userRepository.save({ name: '张三' })` |
| 修改 | `UPDATE user SET name = '李四' WHERE id = 3` | `userRepository.update(3, { name: '李四' })` |
| 删除 | `DELETE FROM user WHERE id = 3` | `userRepository.delete(3)` |

左边你要懂 SQL、要防注入、要处理类型；右边你只需要懂 JS 对象。

### 1.4 TypeORM 是什么，它在 NestJS 里的位置

**专业定义**：TypeORM 是 Node.js 生态里最主流的 ORM 之一，用 TypeScript 编写，支持 MySQL / PostgreSQL / SQLite / Oracle 等多种数据库，最大特点是**用装饰器（Decorator）描述表结构**。

还记得第二篇讲过的装饰器吗？`@Controller()` 是给类贴标签告诉 NestJS"这是控制器"，`@Entity()` 是给类贴标签告诉 TypeORM"这是张表"。**思路完全一样，只是服务的框架不同**。

它在 NestJS 里的位置，看这张链路图（对比前面几篇我们画过的请求链路）：

```
浏览器
  │  GET /user?keyWord=张&page=1
  ▼
Controller（03 篇：接收参数）
  │  调用
  ▼
Service（03 篇：业务逻辑）
  │  通过注入的 Repository 操作
  ▼
Repository（本篇：TypeORM 提供，封装 CRUD 方法）
  │  TypeORM 翻译成 SQL
  ▼
MySQL（硬盘上的真实数据）
```

一句话总结链路：**Controller 收请求 → Service 做业务 → Repository 读写数据库 → TypeORM 翻译 SQL**。你在 Service 里写的是 `.find()`、`.save()`，真正跑在数据库里的是 `SELECT`、`INSERT`。

> 注意：Repository 是**由 TypeORM 生成、由 NestJS 注入**的，你不需要自己 `new`。这也是第二篇 IoC/DI 思想的一次大型实战。

---

## 二、连接数据库：TypeOrmModule.forRoot

### 2.1 第一步：装三个包

NestJS 官方把 TypeORM 集成封装成了独立的包，所以一次要装三个：

```bash
# @nestjs/typeorm 是 NestJS 的集成层（提供 TypeOrmModule）
# typeorm 是 ORM 本体（提供 @Entity、@Column、Repository）
# mysql2 是 MySQL 的驱动（真正跟数据库说话的底层库）
npm install --save @nestjs/typeorm typeorm mysql2
```

三个包的关系，用比喻说：

- `mysql2` ＝ **司机**（真正开车去数据库那儿）
- `typeorm` ＝ **翻译官**（把对象语言翻成 SQL）
- `@nestjs/typeorm` ＝ **人事部**（把翻译官安排进 NestJS 的依赖注入系统，让它能被 `@InjectRepository()` 取到）

少装任何一个都会报错，且报错信息各不相同（见 2.5）。

### 2.2 第二步：先建一个空数据库

这是新手最容易漏的一步。**TypeORM 不会帮你创建"数据库"，它只会帮你创建"表"**。

所以要先用 Navicat / DataGrip / 命令行，在 MySQL 里建一个空库：

```sql
-- 在 MySQL 客户端里执行：建一个叫 portal 的空库，字符集用 utf8mb4 以支持中文和 emoji
CREATE DATABASE portal DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
```

> 记住这个库名 `portal`，下一步配置里要用。

### 2.3 第三步：在 app.module.ts 里注册（本篇最关键的配置）

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { UserModule } from './user/user.module'

@Module({
  imports: [
    // forRoot 的意思是"全局只注册一次"，数据库连接是应用级别的东西
    TypeOrmModule.forRoot({
      type: 'mysql',              // 数据库类型，固定写法
      host: 'localhost',          // 数据库地址，本机就是 localhost
      port: 3306,                 // MySQL 默认端口
      username: 'root',           // 数据库账号
      password: '123456',         // 数据库密码（换成你自己的！）
      database: 'portal',         // 2.2 建的那个空库名
      // 自动加载实体：配合 forFeature 使用，不用手写 entities 数组
      autoLoadEntities: true,
      // 自动同步表结构：改了 Entity 后，数据库表会自动跟着改
      synchronize: true,
      // 连接失败时的重试策略：每隔 500 毫秒重试一次，最多重试 10 次
      retryDelay: 500,
      retryAttempts: 10,
    }),
    UserModule,
  ],
})
export class AppModule {}
```

写完后 `npm run start:dev`，控制台没报错、并且 MySQL 里自动多了一张 `user` 表，就说明连上了。

### 2.4 配置项逐个拆解（这张表建议收藏）

| 配置项 | 含义 | 新手建议 |
|---|---|---|
| `type` | 数据库类型 | `'mysql'`。也支持 `'postgres'`、`'sqlite'` 等 |
| `host` | 数据库服务器地址 | 本机 `localhost`，线上填服务器 IP |
| `port` | 端口 | MySQL 默认 `3306` |
| `username` | 账号 | 本地一般 `root` |
| `password` | 密码 | **千万别提交到 Git**，生产环境用环境变量 |
| `database` | 库名 | 必须是**已存在**的库（见 2.2） |
| `entities` | 实体列表 | 见 3.4 的三种写法对比 |
| `autoLoadEntities` | 自动收集 `forFeature` 注册过的实体 | 推荐 `true`，省事 |
| `synchronize` | 自动把表结构改成和实体一致 | 开发 `true`，**生产必须 `false`** |
| `retryDelay` | 重试间隔（毫秒） | `500` |
| `retryAttempts` | 重试次数 | `10` |
| `logging` | 是否打印实际执行的 SQL | 排查问题时开 `true`，非常有用 |

这里必须重点说 `synchronize`，因为它是**新手最常踩的雷**：

**生活化比喻**：`synchronize: true` 就像"装修队自动按图纸改房子"——你把图纸（Entity）上的一堵墙删掉，它直接把真墙砸了，**不会问你墙里有没有东西**。

| 场景 | `synchronize` 该设成什么 | 原因 |
|---|---|---|
| 学习 / 本地开发 | `true` | 改实体就自动改表，省事，不用手写建表 SQL |
| 测试环境 | `false`（用迁移 Migration） | 表里可能已有测试数据 |
| **生产环境** | **绝对 `false`** | 删字段 = 真删那一列数据，用户数据直接蒸发，且无备份 |

### 2.5 三种"注册实体"的方式，别搞混

一提到实体注册，你会在网上看到三种写法，它们作用**完全不同**，混淆了就会报 "No repository for X was found"。

| 写法 | 写在哪 | 作用 |
|---|---|---|
| `entities: [__dirname + '/**/*.entity{.ts,.js}']` | `forRoot` 里 | 告诉 TypeORM 项目里有哪些实体类（用来建表） |
| `autoLoadEntities: true` | `forRoot` 里 | 自动收集所有被 `forFeature` 注册过的实体，替代上面那行 |
| `TypeOrmModule.forFeature([User])` | **各业务 Module 的 imports 里** | 告诉 NestJS"这个模块要用 User 的 Repository"，是**注入**的前提 |

最关键的一句话：**`forRoot` 管"连库 + 知道有哪些表"，`forFeature` 管"这个模块能用哪些 Repository"**。两件事，缺一不可。

`entities` 通配写法 vs `autoLoadEntities` 对比：

| 对比项 | `entities: [__dirname + '/**/*.entity{.ts,.js}']` | `autoLoadEntities: true` |
|---|---|---|
| 写法复杂度 | 一行魔法字符串 | 一个布尔值 |
| 新增实体时要改吗 | 不用（自动扫描） | 不用（`forFeature` 时自动收集） |
| 容易出错点 | 用 webpack 打包后 `__dirname` 会变，可能扫不到 | 不会 |
| 推荐度 | 老写法，能用 | **推荐**（NestJS 官方推荐） |

### 2.6 常见错误（连接阶段）

| 报错原文（节选） | 原因 | 解决 |
|---|---|---|
| `ER_ACCESS_DENIED_ERROR: Access denied for user 'root'@'localhost'` | 账号密码错 | 核对 `username` / `password`；MySQL 8 还可能有认证插件问题 |
| `Unknown database 'portal'` | 2.2 那步忘了建库 | 先 `CREATE DATABASE portal ...` |
| `connect ECONNREFUSED 127.0.0.1:3306` | MySQL 服务没启动 | 启动 MySQL 服务（Windows 服务管理器里看 MySQL80） |
| `Nest can't resolve dependencies of the UserService (?)` | 模块里漏了 `forFeature([User])` | 在对应 Module 的 `imports` 里补上 |
| `No repository for "User" was found` | 实体没被 TypeORM 识别 | 检查是否有 `autoLoadEntities: true` 或 `entities` 通配 |
| `Client does not support authentication protocol` | MySQL 8 默认加密方式旧驱动不认 | 改用 `mysql2`（本篇就是），或改用户的认证插件 |

---

## 三、实体 Entity：用类描述一张表

### 3.1 什么是实体：一张"图纸"

**生活化比喻**：实体就是**建房子的图纸**。图纸上写"这里有个 3 米宽的门、那里有个 1.5 米高的窗"，施工队（TypeORM）就照着在数据库里盖出对应的表。你改图纸，表结构跟着改（如果 `synchronize` 开了）。

**专业定义**：实体（Entity）是一个映射到数据库表的类（Class）。类名默认对应表名，类的每个属性对应表的一个列，属性上的装饰器描述这一列的规则。

最基础的一个实体长这样：

```typescript
// src/user/entities/user.entity.ts
import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm'

@Entity() // 贴标签：告诉 TypeORM 这是一个实体，要映射成表
export class User {
  @PrimaryGeneratedColumn() // 主键 + 自动递增
  id: number

  @Column() // 普通列，类型由 TS 类型自动推断成 varchar
  name: string

  @Column()
  password: string

  @Column()
  age: number
}
```

启动后，数据库里会出现一张 `user` 表：

```
+----+------+----------+-----+
| id | name | password | age |
+----+------+----------+-----+
```

可以看到三件事：
1. 类名 `User` → 表名 `user`（TypeORM 默认转小写，也可以用 `@Entity('users')` 自定义）
2. 属性名 → 列名
3. `id: number` 加了 `@PrimaryGeneratedColumn()` → 变成自增主键

### 3.2 主键：@PrimaryGeneratedColumn

主键是这一行的唯一身份证，绝对不能重复、不能为空。TypeORM 提供两种自动生成方式：

```typescript
// 方式一：自增数字主键，最常用。适合大多数业务表
@PrimaryGeneratedColumn()
id: number

// 方式二：UUID 字符串主键。适合不想暴露"第几个用户"、或要分布式生成的场景
@PrimaryGeneratedColumn('uuid')
id: string // 注意：uuid 是字符串，类型要写 string
```

> 原文这里写的 `id: number` 配 `'uuid'` 其实类型不匹配，实际应该写 `string`。这种细节在真项目里会引起类型报错，我们按正确的来。

两种主键对比：

| 对比项 | 自增数字 `@PrimaryGeneratedColumn()` | UUID `@PrimaryGeneratedColumn('uuid')` |
|---|---|---|
| 数据库列类型 | `int` | `varchar(36)` |
| 可读性 | 好，1、2、3 一眼看出量级 | 差，`550e8400-e29b-41d4-a716-446655440000` |
| 安全性 | 差，能猜到用户总数 | 好，无法枚举 |
| 索引性能 | 好（数字短） | 略差（36 字符） |
| 推荐场景 | 后台管理系统、内部业务 | 对外的用户表、订单号 |

另外还有一个 `@PrimaryColumn()`，它**不自动生成**，值要你自己给（比如用手机号当主键）：

```typescript
// 主键的值由业务自己提供，比如手机号、身份证号
@PrimaryColumn()
phone: string
```

### 3.3 @Column：列类型与列选项

`@Column()` 不写参数时，TypeORM 会根据 TS 类型自动推断（`string` → `varchar`，`number` → `int`，`boolean` → `tinyint`）。但**一旦你要限制长度、加注释、设默认值，就必须显式写配置对象**：

```typescript
// 显式指定类型和长度：密码最多 200 字符
@Column({ type: 'varchar', length: 200 })
password: string

// 显式指定 int 类型
@Column({ type: 'int' })
age: number

// 创建时间列：插入时自动填当前时间，不用你手动赋值
@CreateDateColumn({ type: 'timestamp' })
create_time: Date
```

MySQL 常见列类型（原文给的全表，我按用途分了组，看这张就够）：

| 分组 | 类型 | 说明 |
|---|---|---|
| 整数 | `int` / `tinyint` / `smallint` / `mediumint` / `bigint` | 数字，范围依次不同；`tinyint` 常用于布尔 |
| 小数 | `float` / `double` / `decimal`(`dec`/`numeric`) | 金额**必须**用 `decimal`，别用 `float`（有精度误差） |
| 日期时间 | `date` / `datetime` / `timestamp` / `time` / `year` | `timestamp` 会自动做时区转换 |
| 字符串 | `char` / `varchar` / `text` / `tinytext` / `mediumtext` / `longtext` | 短文本用 `varchar`，长文本（文章内容）用 `text` |
| 二进制 | `binary` / `blob` / `tinyblob` / `mediumblob` / `longblob` | 存图片/文件二进制 |
| 枚举 | `enum` | 只能取预设值之一 |
| JSON | `json` | 存对象 |
| 空间 | `geometry` / `point` / `linestring` / `polygon` 等 | 存地理坐标，日常少用 |

### 3.4 常用列选项（ColumnOptions）对照表

这是原文列了一大串的地方，我挑出**真正会用到的**，按重要性排序：

| 选项 | 含义 | 什么时候用 |
|---|---|---|
| `type` | 列类型 | 需要 `varchar(200)` 这类精确控制时 |
| `length` | 长度 | 配 `varchar` 用，比如 `length: 200` |
| `name` | 数据库里的真实列名 | 想让列名叫 `ipaaa`、属性叫 `ip` 时解耦 |
| `nullable` | 是否允许 NULL | 默认 `false`（NOT NULL）；可选字段设 `true` |
| `default` | 数据库级默认值 | 比如状态默认 `'1'` |
| `comment` | 列注释 | 强烈建议加，团队协作时一目了然 |
| `unique` | 唯一约束 | 用户名、邮箱、手机号 |
| `select` | 查询时是否默认返回 | 设 `false` 可默认隐藏密码列，**很实用** |
| `update` | `save` 时是否更新该列 | 设 `false` 表示"只在第一次插入时写入"，适合创建时间 |
| `primary` | 标记为主键 | 等价于 `@PrimaryColumn`，少用 |
| `unsigned` | 无符号（仅 MySQL） | 想表示"不能为负"的 id、数量 |
| `precision` / `scale` | 十进制精度/小数位数 | 金额列，如 `precision: 10, scale: 2` |
| `collation` / `charset` | 排序规则 / 字符集 | 需要区分大小写、特殊语言排序时 |
| `transformer` | 读写时的转换函数 | 存的时候加密、读的时候解密；存数组转字符串等 |
| `array` / `hstoreType` / `asExpression` / `generatedType` / `zerofill` / `width` / `onUpdate` | 特定数据库专属 | 新手基本用不到，知道存在即可 |

一个**配置齐全**的真实例子（建议照着写一遍）：

```typescript
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 50, unique: true, comment: '用户名，唯一' })
  name: string

  // select: false → 普通查询不会带出密码，需要时用 addSelect 单独取
  @Column({ type: 'varchar', length: 200, select: false, comment: '密码' })
  password: string

  // nullable: true → 允许不填；default 给个兜底值
  @Column({ type: 'varchar', length: 255, nullable: true, default: '', comment: '描述' })
  desc: string

  // unique: true → 数据库层面保证不重复，比在代码里判断更可靠
  @Column({ type: 'varchar', length: 100, unique: true, nullable: true })
  email: string

  // 金额必须 decimal：precision 总位数 10，scale 小数 2 位 → 最大 99999999.99
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  money: number

  // 数据库里的列名会叫 ipaaa，代码里还是用 ip，互不干扰
  @Column({ type: 'varchar', name: 'ipaaa', nullable: true })
  ip: string
}
```

### 3.5 三种"特殊列"：简单数组、简单 JSON、自动生成列

#### 3.5.1 `simple-array`：把数组塞进一个字符串列

**生活化比喻**：把 `['语文','数学','英语']` 用逗号连成 `"语文,数学,英语"` 存进一个普通字段，读出来再自动切开。

```typescript
@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number

  // 存进去是数组，数据库里实际是一段逗号分隔的字符串
  // 注意：数组元素里不能含逗号，否则切分会错
  @Column('simple-array')
  names: string[]
}
```

#### 3.5.2 `simple-json`：把对象存成 JSON 字符串

**生活化比喻**：像把一份档案（对象）整个装进信封（字符串）存起来，要用时再拆开还原成对象。

```typescript
@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number

  // 数据库如果没 json 类型（如老版本 MySQL），又想存对象，就用 simple-json
  // TypeORM 内部会 JSON.stringify / JSON.parse
  @Column('simple-json')
  profile: { name: string; nickname: string }
}
```

三种"存集合"的方式对比，别选错：

| 对比项 | `simple-array` | `simple-json` | 单独建关联表 |
|---|---|---|---|
| 适合存什么 | 简单的字符串数组 | 简单的对象/嵌套结构 | 需要查询、统计、排序的关联数据 |
| 能否用 WHERE 查元素 | 只能 `LIKE` 模糊匹配 | 基本不能 | 可以，且能走索引 |
| 数据变更 | 整体覆盖 | 整体覆盖 | 可单独增删改 |
| 推荐场景 | 标签名快照、小配置 | 用户偏好设置、扩展字段 | 用户-标签、订单-商品 |

#### 3.5.3 `@Generated('uuid')`：自动生成非主键的唯一值

```typescript
// 不是主键，但一样需要"自动生成"的场景，比如对外暴露的 uuid
@Generated('uuid')
uuid: string
```

这个在后面 5.x 的 `User` 实体里会用到——主键 `id` 留给数据库内部用，额外给个 `uuid` 给外部用。

#### 3.5.4 枚举列 `enum`：只能填预设值

```typescript
// 状态只能是 '1'/'2'/'3'/'4' 之一，数据库层面就会拦住别的值
@Column({
  type: 'enum',
  enum: ['1', '2', '3', '4'],
  default: '1', // 默认值是 '1'
})
xx: string
```

**生活化比喻**：像问卷里的单选题，你想填个 E 选项都不行，只能从 ABCD 里挑。

> 小坑：`enum` 列在生产环境想加一个选项，需要改表结构（DDL），在大表上会很慢。选项不稳定时，用 `tinyint` + 代码里的常量更灵活。

### 3.6 常见错误（实体阶段）

| 报错原文（节选） | 原因 | 解决 |
|---|---|---|
| `ColumnTypeUndefinedError: Column type for User#name is not defined` | 只装 `typeorm` 没装 `reflect-metadata`，或 `tsconfig` 里的 `emitDecoratorMetadata` 是 `false` | 在入口 `main.ts` 第一行 `import 'reflect-metadata'`；并确认 `tsconfig.json` 中 `"emitDecoratorMetadata": true`、`"experimentalDecorators": true` |
| `Entity metadata for User#tags was not found` | 关联的实体类没被注册 | 检查 `autoLoadEntities`/`entities`，以及 `forFeature` 是否包含对方 |
| `Duplicate column name 'xxx'` | 两个属性映射到了同一个列名（比如两个都 `name: 'ip'`） | 改 `name` 或属性名 |
| `Data too long for column 'name'` | `length` 设太小 | 把 `length` 调大，或用 `text` |
| `Cannot use import statement outside a module`（引入实体时） | 路径写错到了 `dist` 里 | 用相对路径引 `src` 下的实体 |
| `synchronize` 打开后表结构突然被改坏 | `synchronize: true` 在生产 | 立刻改 `false`，并改用手动迁移 |

---

## 四、Repository：第一个完整 CURD

### 4.1 Repository 是什么

**生活化比喻**：Repository 是一个**专属仓库管理员**。

- 你要"存一件货" → 跟他说 `save(货)`
- 你要"取符合条件的货" → 跟他说 `find({ where: ... })`
- 你要"清掉某一件" → 跟他说 `delete(id)`

他手上有且只有**一种货**的钥匙——`Repository<User>` 只管 User 表，`Repository<Tags>` 只管 Tags 表。**一个仓库一个管理员，互不越界**。

**专业定义**：Repository（仓储）是 TypeORM 提供的、绑定到单个实体的数据访问对象，封装了该实体的增删改查方法，并自动完成"对象 ↔ SQL"的翻译。

### 4.2 三步接通 Repository（漏一步就报错）

```
第 1 步：定义实体          user.entity.ts       ── 有表可管
第 2 步：模块注册 forFeature  user.module.ts      ── 允许注入
第 3 步：服务里注入         user.service.ts      ── @InjectRepository(User)
```

用图表示更直观：

```
┌─────────────────── AppModule ───────────────────┐
│ TypeOrmModule.forRoot({...})   ← 建立数据库连接  │
│                                                  │
│  ┌──────────── UserModule ────────────┐          │
│  │ imports: [TypeOrmModule.forFeature([User])]  │
│  │                                    │          │
│  │  UserService                       │          │
│  │    constructor(                    │          │
│  │      @InjectRepository(User)       │          │
│  │      user: Repository<User>  ←─────┼── 注入   │
│  │    )                               │          │
│  └────────────────────────────────────┘          │
└──────────────────────────────────────────────────┘
```

### 4.3 完整可运行代码：user 模块

下面这五份文件，保存的就是一个**前端可以直接调通的 CURD**。

**① 实体**

```typescript
// src/user/entities/user.entity.ts
import { Column, Entity, PrimaryGeneratedColumn, Generated, CreateDateColumn } from 'typeorm'

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 255 })
  name: string

  @Column({ type: 'text', nullable: true })
  desc: string

  // 对外暴露的 uuid，非主键，自动生成
  @Generated('uuid')
  uuid: string

  // 创建时间，插入时自动填
  @CreateDateColumn({ type: 'timestamp' })
  createTime: Date
}
```

**② DTO（数据传输对象）**

```typescript
// src/user/dto/create-user.dto.ts
// DTO 只负责"进来什么参数"，字段要和前端提交的对齐
export class CreateUserDto {
  name: string

  desc: string
}
```

```typescript
// src/user/dto/update-user.dto.ts
import { PartialType } from '@nestjs/mapped-types'
import { CreateUserDto } from './create-user.dto'

// PartialType 把 CreateUserDto 的所有字段变成可选
// 这样"只改名字不改描述"的请求也能过（为什么这么做见 07 篇 DTO 章节）
export class UpdateUserDto extends PartialType(CreateUserDto) {}
```

**③ Service：注入 Repository，写业务**

```typescript
// src/user/user.service.ts
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, Like } from 'typeorm'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import { User } from './entities/user.entity'

@Injectable()
export class UserService {
  // 关键一行：让 NestJS 把 User 表的 Repository 注进来
  constructor(
    @InjectRepository(User)
    private readonly user: Repository<User>,
  ) {}

  // ---------- 增 ----------
  create(createUserDto: CreateUserDto) {
    // 先 new 一个实体实例，再逐个赋属性，最后 save
    // 这样比直接 save({...}) 更安全：多传的字段不会被写进数据库
    const data = new User()
    data.name = createUserDto.name
    data.desc = createUserDto.desc
    return this.user.save(data) // save 返回保存后的完整对象（含 id）
  }

  // ---------- 查（列表 + 分页 + 模糊搜索） ----------
  async findAll(query: { keyWord: string; page: number; pageSize: number }) {
    // page 从 URL 查询字符串来，是字符串类型，先转数字，避免 skip 算出 NaN
    const page = Number(query.page) || 1
    const pageSize = Number(query.pageSize) || 10

    const data = await this.user.find({
      where: {
        // Like 对应 SQL 的 LIKE，百分号是通配符 → 名字里包含 keyWord 的都算
        name: Like(`%${query.keyWord ?? ''}%`),
      },
      order: {
        id: 'DESC', // 按 id 倒序，最新的在前
      },
      skip: (page - 1) * pageSize, // 跳过多少条：第 1 页跳 0，第 2 页跳 pageSize
      take: pageSize, // 取多少条
    })

    // 前端分页组件需要总数，单查一次 count
    const total = await this.user.count({
      where: {
        name: Like(`%${query.keyWord ?? ''}%`), // 条件必须和上面完全一致
      },
    })

    return { data, total }
  }

  // ---------- 改 ----------
  update(id: number, updateUserDto: UpdateUserDto) {
    // update 直接发 UPDATE 语句，不触发实体钩子，性能好
    return this.user.update(id, updateUserDto)
  }

  // ---------- 删 ----------
  remove(id: number) {
    return this.user.delete(id)
  }
}
```

**④ Controller：对外暴露接口**

```typescript
// src/user/user.controller.ts
import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common'
import { UserService } from './user.service'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'

@Controller('user') // 路由前缀 /user
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post() // POST /user  → 新增
  create(@Body() createUserDto: CreateUserDto) {
    return this.userService.create(createUserDto)
  }

  @Get() // GET /user?keyWord=张&page=1&pageSize=10 → 列表
  findAll(@Query() query: { keyWord: string; page: number; pageSize: number }) {
    return this.userService.findAll(query)
  }

  @Patch(':id') // PATCH /user/3 → 局部更新
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.userService.update(+id, updateUserDto) // +id 把字符串转数字
  }

  @Delete(':id') // DELETE /user/3 → 删除
  remove(@Param('id') id: string) {
    return this.userService.remove(+id)
  }
}
```

**⑤ Module：把三者串起来**

```typescript
// src/user/user.module.ts
import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { UserService } from './user.service'
import { UserController } from './user.controller'
import { User } from './entities/user.entity'

@Module({
  // 这一行是 Repository 能被注入的前提，漏了就报依赖解析失败
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
```

启动后用 curl 或 Postman 验证：

```bash
# 新增
curl -X POST http://localhost:3000/user \
  -H "Content-Type: application/json" \
  -d '{"name":"张三","desc":"第一个用户"}'

# 查询（分页 + 模糊）
curl "http://localhost:3000/user?keyWord=张&page=1&pageSize=10"

# 修改
curl -X PATCH http://localhost:3000/user/1 \
  -H "Content-Type: application/json" \
  -d '{"name":"张三丰"}'

# 删除
curl -X DELETE http://localhost:3000/user/1
```

### 4.4 Repository 常用方法对照表（建议贴在手边）

| 想做什么 | 方法 | 说明 |
|---|---|---|
| 新增/更新（自动判断） | `save(obj)` | 没有主键就 INSERT，有主键就 UPDATE；会触发钩子 |
| 批量保存 | `save([obj1, obj2])` | 一条语句批量处理 |
| 直接更新 | `update(id, partial)` | 只发 UPDATE，不触发钩子，性能更好 |
| 直接删除 | `delete(id)` | 按主键删 |
| 按条件删 | `delete({ name: '张三' })` | 传条件对象 |
| 查一条 | `findOne({ where: {...} })` | 找不到返回 `null`（旧版报错） |
| 查一条（找不到报错） | `findOneOrFail({ where: {...} })` | 找不到抛 `EntityNotFoundError` |
| 查多条 | `find({ where, order, skip, take })` | 列表查询主力 |
| 查全部 | `find()` | 无参 |
| 统计 | `count({ where })` | 分页必备 |
| 判断存在 | `exist({ where })` | 返回布尔 |
| 自增/自减 | `increment(条件, '字段', 数量)` | 原子操作，并发安全 |
| 原生 SQL | `query('SELECT ...')` | 兜底用，注意防注入 |

### 4.5 `save` 和 `update` 的区别（新手最容易混）

| 对比项 | `save()` | `update()` |
|---|---|---|
| 触发的 SQL | 先查再 INSERT/UPDATE（多一次查询） | 直接 UPDATE |
| 是否触发 `@BeforeUpdate` 等钩子 | 是 | 否 |
| 是否返回完整实体 | 是 | 返回 `UpdateResult` |
| 关联关系是否级联保存 | 是（配合 `cascade`） | 否 |
| 适合场景 | 新增、需要钩子、要保存关联 | 单纯改几个字段，追求性能 |

一句话选：**要"完整对象 + 钩子 + 关联"用 `save`，只要"快速改字段"用 `update`**。

### 4.6 前端怎么调：axios 接口层

原文给的是 Vue3 + Element Plus 的完整页面。作为后端笔记，我们把**接口层**抽出来看，这才是和后端强相关的部分：

```typescript
// src/server/index.ts（前端项目里）
import axios from 'axios'

// 统一配好后端地址，生产环境换成真实域名
axios.defaults.baseURL = 'http://localhost:3000'

// 新增：对应后端 @Post() + CreateUserDto
export const addUser = (data: any) => axios.post('/user', data).then((res) => res.data)

// 列表：对应后端 @Get() + @Query()，分页参数用 params 拼在 URL 上
export const getList = (data: any) => axios.get('/user', { params: data }).then((res) => res.data)

// 删除：对应后端 @Delete(':id')，id 直接拼在路径里
export const delUser = (data: { id: number }) => axios.delete(`/user/${data.id}`).then((res) => res.data)

// 更新：对应后端 @Patch(':id')，注意路径带 id，body 里也带完整对象
export const updateUser = (data: any) => axios.patch(`/user/${data.id}`, data).then((res) => res.data)
```

前后端字段对照，一眼看懂每个请求打到哪：

| 前端动作 | HTTP 方法 + 路径 | 对应后端装饰器 | 参数怎么传 |
|---|---|---|---|
| 新增用户 | `POST /user` | `@Post()` + `@Body()` | JSON body |
| 用户列表 | `GET /user?keyWord=&page=1&pageSize=10` | `@Get()` + `@Query()` | URL 查询字符串 |
| 修改用户 | `PATCH /user/3` | `@Patch(':id')` + `@Param('id')` | 路径 id + body |
| 删除用户 | `DELETE /user/3` | `@Delete(':id')` | 路径 id |

> 原文前端还写了搜索框、弹框表单、分页、`resetForm` 拷贝等一堆细节。这些属于前端工程，本篇不展开——你只需记住：**前后端对接的唯一契约是"路径 + 方法 + 字段名"，字段名必须和后端 DTO 完全一致**，错一个字母就是 `undefined`。

### 4.7 常见错误（CURD 阶段）

| 报错原文（节选） | 原因 | 解决 |
|---|---|---|
| `Nest can't resolve dependencies of the UserService (?)` | 忘了 `forFeature([User])` | 在 Module 的 `imports` 补上 |
| `Column 'xxx' cannot be null` | 实体字段非 `nullable` 但没传值 | 传值，或把该列改 `nullable: true` |
| `You have an error in your SQL syntax ... LIMIT NaN` | `page`/`pageSize` 是字符串，算出 `NaN` | 用 `Number()` 转数字并给默认值 |
| 查询结果 `total` 和 `data` 对不上 | `count` 的 `where` 和 `find` 不一致 | 两处条件抽成同一个变量复用 |
| `Cannot query across one-to-many for property tags`（旧版） | 关联查询写法不对 | 见 5.4 `relations` 用法 |
| 分页越翻越少，第 2 页数据重复 | `skip` 算成了 `page * pageSize` | 正确是 `(page - 1) * pageSize` |
| 前端拿到的 `id` 是字符串 | `@Param('id')` 天生是字符串 | 用 `+id` 或 `ParseIntPipe`（见 07 篇） |

---

## 五、表关系：一对多与多对多

### 5.1 为什么必须分表

**生活化比喻**：一个用户有 100 个标签。

- **不分表**（全塞 user 表）：只能存成一列 `"tag1,tag2,...,tag100"`。想查"哪些用户有 tag1"，只能 `LIKE '%tag1%'`，慢且容易误匹配（`tag10` 也会被 `tag1` 匹配到）。而且标签改个名，要扫全表字符串替换。
- **分表**（user 一张、tags 一张，靠 `userId` 关联）：查"有 tag1 的用户"直接 `WHERE tags = 'tag1'`，能走索引；标签改名只改一行。

所以有了这张图（本篇最该记住的一张）：

```
不分表（一列存字符串）：
  user: id=1, name=张三, tags="tag1,tag2,tag3"   ← 想按标签查，只能 LIKE

分表（靠外键关联）：
  user 表                    tags 表
  +----+--------+        +----+-------+--------+
  | id | name   |        | id | tags  | userId |
  +----+--------+        +----+-------+--------+
  | 1  | 张三   |◄───────| 1  | tag1  |   1    |
  | 2  | 李四   |        | 2  | tag2  |   1    |
  +----+--------+        | 3  | tag3  |   1    |
                         | 4  | tag1  |   2    |
                         +----+-------+--------+
                              外键 userId → user.id
```

读图方式：**tags 表里的 `userId` 指向 user 表的 `id`**。所以"张三"能通过 `id=1` 找到 3 条标签；反过来某条标签通过 `userId=1` 找到张三。

这就是**一对多**：一个用户 → 多个标签。

### 5.2 一对多（OneToMany）与多对一（ManyToOne）

**生活化比喻**：

- **一个用户有多个标签** → 从用户看标签，是"一对多"（OneToMany）
- **多个标签属于同一个用户** → 从标签看用户，是"多对一"（ManyToOne）

它们**永远是成对出现的两面**，就像"父亲有多个孩子"和"每个孩子有一个父亲"。

先建 Tags 实体：

```typescript
// src/user/entities/tags.entity.ts
import { Column, Entity, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm'
import { User } from './user.entity'

@Entity()
export class Tags {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 50 })
  tags: string

  // 多对一：多个 tag 指向同一个 user
  // 第一个参数 () => User：告诉 TypeORM 对面是谁（注意是函数，为了延迟加载避免循环引用）
  // 第二个参数 (user) => user.tags：告诉 TypeORM 对面哪个属性指向我，形成双向关系
  @ManyToOne(() => User, (user) => user.tags, {
    onDelete: 'CASCADE', // 删用户时，他的标签一起删（可选）
  })
  @JoinColumn({ name: 'userId' }) // 外键列建在"多"这一侧，列名 userId
  user: User
}
```

再改 User 实体，加上反向声明：

```typescript
// src/user/entities/user.entity.ts
import { Column, Entity, PrimaryGeneratedColumn, Generated, CreateDateColumn, OneToMany } from 'typeorm'
import { Tags } from './tags.entity'

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 255 })
  name: string

  @Column({ type: 'text', nullable: true })
  desc: string

  @Generated('uuid')
  uuid: string

  @CreateDateColumn({ type: 'timestamp' })
  createTime: Date

  // 一对多：一个 user 拥有多个 tag
  // 注意：这一列在数据库里【没有对应的列】，它只是"关系声明"
  @OneToMany(() => Tags, (tags) => tags.user)
  tags: Tags[]
}
```

**这里有个新手必踩的坑**：`@OneToMany` 修饰的 `tags` 属性，**数据库里并没有 `tags` 这一列**。它只是告诉 TypeORM"需要时可以帮我关联查出来"。真正的物理外键在 `tags` 表的 `userId` 列上——这就是 `@JoinColumn()` 放在"多"那一侧的原因。

**生活化比喻**：`@JoinColumn` 是"把门牌号写在哪家"的决定权。门牌号（外键）只能写在一边，写在"多"（标签）那边，用户那边就只留一句"我有很多标签"的口头承诺。

### 5.3 关联的三种关系一览（含多对多、一对一）

| 关系 | 装饰器 | 生活化例子 | 外键放在哪 |
|---|---|---|---|
| 一对多 | `@OneToMany` | 用户 → 多篇文章 | 不建外键（只是声明） |
| 多对一 | `@ManyToOne` | 多篇文章 → 一个作者 | 建在"多"这一侧，配 `@JoinColumn()` |
| 多对多 | `@ManyToMany` | 学生 ↔ 课程 | 需要**中间表**，配 `@JoinTable()` |
| 一对一 | `@OneToOne` | 用户 ↔ 身份证 | 任一侧，配 `@JoinColumn()` |

### 5.4 relations：要关联数据就得显式声明

`find({ where: {...} })` 默认**只查当前表**。想连标签一起返回，必须加 `relations`。

```typescript
// src/user/user.service.ts（节选）

async findAll(query: { keyWord: string; page: number; pageSize: number }) {
  const page = Number(query.page) || 1
  const pageSize = Number(query.pageSize) || 10

  const data = await this.user.find({
    // 关键：不加这一行，返回的 user 里没有 tags 字段（或者 tags 是 undefined）
    relations: ['tags'],
    where: {
      name: Like(`%${query.keyWord ?? ''}%`),
    },
    order: { id: 'DESC' },
    skip: (page - 1) * pageSize,
    take: pageSize,
  })

  const total = await this.user.count({
    where: { name: Like(`%${query.keyWord ?? ''}%`) },
  })

  return { data, total }
}
```

加了 `relations` 前后，返回的数据差别是这样的：

```jsonc
// 不加 relations
{ "id": 1, "name": "张三", "desc": "第一个用户" }

// 加了 relations: ['tags']
{
  "id": 1,
  "name": "张三",
  "desc": "第一个用户",
  "tags": [                       // ← 多出来的关联数据
    { "id": 1, "tags": "tag1", "userId": 1 },
    { "id": 2, "tags": "tag2", "userId": 1 }
  ]
}
```

**生活化比喻**：`relations` 就像点外卖时勾选"要不要餐具"。你不勾，商家（数据库）就只给你主食（主表数据），餐具（关联数据）不会主动送。

#### 保存关联：完整代码

原文这里的做法是**先存标签、再回填用户关系**。逻辑有点绕，我们拆成 4 步看：

```typescript
// src/user/user.service.ts（节选）
async addTags(params: { tags: string[]; userId: number }) {
  // 第 1 步：拿到要操作的用户
  const userInfo = await this.user.findOne({ where: { id: params.userId } })
  if (!userInfo) {
    // 用户不存在就直接返回，别往下走（不然会报 Cannot read property of null）
    return { message: '用户不存在' }
  }

  // 第 2 步：把前端传来的 ['tag1','tag2','tag3'] 一个个变成 Tags 实例并存库
  const tagList: Tags[] = []
  for (let i = 0; i < params.tags.length; i++) {
    const t = new Tags()
    t.tags = params.tags[i]
    await this.tag.save(t) // 先落库，拿到 id
    tagList.push(t)
  }

  // 第 3 步：把标签列表挂到用户的 tags 属性上
  userInfo.tags = tagList

  // 第 4 步：save 用户，TypeORM 会自动把 tags 的外键 userId 更新成这个用户
  return this.user.save(userInfo)
}
```

配套的 Service 构造函数与 Controller 也要补：

```typescript
// 构造函数要多注入一个 Tags 的 Repository
constructor(
  @InjectRepository(User) private readonly user: Repository<User>,
  @InjectRepository(Tags) private readonly tag: Repository<Tags>,
) {}
```

```typescript
// Controller 新增一个接口
@Post('/add/tags') // POST /user/add/tags
addTags(@Body() params: { tags: string[]; userId: number }) {
  return this.userService.addTags(params)
}
```

Module 也要把 Tags 注册进去：

```typescript
imports: [TypeOrmModule.forFeature([User, Tags])], // 两个都要注册
```

> **路由顺序坑**：`@Post('/add/tags')` 必须放在 `@Post(':id')` 这类动态路由**之前**（本例中 `@Post()` 无参，不受影响）。如果以后加了 `@Post(':id')`，`/add/tags` 会被当成 `id = "add"` 匹配走，导致接口 404 或参数错乱。这是 03 篇提过的"静态路由优先"原则。

### 5.5 多对多（ManyToMany）与 @JoinTable

**生活化比喻**：学生和课程。一个学生选多门课，一门课有多个学生。**两边都是"多"**，谁也不能在表里塞外键——塞一边就存不下另一边的多。

解决办法：**加一张中间表**，专门记"谁选了哪门课"。

```
student 表            student_courses（中间表）        course 表
+----+--------+      +-----------+-----------+      +----+----------+
| id | name   |      | studentId | courseId  |      | id | title    |
+----+--------+      +-----------+-----------+      +----+----------+
| 1  | 小明   |      |     1     |     1     |      | 1  | 数学     |
| 2  | 小红   |      |     1     |     2     |      | 2  | 英语     |
+----+--------+      |     2     |     1     |      +----+----------+
                      +-----------+-----------+
                      ← 一行 = "谁选了哪门课"
```

代码上，**`@JoinTable()` 只写在"拥有方"一侧**（任选一边作为主导方，通常选操作更频繁的那个）：

```typescript
// student.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, ManyToMany, JoinTable } from 'typeorm'
import { Course } from './course.entity'

@Entity()
export class Student {
  @PrimaryGeneratedColumn()
  id: number

  @Column()
  name: string

  // 多对多：一个学生有多门课
  // @JoinTable() 表示"由我来管理中间表"
  // 中间表默认名：student_courses_course（拥有方表名_被拥有方表名）
  @ManyToMany(() => Course, (course) => course.students)
  @JoinTable()
  courses: Course[]
}
```

```typescript
// course.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, ManyToMany } from 'typeorm'
import { Student } from './student.entity'

@Entity()
export class Course {
  @PrimaryGeneratedColumn()
  id: number

  @Column()
  title: string

  // 反向声明：不加 @JoinTable()，因为中间表由 Student 那边管
  @ManyToMany(() => Student, (student) => student.courses)
  students: Student[]
}
```

查询多对多跟一对多一样，用 `relations`：

```typescript
// 查学生，连他选的课一起带出来
const student = await this.studentRepository.findOne({
  where: { id: 1 },
  relations: ['courses'],
})
```

> 想自定义中间表名和列名，用 `@JoinTable({ name: 'student_course', joinColumn: {...}, inverseJoinColumn: {...} })`。新手用默认的最省事。

### 5.6 实体关系示意图（ER 图，本篇核心）

把本篇涉及的四种关系画在一起，这张图看懂，第五、六章就通了：

```
┌─────────────────────────────┐
│            User             │
├─────────────────────────────┤
│ PK  id          int(自增)   │
│     name        varchar(255)│
│     desc        text        │
│     uuid        varchar(36) │
│     createTime  timestamp   │
└──────────┬──────────────────┘
           │
           │ 1 对 多（OneToMany / ManyToOne）
           │ 外键在 tags.userId 上
           │
           ▼  N
┌─────────────────────────────┐
│            Tags             │
├─────────────────────────────┤
│ PK  id          int         │
│     tags        varchar(50) │
│ FK  userId      int  ───────┼──► 指回 User.id
└─────────────────────────────┘

━━━━━━━━━━━━━━━━━━ 多对多（需中间表）━━━━━━━━━━━━━━━━━━

┌──────────────┐        ┌──────────────────┐        ┌──────────────┐
│   Student    │        │  student_courses │        │    Course    │
├──────────────┤        ├──────────────────┤        ├──────────────┤
│ PK id        │──1───► │ FK studentId     │ ◄───N─ │ PK id        │
│    name      │        │ FK courseId      │        │    title     │
└──────────────┘        └──────────────────┘        └──────────────┘
                           ↑ @JoinTable() 生成
                        （拥有方写在 Student 一侧）
```

读图要点，三句话：

1. **一对多的外键永远在"多"的那一侧**（`tags.userId`）
2. **多对多必须靠中间表**，`@JoinTable()` 只写一边
3. **`@OneToMany` 那一侧在数据库里没有列**，只是代码里的关系声明

### 5.7 关系类型对照表（速查）

| 场景 | 用户侧写 | 对方侧写 | 外键/中间表 | 查询 |
|---|---|---|---|---|
| 用户 → 标签 | `@OneToMany(() => Tags, t => t.user) tags: Tags[]` | `@ManyToOne(() => User, u => u.tags)` + `@JoinColumn({ name: 'userId' })` | tags 表加 `userId` | `relations: ['tags']` |
| 文章 → 作者 | `@ManyToOne(() => User, u => u.articles)` + `@JoinColumn()` | `@OneToMany(() => Article, a => a.author)` | article 表加 `userId` | `relations: ['author']` |
| 学生 ↔ 课程 | `@ManyToMany(() => Course, c => c.students)` + `@JoinTable()` | `@ManyToMany(() => Student, s => s.courses)` | 自动生成中间表 | `relations: ['courses']` |
| 用户 ↔ 身份证 | `@OneToOne(() => IdCard, i => i.user)` + `@JoinColumn()` | `@OneToOne(() => User, u => u.idCard)` | 一侧加外键 | `relations: ['idCard']` |

### 5.8 常见错误（关联阶段）

| 报错原文（节选） | 原因 | 解决 |
|---|---|---|
| `Entity metadata for Tags#user was not found` | 循环引用导致对方类没加载 | 装饰器参数一律写 `() => User` 箭头函数，别直接写 `User` |
| 查出来的 `tags` 是 `undefined` | `find()` 没加 `relations: ['tags']` | 加上 `relations` |
| `Cannot query across one-to-many for property tags`（TypeORM 0.3 之前） | 用 `where: { tags: ... }` 查关联 | 用 `relations` + `QueryBuilder` 或先查对方表 |
| 中间表没生成，或生成两张 | `@JoinTable()` 两边都写了 | 只在拥有方写一次 |
| 保存后 `user.tags` 里 `userId` 还是 `null` | 只 `tag.save()` 了，没 `user.save()` 回填 | 见 5.4 第 3、4 步 |
| `foreign key constraint fails` | 存的 `userId` 在 user 表里不存在 | 先校验用户存在，或用 `onDelete: 'CASCADE'` 配合 |
| `Cannot read properties of null (reading 'tags')` | `findOne` 没查到，返回 `null` 还继续用 | 加 `if (!userInfo) return` 判空 |
| 启动时报 `Cannot access 'X' before initialization` | 两个实体文件互相 import 造成循环依赖 | 同上，用 `() => X`；必要时拆出公共类型文件 |

---

## 六、事务 Transaction

### 6.1 先从一笔转账说起

**生活化比喻**：

小满要给陈冠希转账 300 元。这件事在数据库里是**两步**：

1. 小满余额 −300
2. 陈冠希余额 +300

现在假设第 1 步成功了，第 2 步因为网络断了失败了。结果是什么？**小满少了 300 块，陈冠希没收到，钱凭空消失了。**

这绝对不能接受。所以我们需要一个机制：**这两步要么一起成功，要么一起失败退回原样**。这个机制就叫**事务（Transaction）**。

**专业定义**：事务是一组数据库操作的逻辑单元，这组操作要么全部提交成功（Commit），要么全部撤销回滚（Rollback），不存在"只做了一半"的状态。

### 6.2 事务的四大特性 ACID

原文完整介绍了这四个特性，是面试高频题，我们用"转账"这个例子一一对应：

| 特性 | 英文 | 大白话 | 用转账举例 |
|---|---|---|---|
| **原子性** | Atomicity | 要么全成，要么全不成，像一颗原子不可再分 | 扣钱和加钱绑在一起，任一失败全部撤销 |
| **一致性** | Consistency | 执行前后，数据都得是"合法状态" | 转账前后，两人余额总和不变 |
| **隔离性** | Isolation | 多个事务同时跑，互相不干扰 | 你转账时别人也在转账，两边金额不会串 |
| **持久性** | Duration / Durability | 提交了就永久保存，断电也不丢 | 提示"转账成功"后，服务器宕机数据也在 |

记忆口诀：**原子不半个、一致不变形、隔离不串台、持久不蒸发**。

### 6.3 方式一：`manager.transaction`（最常用）

TypeORM 提供了很简洁的事务 API。Repository 上有个 `.manager`，它的 `.transaction()` 接收一个回调函数，回调里拿到的 `manager` 是一个**专属这个事务的管理器**——用它做的所有操作，都在同一个事务里。

```typescript
// src/manger/manger.service.ts（节选）
async transferMoney(dto: transferMoneyDto) {
  try {
    // manager.transaction：开启事务，回调里的操作全在一个事务内
    // 回调正常 return → 自动 COMMIT 提交
    // 回调抛异常     → 自动 ROLLBACK 回滚
    return await this.money.manager.transaction(async (manager) => {
      // 第 1 步：查发起人
      const from = await manager.findOne(Manger, { where: { id: dto.fromId } })
      // 第 2 步：查接收人
      const to = await manager.findOne(Manger, { where: { id: dto.toId } })

      // 判空！不然下面 from.money 直接崩
      if (!from || !to) {
        // 抛错 → 触发自动回滚
        throw new Error('用户不存在')
      }

      // 第 3 步：校验余额
      if (from.money < dto.money) {
        // 余额不足不算"异常"，可以直接 return，事务会正常提交（但什么都没改）
        return { message: '转账失败：余额不足' }
      }

      // 第 4 步：扣钱（注意：一定要 await，否则语句可能还没执行事务就提交了）
      await manager.save(Manger, { id: dto.fromId, money: from.money - dto.money })
      // 第 5 步：加钱
      await manager.save(Manger, { id: dto.toId, money: to.money + dto.money })

      return { message: '转账成功' }
    })
  } catch (e) {
    // 捕获到异常说明已回滚，把原因告诉前端
    return { message: `转账失败：${e.message}` }
  }
}
```

**这段代码里有三个必须注意的点**（原文的写法其实有坑，我们修正了）：

| 坑 | 错误写法 | 为什么错 | 正确写法 |
|---|---|---|---|
| 没 `await` | `manager.save(...)` | 事务可能在 UPDATE 真正执行前就提交了，回滚也回滚不到它 | `await manager.save(...)` |
| 没判空 | `from.money` | `findOne` 查不到返回 `null`，直接崩 | 先 `if (!from \|\| !to) throw` |
| 用 Repository 而非 `manager` | `this.money.save(...)` | Repository 不在事务上下文里，等于另开连接，事务管不到它 | 事务内一律用 `manager.xxx` |

第三条尤其重要：**在 `transaction` 回调里，所有数据库操作都必须走回调参数 `manager`**，绝不能用外层的 `this.money`。否则就是"以为在事务里，其实在外面"，回滚时会漏。

### 6.4 方式二：QueryRunner（手动挡）

`manager.transaction` 是"自动挡"：进场自动 BEGIN，出错自动 ROLLBACK。但有些场景需要**手动控制时机**，比如：

- 要在事务中间查一下状态，根据结果决定要不要继续
- 要把事务对象传出去给别的函数复用
- 要精确控制 `commit` 的时机

这时用 `QueryRunner`（查询执行器）。

**生活化比喻**：`manager.transaction` 像**自动挡汽车**，你只管踩油门；`QueryRunner` 像**手动挡**，离合、挂挡都得自己来，灵活但容易熄火（忘 commit / 忘 release）。

```typescript
// QueryRunner 完整用法
async transferMoneyByRunner(dto: transferMoneyDto) {
  // 1. 从 DataSource 创建一个查询执行器
  const queryRunner = this.dataSource.createQueryRunner()

  // 2. 连接数据库（从连接池取一条连接）
  await queryRunner.connect()

  // 3. 开启事务
  await queryRunner.startTransaction()

  try {
    // 4. 事务内的所有操作都用 queryRunner.manager（注意不是 Repository！）
    const from = await queryRunner.manager.findOne(Manger, { where: { id: dto.fromId } })
    const to = await queryRunner.manager.findOne(Manger, { where: { id: dto.toId } })

    if (!from || !to) throw new Error('用户不存在')
    if (from.money < dto.money) throw new Error('余额不足')

    await queryRunner.manager.save(Manger, { id: dto.fromId, money: from.money - dto.money })
    await queryRunner.manager.save(Manger, { id: dto.toId, money: to.money + dto.money })

    // 5. 手动提交
    await queryRunner.commitTransaction()
    return { message: '转账成功' }
  } catch (e) {
    // 6. 出错手动回滚
    await queryRunner.rollbackTransaction()
    return { message: `转账失败：${e.message}` }
  } finally {
    // 7. 无论成功失败，必须释放连接！漏了会耗尽连接池，最终服务假死
    await queryRunner.release()
  }
}
```

`QueryRunner` 的三条铁律，记不住就背这三句：

1. **`startTransaction()` 之后必须配对 `commitTransaction()` 或 `rollbackTransaction()`**
2. **`finally` 里必须 `release()`**（这条最容易忘，后果最严重——连接池耗尽后所有请求卡死）
3. **中途所有操作必须用 `queryRunner.manager`**，别混用 Repository

要在 Service 里拿到 `DataSource`，注入一下即可：

```typescript
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, DataSource } from 'typeorm'

@Injectable()
export class MangerService {
  constructor(
    @InjectRepository(Manger) private readonly money: Repository<Manger>,
    // DataSource 是 TypeORM 0.3+ 的入口对象，forRoot 配好后可直接注入
    private readonly dataSource: DataSource,
  ) {}
}
```

### 6.5 两种事务写法对比（选哪个？）

| 对比项 | `manager.transaction()` | `QueryRunner` |
|---|---|---|
| 风格 | 自动挡，回调式 | 手动挡，命令式 |
| 提交/回滚 | 自动 | 必须手动 |
| 忘 `release` 的风险 | 无（框架自动释放） | **有，会耗尽连接池** |
| 控制粒度 | 粗（整个回调一个事务） | 细（可嵌套、可分阶段提交） |
| 代码量 | 少 | 多 |
| 适合场景 | 90% 的业务（转账、批量插入、级联保存） | 需要精细控制的复杂场景 |
| 推荐度 | **优先用这个** | 有明确需求时再用 |

**给你的选择建议**：先默认用 `manager.transaction()`。只有当你要"把事务对象传给另一个 Service 复用"或者"中途需要根据中间结果决定提交还是回滚"时，才换 `QueryRunner`。

### 6.6 完整可运行代码：manger 模块

**① DTO**

```typescript
// src/manger/dto/create-manger.dto.ts
export class CreateMangerDto {
  name: string
  money: number
}

// 转账专用 DTO：谁转给谁，转多少
export class transferMoneyDto {
  fromId: number // 发起人 id
  toId: number // 接收人 id
  money: number // 转账金额
}
```

**② 实体**

```typescript
// src/manger/entities/manger.entity.ts
import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm'

@Entity()
export class Manger {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 50 })
  name: string

  // 金额用 decimal 更严谨；这里保留原文的 number 写法便于对照
  // 真实项目建议：@Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  @Column({ type: 'int', default: 0 })
  money: number
}
```

**③ Controller**

```typescript
// src/manger/manger.controller.ts
import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common'
import { MangerService } from './manger.service'
import { CreateMangerDto, transferMoneyDto } from './dto/create-manger.dto'
import { UpdateMangerDto } from './dto/update-manger.dto'

@Controller('manger')
export class MangerController {
  constructor(private readonly mangerService: MangerService) {}

  // 创建账户：POST /manger
  @Post()
  create(@Body() createMangerDto: CreateMangerDto) {
    return this.mangerService.create(createMangerDto)
  }

  // 转账：POST /manger/transferMoney
  @Post('/transferMoney')
  transferMoney(@Body() dto: transferMoneyDto) {
    return this.mangerService.transferMoney(dto)
  }

  @Get()
  findAll() {
    return this.mangerService.findAll()
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.mangerService.findOne(+id)
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateMangerDto: UpdateMangerDto) {
    return this.mangerService.update(+id, updateMangerDto)
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.mangerService.remove(+id)
  }
}
```

**④ Service**（完整版，含事务）

```typescript
// src/manger/manger.service.ts
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { CreateMangerDto, transferMoneyDto } from './dto/create-manger.dto'
import { UpdateMangerDto } from './dto/update-manger.dto'
import { Manger } from './entities/manger.entity'

@Injectable()
export class MangerService {
  constructor(
    @InjectRepository(Manger) private readonly money: Repository<Manger>,
  ) {}

  // 创建账户，顺便给点初始余额方便测试
  create(createMangerDto: CreateMangerDto) {
    return this.money.save(createMangerDto)
  }

  // 核心：事务转账
  async transferMoney(dto: transferMoneyDto) {
    try {
      return await this.money.manager.transaction(async (manager) => {
        const from = await manager.findOne(Manger, { where: { id: dto.fromId } })
        const to = await manager.findOne(Manger, { where: { id: dto.toId } })

        if (!from || !to) throw new Error('账户不存在')
        if (from.money < dto.money) return { message: '转账失败：余额不足' }

        await manager.save(Manger, { id: dto.fromId, money: from.money - dto.money })
        await manager.save(Manger, { id: dto.toId, money: to.money + dto.money })

        return { message: '转账成功' }
      })
    } catch (e) {
      return { message: `转账失败：${e.message}` }
    }
  }

  // 查所有账户，确认转账结果
  findAll() {
    return this.money.find()
  }

  findOne(id: number) {
    return this.money.findOne({ where: { id } })
  }

  update(id: number, updateMangerDto: UpdateMangerDto) {
    return this.money.update(id, updateMangerDto)
  }

  remove(id: number) {
    return this.money.delete(id)
  }
}
```

**⑤ 验证事务真的生效了**（手动实验，强烈建议做一次）

在这个实验里，我们故意让第二步出错，看第一步会不会被回滚：

```typescript
// 临时改造：在扣完钱后主动抛错，验证"扣钱"这一步是否被回滚
await manager.save(Manger, { id: dto.fromId, money: from.money - dto.money })
throw new Error('故意抛错，测试回滚') // ← 临时加这行
await manager.save(Manger, { id: dto.toId, money: to.money + dto.money })
```

预期结果：接口返回"转账失败"，并且**再查数据库，两人余额都没变**。这说明第一条 UPDATE 被成功回滚了——事务生效。

实验完记得把这行删掉。

### 6.7 常见错误（事务阶段）

| 报错原文（节选） | 原因 | 解决 |
|---|---|---|
| 事务"看起来没生效"，数据还是改了 | 事务内用了 `this.xxxRepository.save()` 而不是 `manager.save()` | 回调里一律用 `manager` |
| `Cannot read properties of null (reading 'money')` | `findOne` 返回 `null` 就取属性 | 先判空再取 |
| 报错 `Query runner already released` | `release()` 之后还在用 `queryRunner` | 把释放放到 `finally` 最后一步 |
| 并发时出现"连接池已满 / 请求卡死" | `QueryRunner` 忘记 `release()` | 必加 `try/finally` |
| 事务里报错但余额已经改了 | 忘记 `await` 异步的 `save()` | 每个数据库操作都 `await` |
| 高并发下余额变成负数（超卖/超扣） | 先查后改，中间被其他事务插入 | 用 `manager.increment()` 原子操作，或用悲观锁 `lock: { mode: 'pessimistic_write' }` |
| `Transaction is not started` | `QueryRunner` 只 `connect()` 没 `startTransaction()` | 补上 `startTransaction()` |
| `Nest can't resolve dependencies of the MangerService` | 忘了 `forFeature([Manger])` 或漏注入 `DataSource` | 补 `imports`，检查构造函数 |

---

## 七、知识地图与检查清单

### 7.1 一张图串起全篇

```
                    ┌──────────────────────┐
                    │   第 24 章：连接      │
                    │   TypeOrmModule      │
                    │   .forRoot({...})    │  ← 建立连接（一次）
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │   第 25 章：实体      │
                    │   @Entity / @Column  │  ← 定义表结构（图纸）
                    │   @PrimaryGenerated… │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │   第 26 章：Repository│
                    │   forFeature + 注入   │  ← 能操作表（管理员）
                    │   save/find/update/…  │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │   第 27 章：关系      │
                    │   OneToMany/ManyToOne│  ← 表与表关联（分表）
                    │   ManyToMany/relations│
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │   第 28 章：事务      │
                    │   manager.transaction│  ← 保证不半途而废
                    │   QueryRunner        │
                    └──────────────────────┘
```

一句话串起来：**先连库（forRoot）→ 画图纸（Entity）→ 派管理员（Repository）→ 让表联手（relations）→ 给操作上保险（事务）**。

### 7.2 上机检查清单（照着打勾）

- [ ] 装了 `@nestjs/typeorm typeorm mysql2` 三个包
- [ ] MySQL 里已经建好空数据库（TypeORM 不会帮你建库）
- [ ] `forRoot` 里 `type/host/port/username/password/database` 六项填对
- [ ] 开发环境 `synchronize: true`，生产环境**改回 `false`**
- [ ] `tsconfig.json` 里 `experimentalDecorators` 和 `emitDecoratorMetadata` 都是 `true`
- [ ] `main.ts` 第一行有 `import 'reflect-metadata'`
- [ ] 业务 Module 里写了 `TypeOrmModule.forFeature([实体])`
- [ ] Service 构造函数用 `@InjectRepository(实体)` 注入
- [ ] Service 里**没有** `new Repository()`（Repository 必须靠注入）
- [ ] 分页 `skip` 用的是 `(page - 1) * pageSize`
- [ ] `page`/`pageSize` 从 `@Query` 拿到后转成了数字
- [ ] 粉丝表/子表的外键用 `@JoinColumn` 标在"多"的一侧
- [ ] 关联查询加了 `relations: ['xxx']`
- [ ] 事务回调里所有操作都用 `manager.xxx`，且每个都 `await`
- [ ] `QueryRunner` 在 `finally` 里 `release()`
- [ ] 金额字段用 `decimal`，不用 `float`

### 7.3 本篇小结

| 要点 | 一句话说明 |
|---|---|
| 数据库的作用 | 让数据持久化到硬盘，断电不丢；还提供索引、并发控制、事务 |
| 关系型数据库四要素 | 库 → 表 → 列/行 → 主键，加外键就能让表之间产生关联 |
| ORM 是什么 | Object Relational Mapping，把表映射成类、把行映射成对象，你写对象它翻 SQL |
| TypeORM 是谁 | NestJS 生态最主流的 TypeScript ORM，用装饰器描述表结构 |
| 装三个包 | `@nestjs/typeorm`（集成层）、`typeorm`（本体）、`mysql2`（驱动） |
| 必须先建库 | TypeORM 只会建表，不会建数据库 |
| `forRoot` 用在哪 | 全局 `AppModule` 里注册一次，负责建立数据库连接 |
| `forFeature` 用在哪 | 各业务 Module 里，负责把某实体的 Repository 注册进依赖注入容器 |
| `synchronize: true` 的风险 | 表结构会跟着实体自动改，生产环境可能直接删列丢数据，生产必须 `false` |
| `autoLoadEntities` | 自动收集 `forFeature` 注册的实体，替代 `entities` 通配字符串 |
| 实体 Entity | 映射到数据库表的类，用 `@Entity()` 标记，属性对应列 |
| `@PrimaryGeneratedColumn` | 自动生成主键：默认自增数字，传 `'uuid'` 生成 UUID 字符串 |
| `@PrimaryColumn` | 主键值要自己给（如手机号），不自动生成 |
| `@Column` 只写空括号 | 类型按 TS 类型自动推断（`string`→`varchar`、`number`→`int`） |
| 常用列选项 | `type`/`length`/`nullable`/`default`/`unique`/`comment`/`select`/`update` |
| `select: false` 的用途 | 默认查询不带该列，用来藏密码，需要时单独取 |
| `simple-array` | 把字符串数组按逗号拼接存在一个普通字符串列里 |
| `simple-json` | 把对象 `JSON.stringify` 后存在一个字符串列里 |
| `@Generated('uuid')` | 给非主键字段自动生成 uuid |
| `enum` 列 | 值只能取预设列表之一，改选项需改表结构 |
| Repository | 绑定单个实体的数据访问对象，由 TypeORM 生成、NestJS 注入 |
| 注入三步 | 定义实体 → `forFeature` 注册 → `@InjectRepository` 注入，缺一必报错 |
| `save` vs `update` | `save` 走钩子、能带关联但多一次查询；`update` 直发 UPDATE、更快 |
| 分页三参数 | `skip: (page-1)*pageSize`、`take: pageSize`、配 `count` 拿总数 |
| 模糊查询 | 用 `Like('%关键词%')`，别自己拼 SQL 字符串（防注入） |
| 一对多的外键放哪 | 永远放在"多"的那一侧（`tags.userId`），配 `@JoinColumn()` |
| `@OneToMany` 有实体列吗 | 没有，它只是关系声明，数据库里不产生列 |
| `relations` 的作用 | `find()` 默认只查主表，要关联数据必须显式写 `relations: ['tags']` |
| 多对多怎么存 | 必须靠中间表；`@JoinTable()` 只写在拥有方一侧 |
| 事务为什么需要 | 一组操作要么全成功要么全回滚，避免"扣了钱没到账" |
| ACID | 原子性、一致性、隔离性、持久性（原子不半个、一致不变形、隔离不串台、持久不蒸发） |
| `manager.transaction` | 回调式自动事务，正常返回即提交、抛异常即回滚，首选方案 |
| 事务内的铁律 | 全部操作必须用回调参数 `manager`，且每个都要 `await` |
| `QueryRunner` | 手动挡事务：`connect` → `startTransaction` → `commit/rollback` → **`release`** |
| `release()` 不能漏 | 漏了会耗尽连接池，最终所有请求卡死 |
| 金额用什么类型 | `decimal`，别用 `float`/`double`（有精度误差） |
| 本篇与前后篇的关系 | 前面 03 篇的 Module/Service/Controller 提供骨架，07 篇的 DTO 校验入参，这一篇让数据真正落地 |
*（内容由AI生成，仅供参考）*
