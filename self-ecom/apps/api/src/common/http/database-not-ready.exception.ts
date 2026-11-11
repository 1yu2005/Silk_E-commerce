import { ServiceUnavailableException } from '@nestjs/common';

/** 使用固定的公开错误，不附带驱动错误信息或连接字符串。 */
export class DatabaseNotReadyException extends ServiceUnavailableException {
  constructor() {
    super('服务暂未就绪');
  }
}
