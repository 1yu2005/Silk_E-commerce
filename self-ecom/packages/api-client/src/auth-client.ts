/** 文件作用：封装员工与顾客请求，隔离令牌并统一处理认证失效。 */
import axios, { type InternalAxiosRequestConfig } from 'axios';
import type { ApiResponse, AuthDomain, ChangePasswordData, ChangePasswordInput, CustomerLoginData, CustomerLoginInput,
  CustomerProfile, CustomerProfileInput, CustomerRegisterData, CustomerRegisterInput, EmployeeLoginData, EmployeeLoginInput,
  EmployeePermissions, EmployeeProfile, LoginCredential, LogoutData, EmployeeListQuery, EmployeeListData, EmployeeDetail,
  EmployeeCreateInput, EmployeeCreateData, EmployeeCommandInput, EmployeeProfileInput, EmployeeProfileData,
  EmployeeStatusData, EmployeePasswordResetInput, EmployeePasswordResetData, EmployeeRoleInput, EmployeeRoleData,
  EmployeeExtraPermissionsInput, EmployeeExtraPermissionsData, PermissionCatalog, CustomerAvatarData } from '@shop/shared';
import { ApiClientError, toApiClientError } from './api-error.js';
import { AuthSessionStore, type SessionOptions } from './session.js';
import { createFileClient } from './file-client.js';
import { createGeneratedClient } from './generated/client.js';

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
  const json = createGeneratedClient(api);
  const prefix = domain === 'EMPLOYEE' ? '/admin/' : '/store/';
  const requests = new WeakMap<object, { revision: number; authenticated: boolean }>();
  api.interceptors.request.use(config => {
    const path = requestPath(config, baseURL);
    const fileRequest = (config.method === 'post' && path === '/files') || (config.method === 'get'
      && /^\/files\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}(\/content)?$/i.test(path));
    const publicContact = config.method === 'get' && path === '/store/contact';
    if (!fileRequest && !publicContact && !path.startsWith(prefix) && path !== '/auth/logout' && !['/health/live', '/health/ready'].includes(path)) {
      throw new ApiClientError('CLIENT_REQUEST_TARGET_INVALID', '请求地址不属于当前站点API');
    }
    const isPublic = publicContact || (config.method === 'post' && [`${prefix}auth/login`, '/store/auth/register'].includes(path)) || path.startsWith('/health/');
    const current = session.current();
    // 每次读当前凭证，覆盖调用方或defaults中的旧Authorization；禁止Basic认证覆盖Bearer。
    config.headers.delete('Authorization'); delete config.auth;
    if (!isPublic && current.credential) config.headers.set('Authorization', `Bearer ${current.credential.accessToken}`);
    config.withCredentials = false;
    config.validateStatus = status => status >= 200 && status < 300;
    requests.set(config, { revision: current.revision, authenticated: !isPublic });
    return config;
  }, error => { throw toApiClientError(error); }, { synchronous: true });
  api.interceptors.response.use(response => response, async (error: unknown) => {
    // 私有图片失败时Axios仍按Blob返回JSON；受限解码错误体后再走原401/403与requestId流程。
    if (axios.isAxiosError(error) && error.response?.data instanceof Blob && error.response.data.size <= 65536
      && error.response.data.type.includes('json')) {
      try { error.response.data = JSON.parse(await error.response.data.text()); } catch { /* 非法错误体使用安全通用提示。 */ }
    }
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
  async function login<T extends LoginCredential>(send: () => Promise<ApiResponse<T>>): Promise<ApiResponse<T>> {
    const attempt = ++loginAttempt; session.current(); const revision = session.getLoginRevision();
    const response = await send();
    if (attempt === loginAttempt && revision === session.getLoginRevision()) session.save(response.data);
    return response;
  }
  async function changePassword(input: ChangePasswordInput): Promise<ApiResponse<ChangePasswordData>> {
    const revision = session.current().revision;
    const response = await (domain === 'EMPLOYEE' ? json.changeEmployeePassword({ body: input }) : json.changeCustomerPassword({ body: input }));
    session.clearIfCurrent(revision); return response;
  }
  async function logout(): Promise<ApiResponse<LogoutData>> {
    const revision = session.current().revision; ++loginAttempt;
    try { return await json.logoutCurrentSession({ body: {} }); }
    finally { session.clearIfCurrent(revision); }
  }
  return { api, json, session, login, changePassword, logout };
}

export function createEmployeeClient(options: AuthClientOptions = {}) {
  const client = createAuthTransport('EMPLOYEE', options);
  return { api: client.api, session: client.session, files: createFileClient(client.api), employees: {
    create: async (input: EmployeeCreateInput): Promise<ApiResponse<EmployeeCreateData>> => {
      const { username, displayName, role, initialPassword, reason } = input;
      return client.json.createEmployee({ body: { username, displayName, role, initialPassword, reason } });
    },
    list: async (query: EmployeeListQuery, signal?: AbortSignal): Promise<ApiResponse<EmployeeListData>> => {
      const { page, pageSize, keyword, role, status } = query;
      return client.json.listEmployees({ query: { page, pageSize, keyword, role, status }, signal });
    },
    detail: async (id: string, signal?: AbortSignal): Promise<ApiResponse<EmployeeDetail>> =>
      client.json.getEmployeeDetail({ path: { id }, signal }),
    updateProfile: async (id: string, input: EmployeeProfileInput): Promise<ApiResponse<EmployeeProfileData>> => {
      const { displayName, expectedVersion, reason } = input;
      return client.json.updateEmployeeProfile({ path: { id }, body: { displayName, expectedVersion, reason } });
    },
    enable: async (id: string, input: EmployeeCommandInput): Promise<ApiResponse<EmployeeStatusData>> => {
      const { expectedVersion, reason } = input;
      return client.json.enableEmployee({ path: { id }, body: { expectedVersion, reason } });
    },
    disable: async (id: string, input: EmployeeCommandInput): Promise<ApiResponse<EmployeeStatusData>> => {
      const { expectedVersion, reason } = input;
      return client.json.disableEmployee({ path: { id }, body: { expectedVersion, reason } });
    },
    resetPassword: async (id: string, input: EmployeePasswordResetInput): Promise<ApiResponse<EmployeePasswordResetData>> => {
      const { temporaryPassword, expectedVersion, reason } = input;
      return client.json.resetEmployeePassword({ path: { id }, body: { temporaryPassword, expectedVersion, reason } });
    },
    changeRole: async (id: string, input: EmployeeRoleInput): Promise<ApiResponse<EmployeeRoleData>> => {
      const { role, expectedVersion, reason } = input;
      return client.json.changeEmployeeRole({ path: { id }, body: { role, expectedVersion, reason } });
    },
    setExtraPermissions: async (id: string, input: EmployeeExtraPermissionsInput): Promise<ApiResponse<EmployeeExtraPermissionsData>> => {
      const { permissions, expectedVersion, reason } = input;
      return client.json.replaceEmployeeExtraPermissions({ path: { id }, body: { permissions, expectedVersion, reason } });
    },
    catalog: async (_input?: undefined, signal?: AbortSignal): Promise<ApiResponse<PermissionCatalog>> =>
      client.json.getPermissionCatalog({ signal }),
  }, auth: {
    login: (input: EmployeeLoginInput) => client.login<EmployeeLoginData>(() => client.json.loginEmployee({ body: input })),
    me: async (): Promise<ApiResponse<EmployeeProfile>> => client.json.getEmployeeMe(),
    permissions: async (): Promise<ApiResponse<EmployeePermissions>> => client.json.getEmployeeMePermissions(),
    changePassword: client.changePassword, logout: client.logout,
  } };
}
export function createCustomerClient(options: AuthClientOptions = {}) {
  const client = createAuthTransport('CUSTOMER', options);
  return { api: client.api, session: client.session, files: createFileClient(client.api), auth: {
    register: async (input: CustomerRegisterInput): Promise<ApiResponse<CustomerRegisterData>> => client.json.registerCustomer({ body: input }),
    login: (input: CustomerLoginInput) => client.login<CustomerLoginData>(() => client.json.loginCustomer({ body: input })),
    me: async (): Promise<ApiResponse<CustomerProfile>> => client.json.getCustomerMe(),
    updateProfile: async (input: CustomerProfileInput): Promise<ApiResponse<CustomerProfile>> => client.json.updateCustomerMe({ body: input }),
    setAvatar: async (fileId: string): Promise<ApiResponse<CustomerAvatarData>> => client.json.setCustomerAvatar({ body: { fileId } }),
    removeAvatar: async (): Promise<ApiResponse<CustomerAvatarData>> => client.json.removeCustomerAvatar(),
    changePassword: client.changePassword, logout: client.logout,
  } };
}
