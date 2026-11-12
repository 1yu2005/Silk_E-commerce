/** 文件作用：把顾客身份控制器的稳定快照接入 React 订阅。 */
import { useSyncExternalStore } from 'react';
import { customerAuth } from '../services/api';

export function useCustomerAuth() {
  return useSyncExternalStore(customerAuth.subscribe, customerAuth.getSnapshot);
}
