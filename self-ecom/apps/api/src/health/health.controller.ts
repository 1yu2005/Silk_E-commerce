import { Controller, Get, Inject } from '@nestjs/common';
import { DatabaseNotReadyException } from '../common/http/database-not-ready.exception.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { healthSuccessSchema, notReadySchema, requestIdHeader } from './health.openapi.js';

@Controller('health')
@ApiTags('Health')
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get('live')
  @ApiOperation({ operationId: 'getLiveness', summary: '检查API进程存活', description: '不查询数据库，不接收业务参数。' })
  @ApiOkResponse({ description: '进程可处理HTTP请求', headers: requestIdHeader, schema: healthSuccessSchema(false) })
  getLiveness() {
    return {
      status: 'ok',
      service: 'shop-api',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @ApiOperation({ operationId: 'getReadiness', summary: '检查数据库就绪', description: '通过有界超时的SELECT 1检查数据库连接；不代表迁移已全部应用。' })
  @ApiOkResponse({ description: '数据库连接正常', headers: requestIdHeader, schema: healthSuccessSchema(true) })
  @ApiServiceUnavailableResponse({ description: '数据库不可用或检查超时', headers: requestIdHeader, schema: notReadySchema })
  async getReadiness() {
    try {
      await this.prisma.ping();
    } catch {
      throw new DatabaseNotReadyException();
    }
    return {
      status: 'ready',
      checks: { database: 'up' },
      timestamp: new Date().toISOString(),
    };
  }
}
