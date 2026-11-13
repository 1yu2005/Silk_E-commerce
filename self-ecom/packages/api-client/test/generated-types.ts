/** 文件作用：编译验证生成接口拒绝错误输入，并保留真实头像可空值、分页和文件类型。 */
import type { AxiosInstance } from 'axios';
import type { CustomerAvatarData, CustomerProfile, FileMetadata } from '@shop/shared';
import { createGeneratedClient } from '../src/generated/client.js';
import type { operations } from '../src/generated/schema.js';
declare const api: AxiosInstance;
const client = createGeneratedClient(api);
void client.setCustomerAvatar({ body: { fileId: 'id' } });
// @ts-expect-error 头像绑定只接受文件ID，不能传任意图片URL。
void client.setCustomerAvatar({ body: { avatarUrl: 'https://outside.invalid' } });
// @ts-expect-error 带路径的接口必须提供ID。
void client.getEmployeeDetail({});
// @ts-expect-error 分页为数字。
void client.listEmployees({ query: { page: '2' } });
// @ts-expect-error JSON调用器不能提供任意请求头覆盖认证。
void client.getCustomerMe({ headers: { Authorization: 'bad' } });
type Same<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
type Assert<T extends true> = T;
export type ProfileContract = Assert<Same<CustomerProfile, operations['getCustomerMe']['responses'][200]['content']['application/json']['data']>>;
export type AvatarContract = Assert<Same<CustomerAvatarData, operations['removeCustomerAvatar']['responses'][200]['content']['application/json']['data']>>;
export type FileContract = Assert<Same<FileMetadata, operations['getFileMetadata']['responses'][200]['content']['application/json']['data']>>;
