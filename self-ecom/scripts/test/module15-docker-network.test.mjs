import assert from 'node:assert/strict';
import {test} from 'node:test';
import {module15FreeSubnet} from '../module15-docker-network.mjs';

function ipam(subnets){
 const calls=[],docker=async args=>{calls.push(args);if(args[1]==='ls')return subnets.length?'network-1\nnetwork-2':'';return JSON.stringify(subnets.map(Subnet=>({Subnet})))+'\nnull';};
 return {calls,docker};
}

test('only reads existing network IPAM and selects the first non-overlapping /24',async()=>{
 const {docker,calls}=ipam(['172.17.0.0/16','192.168.0.0/16','10.215.0.0/24']);
 assert.equal(await module15FreeSubnet(docker),'10.215.1.0/24');
 assert.deepEqual(calls,[['network','ls','--format','{{.ID}}'],['network','inspect','--format','{{json .IPAM.Config}}','network-1','network-2']]);
});
test('larger and smaller occupied subnets both block candidates but adjacent networks do not',async()=>{
 const {docker}=ipam(['10.215.0.0/23','10.215.2.128/25','10.214.255.0/24','10.216.0.0/16','fd00::/64']);
 assert.equal(await module15FreeSubnet(docker),'10.215.3.0/24');
});
test('newly retained network is observed by the next allocation',async()=>{
 const subnets=['10.215.0.0/24'],{docker}=ipam(subnets),first=await module15FreeSubnet(docker);subnets.push(first);
 assert.equal(first,'10.215.1.0/24');assert.equal(await module15FreeSubnet(docker),'10.215.2.0/24');
});
test('no existing networks needs no inspect while a covering range rejects without mutation',async()=>{
 const empty=ipam([]);assert.equal(await module15FreeSubnet(empty.docker),'10.215.0.0/24');assert.equal(empty.calls.length,1);
 for(const subnet of ['10.215.0.0/16','10.0.0.0/8','0.0.0.0/0'])await assert.rejects(module15FreeSubnet(ipam([subnet]).docker),/existing networks were preserved/);
});
test('malformed IPv4 network information fails closed',async()=>{
 for(const subnet of ['10.215.0.0/33','10.215.0.256/24','10.215.0.0'])await assert.rejects(module15FreeSubnet(ipam([subnet]).docker),/invalid IPv4 subnet/);
});
