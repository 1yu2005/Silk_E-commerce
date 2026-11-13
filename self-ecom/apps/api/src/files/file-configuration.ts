// 作用：读取可调整的文件配额与清理周期；硬性图片安全上限不允许通过环境变量放宽。
import { readEnvironmentValues } from '../config/environment.js';
export const FILE_CONFIG = Symbol('FILE_CONFIG');
export interface FileConfiguration { stagedQuota: number; uploadsPerMinute: number; cleanupIntervalSeconds: number }
export function loadFileConfiguration(env = readEnvironmentValues()): FileConfiguration {
  function number(key: string, fallback: number, maximum: number) {
    const text = env[key] ?? String(fallback); const value = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`${key}: 须为1～${maximum}的整数`);
    return value;
  }
  return { stagedQuota: number('FILE_STAGED_QUOTA', 100, 1000), uploadsPerMinute: number('FILE_UPLOADS_PER_MINUTE', 20, 100),
    cleanupIntervalSeconds: number('FILE_CLEANUP_INTERVAL_SECONDS', 300, 86400) };
}
