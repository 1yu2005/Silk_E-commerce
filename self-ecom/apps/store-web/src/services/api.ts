/** 文件作用：创建独立的顾客 API 客户端并连接顾客身份控制器。 */
import { createCustomerClient, createGeneratedClient } from '@shop/api-client';
import { CustomerAuthController } from '../auth/controller';

const client = createCustomerClient({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  onUnauthorized: () => customerAuth.onUnauthorized(), onForbidden: () => customerAuth.onForbidden(),
});
export const api = client.api;
export const auth = client.auth;
export const session = client.session;
export const files = client.files;
export const customerAuth = new CustomerAuthController(client);
export const publicContact = createGeneratedClient(api).getStoreContact;
