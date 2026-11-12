/** 文件作用：验证凭证存储、到期清理和异步版本隔离。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthSessionStore, SESSION_KEYS } from '../dist/index.js';

const now = Date.parse('2026-11-12T01:00:00Z');
const credential = { accessToken: 'employee-test-token', tokenType: 'Bearer', expiresAt: new Date(now + 60_000).toISOString() };
function memoryStorage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

test('员工与顾客使用独立键，仅保存最小凭证，刷新可分别恢复', () => {
  const storage = memoryStorage(); const options = { storage: () => storage, now: () => now };
  const employee = new AuthSessionStore('EMPLOYEE', options); const customer = new AuthSessionStore('CUSTOMER', options);
  employee.save({ ...credential, password: '不该存储', employee: { id: '内部资料' }, effectivePermissions: ['不能缓存'] });
  customer.save({ ...credential, accessToken: 'customer-test-token' });
  assert.notEqual(SESSION_KEYS.EMPLOYEE, SESSION_KEYS.CUSTOMER);
  assert.deepEqual(JSON.parse(storage.values.get(SESSION_KEYS.EMPLOYEE)), { domain: 'EMPLOYEE', accessToken: credential.accessToken, expiresAt: credential.expiresAt });
  assert.equal(new AuthSessionStore('EMPLOYEE', options).current().credential.accessToken, credential.accessToken);
  assert.equal(new AuthSessionStore('CUSTOMER', options).current().credential.accessToken, 'customer-test-token');
  employee.clear(); assert.equal(storage.getItem(SESSION_KEYS.EMPLOYEE), null);
  assert.equal(customer.current().credential.accessToken, 'customer-test-token'); assert.ok(storage.getItem(SESSION_KEYS.CUSTOMER));
});

for (const [name, value] of [
  ['损坏JSON', '{broken'], ['其他登录域', JSON.stringify({ domain: 'CUSTOMER', ...credential })],
  ['缺字段', JSON.stringify({ domain: 'EMPLOYEE', accessToken: credential.accessToken })],
  ['无效日期', JSON.stringify({ domain: 'EMPLOYEE', ...credential, expiresAt: 'bad-date' })],
  ['到期边界', JSON.stringify({ domain: 'EMPLOYEE', ...credential, expiresAt: new Date(now).toISOString() })],
  ['含换行token', JSON.stringify({ domain: 'EMPLOYEE', ...credential, accessToken: 'bad\nvalue' })],
  ['null', 'null'], ['数组', '[]'],
]) {
  test(`恢复${name}时丢弃本域记录，不影响另一登录域`, () => {
    const storage = memoryStorage(); storage.setItem(SESSION_KEYS.EMPLOYEE, value); storage.setItem(SESSION_KEYS.CUSTOMER, '保留记录');
    const store = new AuthSessionStore('EMPLOYEE', { storage: () => storage, now: () => now });
    assert.equal(store.current().credential, null); assert.equal(storage.getItem(SESSION_KEYS.EMPLOYEE), null); assert.equal(storage.getItem(SESSION_KEYS.CUSTOMER), '保留记录');
  });
}

test('凭证到期等号时清除内存及持久化，读取快照稳定且订阅可取消', () => {
  let millis = now; const storage = memoryStorage(); const store = new AuthSessionStore('EMPLOYEE', { storage: () => storage, now: () => millis }); let changes = 0;
  const stop = store.subscribe(() => changes++); const first = store.getSnapshot(); assert.equal(first, store.getSnapshot());
  store.save(credential); const saved = store.getSnapshot(); assert.ok(Object.isFrozen(saved)); assert.ok(Object.isFrozen(saved.credential));
  assert.equal(store.current(), saved); millis += 60_000; assert.equal(store.current().credential, null); assert.equal(storage.getItem(SESSION_KEYS.EMPLOYEE), null);
  assert.equal(changes, 2); stop(); store.clear(); assert.equal(changes, 2);
});

test('相同token重新保存也切换修订号，旧请求不能清除新会话', () => {
  const store = new AuthSessionStore('EMPLOYEE', { storage: () => undefined, now: () => now }); store.save(credential);
  const revision = store.current().revision; store.save(credential); assert.equal(store.clearIfCurrent(revision), false);
  assert.equal(store.current().credential.accessToken, credential.accessToken); assert.equal(store.clearIfCurrent(store.current().revision), true); assert.equal(store.current().credential, null);
});

test('存储被禁止时仍可使用和清除内存；订阅者异常不妨碍清理', () => {
  const store = new AuthSessionStore('CUSTOMER', { storage: () => { throw new Error('浏览器禁止存储'); }, now: () => now });
  let changes = 0; store.subscribe(() => { throw new Error('订阅者异常'); }); store.subscribe(() => changes++);
  store.save(credential); assert.equal(store.current().credential.accessToken, credential.accessToken); store.clear(); assert.equal(store.current().credential, null); assert.equal(changes, 2);
});

test('写存储失败后清掉旧记录，继续使用新内存凭证', () => {
  const values = new Map([[SESSION_KEYS.EMPLOYEE, JSON.stringify({ domain: 'EMPLOYEE', ...credential })]]);
  const store = new AuthSessionStore('EMPLOYEE', { now: () => now, storage: () => ({ getItem: key => values.get(key),
    setItem: () => { throw new Error('空间不足'); }, removeItem: key => values.delete(key) }) });
  store.save({ ...credential, accessToken: 'new-token' }); assert.equal(store.current().credential.accessToken, 'new-token'); assert.equal(values.has(SESSION_KEYS.EMPLOYEE), false);
});

test('无效登录凭证不覆盖现有会话，不持久化非法Authorization', () => {
  const store = new AuthSessionStore('EMPLOYEE', { storage: () => undefined, now: () => now }); store.save(credential); const before = store.current();
  for (const patch of [{ tokenType: 'Basic' }, { expiresAt: new Date(now).toISOString() }, { accessToken: '' }, { accessToken: 'bad token' }]) {
    assert.throws(() => store.save({ ...credential, ...patch }), /登录凭证格式不合法/); assert.equal(store.current(), before);
  }
});
test('订阅者在登录通知中清理会话时，不把已清理凭证重新写回存储', () => {
  const storage = memoryStorage(); const store = new AuthSessionStore('EMPLOYEE', { storage: () => storage, now: () => now });
  store.subscribe(() => { if (store.getSnapshot().credential) store.clear(); }); store.save(credential);
  assert.equal(store.current().credential, null); assert.equal(storage.getItem(SESSION_KEYS.EMPLOYEE), null);
});
