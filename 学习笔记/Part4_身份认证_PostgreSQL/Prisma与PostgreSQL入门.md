

# Prisma + PostgreSQL 入门：它们是什么，能干什么

> 前置背景：前面学身份认证（Session / JWT）时，用户信息、密码、登录记录总得存在某个地方。内存变量一重启就没了，所以我们要一个真正的数据库 —— **PostgreSQL**；而直接写 SQL 又容易出错，于是有了 **Prisma** 这层"翻译官"。

---

# 一、先分清两者的角色

用一句话概括：

- **==PostgreSQL = 数据库（存数据的地方）==**
- **==Prisma = ORM 工具（用代码去操作数据库的方式）==**

类比：

| 类比 | PostgreSQL | Prisma |
| --- | --- | --- |
| 仓库 | 真正存放货物的仓库 | —— |
| 仓库管理员 | —— | 帮你搬货、记账、查货的那位 |
| 点餐 | 厨房（数据库） | 服务员（Prisma）：你用人话点菜，他翻译成厨房能懂的单子 |

你在 Node.js 里写 `prisma.user.findMany()`，Prisma 把它翻译成 `SELECT * FROM "User";` 发给 PostgreSQL 执行，再把结果转成 JS 对象返回给你。

---

# 二、PostgreSQL 是什么

## 1. 概念

PostgreSQL（简称 **Postgres** / **PG**）是一个**开源的==关系型==数据库管理系统**（Relational Database Management System，RDBMS）。

- **开源的**：免费、可商用，不像 Oracle 要授权费。
- **关系型**：数据存在"表（table）"里，表由行（记录）和列（字段）组成，表之间可以通过外键建立关系。
- **管理系统**：它不只是一个文件，而是一个常驻后台的服务（进程），你通过客户端连上去发指令。

## 2. 它有什么用

| 用途 | 说明 |
| --- | --- |
| **持久化存储** | 数据写到磁盘，服务重启、机器重启都不丢 |
| **结构化查询** | 用 SQL 按条件筛选、排序、分组、统计 |
| **保证数据正确性** | 主键唯一、非空约束、外键约束、事务（ACID），不会出现"半个用户"这种脏数据 |
| **并发访问** | 多个请求同时读写，数据库负责加锁和隔离，不打架 |
| **权限管理** | 不同账号有不同的库/表权限 |

## 3. 为什么身份认证场景会选它

- 用户表需要**唯一约束**（手机号/邮箱不能重复）→ PG 原生支持。
- 登录、注册、改密码往往涉及**多步写操作**（写用户 + 写日志），需要**事务**保证要么全成功要么全回滚。
- 用户和"角色""登录记录""订单"之间是**关系**，关系型数据库天生擅长 JOIN。
- 生态成熟：云厂商（Supabase、Neon、阿里云 RDS 等）都支持，本地也能一键 Docker 起。

## 4. 和其他数据库的粗略对比

| 数据库 | 类型 | 特点 | 适合场景 |
| --- | --- | --- | --- |
| **PostgreSQL** | 关系型 | 功能最全、标准 SQL、支持 JSON、扩展性强 | 通用业务系统、需要复杂查询和强一致 |
| MySQL | 关系型 | 国内 Web 项目常见、上手快 | 传统 Web、CMS、简单业务 |
| SQLite | 关系型（文件型） | 零配置，一个文件就是一个库 | 本地开发、小工具、移动端 |
| MongoDB | 文档型（NoSQL） | 存 JSON 文档，字段灵活 | 结构不固定的大数据量场景 |

> 学习阶段如果用 Docker / 云数据库都不方便，可以先用 **SQLite** 跑通 Prisma 的流程，代码几乎一样，只需改 `provider` 与连接串 —— 因为 Prisma 帮你屏蔽了底层差异，这正是它的价值之一。

---

# 三、Prisma 是什么

## 1. 概念

Prisma 是 Node.js / TypeScript 生态里的 **ORM（Object-Relational Mapping，对象关系映射）** 工具。

