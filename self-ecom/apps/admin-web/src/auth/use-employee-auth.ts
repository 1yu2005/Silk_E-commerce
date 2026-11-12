/** 文件作用：把员工身份控制器的稳定快照接入 React 订阅。 */
import { useSyncExternalStore } from 'react';
import { employeeAuth } from '../services/api';

export function useEmployeeAuth() {
  return useSyncExternalStore(employeeAuth.subscribe, employeeAuth.getSnapshot);
}
