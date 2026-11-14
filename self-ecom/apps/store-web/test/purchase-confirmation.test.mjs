// 作用：恢复确认键时损坏或不可用的浏览器存储不能让结算页崩溃，成功载荷仍保持原样。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PURCHASE_KEY,readConfirmation} from '../src/customers/purchase-confirmation.ts';

const uuid='fd96c63d-e9af-4d22-833a-9c031852a131';
const confirmation={customerId:'customer-a',key:uuid,body:{quoteId:uuid,addressId:uuid,items:[{cartItemId:uuid,skuId:uuid,quantity:2}]}};
test('有效购买确认保留原键与原载荷，换人不恢复',()=>{
  let removed=false;const storage={getItem:()=>JSON.stringify(confirmation),removeItem:key=>{assert.equal(key,PURCHASE_KEY);removed=true;}};
  assert.deepEqual(readConfirmation(storage,'customer-a'),confirmation);assert.equal(removed,false);
  assert.equal(readConfirmation(storage,'customer-b'),null);assert.equal(removed,true);
});
test('浏览器拒绝读取和删除存储时返回空确认',()=>{
  const storage={getItem(){throw new Error('storage denied');},removeItem(){throw new Error('storage denied');}};
  assert.equal(readConfirmation(storage,'customer-a'),null);
});
test('浏览器访问sessionStorage属性即失败时仍可显示结算页面',()=>{
  assert.equal(readConfirmation(()=>{throw new Error('storage denied');},'customer-a'),null);
});
test('损坏载荷清理失败也不能让恢复过程抛错',()=>{
  assert.equal(readConfirmation({getItem:()=>'{',removeItem(){throw new Error('storage denied');}},'customer-a'),null);
});
