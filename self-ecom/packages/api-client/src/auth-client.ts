/** 文件作用：封装员工与顾客请求，隔离令牌并统一处理认证失效。 */
import axios, { type InternalAxiosRequestConfig } from 'axios';
import type { ApiResponse, AuthDomain, ChangePasswordData, ChangePasswordInput, CustomerLoginData, CustomerLoginInput,
  CustomerProfile, CustomerProfileInput, CustomerRegisterData, CustomerRegisterInput, EmployeeLoginData, EmployeeLoginInput,
  EmployeePermissions, EmployeeProfile, LoginCredential, LogoutData, EmployeeListQuery, EmployeeListData, EmployeeDetail,
  EmployeeCreateInput, EmployeeCreateData, EmployeeCommandInput, EmployeeProfileInput, EmployeeProfileData,
  EmployeeStatusData, EmployeePasswordResetInput, EmployeePasswordResetData, EmployeeRoleInput, EmployeeRoleData,
  EmployeeExtraPermissionsInput, EmployeeExtraPermissionsData, PermissionCatalog } from '@shop/shared';
import { ApiClientError, toApiClientError } from './api-error.js';
import { AuthSessionStore, type SessionOptions } from './session.js';

export interface AuthClientOptions extends SessionOptions {
  baseURL?: string;
  onUnauthorized?: () => void;
  onForbidden?: (code: 'FORBIDDEN' | 'PASSWORD_CHANGE_REQUIRED') => void;
}

