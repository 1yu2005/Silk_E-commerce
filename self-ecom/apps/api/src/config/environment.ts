// 作用：读取根目录环境配置并验证端口、数据库连接及日志等启动约定。
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { parseEnv } from 'node:util';

export const APP_CONFIG = Symbol('APP_CONFIG');
export const projectRoot = resolve(__dirname, '../../../..');

export interface EnvironmentConfig {
  handoverTimeoutMs?:number;
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
  uploadDir: string;
  swaggerEnabled: boolean;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
}

/** 只报告变量名和校验规则，不在错误信息中插入传入值。 */
export function validateEnvironment(env: NodeJS.ProcessEnv): EnvironmentConfig {
  const issues: string[] = [];
  const handoverMinutes=Number(env.HANDOVER_TIMEOUT_MINUTES??'5');
  if(!Number.isInteger(handoverMinutes)||handoverMinutes<1||handoverMinutes>120)issues.push('HANDOVER_TIMEOUT_MINUTES: 必须为1～120的整数');
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    issues.push('NODE_ENV: 必须为 development、test 或 production');
  }

  const portText = env.PORT ?? '3000';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    issues.push('PORT: 必须为1～65535的整数');
  }

  const databaseUrl = env.DATABASE_URL ?? '';
  try {
    const url = new URL(databaseUrl);
    if (!['postgresql:', 'postgres:'].includes(url.protocol)
      || !url.hostname || !url.username || url.pathname.length <= 1 || url.hash) {
      throw new Error();
    }
  } catch {
    issues.push('DATABASE_URL: 必填，须为包含主机、用户名与数据库名的 PostgreSQL URL');
  }

  const corsOrigins = (env.CORS_ORIGINS ?? '').split(',').map(value => value.trim());
  const validOrigin = (origin: string) => {
    try {
      const url = new URL(origin);
      return ['http:', 'https:'].includes(url.protocol) && url.origin === origin;
    } catch {
      return false;
    }
  };
  if (corsOrigins.length !== 2 || new Set(corsOrigins).size !== 2
    || !corsOrigins.every(validOrigin)) {
    issues.push('CORS_ORIGINS: 必填，须为逗号分隔的两个不同HTTP/HTTPS来源，不含路径或通配符');
  }

  const uploadDir = env.UPLOAD_DIR ?? resolve(projectRoot, 'storage/uploads');
  if (!isAbsolute(uploadDir) || uploadDir.includes('\0')) {
    issues.push('UPLOAD_DIR: 必须为绝对路径');
  }

  const swaggerText = env.SWAGGER_ENABLED ?? 'false';
  if (swaggerText !== 'true' && swaggerText !== 'false') {
    issues.push('SWAGGER_ENABLED: 必须为 true 或 false');
  }

  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(logLevel)) {
    issues.push('LOG_LEVEL: 必须为支持的日志级别');
  }

  if (issues.length) throw new Error(`环境配置不合法：\n${issues.join('\n')}`);

  return {
    handoverTimeoutMs:handoverMinutes*60000,
    nodeEnv: nodeEnv as EnvironmentConfig['nodeEnv'],
    port,
    databaseUrl,
    corsOrigins,
    uploadDir,
    swaggerEnabled: swaggerText === 'true',
    logLevel: logLevel as EnvironmentConfig['logLevel'],
  };
}

export function readEnvironmentValues(
  env: NodeJS.ProcessEnv = process.env,
  envFile = resolve(projectRoot, '.env'),
): NodeJS.ProcessEnv {
  let fileValues: NodeJS.ProcessEnv = {};
  try {
    fileValues = parseEnv(readFileSync(envFile, 'utf8'));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      // 不要附带原始解析错误，其中可能包含配置值。
      // eslint-disable-next-line preserve-caught-error
      throw new Error('无法读取环境配置文件，请检查文件权限和格式');
    }
  }
  // 进程或容器中显式设置的配置优先于本地文件。
  const overrides = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined));
  return { ...fileValues, ...overrides };
}


/** 通用配置与JWT配置共用读取规则，各自校验所属配置项。 */
export function loadConfiguration(
  env: NodeJS.ProcessEnv = process.env,
  envFile = resolve(projectRoot, '.env'),
): EnvironmentConfig {
  return validateEnvironment(readEnvironmentValues(env, envFile));
}
