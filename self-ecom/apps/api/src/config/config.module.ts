// 作用：加载并注入经校验的工程环境配置，供业务和基础设施模块使用。
import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfiguration } from './environment.js';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfiguration() }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