- **ORM 的含义**：把数据库里的"表"映射成代码里的"对象/类"。表 `User` 对应模型 `User`，一行记录对应一个对象，一列对应一个属性。
- 你不再手写 SQL 字符串，而是调用方法，由 Prisma 生成 SQL。

```ts
// 你写的
const user = await prisma.user.findUnique({ where: { email } });

// Prisma 生成的（大致）
// SELECT * FROM "User" WHERE "email" = $1 LIMIT 1;
```

## 2. 它有什么用（解决了什么痛点）

| 痛点（手写 SQL） | Prisma 的做法 |
| --- | --- |
| SQL 是字符串，写错只能在运行时炸 | **类型安全**：字段名、参数都有 TS 类型提示，写错编译期就报错 |
| 拼接 SQL 容易被** SQL 注入** | 内部使用**参数化查询**，参数不会被当成 SQL 执行 |
| 表结构改了，代码里的 SQL 全要手改 | 改 `schema.prisma` 后重新生成，客户端自动同步 |
| 建表、改表要自己写 DDL 脚本 | **Prisma Migrate** 对比 schema 自动生成迁移 SQL |
| 查询结果要手动映射成对象 | 直接返回 JS/TS 对象，关系数据可嵌套返回 |

## 3. Prisma 的三块核心组成

| 组成 | 作用 | 对应文件/命令 |
| --- | --- | --- |
| **Prisma Schema** | 唯一的"数据模型说明书"：数据源、生成器、模型定义 | `prisma/schema.prisma` |
| **Prisma Client** | 自动生成的查询客户端，代码里 `import { PrismaClient }` 用的就是它 | `npx prisma generate` |
| **Prisma Migrate** | 根据 schema 生成迁移文件并同步到数据库 | `npx prisma migrate dev` |

一句话记忆：**先写说明书（schema）→ 生成客户端（Client）→ 用客户端增删改查**。

---

# 四、最小上手流程

## 1. 准备一个 PostgreSQL

方式任选其一：

```bash
# 方式 A：Docker 起一个（推荐）
docker run --name pg-dev -e POSTGRES_PASSWORD=123456 -p 5432:5432 -d postgres

# 方式 B：本机安装 PostgreSQL 后，用 psql 连进去建库
createdb myapp
```

## 2. 在项目里安装 Prisma

```bash
npm init -y
npm install prisma --save-dev
npm install @prisma/client
npx prisma init --datasource-provider postgresql
```

执行后会自动生成 `prisma/schema.prisma` 和 `.env`。

## 3. 配置连接串（.env）

```ini
# postgresql://用户名:密码@主机:端口/数据库名?schema=public
DATABASE_URL="postgresql://postgres:123456@localhost:5432/myapp?schema=public"
```

> `.env` 里是凭据，**必须写进 `.gitignore`**，绝不能提交到 Git。这里只是本地学习用的示例密码，真实项目不要用弱口令。

## 4. 定义模型（prisma/schema.prisma）

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// 用户表：身份认证最核心的一张表
model User {
  id        Int      @id @default(autoincrement())   // 主键，自增
  email     String   @unique                          // 唯一，不能重复注册
  username  String
  password  String                                    // 存的是哈希后的密码，绝不存明文
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt                       // 每次更新自动写入时间
}
```

关键点：

- `@id` 标主键，`@default(autoincrement())` 自增；
- `@unique` 生成唯一索引，数据库层面拦住重复邮箱；
- `@updatedAt` 由 Prisma 自动维护，不用手写。

## 5. 建表 + 生成客户端

```bash
npx prisma migrate dev --name init
```

这一条命令做了三件事：生成迁移 SQL 文件 → 在数据库里执行建表 → 重新生成 Prisma Client。

> 想先可视化看看表结构，可以跑 `npx prisma studio`，浏览器里打开一个数据库管理界面。

## 6. 在代码里增删改查

```ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 增：注册一个新用户
  const user = await prisma.user.create({
    data: {
      email: 'tom@example.com',
      username: 'tom',
      password: 'hashed_password_here',
    },
  });

  // 查：按唯一字段查单条（登录时的主要动作）
  const found = await prisma.user.findUnique({
    where: { email: 'tom@example.com' },
  });

  // 改：修改用户名
  await prisma.user.update({
    where: { id: user.id },
    data: { username: 'tom_new' },
  });

  // 删
  await prisma.user.delete({ where: { id: user.id } });

  console.log(found);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