function requestPath(config: InternalAxiosRequestConfig, baseURL: string): string {
  const url = config.url;
  if (config.baseURL !== baseURL || typeof url !== 'string' || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url) || url.includes('\\')) {
    throw new ApiClientError('CLIENT_REQUEST_TARGET_INVALID', '请求地址不属于当前站点API');
  }
  const path = url.split(/[?#]/, 1)[0]!;
  if (/%(?:2f|5c|2e)/i.test(path)) throw new ApiClientError('CLIENT_REQUEST_TARGET_INVALID', '请求地址不属于当前站点API');
  return new URL(path.startsWith('/') ? path : `/${path}`, 'http://api.invalid').pathname;
}

function createAuthTransport(domain: AuthDomain, options: AuthClientOptions) {
  const baseURL = options.baseURL ?? '/api/v1';
  const session = new AuthSessionStore(domain, options);
  const api = axios.create({ baseURL, timeout: 10_000 });
  const prefix = domain === 'EMPLOYEE' ? '/admin/' : '/store/';
  const requests = new WeakMap<object, { revision: number; authenticated: boolean }>();
  api.interceptors.request.use(config => {
    const path = requestPath(config, baseURL);
    if (!path.startsWith(prefix) && path !== '/auth/logout' && !['/health/live', '/health/ready'].includes(path)) {
      throw new ApiClientError('CLIENT_REQUEST_TARGET_INVALID', '请求地址不属于当前站点API');
    }
    const isPublic = (config.method === 'post' && [`${prefix}auth/login`, '/store/auth/register'].includes(path)) || path.startsWith('/health/');
    const current = session.current();
    // 每次读当前凭证，覆盖调用方或defaults中的旧Authorization；禁止Basic认证覆盖Bearer。
    config.headers.delete('Authorization'); delete config.auth;
    if (!isPublic && current.credential) config.headers.set('Authorization', `Bearer ${current.credential.accessToken}`);
    config.withCredentials = false;
    config.validateStatus = status => status >= 200 && status < 300;
    requests.set(config, { revision: current.revision, authenticated: !isPublic });
    return config;
  }, error => { throw toApiClientError(error); }, { synchronous: true });
  api.interceptors.response.use(response => response, (error: unknown) => {
    const failure = toApiClientError(error);
    const request = axios.isAxiosError(error) && error.config ? requests.get(error.config) : undefined;
    // 迟到的旧401/403不能清掉新登录，公开登录失败也不能清除现有会话。
    if (request?.authenticated && request.revision === session.getSnapshot().revision) {
      if (failure.status === 401) {
        session.invalidateIfCurrent(request.revision);
        try { options.onUnauthorized?.(); } catch { /* 页面回调不覆盖原始请求错误。 */ }
      } else if (failure.status === 403) {
        try { options.onForbidden?.(failure.code === 'PASSWORD_CHANGE_REQUIRED' ? 'PASSWORD_CHANGE_REQUIRED' : 'FORBIDDEN'); }
        catch { /* 不在拦截器里自动刷新权限，避免403形成请求循环。 */ }
      }
    }
    throw failure;
  });

  let loginAttempt = 0;
  async function login<T extends LoginCredential>(path: string, input: EmployeeLoginInput | CustomerLoginInput): Promise<ApiResponse<T>> {
    const attempt = ++loginAttempt; session.current(); const revision = session.getLoginRevision();
    const response = await api.post<ApiResponse<T>>(path, input);
    if (attempt === loginAttempt && revision === session.getLoginRevision()) session.save(response.data.data);
    return response.data;
  }
  async function changePassword(input: ChangePasswordInput): Promise<ApiResponse<ChangePasswordData>> {
    const revision = session.current().revision;
    const response = await api.post<ApiResponse<ChangePasswordData>>(`${prefix}auth/change-password`, input);
    session.clearIfCurrent(revision); return response.data;
  }
  async function logout(): Promise<ApiResponse<LogoutData>> {
    const revision = session.current().revision; ++loginAttempt;
    try { return (await api.post<ApiResponse<LogoutData>>('/auth/logout', {})).data; }
    finally { session.clearIfCurrent(revision); }
  }
  return { api, session, login, changePassword, logout };
}

export function createEmployeeClient(options: AuthClientOptions = {}) {
  const client = createAuthTransport('EMPLOYEE', options);
  return { api: client.api, session: client.session, employees: {
    create: async (input: EmployeeCreateInput): Promise<ApiResponse<EmployeeCreateData>> => {
      const { username, displayName, role, initialPassword, reason } = input;
      return (await client.api.post<ApiResponse<EmployeeCreateData>>('/admin/employees', { username, displayName, role, initialPassword, reason })).data;
    },
    list: async (query: EmployeeListQuery, signal?: AbortSignal): Promise<ApiResponse<EmployeeListData>> => {
      const { page, pageSize, keyword, role, status } = query;
      return (await client.api.get<ApiResponse<EmployeeListData>>('/admin/employees', { params: { page, pageSize, keyword, role, status }, signal })).data;
    },
    detail: async (id: string, signal?: AbortSignal): Promise<ApiResponse<EmployeeDetail>> =>
      (await client.api.get<ApiResponse<EmployeeDetail>>(`/admin/employees/${encodeURIComponent(id.toLowerCase())}`, { signal })).data,
    updateProfile: async (id: string, input: EmployeeProfileInput): Promise<ApiResponse<EmployeeProfileData>> => {
      const { displayName, expectedVersion, reason } = input;
      return (await client.api.patch<ApiResponse<EmployeeProfileData>>(`/admin/employees/${encodeURIComponent(id.toLowerCase())}/profile`, { displayName, expectedVersion, reason })).data;
    },
    enable: async (id: string, input: EmployeeCommandInput): Promise<ApiResponse<EmployeeStatusData>> => {
      const { expectedVersion, reason } = input;
      return (await client.api.post<ApiResponse<EmployeeStatusData>>(`/admin/employees/${encodeURIComponent(id.toLowerCase())}/enable`, { expectedVersion, reason })).data;
    },
    disable: async (id: string, input: EmployeeCommandInput): Promise<ApiResponse<EmployeeStatusData>> => {
      const { expectedVersion, reason } = input;
      return (await client.api.post<ApiResponse<EmployeeStatusData>>(`/admin/employees/${encodeURIComponent(id.toLowerCase())}/disable`, { expectedVersion, reason })).data;
    },
    resetPassword: async (id: string, input: EmployeePasswordResetInput): Promise<ApiResponse<EmployeePasswordResetData>> => {
      const { temporaryPassword, expectedVersion, reason } = input;
      return (await client.api.post<ApiResponse<EmployeePasswordResetData>>(`/admin/employees/${encodeURIComponent(id.toLowerCase())}/reset-password`, { temporaryPassword, expectedVersion, reason })).data;
    },
    changeRole: async (id: string, input: EmployeeRoleInput): Promise<ApiResponse<EmployeeRoleData>> => {
      const { role, expectedVersion, reason } = input;
      return (await client.api.post<ApiResponse<EmployeeRoleData>>(`/admin/employees/${encodeURIComponent(id.toLowerCase())}/change-role`, { role, expectedVersion, reason })).data;
    },
    setExtraPermissions: async (id: string, input: EmployeeExtraPermissionsInput): Promise<ApiResponse<EmployeeExtraPermissionsData>> => {
      const { permissions, expectedVersion, reason } = input;
      return (await client.api.put<ApiResponse<EmployeeExtraPermissionsData>>(`/admin/employees/${encodeURIComponent(id.toLowerCase())}/extra-permissions`, { permissions, expectedVersion, reason })).data;
    },
    catalog: async (_input?: undefined, signal?: AbortSignal): Promise<ApiResponse<PermissionCatalog>> =>
      (await client.api.get<ApiResponse<PermissionCatalog>>('/admin/permissions', { signal })).data,
  }, auth: {
    login: (input: EmployeeLoginInput) => client.login<EmployeeLoginData>('/admin/auth/login', input),
    me: async (): Promise<ApiResponse<EmployeeProfile>> => (await client.api.get<ApiResponse<EmployeeProfile>>('/admin/me')).data,
    permissions: async (): Promise<ApiResponse<EmployeePermissions>> => (await client.api.get<ApiResponse<EmployeePermissions>>('/admin/me/permissions')).data,
    changePassword: client.changePassword, logout: client.logout,
  } };
}
export function createCustomerClient(options: AuthClientOptions = {}) {
  const client = createAuthTransport('CUSTOMER', options);
  return { api: client.api, session: client.session, auth: {
    register: async (input: CustomerRegisterInput): Promise<ApiResponse<CustomerRegisterData>> => (await client.api.post<ApiResponse<CustomerRegisterData>>('/store/auth/register', input)).data,
    login: (input: CustomerLoginInput) => client.login<CustomerLoginData>('/store/auth/login', input),
    me: async (): Promise<ApiResponse<CustomerProfile>> => (await client.api.get<ApiResponse<CustomerProfile>>('/store/me')).data,
    updateProfile: async (input: CustomerProfileInput): Promise<ApiResponse<CustomerProfile>> => (await client.api.patch<ApiResponse<CustomerProfile>>('/store/me', input)).data,
    changePassword: client.changePassword, logout: client.logout,
  } };
}
