// 作用：本期验证共用固定运行时与秘密脱敏；只把必要摘要写入公开证据。
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
export const root=process.cwd();
export const requireApi=createRequire(resolve('apps/api/package.json'));
export const env={...parseEnv(readFileSync('.env','utf8')),...process.env};
export const docker=env.DOCKER_EXECUTABLE??join(env.LOCALAPPDATA,'Programs/DockerDesktop/resources/bin/docker.exe');
export function redact(value){return Object.entries(env).filter(([k,v])=>/SECRET|PASSWORD|DATABASE_URL|TOKEN/.test(k)&&v?.length>5).reduce((s,[,v])=>s.replaceAll(v,'[REDACTED]'),String(value));}