注意最后的 `$disconnect()`：脚本结束时断开连接，否则进程可能挂着不退出。

---

# 五、放到身份认证场景里看

学完前面认证章节后，这张表几乎是必写的：

```prisma
model User {
  id           Int      @id @default(autoincrement())
  email        String   @unique
  passwordHash String                      // bcrypt 加密后的密码
  role         Role     @default(USER)     // 关联角色表
  sessions     Session[]                   // 一个用户多个登录会话（Session 方案用）
  createdAt    DateTime @default(now())
}

model Session {
  id        String   @id          // 会话 ID（也可以存 refresh token 的哈希）
  userId    Int
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  createdAt DateTime @default(now())
}

enum Role {
  USER
  ADMIN
}
```

这张 schema 已经说明了三件事：

1. **用户唯一性**由 `email @unique` 保证 → 重复注册会在数据库层报错，业务层捕获 `P2002` 错误码即可返回"邮箱已注册"。
2. **密码安全**：只存哈希（`passwordHash`），登录时比对哈希而不是解密明文。
3. **Session 落库**：把会话存表里，用户登出 / 过期清理都可控，多台服务器也能共享登录态（不像内存 Session 只在一台机器上有效）。

JWT 方案下也常建表存**刷新令牌（refresh token）**，思路完全一样。

---

# 六、常见坑与小贴士

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `Can't reach database server` | PG 没启动 / 端口密码错 | 检查 Docker 容器是否在跑、`DATABASE_URL` 是否正确 |
| `Unique constraint failed on the fields: (email)` | 违反 `@unique`，Prisma 抛 `P2002` | 业务代码 try/catch，返回友好提示 |
| 改了 schema 但代码没提示新字段 | 没重新生成客户端 | 再跑一次 `npx prisma generate`（`migrate dev` 会自动执行） |
| 生产环境误用 `migrate dev` | 它可能重置数据 | 生产用 `prisma migrate deploy`（只执行已有迁移，不重置） |
| 每个请求都 `new PrismaClient()` | 连接数暴涨 | 全局单例（Next.js 建议挂到 `globalThis` 上复用） |
| 把 `.env` 提交到 Git | 泄露数据库密码 | 加入 `.gitignore`，密钥用环境变量注入 |

---

# 七、术语速查

| 术语 | 英文 / 全称 | 一句话解释 |
| --- | --- | --- |
| 关系型数据库 | Relational Database | 用表 + 关系组织数据的数据库 |
| 主键 | Primary Key | 唯一标识一行的字段，如 `id` |
| 外键 | Foreign Key | 指向另一张表主键的字段，用来建立关联 |
| 索引 | Index | 加速查询的数据结构，`@unique` 会自带唯一索引 |
| 事务 | Transaction (ACID) | 一组操作要么全成功、要么全回滚 |
| ORM | Object-Relational Mapping | 把表和对象互相映射的工具 |
| 迁移 | Migration | 描述"表结构怎么变"的版本化脚本 |
| 数据源 | datasource | Prisma schema 里声明连哪个数据库、用哪个地址 |
| 参数化查询 | Parameterized Query | 把参数与 SQL 语句分离，天然防注入 |

---

# 八、小结

- **PostgreSQL** 负责"把数据安全、持久、正确地存起来"，关系型 + 强约束 + 事务是它在身份认证场景的底气。
- **Prisma** 负责"让你用 JS/TS 的方式舒服地操作数据库"，核心价值是**类型安全 + 自动生成 + 迁移管理 + 防注入**。
- 工作流固定：**设计 schema → migrate 建表 → generate 客户端 → 代码里 CRUD**。
- 学到这里，你已经有能力给认证系统接上真正的持久化存储：用户表、密码哈希、Session / Refresh Token 都能落地。

> 下一步可延伸：bcrypt 密码加密、JWT 签发与校验、Prisma 关联查询（`include` / 多表 JOIN）、中间件里做鉴权。
