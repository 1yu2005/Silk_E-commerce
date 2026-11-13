/** 文件作用：由OpenAPI自动生成，禁止手改；使用pnpm api-client:generate更新。生成器openapi-typescript 7.13.0。 */
export interface paths {
    "/api/v1/admin/auth/change-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 员工本人改密
         * @description 强制改密员工可访问。验证旧密码，新密码须不同；成功后撤销本人全部会话并要求重新登录，不返回新token。密码、会话和审计在同一事务提交。
         */
        post: operations["changeEmployeePassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 员工登录
         * @description 公开接口；账号规范化，密码保留原文。每IP每分钟30次，同账号与IP五分钟最多5次失败；在途验证预留名额，超限返回Retry-After秒数。
         */
        post: operations["loginEmployee"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/employees": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询员工列表
         * @description 仅employee.read可用，先校验权限再校验参数。关键词去首尾空白，账号/显示名忽略大小写按文字包含匹配；%与_不作为通配符。createdAt倒序、id倒序稳定排序；不查询逐人权限。总数和本页数据使用同一读取快照。
         */
        get: operations["listEmployees"];
        put?: never;
        /**
         * 创建员工（包括管理员）
         * @description 锁内重新校验操作者当前会话、强制改密与employee.create权限。新员工ACTIVE、version=0、必须首次改密，无额外权限或会话。创建与审计同事务；创建管理员先取得稳定锁，重复账号含并发冲突返回409。响应不回显初始密码，不提供创建请求幂等键，响应丢失请先查询核实。
         */
        post: operations["createEmployee"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/employees/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询员工详情与权限
         * @description 仅employee.read可用。无权请求在目标查询及UUID校验前403；有权请求的不存在目标404。返回公开资料、记录/权限版本和三组权限，可查看停用员工；不返回密码、哈希、token或会话。
         */
        get: operations["getEmployeeDetail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/employees/{id}/change-role": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 员工调岗
         * @description 稳定锁→员工ID升序锁，锁内重验身份/权限及目标版本；禁止降级最后一名ACTIVE超级管理员。真实换岗清空额外授权、递增version/permissionVersion，与审计及资格变更同事务；保留会话，旧token下一请求按新岗位执行。同岗位且版本匹配changed=false并保留授权，旧版本仍409。响应丢失先刷新核实。 员工写入前合并全部失资格任务的完整业务锁；任务回池、领域经办同步、历史及审计与员工变更同事务，失败整体回滚。锁集合变化整笔最多重试3次。
         */
        post: operations["changeEmployeeRole"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/employees/{id}/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 停用员工
         * @description 稳定锁→员工ID升序锁，锁内重验操作者及版本；禁止停用最后一名ACTIVE超级管理员。状态变为DISABLED，version/tokenVersion递增、全部会话撤销、审计和资格变更入口同事务；同状态匹配版本changed=false，旧版本仍409。 员工写入前合并全部失资格任务的完整业务锁；任务回池、领域经办同步、历史及审计与员工变更同事务，失败整体回滚。锁集合变化整笔最多重试3次。
         */
        post: operations["disableEmployee"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/employees/{id}/enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 启用员工
         * @description 沿用稳定锁、员工ID升序锁、最新身份和版本校验。启用仅改状态/version并同事务审计及资格变更，不恢复旧会话或清除强制改密；需重新登录。同状态匹配版本changed=false，旧版本仍409。
         */
        post: operations["enableEmployee"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/employees/{id}/extra-permissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * 替换员工个人额外权限
         * @description 按员工ID升序锁定并重验当前身份/权限及目标版本，超级管理员目标不适用（包括空集合）。服务端解析依赖，实际变化递增version/permissionVersion，授权差集、审计、资格入口同事务；保留会话，旧token下一请求读取新权限。同集合匹配版本changed=false，旧版本409。响应丢失先刷新详情核实，前端须保留完整解析集合再编辑。 员工写入前合并全部失资格任务的完整业务锁；任务回池、领域经办同步、历史及审计与员工变更同事务，失败整体回滚。锁集合变化整笔最多重试3次。
         */
        put: operations["replaceEmployeeExtraPermissions"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/employees/{id}/profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * 修改员工显示名
         * @description 仅接受显示名、当前version及原因；管理员可修改本人或他人，支持停用目标。按ID升序锁操作者与目标，锁内复核当前身份及权限后检查版本。仅修改显示名及version并同事务审计；同名且版本匹配200返回当前资料，不递增/重复审计，旧版本始终409。不会改岗位、状态、密码、权限或撤销会话。
         */
        patch: operations["updateEmployeeProfile"];
        trace?: never;
    };
    "/api/v1/admin/employees/{id}/reset-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 管理员重置其他员工密码
         * @description 操作者和目标按ID升序锁定，锁内重验身份/权限及目标版本；不能重置本人。新哈希、强制改密、version/tokenVersion递增、撤销全部会话与审计同事务，不回显密码。目标启停、岗位和授权保留，临时密码登录后须改密再重新登录。旧版本409，响应丢失先刷新核实，不自动重提。
         */
        post: operations["resetEmployeePassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取当前员工
         * @description 使用当前数据库身份快照；强制改密员工可访问。只返回白名单摘要，不返回token、密码、版本或额外授权。
         */
        get: operations["getEmployeeMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/me/permissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取本人当前权限
         * @description 员工完成改密后可用，无需管理员权限。按同一当前身份快照返回岗位默认、个人额外和最终权限；不从token或客户端读取权限，不自动补发依赖，不修改授权或会话。
         */
        get: operations["getEmployeeMePermissions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/permissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询固定权限目录与岗位模板
         * @description 仅employee.read可用，强制改密员工禁止访问。无业务输入，不支持过滤或修改；查询参数不会改变目录。返回代码配置中的权限、管理员专属标识、直接依赖及三岗位模板，各码数组稳定排序。目录读取不额外查库，不自动seed或授权；认证仍校验当前数据库身份。
         */
        get: operations["getPermissionCatalog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询当前全店设置
         * @description 仅管理员store.setting.manage可用；未配置时configured=false、version=0、currentSetting=null。完整配置包含地址和内部期限，不向普通员工或顾客开放。
         */
        get: operations["getStoreSettings"];
        /**
         * 完整替换全店设置并追加版本
         * @description 金额为整数分，期限为正整数且单位固定；严格boolean与嵌套字段白名单。文本去首尾空白，电话移除空格和连字符。先锁员工再锁Head，锁内复核身份和管理员权限。expectedVersion过期始终409；同内容且版本匹配changed=false、不新增版本/审计；变化时版本、指针和审计同事务提交。仅影响之后新阶段，旧版本和已固化期限不回写。
         */
        put: operations["updateStoreSettings"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/settings/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 分页查询全店设置版本摘要
         * @description 版本编号倒序；总数和本页使用一致快照。只返回ID、编号、修改人ID、时间和原因；完整配置由详情接口读取。
         */
        get: operations["listStoreSettingVersions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/settings/versions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询全店设置历史版本
         * @description 仅管理员可查完整历史与修改原因；不存在版本404。已保存的旧配置不随现值变化。
         */
        get: operations["getStoreSettingVersion"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 分页查询本人任务、合资格岗位池或管理员待安排
         * @description 默认mine，仅当前本人经办；pool仅当前完整资格且OPEN；reassign须管理员task.transfer。所有范围还需真实业务读取权。按截止升序、无截止在后、创建时间/ID稳定排序；overdue为当前未终结任务是否到期。
         */
        get: operations["listTasks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/tasks/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询任务、期限快照及裁剪后的业务摘要
         * @description 业务读取权并满足当前资格/当前或历史经办/管理员范围；不可查看与不存在均404。allowedActions仅提示，提交仍重新检查当前权限、任务版本和真实业务允许条件。
         */
        get: operations["getTaskDetail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/tasks/{id}/claim": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 原子领取本人任务
         * @description 锁员工、完整业务、游标和任务后复核当前身份、全部资格、业务允许条件和版本。重复原expectedVersion仅在当前仍为该主体最后一次领取结果时changed=false；释放或再领取后旧请求冲突。
         */
        post: operations["claimTask"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/tasks/{id}/extend-deadline": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 管理员延期或首次指定人工任务截止
         * @description 仅SUPER_ADMIN且deadline.extend，真实领域适配器必须允许并同步合法领域截止。新截止须为ISO UTC且晚于当前截止和现在；不改付款、售后申请窗口、自动收货或交运事实。保留原截止、经办、状态和轮次；旧截止已到（含等号）先补记OVERDUE，再写EXTENDED或DEADLINE_ASSIGNED及历史/审计，全部同事务。终结拒绝；暂停是否允许由领域决定，延期不会恢复任务。同主体/旧版本/原因/规范化截止的最后成功结果changed=false，仍复核身份和领域资格。
         */
        post: operations["extendTaskDeadline"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/tasks/{id}/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 分页查询任务动作与期限事件统一时间线
         * @description 与详情使用同一业务读取范围，旧经办不替代当前业务读取权。occurredAt降序、kind/id升序稳定分页；原因按业务权限隐藏，响应不包含全店审计、员工账号或凭证。
         */
        get: operations["getTaskHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/tasks/{id}/release": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 本人安全释放任务并保留轮次和期限
         * @description 当前经办且真实业务确认可安全交接才释放，原因必填。同主体、同expectedVersion、同规范化原因的最后一次成功释放可以重放；不借释放恢复暂停任务。
         */
        post: operations["releaseTask"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/tasks/{id}/transfer": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 管理员显式指派或安全转交任务
         * @description 仅SUPER_ADMIN且task.transfer；目标须启用、已改密且满足完整资格。OPEN可指派，CLAIMED可转交，暂停/终结不可转交。按完整锁序复核并与真实领域交接、历史、审计同事务；保留轮次与期限。同主体/旧版本/目标/原因的最后成功结果可幂等重放。
         */
        post: operations["transferTask"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/tasks/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询本人待办、岗位池及逾期摘要
         * @description 各卡片可重叠。逾期仅统计本人可读任务：当前逾期为未终结且now>=dueAt；历史曾逾期含持久事实或当前已到期。普通员工待安排数为null；无真实业务范围时返回真实零值。
         */
        get: operations["getTaskSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 注销当前设备
         * @description 员工和顾客共用，强制改密员工可用。仅撤销当前sid；签名、归属、会话版本和期限仍须有效，已撤销sid幂等返回成功并保留原事实。首次撤销与审计同事务，其它设备不受影响；不返回token。
         */
        post: operations["logoutCurrentSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 上传一张受控图片
         * @description multipart先添加purpose再添加file；其它字段、多文件拒绝。JPEG/PNG/WebP单图最大5MiB，宽高各≤10000、总像素≤4000万，不接受动画。真实解码重编码并去除元数据。用途决定业务权限；每主体默认20次/分钟、100张未绑定配额。STAGED固定私有，24小时到期，上传不等于绑定业务。
         */
        post: operations["uploadImage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取有权访问的安全图片元数据
         * @description 始终需要有效会话和文件权限；不公开storageKey、上传者、摘要或原文件名。无权与不存在均404。
         */
        get: operations["getFileMetadata"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取图片内容
         * @description 仅已有效公开的头像或商品图允许匿名；私有图需Bearer且按当前业务授权，上传者不永久放行。私有响应private,no-store；无权404，有权但磁盘丢失503。URL不得携带token。
         */
        get: operations["getFileContent"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/health/live": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 检查API进程存活
         * @description 不查询数据库，不接收业务参数。
         */
        get: operations["getLiveness"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/health/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 检查数据库就绪
         * @description 通过有界超时的SELECT 1检查数据库连接；不代表迁移已全部应用。
         */
        get: operations["getReadiness"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/store/auth/change-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 顾客本人改密
         * @description 验证旧密码，新密码须不同且保留原文；NORMAL和TRADE_RESTRICTED可用。锁本人后重验会话和密码快照，密码/令牌版本/全部会话撤销/审计同事务，成功须重新登录，不返回token。
         */
        post: operations["changeCustomerPassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/store/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 顾客登录
         * @description 公开；每实际来源IP每分钟30次，同规范化手机号及IP每5分钟最多5次失败，在途请求预留名额。正确密码后锁顾客复核哈希/版本/状态，同事务创建会话与更新登录时间。NORMAL和TRADE_RESTRICTED可登录；LOGIN_FROZEN拒绝。
         */
        post: operations["loginCustomer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/store/auth/register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 顾客注册
         * @description 公开接口；每实际来源IP每分钟5次，格式错误也计数，超限429及Retry-After。手机号唯一，注册不自动登录、不发送短信、不代表已验证手机号所有权。顾客与最小审计同事务，失败全部回滚。响应丢失先尝试登录核实，不覆盖已有账号。
         */
        post: operations["registerCustomer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/store/contact": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 公开查询店铺服务联系方式
         * @description 无需登录。仅返回configured、servicePhone、serviceHours和settingsVersion；未配置时联系方式为null、版本0。不返回退货地址、内部期限、运费、修改人或原因。
         */
        get: operations["getStoreContact"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/store/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取当前顾客资料
         * @description 仅凭当前顾客会话查询本人；忽略客户端自报ID。NORMAL和TRADE_RESTRICTED可读取，冻结/撤销/到期会话拒绝。返回白名单资料及真实头像URL，无头像为null，不返回密码、内部版本或员工权限。
         */
        get: operations["getCustomerMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * 顾客本人修改昵称
         * @description 仅接受nickname，去首尾空白后1～40字符；NORMAL和TRADE_RESTRICTED可用。锁本人并重新认证，昵称和审计同事务；同名不重复更新或写审计。无客户端目标ID/版本；并发合法修改按主体锁顺序提交，响应保留当前真实头像。
         */
        patch: operations["updateCustomerMe"];
        trace?: never;
    };
    "/api/v1/store/me/avatar": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * 设置本人头像
         * @description 只接受本人上传且用途CUSTOMER_AVATAR的可绑定文件；顾客、引用、文件状态、审计同事务。相同头像changed=false；替换保留历史图片及公开URL。
         */
        put: operations["setCustomerAvatar"];
        post?: never;
        /**
         * 移除本人当前头像
         * @description 无业务请求体；重复移除changed=false。只清当前指针，不删除历史引用或已公开的旧图片。
         */
        delete: operations["removeCustomerAvatar"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: never;
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    changeEmployeePassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * Format: password
                     * @description 8～64个Unicode码点且UTF-8最多72字节，保留空格，不截断或归一化；新旧密码必须不同
                     */
                    newPassword: string;
                    /**
                     * Format: password
                     * @description 8～64个Unicode码点且UTF-8最多72字节，保留空格，不截断或归一化；新旧密码必须不同
                     */
                    oldPassword: string;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @enum {boolean} */
                            changed: true;
                            /** @enum {boolean} */
                            requireLogin: true;
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "INVALID_CREDENTIALS" | "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    loginEmployee: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * Format: password
                     * @description 8～64个Unicode码点且UTF-8最多72字节，保留首尾空格，不截断或归一化
                     * @example TempDemo#2026
                     */
                    password: string;
                    /**
                     * @description 去首尾空白并转小写后为字母开头，后接字母、数字或下划线
                     * @example service_a
                     */
                    username: string;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @description 仅登录成功返回的JWT，Authorize输入token本体 */
                            accessToken: string;
                            employee: {
                                displayName: string;
                                /** Format: uuid */
                                id: string;
                                mustChangePassword: boolean;
                                /** @enum {string} */
                                role: "SUPER_ADMIN" | "MERCH_WAREHOUSE" | "CUSTOMER_SERVICE";
                                /** @enum {string} */
                                status: "ACTIVE" | "DISABLED";
                                username: string;
                            };
                            /** Format: date-time */
                            expiresAt: string;
                            mustChangePassword: boolean;
                            /** @enum {string} */
                            tokenType: "Bearer";
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "INVALID_CREDENTIALS" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            429: {
                headers: {
                    /** @description 等待秒数 */
                    "Retry-After"?: number;
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "AUTH_RATE_LIMITED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    listEmployees: {
        parameters: {
            query?: {
                keyword?: string;
                page?: number;
                pageSize?: number;
                role?: "SUPER_ADMIN" | "MERCH_WAREHOUSE" | "CUSTOMER_SERVICE";
                status?: "ACTIVE" | "DISABLED";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            items: {
                                /** Format: date-time */
                                createdAt: string;
                                displayName: string;
                                /** Format: uuid */
                                id: string;
                                /** Format: date-time */
                                lastLoginAt: string | null;
                                mustChangePassword: boolean;
                                /** @enum {string} */
                                role: "SUPER_ADMIN" | "MERCH_WAREHOUSE" | "CUSTOMER_SERVICE";
                                /** @enum {string} */
                                status: "ACTIVE" | "DISABLED";
                                username: string;
                                version: number;
                            }[];
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            403: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FORBIDDEN" | "PASSWORD_CHANGE_REQUIRED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    createEmployee: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @description 去首尾空白，不能为空
                     * @example 客服甲
                     */
                    displayName: string;
                    /**
                     * Format: password
                     * @description 8～64个Unicode码点且UTF-8最多72字节；保留空格，不截断或归一化
                     * @example TempDemo#2026
                     */
                    initialPassword: string;
                    /**
                     * @description 去首尾空白，创建原因必填
                     * @example 新增客服测试账号
                     */
                    reason: string;
                    /** @enum {string} */
                    role: "SUPER_ADMIN" | "MERCH_WAREHOUSE" | "CUSTOMER_SERVICE";
                    /**
                     * @description 去首尾空白并转小写后为小写字母开头，后接小写字母、数字或下划线
                     * @example service_a
                     */
                    username: string;
                };
            };
        };
        responses: {
            201: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: date-time */
                            createdAt: string;
                            displayName: string;
                            /** Format: uuid */
                            id: string;
                            /** Format: date-time */
                            lastLoginAt: string | null;
                            mustChangePassword: boolean;
                            /** @enum {string} */
                            role: "SUPER_ADMIN" | "MERCH_WAREHOUSE" | "CUSTOMER_SERVICE";
                            /** @enum {string} */
                            status: "ACTIVE" | "DISABLED";
                            username: string;
                            version: number;
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            403: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FORBIDDEN" | "PASSWORD_CHANGE_REQUIRED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            409: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "USERNAME_EXISTS";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    getEmployeeDetail: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: date-time */
                            createdAt: string;
                            defaultPermissions: ("category.read" | "category.manage" | "product.read" | "product.cost.read" | "product.manage" | "product.publish" | "inventory.read" | "inventory.adjustment.create" | "inventory.adjustment.claim" | "inventory.adjustment.post" | "inventory.adjustment.void" | "inventory.source.manage" | "inventory.alert.manage" | "order.fulfillment.read" | "shipment.claim" | "shipment.pack" | "shipment.handover" | "shipment.tracking.correct" | "shipment.exception.manage" | "order.physical.check" | "inventory.order-exception.manage" | "after-sale.inspection.read" | "after-sale.receipt.record" | "after-sale.inspection.confirm" | "dashboard.read" | "order.service.read" | "communication.service.write" | "customer.read" | "after-sale.service.read" | "after-sale.review" | "after-sale.close" | "after-sale.return.follow" | "after-sale.refund.execute" | "after-sale.refund.retry" | "shipment.customer-confirm" | "offline-case.manage" | "customer.frozen.proxy" | "employee.read" | "employee.create" | "employee.profile.update" | "employee.status.manage" | "employee.password.reset" | "employee.role.change" | "employee.permission.manage" | "customer.status.manage" | "store.setting.manage" | "audit.read" | "order.unpaid.close" | "shipment.history.correct" | "after-sale.dispute.decide" | "deadline.extend" | "task.transfer")[];
                            displayName: string;
                            effectivePermissions: ("category.read" | "category.manage" | "product.read" | "product.cost.read" | "product.manage" | "product.publish" | "inventory.read" | "inventory.adjustment.create" | "inventory.adjustment.claim" | "inventory.adjustment.post" | "inventory.adjustment.void" | "inventory.source.manage" | "inventory.alert.manage" | "order.fulfillment.read" | "shipment.claim" | "shipment.pack" | "shipment.handover" | "shipment.tracking.correct" | "shipment.exception.manage" | "order.physical.check" | "inventory.order-exception.manage" | "after-sale.inspection.read" | "after-sale.receipt.record" | "after-sale.inspection.confirm" | "dashboard.read" | "order.service.read" | "communication.service.write" | "customer.read" | "after-sale.service.read" | "after-sale.review" | "after-sale.close" | "after-sale.return.follow" | "after-sale.refund.execute" | "after-sale.refund.retry" | "shipment.customer-confirm" | "offline-case.manage" | "customer.frozen.proxy" | "employee.read" | "employee.create" | "employee.profile.update" | "employee.status.manage" | "employee.password.reset" | "employee.role.change" | "employee.permission.manage" | "customer.status.manage" | "store.setting.manage" | "audit.read" | "order.unpaid.close" | "shipment.history.correct" | "after-sale.dispute.decide" | "deadline.extend" | "task.transfer")[];
                            extraPermissions: ("category.read" | "category.manage" | "product.read" | "product.cost.read" | "product.manage" | "product.publish" | "inventory.read" | "inventory.adjustment.create" | "inventory.adjustment.claim" | "inventory.adjustment.post" | "inventory.adjustment.void" | "inventory.source.manage" | "inventory.alert.manage" | "order.fulfillment.read" | "shipment.claim" | "shipment.pack" | "shipment.handover" | "shipment.tracking.correct" | "shipment.exception.manage" | "order.physical.check" | "inventory.order-exception.manage" | "after-sale.inspection.read" | "after-sale.receipt.record" | "after-sale.inspection.confirm" | "dashboard.read" | "order.service.read" | "communication.service.write" | "customer.read" | "after-sale.service.read" | "after-sale.review" | "after-sale.close" | "after-sale.return.follow" | "after-sale.refund.execute" | "after-sale.refund.retry" | "shipment.customer-confirm" | "offline-case.manage" | "customer.frozen.proxy" | "employee.read" | "employee.create" | "employee.profile.update" | "employee.status.manage" | "employee.password.reset" | "employee.role.change" | "employee.permission.manage" | "customer.status.manage" | "store.setting.manage" | "audit.read" | "order.unpaid.close" | "shipment.history.correct" | "after-sale.dispute.decide" | "deadline.extend" | "task.transfer")[];
                            /** Format: uuid */
                            id: string;
                            /** Format: date-time */
                            lastLoginAt: string | null;
                            mustChangePassword: boolean;
                            permissionVersion: number;
                            /** @enum {string} */
                            role: "SUPER_ADMIN" | "MERCH_WAREHOUSE" | "CUSTOMER_SERVICE";
                            /** @enum {string} */
                            status: "ACTIVE" | "DISABLED";
                            username: string;
                            version: number;
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            403: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FORBIDDEN" | "PASSWORD_CHANGE_REQUIRED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            404: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "EMPLOYEE_NOT_FOUND";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    changeEmployeeRole: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @description 使用刚查询到的version，必须为JSON数字
                     * @example 0
                     */
                    expectedVersion: number;
                    /**
                     * @description 去首尾空白，调岗原因必填
                     * @example 调整为商品与仓储岗位
                     */
                    reason: string;
                    /** @enum {string} */
                    role: "SUPER_ADMIN" | "MERCH_WAREHOUSE" | "CUSTOMER_SERVICE";
                };
            };
        };
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @description 同岗位且版本匹配为false，不清空授权、不重复更新或审计 */
                            changed: boolean;
                            /** @description 真实换岗清空；同岗位无变化保留现有额外授权 */
                            extraPermissions: ("category.read" | "category.manage" | "product.read" | "product.cost.read" | "product.manage" | "product.publish" | "inventory.read" | "inventory.adjustment.create" | "inventory.adjustment.claim" | "inventory.adjustment.post" | "inventory.adjustment.void" | "inventory.source.manage" | "inventory.alert.manage" | "order.fulfillment.read" | "shipment.claim" | "shipment.pack" | "shipment.handover" | "shipment.tracking.correct" | "shipment.exception.manage" | "order.physical.check" | "inventory.order-exception.manage" | "after-sale.inspection.read" | "after-sale.receipt.record" | "after-sale.inspection.confirm" | "dashboard.read" | "order.service.read" | "communication.service.write" | "customer.read" | "after-sale.service.read" | "after-sale.review" | "after-sale.close" | "after-sale.return.follow" | "after-sale.refund.execute" | "after-sale.refund.retry" | "shipment.customer-confirm" | "offline-case.manage" | "customer.frozen.proxy" | "employee.read" | "employee.create" | "employee.profile.update" | "employee.status.manage" | "employee.password.reset" | "employee.role.change" | "employee.permission.manage" | "customer.status.manage" | "store.setting.manage" | "audit.read" | "order.unpaid.close" | "shipment.history.correct" | "after-sale.dispute.decide" | "deadline.extend" | "task.transfer")[];
                            /** Format: uuid */
                            id: string;
                            permissionVersion: number;
                            /** @enum {string} */
                            role: "SUPER_ADMIN" | "MERCH_WAREHOUSE" | "CUSTOMER_SERVICE";
                            version: number;
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            403: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FORBIDDEN" | "PASSWORD_CHANGE_REQUIRED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            404: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "EMPLOYEE_NOT_FOUND";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            409: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VERSION_CONFLICT" | "LAST_ADMIN_REQUIRED" | "TASK_LOCK_PLAN_CHANGED" | "BUSINESS_MODULE_NOT_READY" | "TASK_VERSION_EXHAUSTED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    disableEmployee: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @description 使用刚查询到的version，必须为JSON数字
                     * @example 0
                     */
                    expectedVersion: number;
                    /**
                     * @description 去首尾空白，启停原因必填
                     * @example 员工暂时离岗
                     */
                    reason: string;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @description 同状态且版本匹配为false，不重复写入或审计 */
                            changed: boolean;
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            status: "ACTIVE" | "DISABLED";
                            version: number;
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            403: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FORBIDDEN" | "PASSWORD_CHANGE_REQUIRED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            404: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "EMPLOYEE_NOT_FOUND";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            409: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VERSION_CONFLICT" | "LAST_ADMIN_REQUIRED" | "TASK_LOCK_PLAN_CHANGED" | "BUSINESS_MODULE_NOT_READY" | "TASK_VERSION_EXHAUSTED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    enableEmployee: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @description 使用刚查询到的version，必须为JSON数字
                     * @example 0
                     */
                    expectedVersion: number;
                    /**
                     * @description 去首尾空白，启停原因必填
                     * @example 员工暂时离岗
                     */
                    reason: string;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @description 同状态且版本匹配为false，不重复写入或审计 */
                            changed: boolean;
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            status: "ACTIVE" | "DISABLED";
                            version: number;
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            403: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FORBIDDEN" | "PASSWORD_CHANGE_REQUIRED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            404: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "EMPLOYEE_NOT_FOUND";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            409: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VERSION_CONFLICT" | "LAST_ADMIN_REQUIRED" | "TASK_LOCK_PLAN_CHANGED" | "BUSINESS_MODULE_NOT_READY" | "TASK_VERSION_EXHAUSTED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    replaceEmployeeExtraPermissions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @description 使用刚查询到的version，必须为JSON数字
                     * @example 0
                     */
                    expectedVersion: number;
                    /** @description 完整期望额外集合，空数组清空；重复码去重，不trim或更改大小写。未知/管理员专属码整次400；移除旧额外依赖优先级联撤销，新增才补齐依赖。 */
                    permissions: string[];
                    /**
                     * @description 去首尾空白，授权/撤权原因必填
                     * @example 客服兼顾发货登记
                     */
                    reason: string;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @description 本次新增选择自动补齐的依赖 */
                            addedByDependency: ("category.read" | "category.manage" | "product.read" | "product.cost.read" | "product.manage" | "product.publish" | "inventory.read" | "inventory.adjustment.create" | "inventory.adjustment.claim" | "inventory.adjustment.post" | "inventory.adjustment.void" | "inventory.source.manage" | "inventory.alert.manage" | "order.fulfillment.read" | "shipment.claim" | "shipment.pack" | "shipment.handover" | "shipment.tracking.correct" | "shipment.exception.manage" | "order.physical.check" | "inventory.order-exception.manage" | "after-sale.inspection.read" | "after-sale.receipt.record" | "after-sale.inspection.confirm" | "dashboard.read" | "order.service.read" | "communication.service.write" | "customer.read" | "after-sale.service.read" | "after-sale.review" | "after-sale.close" | "after-sale.return.follow" | "after-sale.refund.execute" | "after-sale.refund.retry" | "shipment.customer-confirm" | "offline-case.manage" | "customer.frozen.proxy" | "employee.read" | "employee.create" | "employee.profile.update" | "employee.status.manage" | "employee.password.reset" | "employee.role.change" | "employee.permission.manage" | "customer.status.manage" | "store.setting.manage" | "audit.read" | "order.unpaid.close" | "shipment.history.correct" | "after-sale.dispute.decide" | "deadline.extend" | "task.transfer")[];
                            /** @description 解析后集合与现有相同为false，不重写授权关系、版本或审计 */
                            changed: boolean;
                            defaultPermissions: ("category.read" | "category.manage" | "product.read" | "product.cost.read" | "product.manage" | "product.publish" | "inventory.read" | "inventory.adjustment.create" | "inventory.adjustment.claim" | "inventory.adjustment.post" | "inventory.adjustment.void" | "inventory.source.manage" | "inventory.alert.manage" | "order.fulfillment.read" | "shipment.claim" | "shipment.pack" | "shipment.handover" | "shipment.tracking.correct" | "shipment.exception.manage" | "order.physical.check" | "inventory.order-exception.manage" | "after-sale.inspection.read" | "after-sale.receipt.record" | "after-sale.inspection.confirm" | "dashboard.read" | "order.service.read" | "communication.service.write" | "customer.read" | "after-sale.service.read" | "after-sale.review" | "after-sale.close" | "after-sale.return.follow" | "after-sale.refund.execute" | "after-sale.refund.retry" | "shipment.customer-confirm" | "offline-case.manage" | "customer.frozen.proxy" | "employee.read" | "employee.create" | "employee.profile.update" | "employee.status.manage" | "employee.password.reset" | "employee.role.change" | "employee.permission.manage" | "customer.status.manage" | "store.setting.manage" | "audit.read" | "order.unpaid.close" | "shipment.history.correct" | "after-sale.dispute.decide" | "deadline.extend" | "task.transfer")[];
                            effectivePermissions: ("category.read" | "category.manage" | "product.read" | "product.cost.read" | "product.manage" | "product.publish" | "inventory.read" | "inventory.adjustment.create" | "inventory.adjustment.claim" | "inventory.adjustment.post" | "inventory.adjustment.void" | "inventory.source.manage" | "inventory.alert.manage" | "order.fulfillment.read" | "shipment.claim" | "shipment.pack" | "shipment.handover" | "shipment.tracking.correct" | "shipment.exception.manage" | "order.physical.check" | "inventory.order-exception.manage" | "after-sale.inspection.read" | "after-sale.receipt.record" | "after-sale.inspection.confirm" | "dashboard.read" | "order.service.read" | "communication.service.write" | "customer.read" | "after-sale.service.read" | "after-sale.review" | "after-sale.close" | "after-sale.return.follow" | "after-sale.refund.execute" | "after-sale.refund.retry" | "shipment.customer-confirm" | "offline-case.manage" | "customer.frozen.proxy" | "employee.read" | "employee.create" | "employee.profile.update" | "employee.status.manage" | "employee.password.reset" | "employee.role.change" | "employee.permission.manage" | "customer.status.manage" | "store.setting.manage" | "audit.read" | "order.unpaid.close" | "shipment.history.correct" | "after-sale.dispute.decide" | "deadline.extend" | "task.transfer")[];
                            /** Format: uuid */
                            id: string;
                            /** @description 已属于岗位默认、不重复存入额外表的请求项 */
                            normalizedDefaultPermissions: ("category.read" | "category.manage" | "product.read" | "product.cost.read" | "product.manage" | "product.publish" | "inventory.read" | "inventory.adjustment.create" | "inventory.adjustment.claim" | "inventory.adjustment.post" | "inventory.adjustment.void" | "inventory.source.manage" | "inventory.alert.manage" | "order.fulfillment.read" | "shipment.claim" | "shipment.pack" | "shipment.handover" | "shipment.tracking.correct" | "shipment.exception.manage" | "order.physical.check" | "inventory.order-exception.manage" | "after-sale.inspection.read" | "after-sale.receipt.record" | "after-sale.inspection.confirm" | "dashboard.read" | "order.service.read" | "communication.service.write" | "customer.read" | "after-sale.service.read" | "after-sale.review" | "after-sale.close" | "after-sale.return.follow" | "after-sale.refund.execute" | "after-sale.refund.retry" | "shipment.customer-confirm" | "offline-case.manage" | "customer.frozen.proxy" | "employee.read" | "employee.create" | "employee.profile.update" | "employee.status.manage" | "employee.password.reset" | "employee.role.change" | "employee.permission.manage" | "customer.status.manage" | "store.setting.manage" | "audit.read" | "order.unpaid.close" | "shipment.history.correct" | "after-sale.dispute.decide" | "deadline.extend" | "task.transfer")[];
                            permissionVersion: number;
                            /** @description 因旧依赖被撤销而级联移除的请求操作 */
                            removedByDependency: ("category.read" | "category.manage" | "product.read" | "product.cost.read" | "product.manage" | "product.publish" | "inventory.read" | "inventory.adjustment.create" | "inventory.adjustment.claim" | "inventory.adjustment.post" | "inventory.adjustment.void" | "inventory.source.manage" | "inventory.alert.manage" | "order.fulfillment.read" | "shipment.claim" | "shipment.pack" | "shipment.handover" | "shipment.tracking.correct" | "shipment.exception.manage" | "order.physical.check" | "inventory.order-exception.manage" | "after-sale.inspection.read" | "after-sale.receipt.record" | "after-sale.inspection.confirm" | "dashboard.read" | "order.service.read" | "communication.service.write" | "customer.read" | "after-sale.service.read" | "after-sale.review" | "after-sale.close" | "after-sale.return.follow" | "after-sale.refund.execute" | "after-sale.refund.retry" | "shipment.customer-confirm" | "offline-case.manage" | "customer.frozen.proxy" | "employee.read" | "employee.create" | "employee.profile.update" | "employee.status.manage" | "employee.password.reset" | "employee.role.change" | "employee.permission.manage" | "customer.status.manage" | "store.setting.manage" | "audit.read" | "order.unpaid.close" | "shipment.history.correct" | "after-sale.dispute.decide" | "deadline.extend" | "task.transfer")[];
                            resolvedExtraPermissions: ("category.read" | "category.manage" | "product.read" | "product.cost.read" | "product.manage" | "product.publish" | "inventory.read" | "inventory.adjustment.create" | "inventory.adjustment.claim" | "inventory.adjustment.post" | "inventory.adjustment.void" | "inventory.source.manage" | "inventory.alert.manage" | "order.fulfillment.read" | "shipment.claim" | "shipment.pack" | "shipment.handover" | "shipment.tracking.correct" | "shipment.exception.manage" | "order.physical.check" | "inventory.order-exception.manage" | "after-sale.inspection.read" | "after-sale.receipt.record" | "after-sale.inspection.confirm" | "dashboard.read" | "order.service.read" | "communication.service.write" | "customer.read" | "after-sale.service.read" | "after-sale.review" | "after-sale.close" | "after-sale.return.follow" | "after-sale.refund.execute" | "after-sale.refund.retry" | "shipment.customer-confirm" | "offline-case.manage" | "customer.frozen.proxy" | "employee.read" | "employee.create" | "employee.profile.update" | "employee.status.manage" | "employee.password.reset" | "employee.role.change" | "employee.permission.manage" | "customer.status.manage" | "store.setting.manage" | "audit.read" | "order.unpaid.close" | "shipment.history.correct" | "after-sale.dispute.decide" | "deadline.extend" | "task.transfer")[];
                            version: number;
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED" | "PERMISSION_NOT_GRANTABLE" | "EXTRA_PERMISSION_NOT_APPLICABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            403: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FORBIDDEN" | "PASSWORD_CHANGE_REQUIRED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            404: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "EMPLOYEE_NOT_FOUND";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            409: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VERSION_CONFLICT" | "TASK_LOCK_PLAN_CHANGED" | "BUSINESS_MODULE_NOT_READY" | "TASK_VERSION_EXHAUSTED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    updateEmployeeProfile: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @description 去首尾空白，不能为空
                     * @example 客服甲（晚班）
                     */
                    displayName: string;
                    /**
                     * @description 使用刚查询到的version，必须为JSON数字
                     * @example 0
                     */
                    expectedVersion: number;
                    /**
                     * @description 去首尾空白，修改原因必填
                     * @example 调整显示名
                     */
                    reason: string;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: date-time */
                            createdAt: string;
                            displayName: string;
                            /** Format: uuid */
                            id: string;
                            /** Format: date-time */
                            lastLoginAt: string | null;
                            mustChangePassword: boolean;
                            /** @enum {string} */
                            role: "SUPER_ADMIN" | "MERCH_WAREHOUSE" | "CUSTOMER_SERVICE";
                            /** @enum {string} */
                            status: "ACTIVE" | "DISABLED";
                            username: string;
                            version: number;
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            403: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FORBIDDEN" | "PASSWORD_CHANGE_REQUIRED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            404: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "EMPLOYEE_NOT_FOUND";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            409: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VERSION_CONFLICT";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    resetEmployeePassword: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @description 使用刚查询到的version，必须为JSON数字
                     * @example 0
                     */
                    expectedVersion: number;
                    /**
                     * @description 去首尾空白，重置原因必填
                     * @example 员工忘记密码
                     */
                    reason: string;
                    /**
                     * Format: password
                     * @description 8～64个Unicode码点且UTF-8最多72字节，保留空格，不截断；不得与当前密码相同
                     * @example ResetDemo#2026
                     */
                    temporaryPassword: string;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                            /** @enum {boolean} */
                            mustChangePassword: true;
                            version: number;
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED" | "SELF_PASSWORD_RESET_NOT_ALLOWED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            403: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FORBIDDEN" | "PASSWORD_CHANGE_REQUIRED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            404: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "EMPLOYEE_NOT_FOUND";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            409: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VERSION_CONFLICT";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    getEmployeeMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            displayName: string;
                            /** Format: uuid */
                            id: string;
                            mustChangePassword: boolean;
                            /** @enum {string} */
                            role: "SUPER_ADMIN" | "MERCH_WAREHOUSE" | "CUSTOMER_SERVICE";
                            /** @enum {string} */
                            status: "ACTIVE" | "DISABLED";
                            username: string;
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    getEmployeeMePermissions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @description 当前岗位固定默认权限，按权限码排序 */
                            defaultPermissions: ("category.read" | "category.manage" | "product.read" | "product.cost.read" | "product.manage" | "product.publish" | "inventory.read" | "inventory.adjustment.create" | "inventory.adjustment.claim" | "inventory.adjustment.post" | "inventory.adjustment.void" | "inventory.source.manage" | "inventory.alert.manage" | "order.fulfillment.read" | "shipment.claim" | "shipment.pack" | "shipment.handover" | "shipment.tracking.correct" | "shipment.exception.manage" | "order.physical.check" | "inventory.order-exception.manage" | "after-sale.inspection.read" | "after-sale.receipt.record" | "after-sale.inspection.confirm" | "dashboard.read" | "order.service.read" | "communication.service.write" | "customer.read" | "after-sale.service.read" | "after-sale.review" | "after-sale.close" | "after-sale.return.follow" | "after-sale.refund.execute" | "after-sale.refund.retry" | "shipment.customer-confirm" | "offline-case.manage" | "customer.frozen.proxy" | "employee.read" | "employee.create" | "employee.profile.update" | "employee.status.manage" | "employee.password.reset" | "employee.role.change" | "employee.permission.manage" | "customer.status.manage" | "store.setting.manage" | "audit.read" | "order.unpaid.close" | "shipment.history.correct" | "after-sale.dispute.decide" | "deadline.extend" | "task.transfer")[];
                            /** @description 默认与额外授权合并后的最终权限，按权限码排序 */
                            effectivePermissions: ("category.read" | "category.manage" | "product.read" | "product.cost.read" | "product.manage" | "product.publish" | "inventory.read" | "inventory.adjustment.create" | "inventory.adjustment.claim" | "inventory.adjustment.post" | "inventory.adjustment.void" | "inventory.source.manage" | "inventory.alert.manage" | "order.fulfillment.read" | "shipment.claim" | "shipment.pack" | "shipment.handover" | "shipment.tracking.correct" | "shipment.exception.manage" | "order.physical.check" | "inventory.order-exception.manage" | "after-sale.inspection.read" | "after-sale.receipt.record" | "after-sale.inspection.confirm" | "dashboard.read" | "order.service.read" | "communication.service.write" | "customer.read" | "after-sale.service.read" | "after-sale.review" | "after-sale.close" | "after-sale.return.follow" | "after-sale.refund.execute" | "after-sale.refund.retry" | "shipment.customer-confirm" | "offline-case.manage" | "customer.frozen.proxy" | "employee.read" | "employee.create" | "employee.profile.update" | "employee.status.manage" | "employee.password.reset" | "employee.role.change" | "employee.permission.manage" | "customer.status.manage" | "store.setting.manage" | "audit.read" | "order.unpaid.close" | "shipment.history.correct" | "after-sale.dispute.decide" | "deadline.extend" | "task.transfer")[];
                            /** @description 当前个人额外授权，按权限码排序 */
                            extraPermissions: ("category.read" | "category.manage" | "product.read" | "product.cost.read" | "product.manage" | "product.publish" | "inventory.read" | "inventory.adjustment.create" | "inventory.adjustment.claim" | "inventory.adjustment.post" | "inventory.adjustment.void" | "inventory.source.manage" | "inventory.alert.manage" | "order.fulfillment.read" | "shipment.claim" | "shipment.pack" | "shipment.handover" | "shipment.tracking.correct" | "shipment.exception.manage" | "order.physical.check" | "inventory.order-exception.manage" | "after-sale.inspection.read" | "after-sale.receipt.record" | "after-sale.inspection.confirm" | "dashboard.read" | "order.service.read" | "communication.service.write" | "customer.read" | "after-sale.service.read" | "after-sale.review" | "after-sale.close" | "after-sale.return.follow" | "after-sale.refund.execute" | "after-sale.refund.retry" | "shipment.customer-confirm" | "offline-case.manage" | "customer.frozen.proxy" | "employee.read" | "employee.create" | "employee.profile.update" | "employee.status.manage" | "employee.password.reset" | "employee.role.change" | "employee.permission.manage" | "customer.status.manage" | "store.setting.manage" | "audit.read" | "order.unpaid.close" | "shipment.history.correct" | "after-sale.dispute.decide" | "deadline.extend" | "task.transfer")[];
                            /** @description 当前数据库权限版本，调岗或授权变更后递增 */
                            permissionVersion: number;
                            /** @enum {string} */
                            role: "SUPER_ADMIN" | "MERCH_WAREHOUSE" | "CUSTOMER_SERVICE";
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            403: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "PASSWORD_CHANGE_REQUIRED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    getPermissionCatalog: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            permissions: {
                                adminOnly: boolean;
                                /** @enum {string} */
                                code: "category.read" | "category.manage" | "product.read" | "product.cost.read" | "product.manage" | "product.publish" | "inventory.read" | "inventory.adjustment.create" | "inventory.adjustment.claim" | "inventory.adjustment.post" | "inventory.adjustment.void" | "inventory.source.manage" | "inventory.alert.manage" | "order.fulfillment.read" | "shipment.claim" | "shipment.pack" | "shipment.handover" | "shipment.tracking.correct" | "shipment.exception.manage" | "order.physical.check" | "inventory.order-exception.manage" | "after-sale.inspection.read" | "after-sale.receipt.record" | "after-sale.inspection.confirm" | "dashboard.read" | "order.service.read" | "communication.service.write" | "customer.read" | "after-sale.service.read" | "after-sale.review" | "after-sale.close" | "after-sale.return.follow" | "after-sale.refund.execute" | "after-sale.refund.retry" | "shipment.customer-confirm" | "offline-case.manage" | "customer.frozen.proxy" | "employee.read" | "employee.create" | "employee.profile.update" | "employee.status.manage" | "employee.password.reset" | "employee.role.change" | "employee.permission.manage" | "customer.status.manage" | "store.setting.manage" | "audit.read" | "order.unpaid.close" | "shipment.history.correct" | "after-sale.dispute.decide" | "deadline.extend" | "task.transfer";
                                dependencies: ("category.read" | "category.manage" | "product.read" | "product.cost.read" | "product.manage" | "product.publish" | "inventory.read" | "inventory.adjustment.create" | "inventory.adjustment.claim" | "inventory.adjustment.post" | "inventory.adjustment.void" | "inventory.source.manage" | "inventory.alert.manage" | "order.fulfillment.read" | "shipment.claim" | "shipment.pack" | "shipment.handover" | "shipment.tracking.correct" | "shipment.exception.manage" | "order.physical.check" | "inventory.order-exception.manage" | "after-sale.inspection.read" | "after-sale.receipt.record" | "after-sale.inspection.confirm" | "dashboard.read" | "order.service.read" | "communication.service.write" | "customer.read" | "after-sale.service.read" | "after-sale.review" | "after-sale.close" | "after-sale.return.follow" | "after-sale.refund.execute" | "after-sale.refund.retry" | "shipment.customer-confirm" | "offline-case.manage" | "customer.frozen.proxy" | "employee.read" | "employee.create" | "employee.profile.update" | "employee.status.manage" | "employee.password.reset" | "employee.role.change" | "employee.permission.manage" | "customer.status.manage" | "store.setting.manage" | "audit.read" | "order.unpaid.close" | "shipment.history.correct" | "after-sale.dispute.decide" | "deadline.extend" | "task.transfer")[];
                                description: string;
                                name: string;
                            }[];
                            roleTemplates: {
                                CUSTOMER_SERVICE: ("category.read" | "category.manage" | "product.read" | "product.cost.read" | "product.manage" | "product.publish" | "inventory.read" | "inventory.adjustment.create" | "inventory.adjustment.claim" | "inventory.adjustment.post" | "inventory.adjustment.void" | "inventory.source.manage" | "inventory.alert.manage" | "order.fulfillment.read" | "shipment.claim" | "shipment.pack" | "shipment.handover" | "shipment.tracking.correct" | "shipment.exception.manage" | "order.physical.check" | "inventory.order-exception.manage" | "after-sale.inspection.read" | "after-sale.receipt.record" | "after-sale.inspection.confirm" | "dashboard.read" | "order.service.read" | "communication.service.write" | "customer.read" | "after-sale.service.read" | "after-sale.review" | "after-sale.close" | "after-sale.return.follow" | "after-sale.refund.execute" | "after-sale.refund.retry" | "shipment.customer-confirm" | "offline-case.manage" | "customer.frozen.proxy" | "employee.read" | "employee.create" | "employee.profile.update" | "employee.status.manage" | "employee.password.reset" | "employee.role.change" | "employee.permission.manage" | "customer.status.manage" | "store.setting.manage" | "audit.read" | "order.unpaid.close" | "shipment.history.correct" | "after-sale.dispute.decide" | "deadline.extend" | "task.transfer")[];
                                MERCH_WAREHOUSE: ("category.read" | "category.manage" | "product.read" | "product.cost.read" | "product.manage" | "product.publish" | "inventory.read" | "inventory.adjustment.create" | "inventory.adjustment.claim" | "inventory.adjustment.post" | "inventory.adjustment.void" | "inventory.source.manage" | "inventory.alert.manage" | "order.fulfillment.read" | "shipment.claim" | "shipment.pack" | "shipment.handover" | "shipment.tracking.correct" | "shipment.exception.manage" | "order.physical.check" | "inventory.order-exception.manage" | "after-sale.inspection.read" | "after-sale.receipt.record" | "after-sale.inspection.confirm" | "dashboard.read" | "order.service.read" | "communication.service.write" | "customer.read" | "after-sale.service.read" | "after-sale.review" | "after-sale.close" | "after-sale.return.follow" | "after-sale.refund.execute" | "after-sale.refund.retry" | "shipment.customer-confirm" | "offline-case.manage" | "customer.frozen.proxy" | "employee.read" | "employee.create" | "employee.profile.update" | "employee.status.manage" | "employee.password.reset" | "employee.role.change" | "employee.permission.manage" | "customer.status.manage" | "store.setting.manage" | "audit.read" | "order.unpaid.close" | "shipment.history.correct" | "after-sale.dispute.decide" | "deadline.extend" | "task.transfer")[];
                                SUPER_ADMIN: ("category.read" | "category.manage" | "product.read" | "product.cost.read" | "product.manage" | "product.publish" | "inventory.read" | "inventory.adjustment.create" | "inventory.adjustment.claim" | "inventory.adjustment.post" | "inventory.adjustment.void" | "inventory.source.manage" | "inventory.alert.manage" | "order.fulfillment.read" | "shipment.claim" | "shipment.pack" | "shipment.handover" | "shipment.tracking.correct" | "shipment.exception.manage" | "order.physical.check" | "inventory.order-exception.manage" | "after-sale.inspection.read" | "after-sale.receipt.record" | "after-sale.inspection.confirm" | "dashboard.read" | "order.service.read" | "communication.service.write" | "customer.read" | "after-sale.service.read" | "after-sale.review" | "after-sale.close" | "after-sale.return.follow" | "after-sale.refund.execute" | "after-sale.refund.retry" | "shipment.customer-confirm" | "offline-case.manage" | "customer.frozen.proxy" | "employee.read" | "employee.create" | "employee.profile.update" | "employee.status.manage" | "employee.password.reset" | "employee.role.change" | "employee.permission.manage" | "customer.status.manage" | "store.setting.manage" | "audit.read" | "order.unpaid.close" | "shipment.history.correct" | "after-sale.dispute.decide" | "deadline.extend" | "task.transfer")[];
                            };
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            403: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FORBIDDEN" | "PASSWORD_CHANGE_REQUIRED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    getStoreSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            configured: boolean;
                            currentSetting: {
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: uuid */
                                createdByEmployeeId: string | null;
                                deadlines: {
                                    /** @description 自然日；订单完成起算 */
                                    afterSaleWindowDays: number;
                                    /** @description 自然日；实际交运起算 */
                                    autoReceiptDays: number;
                                    /** @description 工作日；实际到货起算 */
                                    inspectionWorkdays: number;
                                    /** @description 分钟；建单时固化付款期限 */
                                    paymentMinutes: number;
                                    /** @description 工作日；退款条件满足起算 */
                                    refundWorkdays: number;
                                    /** @description 自然日；同意寄回阶段起算 */
                                    returnShipDays: number;
                                    /** @description 工作日；每轮审核起算 */
                                    reviewWorkdays: number;
                                    /** @description 自然日；每轮要求补材料起算 */
                                    supplementDays: number;
                                };
                                freeShippingEnabled: boolean;
                                freeShippingThresholdCents: number;
                                /** Format: uuid */
                                id: string;
                                reason: string;
                                returnAddress: {
                                    city: string;
                                    detail: string;
                                    district: string;
                                    /** @description 规范化后保存的电话；仅保留可选国际前缀和数字 */
                                    phone: string;
                                    province: string;
                                    receiver: string;
                                };
                                serviceContact: {
                                    /** @description 规范化后保存的电话；仅保留可选国际前缀和数字 */
                                    phone: string;
                                    /** @description 省略、null或空白表示未设置服务时间；完整替换时清除旧值 */
                                    serviceHours: string | null;
                                };
                                shippingFeeCents: number;
                                versionNumber: number;
                            } | null;
                            version: number;
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            403: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FORBIDDEN" | "PASSWORD_CHANGE_REQUIRED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    updateStoreSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    deadlines: {
                        /** @description 自然日；订单完成起算 */
                        afterSaleWindowDays: number;
                        /** @description 自然日；实际交运起算 */
                        autoReceiptDays: number;
                        /** @description 工作日；实际到货起算 */
                        inspectionWorkdays: number;
                        /** @description 分钟；建单时固化付款期限 */
                        paymentMinutes: number;
                        /** @description 工作日；退款条件满足起算 */
                        refundWorkdays: number;
                        /** @description 自然日；同意寄回阶段起算 */
                        returnShipDays: number;
                        /** @description 工作日；每轮审核起算 */
                        reviewWorkdays: number;
                        /** @description 自然日；每轮要求补材料起算 */
                        supplementDays: number;
                    };
                    expectedVersion: number;
                    freeShippingEnabled: boolean;
                    freeShippingThresholdCents: number;
                    reason: string;
                    returnAddress: {
                        city: string;
                        detail: string;
                        district: string;
                        /** @description 去首尾空白后的输入与规范化结果长度均须3～30；允许国际前缀、数字、空格/连字符，移除分隔符后保存 */
                        phone: string;
                        province: string;
                        receiver: string;
                    };
                    serviceContact: {
                        /** @description 去首尾空白后的输入与规范化结果长度均须3～30；允许国际前缀、数字、空格/连字符，移除分隔符后保存 */
                        phone: string;
                        /** @description 省略、null或空白表示未设置服务时间；完整替换时清除旧值 */
                        serviceHours?: string | null;
                    };
                    shippingFeeCents: number;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            changed: boolean;
                            currentSetting: {
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: uuid */
                                createdByEmployeeId: string | null;
                                deadlines: {
                                    /** @description 自然日；订单完成起算 */
                                    afterSaleWindowDays: number;
                                    /** @description 自然日；实际交运起算 */
                                    autoReceiptDays: number;
                                    /** @description 工作日；实际到货起算 */
                                    inspectionWorkdays: number;
                                    /** @description 分钟；建单时固化付款期限 */
                                    paymentMinutes: number;
                                    /** @description 工作日；退款条件满足起算 */
                                    refundWorkdays: number;
                                    /** @description 自然日；同意寄回阶段起算 */
                                    returnShipDays: number;
                                    /** @description 工作日；每轮审核起算 */
                                    reviewWorkdays: number;
                                    /** @description 自然日；每轮要求补材料起算 */
                                    supplementDays: number;
                                };
                                freeShippingEnabled: boolean;
                                freeShippingThresholdCents: number;
                                /** Format: uuid */
                                id: string;
                                reason: string;
                                returnAddress: {
                                    city: string;
                                    detail: string;
                                    district: string;
                                    /** @description 规范化后保存的电话；仅保留可选国际前缀和数字 */
                                    phone: string;
                                    province: string;
                                    receiver: string;
                                };
                                serviceContact: {
                                    /** @description 规范化后保存的电话；仅保留可选国际前缀和数字 */
                                    phone: string;
                                    /** @description 省略、null或空白表示未设置服务时间；完整替换时清除旧值 */
                                    serviceHours: string | null;
                                };
                                shippingFeeCents: number;
                                versionNumber: number;
                            };
                            /** Format: uuid */
                            settingVersionId: string;
                            version: number;
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            403: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FORBIDDEN" | "PASSWORD_CHANGE_REQUIRED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            409: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VERSION_CONFLICT";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    listStoreSettingVersions: {
        parameters: {
            query?: {
                page?: number;
                pageSize?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            items: {
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: uuid */
                                createdByEmployeeId: string | null;
                                /** Format: uuid */
                                id: string;
                                reason: string;
                                versionNumber: number;
                            }[];
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            403: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FORBIDDEN" | "PASSWORD_CHANGE_REQUIRED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    getStoreSettingVersion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: uuid */
                            createdByEmployeeId: string | null;
                            deadlines: {
                                /** @description 自然日；订单完成起算 */
                                afterSaleWindowDays: number;
                                /** @description 自然日；实际交运起算 */
                                autoReceiptDays: number;
                                /** @description 工作日；实际到货起算 */
                                inspectionWorkdays: number;
                                /** @description 分钟；建单时固化付款期限 */
                                paymentMinutes: number;
                                /** @description 工作日；退款条件满足起算 */
                                refundWorkdays: number;
                                /** @description 自然日；同意寄回阶段起算 */
                                returnShipDays: number;
                                /** @description 工作日；每轮审核起算 */
                                reviewWorkdays: number;
                                /** @description 自然日；每轮要求补材料起算 */
                                supplementDays: number;
                            };
                            freeShippingEnabled: boolean;
                            freeShippingThresholdCents: number;
                            /** Format: uuid */
                            id: string;
                            reason: string;
                            returnAddress: {
                                city: string;
                                detail: string;
                                district: string;
                                /** @description 规范化后保存的电话；仅保留可选国际前缀和数字 */
                                phone: string;
                                province: string;
                                receiver: string;
                            };
                            serviceContact: {
                                /** @description 规范化后保存的电话；仅保留可选国际前缀和数字 */
                                phone: string;
                                /** @description 省略、null或空白表示未设置服务时间；完整替换时清除旧值 */
                                serviceHours: string | null;
                            };
                            shippingFeeCents: number;
                            versionNumber: number;
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            403: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FORBIDDEN" | "PASSWORD_CHANGE_REQUIRED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            404: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "SETTING_VERSION_NOT_FOUND";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    listTasks: {
        parameters: {
            query?: {
                businessId?: string;
                businessType?: "INVENTORY_ADJUSTMENT" | "ORDER" | "AFTER_SALE" | "OFFLINE_CASE" | "CUSTODY_ARRANGEMENT";
                overdue?: boolean;
                page?: number;
                pageSize?: number;
                stage?: "INVENTORY_POST" | "INVENTORY_RECONCILE" | "SHIPMENT_PROCESS" | "HANDOVER_VERIFY" | "PHYSICAL_VERIFY" | "STOCK_EXCEPTION_VERIFY" | "SHIPMENT_EXCEPTION_VERIFY" | "CUSTOMER_CONTACT" | "AFTER_SALE_REVIEW" | "SUPPLEMENT_FOLLOW" | "RETURN_FOLLOW" | "RETURN_RECEIVE" | "RETURN_INSPECT" | "INSPECTION_EXCEPTION_CONTACT" | "REFUND_PROCESS" | "ADMIN_DISPUTE" | "ADMIN_STOCK_REVIEW" | "PROXY_INPUT" | "OFFLINE_FOLLOW" | "CUSTODY_EXECUTE";
                status?: "OPEN" | "CLAIMED" | "SUSPENDED" | "COMPLETED" | "CANCELLED";
                view?: "mine" | "pool" | "reassign";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            items: {
                                allowedActions: ("claim" | "release" | "transfer" | "extendDeadline")[];
                                assignee: {
                                    displayName: string;
                                    /** Format: uuid */
                                    id: string;
                                } | null;
                                business: {
                                    /** @description 由真实业务提供的安全应用内详情路径；未接页面时为null */
                                    detailPath: string | null;
                                    label: string;
                                    number: string;
                                };
                                /** Format: uuid */
                                businessId: string;
                                /** @enum {string} */
                                businessType: "INVENTORY_ADJUSTMENT" | "ORDER" | "AFTER_SALE" | "OFFLINE_CASE" | "CUSTODY_ARRANGEMENT";
                                /** Format: date-time */
                                dueAt: string | null;
                                /** Format: date-time */
                                firstOverdueAt: string | null;
                                hasEverOverdue: boolean;
                                /** Format: uuid */
                                id: string;
                                isCurrentlyOverdue: boolean;
                                /** Format: date-time */
                                originalDueAt: string | null;
                                reassignNeeded: boolean;
                                requiredPermissions: string[];
                                round: number;
                                /** @enum {string} */
                                stage: "INVENTORY_POST" | "INVENTORY_RECONCILE" | "SHIPMENT_PROCESS" | "HANDOVER_VERIFY" | "PHYSICAL_VERIFY" | "STOCK_EXCEPTION_VERIFY" | "SHIPMENT_EXCEPTION_VERIFY" | "CUSTOMER_CONTACT" | "AFTER_SALE_REVIEW" | "SUPPLEMENT_FOLLOW" | "RETURN_FOLLOW" | "RETURN_RECEIVE" | "RETURN_INSPECT" | "INSPECTION_EXCEPTION_CONTACT" | "REFUND_PROCESS" | "ADMIN_DISPUTE" | "ADMIN_STOCK_REVIEW" | "PROXY_INPUT" | "OFFLINE_FOLLOW" | "CUSTODY_EXECUTE";
                                /** Format: date-time */
                                startedAt: string;
                                /** @enum {string} */
                                status: "OPEN" | "CLAIMED" | "SUSPENDED" | "COMPLETED" | "CANCELLED";
                                version: number;
                            }[];
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            403: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FORBIDDEN" | "PASSWORD_CHANGE_REQUIRED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    getTaskDetail: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            allowedActions: ("claim" | "release" | "transfer" | "extendDeadline")[];
                            assignee: {
                                displayName: string;
                                /** Format: uuid */
                                id: string;
                            } | null;
                            business: {
                                /** @description 由真实业务提供的安全应用内详情路径；未接页面时为null */
                                detailPath: string | null;
                                label: string;
                                number: string;
                            };
                            /** Format: uuid */
                            businessId: string;
                            /** @enum {string} */
                            businessType: "INVENTORY_ADJUSTMENT" | "ORDER" | "AFTER_SALE" | "OFFLINE_CASE" | "CUSTODY_ARRANGEMENT";
                            /** Format: date-time */
                            closedAt: string | null;
                            /** Format: date-time */
                            dueAt: string | null;
                            /** Format: date-time */
                            firstOverdueAt: string | null;
                            hasEverOverdue: boolean;
                            /** Format: uuid */
                            id: string;
                            isCurrentlyOverdue: boolean;
                            latestDeadlineEvent: {
                                /** Format: date-time */
                                deadlineAt: string;
                                /** Format: date-time */
                                detectedAt: string;
                                /** @enum {string} */
                                eventType: "OVERDUE" | "EXTENDED" | "DEADLINE_ASSIGNED";
                                /** Format: uuid */
                                id: string;
                                /** @enum {string} */
                                kind: "DEADLINE_EVENT";
                                /** Format: date-time */
                                newDueAt: string | null;
                                /** Format: date-time */
                                occurredAt: string;
                                reason: string | null;
                            } | null;
                            /** Format: date-time */
                            originalDueAt: string | null;
                            reassignNeeded: boolean;
                            requiredPermissions: string[];
                            round: number;
                            ruleSnapshot: {
                                algorithmVersion: string | null;
                                amount: number | null;
                                ruleCode: string | null;
                                settingsVersionNumber: number | null;
                                source: string | null;
                                sourceField: string | null;
                                stageCatalogVersion: string | null;
                                timeZone: string | null;
                                unit: string | null;
                            };
                            /** Format: uuid */
                            settingsVersionId: string | null;
                            /** @enum {string} */
                            stage: "INVENTORY_POST" | "INVENTORY_RECONCILE" | "SHIPMENT_PROCESS" | "HANDOVER_VERIFY" | "PHYSICAL_VERIFY" | "STOCK_EXCEPTION_VERIFY" | "SHIPMENT_EXCEPTION_VERIFY" | "CUSTOMER_CONTACT" | "AFTER_SALE_REVIEW" | "SUPPLEMENT_FOLLOW" | "RETURN_FOLLOW" | "RETURN_RECEIVE" | "RETURN_INSPECT" | "INSPECTION_EXCEPTION_CONTACT" | "REFUND_PROCESS" | "ADMIN_DISPUTE" | "ADMIN_STOCK_REVIEW" | "PROXY_INPUT" | "OFFLINE_FOLLOW" | "CUSTODY_EXECUTE";
                            /** Format: date-time */
                            startedAt: string;
                            /** @enum {string} */
                            status: "OPEN" | "CLAIMED" | "SUSPENDED" | "COMPLETED" | "CANCELLED";
                            version: number;
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            403: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FORBIDDEN" | "PASSWORD_CHANGE_REQUIRED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            404: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TASK_NOT_FOUND";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    claimTask: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    expectedVersion: number;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            changed: boolean;
                            task: {
                                allowedActions: ("claim" | "release" | "transfer" | "extendDeadline")[];
                                assignee: {
                                    displayName: string;
                                    /** Format: uuid */
                                    id: string;
                                } | null;
                                business: {
                                    /** @description 由真实业务提供的安全应用内详情路径；未接页面时为null */
                                    detailPath: string | null;
                                    label: string;
                                    number: string;
                                };
                                /** Format: uuid */
                                businessId: string;
                                /** @enum {string} */
                                businessType: "INVENTORY_ADJUSTMENT" | "ORDER" | "AFTER_SALE" | "OFFLINE_CASE" | "CUSTODY_ARRANGEMENT";
                                /** Format: date-time */
                                dueAt: string | null;
                                /** Format: date-time */
                                firstOverdueAt: string | null;
                                hasEverOverdue: boolean;
                                /** Format: uuid */
                                id: string;
                                isCurrentlyOverdue: boolean;
                                /** Format: date-time */
                                originalDueAt: string | null;
                                reassignNeeded: boolean;
                                requiredPermissions: string[];
                                round: number;
                                /** @enum {string} */
                                stage: "INVENTORY_POST" | "INVENTORY_RECONCILE" | "SHIPMENT_PROCESS" | "HANDOVER_VERIFY" | "PHYSICAL_VERIFY" | "STOCK_EXCEPTION_VERIFY" | "SHIPMENT_EXCEPTION_VERIFY" | "CUSTOMER_CONTACT" | "AFTER_SALE_REVIEW" | "SUPPLEMENT_FOLLOW" | "RETURN_FOLLOW" | "RETURN_RECEIVE" | "RETURN_INSPECT" | "INSPECTION_EXCEPTION_CONTACT" | "REFUND_PROCESS" | "ADMIN_DISPUTE" | "ADMIN_STOCK_REVIEW" | "PROXY_INPUT" | "OFFLINE_FOLLOW" | "CUSTODY_EXECUTE";
                                /** Format: date-time */
                                startedAt: string;
                                /** @enum {string} */
                                status: "OPEN" | "CLAIMED" | "SUSPENDED" | "COMPLETED" | "CANCELLED";
                                version: number;
                            };
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            403: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FORBIDDEN" | "PASSWORD_CHANGE_REQUIRED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            404: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TASK_NOT_FOUND";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            409: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VERSION_CONFLICT" | "TASK_ALREADY_CLAIMED" | "TASK_NOT_OPEN" | "TASK_ENTRY_BLOCKED" | "BUSINESS_MODULE_NOT_READY" | "TASK_LOCK_PLAN_CHANGED" | "TASK_VERSION_EXHAUSTED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    extendTaskDeadline: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    expectedVersion: number;
                    /**
                     * Format: date-time
                     * @description 真实有效的ISO UTC时刻，必须带Z，精度最多毫秒；必须晚于当前截止及服务器当前时间
                     */
                    newDueAt: string;
                    reason: string;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            changed: boolean;
                            task: {
                                allowedActions: ("claim" | "release" | "transfer" | "extendDeadline")[];
                                assignee: {
                                    displayName: string;
                                    /** Format: uuid */
                                    id: string;
                                } | null;
                                business: {
                                    /** @description 由真实业务提供的安全应用内详情路径；未接页面时为null */
                                    detailPath: string | null;
                                    label: string;
                                    number: string;
                                };
                                /** Format: uuid */
                                businessId: string;
                                /** @enum {string} */
                                businessType: "INVENTORY_ADJUSTMENT" | "ORDER" | "AFTER_SALE" | "OFFLINE_CASE" | "CUSTODY_ARRANGEMENT";
                                /** Format: date-time */
                                dueAt: string | null;
                                /** Format: date-time */
                                firstOverdueAt: string | null;
                                hasEverOverdue: boolean;
                                /** Format: uuid */
                                id: string;
                                isCurrentlyOverdue: boolean;
                                /** Format: date-time */
                                originalDueAt: string | null;
                                reassignNeeded: boolean;
                                requiredPermissions: string[];
                                round: number;
                                /** @enum {string} */
                                stage: "INVENTORY_POST" | "INVENTORY_RECONCILE" | "SHIPMENT_PROCESS" | "HANDOVER_VERIFY" | "PHYSICAL_VERIFY" | "STOCK_EXCEPTION_VERIFY" | "SHIPMENT_EXCEPTION_VERIFY" | "CUSTOMER_CONTACT" | "AFTER_SALE_REVIEW" | "SUPPLEMENT_FOLLOW" | "RETURN_FOLLOW" | "RETURN_RECEIVE" | "RETURN_INSPECT" | "INSPECTION_EXCEPTION_CONTACT" | "REFUND_PROCESS" | "ADMIN_DISPUTE" | "ADMIN_STOCK_REVIEW" | "PROXY_INPUT" | "OFFLINE_FOLLOW" | "CUSTODY_EXECUTE";
                                /** Format: date-time */
                                startedAt: string;
                                /** @enum {string} */
                                status: "OPEN" | "CLAIMED" | "SUSPENDED" | "COMPLETED" | "CANCELLED";
                                version: number;
                            };
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            403: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FORBIDDEN" | "PASSWORD_CHANGE_REQUIRED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            404: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TASK_NOT_FOUND";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            409: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VERSION_CONFLICT" | "TASK_DEADLINE_BLOCKED" | "TASK_DEADLINE_NOT_LATER" | "BUSINESS_MODULE_NOT_READY" | "TASK_LOCK_PLAN_CHANGED" | "TASK_VERSION_EXHAUSTED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    getTaskHistory: {
        parameters: {
            query?: {
                page?: number;
                pageSize?: number;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            items: ({
                                /** @enum {string} */
                                action: "CREATED" | "CLAIMED" | "RELEASED" | "TRANSFERRED" | "QUALIFICATION_LOST" | "SUSPENDED" | "RESUMED" | "COMPLETED" | "CANCELLED" | "DEADLINE_CHANGED";
                                /** @enum {string} */
                                afterStatus: "OPEN" | "CLAIMED" | "SUSPENDED" | "COMPLETED" | "CANCELLED";
                                /** @enum {string|null} */
                                beforeStatus: "OPEN" | "CLAIMED" | "SUSPENDED" | "COMPLETED" | "CANCELLED" | null;
                                /** Format: uuid */
                                fromAssigneeId: string | null;
                                /** Format: uuid */
                                id: string;
                                /** @enum {string} */
                                kind: "TASK_CHANGE";
                                /** Format: date-time */
                                occurredAt: string;
                                reason: string | null;
                                /** Format: uuid */
                                toAssigneeId: string | null;
                            } | {
                                /** Format: date-time */
                                deadlineAt: string;
                                /** Format: date-time */
                                detectedAt: string;
                                /** @enum {string} */
                                eventType: "OVERDUE" | "EXTENDED" | "DEADLINE_ASSIGNED";
                                /** Format: uuid */
                                id: string;
                                /** @enum {string} */
                                kind: "DEADLINE_EVENT";
                                /** Format: date-time */
                                newDueAt: string | null;
                                /** Format: date-time */
                                occurredAt: string;
                                reason: string | null;
                            })[];
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            403: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FORBIDDEN" | "PASSWORD_CHANGE_REQUIRED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            404: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TASK_NOT_FOUND";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    releaseTask: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    expectedVersion: number;
                    reason: string;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            changed: boolean;
                            task: {
                                allowedActions: ("claim" | "release" | "transfer" | "extendDeadline")[];
                                assignee: {
                                    displayName: string;
                                    /** Format: uuid */
                                    id: string;
                                } | null;
                                business: {
                                    /** @description 由真实业务提供的安全应用内详情路径；未接页面时为null */
                                    detailPath: string | null;
                                    label: string;
                                    number: string;
                                };
                                /** Format: uuid */
                                businessId: string;
                                /** @enum {string} */
                                businessType: "INVENTORY_ADJUSTMENT" | "ORDER" | "AFTER_SALE" | "OFFLINE_CASE" | "CUSTODY_ARRANGEMENT";
                                /** Format: date-time */
                                dueAt: string | null;
                                /** Format: date-time */
                                firstOverdueAt: string | null;
                                hasEverOverdue: boolean;
                                /** Format: uuid */
                                id: string;
                                isCurrentlyOverdue: boolean;
                                /** Format: date-time */
                                originalDueAt: string | null;
                                reassignNeeded: boolean;
                                requiredPermissions: string[];
                                round: number;
                                /** @enum {string} */
                                stage: "INVENTORY_POST" | "INVENTORY_RECONCILE" | "SHIPMENT_PROCESS" | "HANDOVER_VERIFY" | "PHYSICAL_VERIFY" | "STOCK_EXCEPTION_VERIFY" | "SHIPMENT_EXCEPTION_VERIFY" | "CUSTOMER_CONTACT" | "AFTER_SALE_REVIEW" | "SUPPLEMENT_FOLLOW" | "RETURN_FOLLOW" | "RETURN_RECEIVE" | "RETURN_INSPECT" | "INSPECTION_EXCEPTION_CONTACT" | "REFUND_PROCESS" | "ADMIN_DISPUTE" | "ADMIN_STOCK_REVIEW" | "PROXY_INPUT" | "OFFLINE_FOLLOW" | "CUSTODY_EXECUTE";
                                /** Format: date-time */
                                startedAt: string;
                                /** @enum {string} */
                                status: "OPEN" | "CLAIMED" | "SUSPENDED" | "COMPLETED" | "CANCELLED";
                                version: number;
                            };
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            403: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FORBIDDEN" | "PASSWORD_CHANGE_REQUIRED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            404: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TASK_NOT_FOUND";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            409: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VERSION_CONFLICT" | "TASK_NOT_ASSIGNEE" | "TASK_RELEASE_BLOCKED" | "BUSINESS_MODULE_NOT_READY" | "TASK_LOCK_PLAN_CHANGED" | "TASK_VERSION_EXHAUSTED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    transferTask: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    expectedVersion: number;
                    reason: string;
                    /** Format: uuid */
                    targetEmployeeId: string;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            changed: boolean;
                            task: {
                                allowedActions: ("claim" | "release" | "transfer" | "extendDeadline")[];
                                assignee: {
                                    displayName: string;
                                    /** Format: uuid */
                                    id: string;
                                } | null;
                                business: {
                                    /** @description 由真实业务提供的安全应用内详情路径；未接页面时为null */
                                    detailPath: string | null;
                                    label: string;
                                    number: string;
                                };
                                /** Format: uuid */
                                businessId: string;
                                /** @enum {string} */
                                businessType: "INVENTORY_ADJUSTMENT" | "ORDER" | "AFTER_SALE" | "OFFLINE_CASE" | "CUSTODY_ARRANGEMENT";
                                /** Format: date-time */
                                dueAt: string | null;
                                /** Format: date-time */
                                firstOverdueAt: string | null;
                                hasEverOverdue: boolean;
                                /** Format: uuid */
                                id: string;
                                isCurrentlyOverdue: boolean;
                                /** Format: date-time */
                                originalDueAt: string | null;
                                reassignNeeded: boolean;
                                requiredPermissions: string[];
                                round: number;
                                /** @enum {string} */
                                stage: "INVENTORY_POST" | "INVENTORY_RECONCILE" | "SHIPMENT_PROCESS" | "HANDOVER_VERIFY" | "PHYSICAL_VERIFY" | "STOCK_EXCEPTION_VERIFY" | "SHIPMENT_EXCEPTION_VERIFY" | "CUSTOMER_CONTACT" | "AFTER_SALE_REVIEW" | "SUPPLEMENT_FOLLOW" | "RETURN_FOLLOW" | "RETURN_RECEIVE" | "RETURN_INSPECT" | "INSPECTION_EXCEPTION_CONTACT" | "REFUND_PROCESS" | "ADMIN_DISPUTE" | "ADMIN_STOCK_REVIEW" | "PROXY_INPUT" | "OFFLINE_FOLLOW" | "CUSTODY_EXECUTE";
                                /** Format: date-time */
                                startedAt: string;
                                /** @enum {string} */
                                status: "OPEN" | "CLAIMED" | "SUSPENDED" | "COMPLETED" | "CANCELLED";
                                version: number;
                            };
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            403: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FORBIDDEN" | "PASSWORD_CHANGE_REQUIRED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            404: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TASK_NOT_FOUND";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            409: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VERSION_CONFLICT" | "TARGET_NOT_ELIGIBLE" | "TASK_TRANSFER_BLOCKED" | "BUSINESS_MODULE_NOT_READY" | "TASK_LOCK_PLAN_CHANGED" | "TASK_VERSION_EXHAUSTED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    getTaskSummary: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: date-time */
                            asOf: string;
                            /** @enum {boolean} */
                            countsOverlap: true;
                            currentOverdue: number;
                            eligibleOpen: number;
                            everOverdue: number;
                            myPending: number;
                            reassignNeeded: number | null;
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            403: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FORBIDDEN" | "PASSWORD_CHANGE_REQUIRED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    logoutCurrentSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @enum {boolean} */
                            loggedOut: true;
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    uploadImage: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": {
                    /** Format: binary */
                    file: string;
                    /** @enum {string} */
                    purpose: "CUSTOMER_AVATAR" | "PRODUCT_IMAGE" | "AFTER_SALE_EVIDENCE" | "INVENTORY_EVIDENCE" | "FULFILLMENT_EVIDENCE" | "INSPECTION_EVIDENCE" | "COMMUNICATION_EVIDENCE";
                };
            };
        };
        responses: {
            201: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            byteSize: number;
                            /** @example /api/v1/files/f7ca2e71-40a4-4f09-afad-45241a7a27da/content */
                            contentUrl: string;
                            /** Format: date-time */
                            expiresAt: string | null;
                            height: number;
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            mimeType: "image/jpeg" | "image/png" | "image/webp";
                            /** @enum {string} */
                            purpose: "CUSTOMER_AVATAR" | "PRODUCT_IMAGE" | "AFTER_SALE_EVIDENCE" | "INVENTORY_EVIDENCE" | "FULFILLMENT_EVIDENCE" | "INSPECTION_EVIDENCE" | "COMMUNICATION_EVIDENCE";
                            /** @enum {string} */
                            state: "STAGED" | "RETAINED";
                            /** @enum {string} */
                            visibility: "PRIVATE" | "PUBLIC";
                            width: number;
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FILE_INVALID_UPLOAD" | "FILE_TYPE_NOT_ALLOWED" | "FILE_INVALID_IMAGE" | "FILE_ANIMATION_NOT_ALLOWED" | "FILE_DIMENSIONS_EXCEEDED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            403: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FORBIDDEN" | "PASSWORD_CHANGE_REQUIRED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            413: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FILE_TOO_LARGE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            429: {
                headers: {
                    "Retry-After"?: number;
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FILE_RATE_LIMITED" | "FILE_QUOTA_EXCEEDED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    getFileMetadata: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            byteSize: number;
                            /** @example /api/v1/files/f7ca2e71-40a4-4f09-afad-45241a7a27da/content */
                            contentUrl: string;
                            /** Format: date-time */
                            expiresAt: string | null;
                            height: number;
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            mimeType: "image/jpeg" | "image/png" | "image/webp";
                            /** @enum {string} */
                            purpose: "CUSTOMER_AVATAR" | "PRODUCT_IMAGE" | "AFTER_SALE_EVIDENCE" | "INVENTORY_EVIDENCE" | "FULFILLMENT_EVIDENCE" | "INSPECTION_EVIDENCE" | "COMMUNICATION_EVIDENCE";
                            /** @enum {string} */
                            state: "STAGED" | "RETAINED";
                            /** @enum {string} */
                            visibility: "PRIVATE" | "PUBLIC";
                            width: number;
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            404: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FILE_NOT_FOUND";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    getFileContent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    "Cache-Control"?: string;
                    "X-Content-Type-Options"?: "nosniff";
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "image/jpeg": string;
                    "image/png": string;
                    "image/webp": string;
                };
            };
            404: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FILE_NOT_FOUND";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            503: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FILE_STORAGE_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    getLiveness: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 进程可处理HTTP请求 */
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @enum {string} */
                            service: "shop-api";
                            /** @enum {string} */
                            status: "ok";
                            /**
                             * Format: date-time
                             * @description 服务器UTC时间
                             * @example 2026-11-11T02:00:00.000Z
                             */
                            timestamp: string;
                        };
                        /**
                         * Format: uuid
                         * @example 9bc421ac-5987-493e-a6cf-73fe46082272
                         */
                        requestId: string;
                    };
                };
            };
        };
    };
    getReadiness: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 数据库连接正常 */
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            checks: {
                                /** @enum {string} */
                                database: "up";
                            };
                            /** @enum {string} */
                            status: "ready";
                            /**
                             * Format: date-time
                             * @description 服务器UTC时间
                             * @example 2026-11-11T02:00:00.000Z
                             */
                            timestamp: string;
                        };
                        /**
                         * Format: uuid
                         * @example 9bc421ac-5987-493e-a6cf-73fe46082272
                         */
                        requestId: string;
                    };
                };
            };
            /** @description 数据库不可用或检查超时 */
            503: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "SERVICE_NOT_READY";
                        details: {
                            /** @enum {string} */
                            database: "unavailable";
                        };
                        /** @example 服务暂未就绪 */
                        message: string;
                        /**
                         * Format: uuid
                         * @example 9bc421ac-5987-493e-a6cf-73fe46082272
                         */
                        requestId: string;
                    };
                };
            };
        };
    };
    changeCustomerPassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * Format: password
                     * @description 8～64个Unicode码点且UTF-8最多72字节，保留空格，不截断或归一化；新旧密码必须不同
                     */
                    newPassword: string;
                    /**
                     * Format: password
                     * @description 8～64个Unicode码点且UTF-8最多72字节，保留空格，不截断或归一化；新旧密码必须不同
                     */
                    oldPassword: string;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @enum {boolean} */
                            changed: true;
                            /** @enum {boolean} */
                            requireLogin: true;
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "INVALID_CREDENTIALS" | "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    loginCustomer: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * Format: password
                     * @description 8～64个Unicode码点且UTF-8最多72字节，保留空格，不截断或归一化
                     * @example ShopDemo#2026
                     */
                    password: string;
                    /**
                     * @description 去首尾空白后的大陆11位手机号
                     * @example 13800138001
                     */
                    phone: string;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @description 仅登录成功返回的JWT，Authorize输入token本体 */
                            accessToken: string;
                            customer: {
                                /** @description 无头像时null；否则为/api/v1/files/{id}/content受控公开图片地址 */
                                avatarUrl: string | null;
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: uuid */
                                id: string;
                                nickname: string;
                                phone: string;
                                /** @enum {string} */
                                status: "NORMAL" | "TRADE_RESTRICTED";
                            };
                            /** Format: date-time */
                            expiresAt: string;
                            /** @enum {string} */
                            tokenType: "Bearer";
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "INVALID_CREDENTIALS" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            429: {
                headers: {
                    /** @description 等待秒数 */
                    "Retry-After"?: number;
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "AUTH_RATE_LIMITED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    registerCustomer: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @description 可省略，默认“新顾客”；提交时去首尾空白后1～40字符，不接受null或空白
                     * @example 顾客甲
                     */
                    nickname?: string;
                    /**
                     * Format: password
                     * @description 8～64个Unicode码点且UTF-8最多72字节，保留首尾空格，不截断或归一化
                     * @example ShopDemo#2026
                     */
                    password: string;
                    /**
                     * @description 去首尾空白后的大陆11位手机号；不代表实名或短信所有权验证
                     * @example 13800138001
                     */
                    phone: string;
                };
            };
        };
        responses: {
            201: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: uuid */
                            id: string;
                            nickname: string;
                            phone: string;
                            /** @enum {string} */
                            status: "NORMAL";
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            409: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "PHONE_EXISTS";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            429: {
                headers: {
                    /** @description 等待秒数 */
                    "Retry-After"?: number;
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "AUTH_RATE_LIMITED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    getStoreContact: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            configured: boolean;
                            serviceHours: string | null;
                            servicePhone: string | null;
                            settingsVersion: number;
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    getCustomerMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @description 无头像时null；否则为/api/v1/files/{id}/content受控公开图片地址 */
                            avatarUrl: string | null;
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: uuid */
                            id: string;
                            nickname: string;
                            phone: string;
                            /** @enum {string} */
                            status: "NORMAL" | "TRADE_RESTRICTED";
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    updateCustomerMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @description 去首尾空白后1～40个Unicode字符
                     * @example 顾客甲
                     */
                    nickname: string;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @description 无头像时null；否则为/api/v1/files/{id}/content受控公开图片地址 */
                            avatarUrl: string | null;
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: uuid */
                            id: string;
                            nickname: string;
                            phone: string;
                            /** @enum {string} */
                            status: "NORMAL" | "TRADE_RESTRICTED";
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    setCustomerAvatar: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    fileId: string;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            avatarAssetId: string | null;
                            avatarUrl: string | null;
                            changed: boolean;
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            404: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FILE_NOT_FOUND";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            409: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "FILE_PURPOSE_MISMATCH" | "FILE_NOT_BINDABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
    removeCustomerAvatar: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            avatarAssetId: string | null;
                            avatarUrl: string | null;
                            changed: boolean;
                        };
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            400: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "VALIDATION_FAILED";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            401: {
                headers: {
                    /** @description 服务器生成的请求编号，与响应体requestId一致 */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_SUBJECT_MISMATCH" | "SESSION_REVOKED" | "ACCOUNT_UNAVAILABLE";
                        details?: {
                            field?: string;
                            message?: string;
                        }[];
                        message: string;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
        };
    };
}
