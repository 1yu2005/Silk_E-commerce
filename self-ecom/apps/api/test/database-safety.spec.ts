import { expect, it } from 'vitest';
import { assertSafeTestDatabase } from '../scripts/database-env.js';

const dev = 'postgresql://shop:secret@localhost:15432/shop_dev';
const test = 'postgresql://shop:secret@127.0.0.1:15432/shop_test';

it('accepts a separate test database, including equivalent loopback hosts', () => {
  expect(assertSafeTestDatabase(dev, test).testName).toBe('shop_test');
});

it.each([undefined, '', dev,
  'postgresql://shop:secret@localhost:15432/production',
  'postgresql://shop:secret@localhost:5432/shop_test',
  'postgresql://shop:secret@remote.example:15432/shop_test',
  'postgresql://shop:secret@localhost:15432/shop_test%22',
])('rejects unsafe test targets before database work', target => {
  expect(() => assertSafeTestDatabase(dev, target)).toThrow('TEST_DATABASE_URL');
});

it('rejects using a development database whose name also ends in _test', () => {
  expect(() => assertSafeTestDatabase(test, test)).toThrow('不得与开发库同名');
});

it('does not echo connection credentials in safety errors', () => {
  try { assertSafeTestDatabase(dev, 'not-a-url-with-private-password'); }
  catch (error) {
    expect((error as Error).message).not.toContain('private-password');
    expect((error as Error).message).not.toContain('secret');
  }
});
