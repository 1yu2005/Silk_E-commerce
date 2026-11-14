// 作用：只接受列表明确支持的链接筛选，错误地址不退化为无筛选查询。
type Rule=readonly string[]|'uuid';
type Parsed={filters:Record<string,string>;issue?:never}|{filters?:never;issue:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseListLink(search:string,rules:Record<string,Rule>):Parsed {
  const params=new URLSearchParams(search),filters:Record<string,string>={};
  for(const [name,value] of params){
    const rule=Object.hasOwn(rules,name)?rules[name]:undefined;
    if(!rule||params.getAll(name).length!==1||!value)return {issue:'筛选地址含未知、重复或空参数，请重置筛选。'};
    if(rule==='uuid'){
      if(!uuid.test(value))return {issue:'筛选地址中的顾客编号格式不正确，请重置筛选。'};
      filters[name]=value.toLowerCase();
    }else{
      if(!rule.includes(value))return {issue:'筛选地址中的状态或预警条件不正确，请重置筛选。'};
      filters[name]=value;
    }
  }
  return {filters};
}
