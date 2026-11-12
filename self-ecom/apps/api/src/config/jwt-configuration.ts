// 作用：按认证启动入口读取并严格校验 JWT 密钥和会话期限，错误不输出秘密。
import { resolve } from 'node:path';
import { projectRoot, readEnvironmentValues } from './environment.js';

export interface JwtConfiguration { secret: string; ttlSeconds: number }

/** 只报告配置名和规则，禁止在异常中包含密钥原文。 */
export function validateJwtConfiguration(env: NodeJS.ProcessEnv): JwtConfiguration {
  const secret = env.JWT_SECRET ?? '';
  const issues: string[] = [];
  if (!secret.trim() || Buffer.byteLength(secret, 'utf8') < 32) {
    issues.push('JWT_SECRET: 必填，须为至少32字节的随机密钥');
  }
  const ttlText = env.JWT_TTL_SECONDS ?? '7200';
  const ttlSeconds = Number(ttlText);
  if (!/^[1-9][0-9]*$/.test(ttlText) || !Number.isSafeInteger(ttlSeconds) || ttlSeconds > 86_400) {
    issues.push('JWT_TTL_SECONDS: 必须为1～86400的整数字符串，默认7200');
  }
  if (issues.length) throw new Error(`JWT配置不合法：\n${issues.join('\n')}`);
  return { secret, ttlSeconds };
}

export function loadJwtConfiguration(env: NodeJS.ProcessEnv = process.env,
  envFile = resolve(projectRoot, '.env')): JwtConfiguration {
  return validateJwtConfiguration(readEnvironmentValues(env, envFile));
}
