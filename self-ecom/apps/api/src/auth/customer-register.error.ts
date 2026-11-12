// 作用：定义手机号已注册错误，供唯一约束冲突的安全映射使用。
export class CustomerPhoneExistsError extends Error {
  constructor() { super('手机号已注册'); this.name = 'CustomerPhoneExistsError'; }
}
