/** 文件作用：验证规范化、集合、键边界及分页溢出，拒绝会让不同业务错误共用摘要的输入。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalJson, canonicalSet, validateIdempotencyKey, normalizePagination, paginationWindow } from '../dist/index.js';
test('对象键排序、数组保序、中文和空值稳定，重复对象引用合法', () => {
  assert.equal(canonicalJson({ b: 2, a: { y: null, x: '衣服' } }), canonicalJson({ a: { x: '衣服', y: null }, b: 2 }));
  assert.notEqual(canonicalJson(['主图', '细节']), canonicalJson(['细节', '主图']));
  const item = { id: 1 }; assert.equal(canonicalJson([item, item]), '[{"id":1},{"id":1}]');
});
for (const value of [NaN, Infinity, 1.2, Number.MAX_SAFE_INTEGER + 1, 1n, undefined, () => {}, new Date(), new Set(), [undefined], Array(1), { a: undefined }, { token: 'secret' }, { requestId: 'transient' }]) {
  test(`非法规范输入被拒绝：${typeof value}/${Object.prototype.toString.call(value)}`, () => assert.throws(() => canonicalJson(value), { code: 'COMMAND_PAYLOAD_INVALID' }));
}
test('拒绝循环、访问器、symbol、额外数组属性与超深/超大输入', () => {
  const cycle = {}; cycle.self = cycle;
  const getter = Object.defineProperty({}, 'a', { get() { throw Error('不应调用'); }, enumerable: true });
  const array = [1]; array.extra = 1;
  let deep = {}; for (let i = 0; i < 34; i++) deep = { deep };
  for (const value of [cycle, getter, { [Symbol()]: 1 }, array, deep, '中'.repeat(30000), Array(10001).fill(1)]) {
    assert.throws(() => canonicalJson(value), { code: 'COMMAND_PAYLOAD_INVALID' });
  }
});
test('集合拒绝规范重复，返回稳定新数组并保留元素；稀疏数组拒绝', () => {
  const values = [{ id: 2 }, { id: 1 }]; assert.deepEqual(canonicalSet(values), [{ id: 1 }, { id: 2 }]); assert.equal(values[0].id, 2);
  assert.throws(() => canonicalSet([{ a: 1, b: 2 }, { b: 2, a: 1 }]), { code: 'COMMAND_PAYLOAD_INVALID' });
  assert.throws(() => canonicalSet(Array(1)), { code: 'COMMAND_PAYLOAD_INVALID' });
});
test('幂等键16/128边界合法，拒绝空白、中文、换行、过短和超长', () => {
  for (const value of ['a'.repeat(16), 'A0-_'.repeat(32)]) assert.equal(validateIdempotencyKey(value), value);
  for (const value of ['', 'a'.repeat(15), 'a'.repeat(129), '中'.repeat(16), 'a'.repeat(16) + '\n', ' '.repeat(16), null, []]) {
    assert.throws(() => validateIdempotencyKey(value), { code: 'IDEMPOTENCY_KEY_INVALID' });
  }
});
test('分页默认20、最大100，巨大页码为空而不发生乘法溢出', () => {
  assert.deepEqual(normalizePagination(), { page: 1, pageSize: 20 });
  assert.deepEqual(paginationWindow({ page: 2, pageSize: 100 }, 101), { page: 2, pageSize: 100, skip: 100, take: 100 });
  assert.equal(paginationWindow({ page: Number.MAX_SAFE_INTEGER, pageSize: 100 }, Number.MAX_SAFE_INTEGER).skip, null);
  assert.equal(paginationWindow({}, 0).skip, null);
  for (const input of [{ page: null }, { page: '1' }, { pageSize: 101 }, { page: 0 }, { page: Infinity }]) assert.throws(() => normalizePagination(input), RangeError);
});
