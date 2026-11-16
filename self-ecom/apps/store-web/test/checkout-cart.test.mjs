// 结算读取多页购物车时，其他标签页删改项目不能造成永不结束的读取。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readCheckoutCart} from '../src/customers/checkout-cart.ts';

test('结算保留各页购物车项目及顺序',async()=>{
 const pages=[{items:[{id:'a'},{id:'b'}],total:3},{items:[{id:'c'}],total:3}],calls=[];
 const rows=await readCheckoutCart(async page=>{calls.push(page);return pages[page-1];},2);
 assert.deepEqual(rows.map(row=>row.id),['a','b','c']);
 assert.deepEqual(calls,[1,2]);
});

test('读下一页前购物车缩减时，空页结束读取而不会无限翻页',async()=>{
 const calls=[];
 const rows=await readCheckoutCart(async page=>{
  calls.push(page);assert.ok(page<=2,'购物车缩减后不能继续请求不存在的页面');
  return page===1?{items:[{id:'a'},{id:'b'}],total:5}:{items:[],total:2};
 },2);
 assert.deepEqual(rows.map(row=>row.id),['a','b']);
 assert.deepEqual(calls,[1,2]);
});

test('购物车翻页发生偏移时仍以第一页页数为界，避免依赖累计行数收敛',async()=>{
 const calls=[];
 const rows=await readCheckoutCart(async page=>{
  calls.push(page);assert.ok(page<=2,'读取范围不能随累计行数无限扩张');
  return {items:[{id:String(page)}],total:4};
 },2);
 assert.deepEqual(rows.map(row=>row.id),['1','2']);
 assert.deepEqual(calls,[1,2]);
});
