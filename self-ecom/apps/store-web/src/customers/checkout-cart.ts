// 购物车可被其他页面修改；按首批总量限制翻页，空页立即停止，最终购买清单仍由服务器报价校验。
import type {Cart} from './model';

export async function readCheckoutCart(loadPage:(page:number)=>Promise<Pick<Cart,'items'|'total'>>,pageSize:number){
 const first=await loadPage(1),rows=[...first.items],pages=Math.ceil(first.total/pageSize);
 for(let page=2;page<=pages;page++){
  const next=await loadPage(page);
  rows.push(...next.items);
  if(!next.items.length)break;
 }
 return rows;
}
