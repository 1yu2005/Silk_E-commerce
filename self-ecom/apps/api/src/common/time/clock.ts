// 作用：提供可注入的服务器时钟，业务测试可替换为固定时刻，不修改宿主机时间。
import { Injectable } from '@nestjs/common';

export abstract class Clock {
  abstract now(): Date;
}

@Injectable()
export class SystemClock extends Clock {
  now(): Date { return new Date(); }
}
