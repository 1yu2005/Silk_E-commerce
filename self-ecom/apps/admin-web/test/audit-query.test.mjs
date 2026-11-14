// 作用：验证审计深层链接、严格筛选与北京时间转换及精确金额展示。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {auditIdIssue,auditLocalTime,auditSearchParams,auditTimeFromInput,auditValue,canReadAudit,parseAuditSearch} from '../src/audit/query.ts';
test('审计筛选可往返深层链接，业务号中的SQL文字只作普通值编码',()=>{
  const businessNo="O123' OR 1=1 --",query={page:2,pageSize:50,businessType:'ORDER',businessNo,from:'2030-11-14T00:00:00+08:00',to:'2030-11-15T00:00:00+08:00'};
  assert.deepEqual(parseAuditSearch(auditSearchParams(query).toString()).query,query);
  assert.equal(parseAuditSearch('').query.pageSize,20);
});
test('重复、空、非法、超范围筛选明确显示错误，不能偷偷改成全店查询',()=>{
  for(const s of ['page=1&page=2','pageSize=101','page=1e2','page=101&pageSize=100','actorType=SYSTEM&actorEmployeeId=00112233-4455-4677-8899-aabbccddeeff',
    'actorEmployeeId=bad','businessNo=','businessType=PRIVATE','action=unknown.action','targetType=Unknown','from=2030-11-14T00%3A00%3A00','from=2030-11-15T00%3A00%3A00Z&to=2030-11-14T00%3A00%3A00Z',
    'from=2029-01-01T00%3A00%3A00Z&to=2030-11-14T00%3A00%3A00Z','arbitrary=secret'])assert.ok(parseAuditSearch(s).error,s);
  assert.equal(parseAuditSearch('page=100&pageSize=100').query.page,100);
});
test('时间输入固定北京时区，不随浏览器或宿主本地时区移动',()=>{
  assert.equal(auditLocalTime('2030-11-14T16:00:00.000Z'),'2030-11-15T00:00:00');
  assert.equal(auditTimeFromInput('2030-11-15T00:00:00'),'2030-11-14T16:00:00.000Z');
  assert.equal(auditTimeFromInput(''),undefined);
});
test('差异金额保留超过安全整数的全部分位，未知动作不需要原始JSON渲染',()=>{
  assert.equal(auditValue('amountCents','9007199254740993'),'90071992547409.93 元');
  assert.equal(auditValue('amountCents','-10000'),'-100.00 元');
  assert.equal(auditValue('orderStatus','REFUNDED'),'已退款');assert.equal(auditValue('passwordChanged',true),'是');assert.equal(auditValue('x',null),'未记录');
  assert.equal(canReadAudit({effectivePermissions:['dashboard.read']}),false);assert.equal(canReadAudit({effectivePermissions:['audit.read']}),true);
  assert.ok(auditIdIssue('not-an-id'));assert.equal(auditIdIssue('00112233-4455-4677-8899-aabbccddeeff'),null);
});
