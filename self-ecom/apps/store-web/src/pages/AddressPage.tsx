// 作用：本人地址簿，默认切换及删除均携带最新版本；冲突后由用户重读并确认。
import {useCallback,useState,useSyncExternalStore} from 'react';
import {Alert,Button,Empty,Spin,Tag} from 'antd';
import {catalog,session} from '../services/api';
import {AuthError} from '../auth/AuthError';
import {useStoreCommand,useStoreQuery} from '../customers/use-store-data';
import type {Address,AddressInput} from '../customers/model';
export function AddressPage(){const {revision}=useSyncExternalStore(session.subscribe,session.getSnapshot);const [epoch,setEpoch]=useState(0);return <AddressBook key={revision+':'+epoch} reload={()=>setEpoch(n=>n+1)}/>;}
function AddressBook({reload}:{reload:()=>void}){
 const load=useCallback(async(signal:AbortSignal)=>(await catalog.listAddresses({signal})).data,[]);const query=useStoreQuery(load,'addresses');
 const [editing,setEditing]=useState<Address|'new'|null>(null);const cmd=useStoreCommand(reload);const disabled=cmd.busy||cmd.blocked;
 return <section className="customer-workspace"><div className="customer-heading"><div><span className="store-kicker">YOUR ADDRESS BOOK</span><h1>收货地址</h1><p>保存常用地址，下一次挑选衣服时更从容。</p></div><Button type="primary" disabled={disabled||!query?.data||query.data.items.length>=20} onClick={()=>setEditing('new')}>新增地址</Button></div>
 <p>已保存 {query?.data?.items.length??'…'} / 20 条。修改地址簿不会改变已经提交的订单。</p><AuthError error={cmd.error}/>
 {cmd.blocked?<Alert type="warning" title="请读取最新地址后重新确认" description="提交可能冲突或结果尚未确认，不会自动重发。" action={<Button onClick={reload}>读取最新地址</Button>}/>:null}
 {!query?.data?<>{query?.error?<AuthError error={query.error}/>:<Spin/>}<Button onClick={reload}>重新读取地址</Button></>:<>
 {!query.data.items.some(a=>a.isDefault)&&query.data.items.length>0?<Alert type="info" title="当前没有默认地址，下单时需自行选择。"/>:null}
 {query.data.items.length===0?<Empty description="还没有保存地址"/>:<div className="address-grid">{query.data.items.map(a=><article key={a.id} className="address-card"><header><strong>{a.receiver}</strong>{a.isDefault?<Tag color="green">默认地址</Tag>:null}</header><p>{a.phone}</p><p>{a.province} {a.city} {a.district}<br/>{a.detail}</p><div className="customer-actions"><Button disabled={disabled} onClick={()=>setEditing(a)}>编辑</Button><Button disabled={disabled||a.isDefault} onClick={()=>void cmd.run(()=>catalog.setDefaultAddress({path:{id:a.id},body:{expectedVersion:a.version}}))}>设为默认</Button><Button danger disabled={disabled} onClick={()=>{if(window.confirm('删除这条地址？删除默认地址后可以没有默认地址。'))void cmd.run(()=>catalog.deleteAddress({path:{id:a.id},body:{expectedVersion:a.version}}));}}>删除</Button></div></article>)}</div>}
 {editing?<AddressForm key={editing==='new'?'new':editing.id+':'+editing.version} value={editing==='new'?undefined:editing} disabled={disabled} close={()=>setEditing(null)} save={body=>void cmd.run(()=>editing==='new'?catalog.createAddress({body}):catalog.updateAddress({path:{id:editing.id},body:{...body,expectedVersion:editing.version}}))}/>:null}
 </>}</section>;
}
function AddressForm({value,disabled,save,close}:{value?:Address;disabled:boolean;save:(body:AddressInput)=>void;close:()=>void}){
 return <form className="customer-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);save({receiver:String(f.get('receiver')),phone:String(f.get('phone')),province:String(f.get('province')),city:String(f.get('city')),district:String(f.get('district')),detail:String(f.get('detail')),isDefault:f.get('isDefault')==='on'});}}><h2>{value?'编辑地址':'新增地址'}</h2><fieldset disabled={disabled}>
 <label>收货人<input name="receiver" required maxLength={40} autoComplete="shipping name" defaultValue={value?.receiver}/></label><label>联系电话<input name="phone" required minLength={3} maxLength={30} pattern="\+?[0-9 -]{3,30}" autoComplete="shipping tel" defaultValue={value?.phone}/></label>
 <div className="address-region">{(['province','city','district'] as const).map((key,i)=><label key={key}>{['省 / 直辖市','城市','区 / 县'][i]}<input name={key} required maxLength={50} defaultValue={value?.[key]}/></label>)}</div>
 <label>详细地址<textarea name="detail" required maxLength={200} rows={3} autoComplete="shipping street-address" defaultValue={value?.detail}/></label><label className="customer-check"><input type="checkbox" name="isDefault" defaultChecked={value?.isDefault??false}/>设为默认地址</label><p className="muted">电话仅作格式规范化，未进行短信或号码归属验证。地区由你填写，不自动判断配送范围。</p><div className="customer-actions"><Button htmlType="submit" type="primary">保存地址</Button><Button onClick={close}>取消编辑</Button></div></fieldset></form>;
}
