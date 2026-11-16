// 作用：保护所有已有容器的身份、镜像、挂载和运行状态；另记已有故障容器的自主重启。
import assert from 'node:assert/strict';

export const originalContainerTemplate='{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"mounts":{{json .Mounts}},"restartCount":{{.RestartCount}},"running":{{.State.Running}},"startedAt":{{json .State.StartedAt}},"restartPolicy":{{json .HostConfig.RestartPolicy}},"project":{{json (index .Config.Labels "com.docker.compose.project")}}}';

export function protectOriginalContainers(before,after){
 assert.equal(after.length,before.length,'已有容器不能丢失');
 const current=new Map(after.map(row=>[row.id,row])),autonomousRestarts=[];
 assert.equal(current.size,after.length,'已有容器身份不能重复');
 for(const previous of before){
  const next=current.get(previous.id);assert.ok(next,'已有容器必须保留');
  for(const field of ['id','name','image','mounts','running','restartPolicy','project'])assert.deepEqual(next[field],previous[field],'已有容器字段变更：'+field);
  if(next.startedAt===previous.startedAt){assert.equal(next.restartCount,previous.restartCount,'重启计数不能无解释改变');continue;}
  assert.notEqual(previous.project,'self-ecom','常用环境服务不能在隔离验收中重启');
  assert.ok(previous.running&&next.running&&previous.restartCount>0&&next.restartCount>previous.restartCount
   &&['always','unless-stopped'].includes(previous.restartPolicy?.Name),'只有原已重启中的其它容器可登记自主重启');
  autonomousRestarts.push({id:previous.id,name:previous.name,project:previous.project,before:{startedAt:previous.startedAt,restartCount:previous.restartCount},after:{startedAt:next.startedAt,restartCount:next.restartCount}});
 }
 return autonomousRestarts;
}
