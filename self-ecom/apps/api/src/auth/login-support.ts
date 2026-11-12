// 作用：提供不存在账号时使用的虚拟密码哈希，减少认证错误的时间差异。
// 固定虚拟bcrypt cost12哈希，仅用于不存在账号的等成本验证，不对应任何业务账号。
export const DUMMY_LOGIN_HASH = '$2b$12$1NoHddpnK7OJ6xbOOzXNH.1fxBsM.h3pRyy8FN0pAY8MspeWAp5de';
