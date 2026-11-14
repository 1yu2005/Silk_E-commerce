// 作用：验证不可信历史载荷的展示边界、北京默认窗口、严格DTO和查询容量约定。
import 'reflect-metadata';
import {randomUUID} from 'node:crypto';
import {plainToInstance} from 'class-transformer';
import {validate} from 'class-validator';
import {expect,it} from 'vitest';
import {AuditFilterOptionsDto,AuditListQueryDto} from '../src/audit-query/audit-query.dto.js';
import {auditQueryRange} from '../src/audit-query/audit-query.service.js';
import {projectAuditDetails,safeAuditId,safeAuditRequestId,safeBusinessNo,safeEmployeeIdentity} from '../src/audit-query/audit-query.policy.js';
const now=new Date('2030-11-14T18:30:00Z');
it('默认最近7个北京日期，asOf上界不含；显式时区等价转换',()=>{
  expect(auditQueryRange(new AuditListQueryDto(),now)).toEqual({from:new Date('2030-11-08T16:00:00Z'),to:now});
  expect(auditQueryRange(Object.assign(new AuditListQueryDto(),{from:'2030-11-14T00:00:00+08:00',to:'2030-11-15T00:00:00+08:00'}),now))
    .toEqual({from:new Date('2030-11-13T16:00:00Z'),to:new Date('2030-11-14T16:00:00Z')});
});
it('精确允许366天/10000定位，超出或矛盾主体明确拒绝',()=>{
  const from=new Date(now.getTime()-366*86400000).toISOString();
  expect(()=>auditQueryRange(Object.assign(new AuditListQueryDto(),{from,page:100,pageSize:100}),now)).not.toThrow();
  for(const input of [{from:new Date(Date.parse(from)-1).toISOString()},{page:101,pageSize:100}])expect(()=>auditQueryRange(Object.assign(new AuditListQueryDto(),input),now)).toThrowError(expect.objectContaining({code:'QUERY_RANGE_TOO_LARGE'}));
  for(const input of [{from:now.toISOString()},{actorType:'SYSTEM',actorEmployeeId:randomUUID()},{actorEmployeeId:randomUUID(),actorCustomerId:randomUUID()}])expect(()=>auditQueryRange(Object.assign(new AuditListQueryDto(),input),now)).toThrowError(expect.objectContaining({code:'VALIDATION_FAILED'}));
});
it.each([{page:'1e2'},{pageSize:'101'},{page:['1','2']},{businessNo:''},{actorType:'UNKNOWN'},{actorEmployeeId:'private-input'},
  {from:'2030-11-15T00:00:00'},{from:'2030-02-30T00:00:00Z'},{from:['2030-11-15T00:00:00Z']},{action:'unknown.action'},
  {targetType:'private-input'},{arbitrary:'private-input'}])('非法、重复和未知筛选不进入服务 %#',async input=>{
  const errors=await validate(plainToInstance(AuditListQueryDto,input),{whitelist:true,forbidNonWhitelisted:true});expect(errors.length).toBeGreaterThan(0);
});
it('筛选选项上限100，UUID和业务号只标准化已声明输入',async()=>{
  const id=randomUUID().toUpperCase(),query=plainToInstance(AuditListQueryDto,{actorEmployeeId:id,businessNo:'  O123  ',page:'1',pageSize:'100'});
  expect(await validate(query)).toEqual([]);expect(query.actorEmployeeId).toBe(id.toLowerCase());expect(query.businessNo).toBe('O123');
  expect((await validate(plainToInstance(AuditFilterOptionsDto,{limit:'101'}))).length).toBeGreaterThan(0);
});
it('已知动作仅展示经过值验证的状态/数量/金额；任意字符串和新字段均隐藏',()=>{
  const secret='Bearer private-token 手机13800138000 地址测试省详细地址 storage_key=secret-file';
  const data=projectAuditDetails('order.pay','Order',{orderStatus:'WAIT_PAYMENT',amountCents:10700,passwordHash:secret},{orderStatus:secret,amountCents:10700,paymentId:secret,requestBody:secret},secret);
  expect(data.changes).toEqual([{field:'orderStatus',label:'订单状态',before:'WAIT_PAYMENT',after:null},{field:'amountCents',label:'金额（分）',before:10700,after:10700}]);
  expect(data.hasReason).toBe(true);expect(JSON.stringify(data)).not.toContain(secret);expect(data.reason).toContain('自由文本');
});
it('改密与授权只返回必要标记，未知权限码和自由账号资料不会透传',()=>{
  const secret='private-token';
  const password=projectAuditDetails('employee.password.reset','Employee',null,{passwordChanged:true,mustChangePassword:true,passwordHash:secret},secret);
  expect(password.changes.map(x=>x.field)).toEqual(['passwordChanged','mustChangePassword']);
  const role=projectAuditDetails('employee.role.change','Employee',{role:'SUPER_ADMIN',extraPermissions:[]},{role:'CUSTOMER_SERVICE',extraPermissions:[secret],displayName:secret},null);
  expect(JSON.stringify(role)).not.toContain(secret);expect(role.changes.find(x=>x.field==='role')?.after).toBe('CUSTOMER_SERVICE');
  expect(safeEmployeeIdentity({id:randomUUID(),username:secret+'@13800138000',status:'DISABLED'})).toMatchObject({username:null,disabled:true});
});
it('未知历史动作和错对象动作均安全降级，连动作字符串本身也不原样显示',()=>{
  for(const [action,target] of [['secret-token','Order'],['order.pay','Customer']]){
    const result=projectAuditDetails(action!,target!,{nested:{token:'secret-token'}},['secret-token'],'secret-token');
    expect(result).toMatchObject({action:'UNKNOWN',detailsAvailable:false,changes:[]});expect(result.detailNotice).toBe('该动作暂无安全详情展示');expect(JSON.stringify(result)).not.toContain('secret-token');
  }
});
it('技术/业务标识同样按规范裁剪，不以字符串安全为借口透传任意值',()=>{
  const id=randomUUID();expect(safeAuditId(id)).toBe(id);expect(safeAuditId('full private address')).toBeNull();
  expect(safeAuditRequestId(id)).toBe(id);expect(safeAuditRequestId('Bearer private-token')).toBeNull();
  expect(safeBusinessNo('OM123ABC','ORDER')).toBe('OM123ABC');expect(safeBusinessNo('PRIVATE_TOKEN','ORDER')).toBeNull();
});
