/** 文件作用：定义员工与顾客认证接口的白名单输入和输出类型。 */
export type AuthDomain = 'EMPLOYEE' | 'CUSTOMER';
export type EmployeeRole = 'SUPER_ADMIN' | 'MERCH_WAREHOUSE' | 'CUSTOMER_SERVICE';
export type AvailableCustomerStatus = 'NORMAL' | 'TRADE_RESTRICTED';

export interface EmployeeProfile {
  id: string; username: string; displayName: string; role: EmployeeRole; status: 'ACTIVE' | 'DISABLED'; mustChangePassword: boolean;
}
export interface CustomerProfile {
  id: string; phone: string; nickname: string; avatarUrl: null; status: AvailableCustomerStatus; createdAt: string;
}
export interface EmployeeLoginInput { username: string; password: string }
export interface CustomerLoginInput { phone: string; password: string }
export interface CustomerRegisterInput extends CustomerLoginInput { nickname?: string }
export interface CustomerProfileInput { nickname: string }
export interface ChangePasswordInput { oldPassword: string; newPassword: string }
export interface LoginCredential { accessToken: string; tokenType: 'Bearer'; expiresAt: string }
export interface EmployeeLoginData extends LoginCredential { mustChangePassword: boolean; employee: EmployeeProfile }
export interface CustomerLoginData extends LoginCredential { customer: CustomerProfile }
export interface CustomerRegisterData { id: string; phone: string; nickname: string; status: 'NORMAL'; createdAt: string }
export interface ChangePasswordData { changed: true; requireLogin: true }
export interface LogoutData { loggedOut: true }
export interface EmployeePermissions {
  role: EmployeeRole; permissionVersion: number; defaultPermissions: string[]; extraPermissions: string[]; effectivePermissions: string[];
}
