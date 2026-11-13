// 作用：复用原普通/数据库配置，仅为本轮验收增加工作进程内的临时目录保护。
import { fileURLToPath } from 'node:url';
import { mergeConfig } from 'vitest/config';
import unit from '../../vitest.config.mts';
import integration from '../../vitest.integration.config.mts';
export default mergeConfig(process.env.FULL_VERIFICATION_KIND === 'integration' ? integration : unit, {
  test: { setupFiles: [fileURLToPath(new URL('./retained.setup.mjs', import.meta.url))] },
});
