// 作用：在Vitest隔离进程内安装本轮临时目录保护；单文件业务删除与全部断言保持执行。
import { installArtifactRetention } from '../../../../docs/verification/evidence/M0-04/step11/retain-artifacts.mjs';
installArtifactRetention();
