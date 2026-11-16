// Retained acceptance networks can exhaust Docker's default pools. Read IPAM and allocate a unique /24.
import assert from 'node:assert/strict';

function ipv4Range(subnet){
 if(subnet.includes(':'))return null;
 const [address,bits,...extra]=subnet.split('/'),octets=address.split('.').map(Number),prefix=Number(bits);
 assert.ok(extra.length===0&&bits!==undefined&&Number.isInteger(prefix)&&prefix>=0&&prefix<=32&&octets.length===4&&octets.every(value=>Number.isInteger(value)&&value>=0&&value<=255),'Docker returned an invalid IPv4 subnet');
 const value=octets.reduce((sum,octet)=>sum*256+octet,0),size=2**(32-prefix),start=Math.floor(value/size)*size;
 return {start,end:start+size-1};
}

export async function module15FreeSubnet(docker){
 const ids=String(await docker(['network','ls','--format','{{.ID}}'])).trim().split(/\s+/).filter(Boolean);
 const raw=ids.length?String(await docker(['network','inspect','--format','{{json .IPAM.Config}}',...ids])).trim():'';
 const occupied=raw?raw.split(/\r?\n/).flatMap(line=>JSON.parse(line)??[]).filter(config=>config.Subnet).map(config=>ipv4Range(config.Subnet)).filter(Boolean):[];
 for(let index=0;index<256;index++){
  const subnet='10.215.'+index+'.0/24',candidate=ipv4Range(subnet);
  if(occupied.every(range=>candidate.end<range.start||candidate.start>range.end))return subnet;
 }
 throw new Error('All 10.215.x.0/24 acceptance subnets are occupied; existing networks were preserved');
}
