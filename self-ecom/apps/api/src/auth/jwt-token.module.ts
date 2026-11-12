// 作用：读取并校验 JWT 配置，为认证模块提供固定算法的令牌服务。
import { Module } from '@nestjs/common';
import { loadJwtConfiguration } from '../config/jwt-configuration.js';
import { JwtTokenService } from './jwt-token.service.js';

// 由认证模块显式导入；只提供令牌服务，不注册路由，seed仍按自身入口校验配置。
@Module({ providers: [{ provide: JwtTokenService, useFactory: () => new JwtTokenService(loadJwtConfiguration()) }],
  exports: [JwtTokenService] })
export class JwtTokenModule {}
