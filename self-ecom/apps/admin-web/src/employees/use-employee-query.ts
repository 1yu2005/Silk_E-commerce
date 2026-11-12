/** 文件作用：订阅员工查询并在参数变化时隐藏上一份结果。 */
import { useEffect, useSyncExternalStore } from 'react';
import type { EmployeeQueryController } from './query-controller';

export function useEmployeeQuery<Input, Data>(controller: EmployeeQueryController<Input, Data>, key: string, input: Input) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => { void controller.read(key, input); }, [controller, key, input]);
  // 参数变化后不把上一筛选或上一员工的资料短暂显示在新地址下。
  return snapshot.key === key ? snapshot : { key, status: 'loading' as const, data: null, error: null };
}
