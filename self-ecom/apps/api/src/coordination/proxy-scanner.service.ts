// 作用：启动与定时补扫仅失效过期核实来源，不关闭售后或重建任务轮次。
import {Inject,Injectable,Logger,type OnApplicationBootstrap,type OnApplicationShutdown} from '@nestjs/common';
import {APP_CONFIG,type EnvironmentConfig} from '../config/environment.js';
import {ProxyInputService} from './proxy-input.service.js';
@Injectable()
export class ProxyInputScheduler implements OnApplicationBootstrap,OnApplicationShutdown {
 private readonly logger=new Logger(ProxyInputScheduler.name);private timer?:ReturnType<typeof setInterval>;private running?:Promise<void>;
 constructor(@Inject(ProxyInputService)private readonly service:ProxyInputService,@Inject(APP_CONFIG)private readonly config:EnvironmentConfig){}
 onApplicationBootstrap(){if(this.config.nodeEnv==='test'||this.timer)return;this.tick();this.timer=setInterval(()=>this.tick(),60000);this.timer.unref();}
 private tick(){this.running??=this.service.expire().then(()=>{}).catch(()=>{this.logger.error('身份核实到期补扫失败，下轮重试');}).finally(()=>{this.running=undefined;});}
 async onApplicationShutdown(){if(this.timer)clearInterval(this.timer);await this.running;}
}
