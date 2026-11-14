// 链接筛选必须保留明确条件；坏地址不能静默变成全量读取。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseListLink} from '../src/routing/list-link.ts';

test('待发货链接与既有顾客编号同时保留，UUID规范化不改变归属',()=>{
  const customer='00112233-4455-4677-8899-AABBCCDDEEFF';
  const parsed=parseListLink(new URLSearchParams({status:'WAIT_SHIPMENT',customerId:customer}).toString(),{status:['WAIT_SHIPMENT','COMPLETED'],customerId:'uuid'});
  assert.deepEqual(parsed.filters,{status:'WAIT_SHIPMENT',customerId:customer.toLowerCase()});
  assert.deepEqual(parseListLink('',{status:['WAIT_SHIPMENT'],customerId:'uuid'}).filters,{});
});

test('未知、重复、空、非法状态与顾客号不允许退化为未筛选结果',()=>{
  const rules={status:['WAIT_SHIPMENT'],customerId:'uuid'};
  for(const search of ['status=WAIT_SHIPMENT&status=COMPLETED','status=','status=UNKNOWN','status=WAIT_SHIPMENT%00','customerId=not-an-id','customerId=','password=x','constructor=x','__proto__=x']){
    const parsed=parseListLink(search,rules);assert.ok(parsed.issue,search);assert.equal(parsed.filters,undefined,search);
  }
});

test('售后状态和预警true/false保留原义；混入其他列表条件明确拒绝',()=>{
  assert.deepEqual(parseListLink('status=PENDING_REVIEW',{status:['PENDING_REVIEW']}).filters,{status:'PENDING_REVIEW'});
  for(const value of ['true','false'])assert.deepEqual(parseListLink('lowStock='+value,{lowStock:['true','false']}).filters,{lowStock:value});
  for(const search of ['lowStock=1','lowStock=FALSE','lowStock=true&lowStock=false','lowStock=true&status=PENDING_REVIEW'])assert.ok(parseListLink(search,{lowStock:['true','false']}).issue,search);
});
