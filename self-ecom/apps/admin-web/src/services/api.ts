/** 文件作用：创建后台 API 客户端、员工身份控制器和内存查询缓存。 */
import { createEmployeeClient } from '@shop/api-client';
import { EmployeeAuthController } from '../auth/controller';
import { EmployeeQueryController } from '../employees/query-controller';
import type { EmployeeDetail, EmployeeListData, EmployeeListQuery, PermissionCatalog } from '@shop/api-client';

const client = createEmployeeClient({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  onUnauthorized: () => employeeAuth.onUnauthorized(),
  onForbidden: code => employeeAuth.onForbidden(code),
});
export const api = client.api;
export const auth = client.auth;
export const session = client.session;
export const files = client.files;
export const employeeAuth = new EmployeeAuthController(client);
export const employees = client.employees;
export const employeeQueries = {
  list: new EmployeeQueryController<EmployeeListQuery, EmployeeListData>(session, employees.list),
  detail: new EmployeeQueryController<string, EmployeeDetail>(session, employees.detail),
  catalog: new EmployeeQueryController<undefined, PermissionCatalog>(session, employees.catalog),
};
