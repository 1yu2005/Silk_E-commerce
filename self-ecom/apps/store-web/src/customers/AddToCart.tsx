// 作用：完整SKU才可加购；POST增量响应丢失时先查看购物车，不自动重发。
import {useState} from 'react';
import {Alert,Button} from 'antd';
import {Link} from 'react-router-dom';
import {catalog} from '../services/api';
import {useCustomerAuth} from '../auth/use-customer-auth';
import {AuthError} from '../auth/AuthError';
import {useStoreCommand} from './use-store-data';
export function AddToCart({sku}:{sku:{id:string;available:number;purchasable:boolean}|undefined}){
 const {status}=useCustomerAuth();const [added,setAdded]=useState(false);const cmd=useStoreCommand(()=>setAdded(true));
 return <div className="add-to-cart"><AuthError error={cmd.error}/>{cmd.blocked?<Alert type="warning" title="加购结果需确认" description={<>请求不会自动重发，请先<Link to="/cart">查看购物车</Link>确认数量，再决定是否继续添加。</>}/>:null}
 {status!=='ready'?<Link className="store-primary-link" to="/login">登录后加入购物车</Link>:<form onSubmit={e=>{e.preventDefault();if(sku)void cmd.run(()=>catalog.addCartItem({body:{skuId:sku.id,quantity:Number(new FormData(e.currentTarget).get('quantity'))}}));}}><label>添加数量<input aria-label="添加数量" name="quantity" type="number" min={1} max={Math.min(99,sku?.available??99)} step={1} defaultValue={1} required disabled={cmd.busy||cmd.blocked||!sku?.purchasable}/></label><Button htmlType="submit" type="primary" loading={cmd.busy} disabled={cmd.blocked||!sku?.purchasable}>加入购物车</Button></form>}
 {added?<p role="status">已加入购物车。<Link to="/cart">查看购物车 →</Link></p>:null}</div>;
}
