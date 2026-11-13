/** 文件作用：创建后台 API 客户端、员工身份控制器和内存查询缓存。 */
import { createEmployeeClient, createGeneratedClient } from '@shop/api-client';
import { EmployeeAuthController } from '../auth/controller';
import { EmployeeQueryController } from '../employees/query-controller';
import type { EmployeeDetail, EmployeeListData, EmployeeListQuery, PermissionCatalog } from '@shop/api-client';
import type { CurrentSettings, SettingsHistory, SettingsVersion } from '../settings/model';
import type { TaskDetail, TaskHistory, TaskList, TaskSearch, TaskSummary } from '../tasks/model';
import type { CategoryTree, Draft, Product, ProductQuery, Products } from '../catalog/model';

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
// 沿用已验证的内存查询、取消和会话隔离能力；设置请求直接使用生成调用器。
export const settings = createGeneratedClient(api);
export const settingsQueries = {
  current: new EmployeeQueryController<undefined, CurrentSettings>(session, (_, signal) => settings.getStoreSettings({ signal }), '全店设置读取失败，请重试'),
  history: new EmployeeQueryController<{ page: number; pageSize: number }, SettingsHistory>(session, (query, signal) => settings.listStoreSettingVersions({ query, signal }), '版本历史读取失败，请重试'),
  detail: new EmployeeQueryController<string, SettingsVersion>(session, (id, signal) => settings.getStoreSettingVersion({ path: { id }, signal }), '设置版本读取失败，请重试'),
};
// 设置和任务共享同一个无状态生成调用器，避免重复创建整套HTTP方法；查询缓存仍各自独立。
export const tasks = settings;
export const catalog=settings;
export const catalogQueries={
  categories:new EmployeeQueryController<undefined,CategoryTree>(session,(_,signal)=>catalog.getAdminCategoryTree({signal}),'分类读取失败'),
  products:new EmployeeQueryController<ProductQuery,Products>(session,(query,signal)=>catalog.listAdminProducts({query,signal}),'商品读取失败'),
  product:new EmployeeQueryController<string,Product>(session,(id,signal)=>catalog.getAdminProduct({path:{id},signal}),'商品读取失败'),
  draft:new EmployeeQueryController<string,Draft>(session,(id,signal)=>catalog.getInitialInventoryDraft({path:{id},signal}),'数量草稿读取失败'),
};
export const taskQueries = {
  list: new EmployeeQueryController<TaskSearch, TaskList>(session, (query, signal) => tasks.listTasks({ query, signal }), '任务列表读取失败，请重试'),
  summary: new EmployeeQueryController<undefined, TaskSummary>(session, (_, signal) => tasks.getTaskSummary({ signal }), '任务摘要读取失败，请重试'),
  detail: new EmployeeQueryController<string, TaskDetail>(session, (id, signal) => tasks.getTaskDetail({ path: { id }, signal }), '任务详情读取失败，请重试'),
  history: new EmployeeQueryController<{ id: string; page: number }, TaskHistory>(session, ({ id, page }, signal) => tasks.getTaskHistory({ path: { id }, query: { page, pageSize: 10 }, signal }), '任务历史读取失败，请重试'),
  targets: new EmployeeQueryController<EmployeeListQuery, EmployeeListData>(session, employees.list, '转交候选员工读取失败，请重试'),
};
