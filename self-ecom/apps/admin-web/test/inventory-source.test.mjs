// 删除中间行后追加来源行，默认行号仍须唯一，不能让正常编辑生成服务端拒绝的凭据。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {nextSourceLineKey} from '../src/inventory/model.ts';

test('来源行增删后生成未被使用的默认编号，不修改保留行',()=>{
 const rows=[{lineKey:'1'},{lineKey:'2'},{lineKey:'3'}];
 rows.splice(1,1);
 rows.push({lineKey:nextSourceLineKey(rows)});
 assert.equal(new Set(rows.map(row=>row.lineKey)).size,rows.length);
 assert.deepEqual(rows.slice(0,2),[{lineKey:'1'},{lineKey:'3'}]);
});

test('自定义编号不影响默认编号，已有数字编号会跳过',()=>{
 assert.equal(nextSourceLineKey([]),'1');
 assert.equal(nextSourceLineKey([{lineKey:'仓库A'},{lineKey:'2'},{lineKey:'1'}]),'3');
 assert.equal(nextSourceLineKey([{lineKey:'01'},{lineKey:'批次1'}]),'1');
 assert.equal(nextSourceLineKey([{lineKey:' 1 '},{lineKey:'2\t'}]),'3');
});
