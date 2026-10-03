import assert from 'node:assert/strict';
import test from 'node:test';
import { ScanQueue } from '../src/scanQueue.ts';

test('scan queue preserves stable priority order as nested directories arrive', () => {
  const preferred = (path: string) => '/library/target/deep/file.png'.startsWith(path + '/');
  const queue = new ScanQueue(preferred);
  ['/library/first', '/library/target', '/library/last'].forEach(path => queue.push(path));
  assert.equal(queue.shift(), '/library/target');
  ['/library/target/other', '/library/target/deep'].forEach(path => queue.push(path));
  assert.equal(queue.shift(), '/library/target/deep');
  assert.equal(queue.length, 3);
  assert.deepEqual([queue.shift(), queue.shift(), queue.shift()], ['/library/first', '/library/last', '/library/target/other']);
  assert.equal(queue.shift(), undefined);
});

test('scan queue matches repeated stable sorting under mixed enqueue/dequeue', () => {
  let state = 91;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
  for (const preferred of [undefined, (path: string) => Number(path) % 3 === 0, () => true]) {
    const queue = new ScanQueue(preferred), expected: string[] = [];
    for (let step = 0; step < 6000; step++) {
      if (random() % 11 >= 3) {
        const path = String(random() % 1000);
        queue.push(path); expected.push(path);
        if (preferred) expected.sort((a, b) => Number(!preferred(a)) - Number(!preferred(b)));
      } else assert.equal(queue.shift(), expected.shift());
      assert.equal(queue.length, expected.length);
    }
    while (expected.length) assert.equal(queue.shift(), expected.shift());
    assert.equal(queue.length, 0);
    queue.push('reused');
    assert.equal(queue.shift(), 'reused');
  }
});

test('scan queue evaluates priority once and preserves empty path entries', () => {
  let calls = 0;
  const queue = new ScanQueue(() => { calls++; return false; });
  for (let i = 0; i < 10000; i++) queue.push(i ? String(i) : '');
  for (let i = 0; i < 10000; i++) assert.equal(queue.shift(), i ? String(i) : '');
  assert.equal(calls, 10000);
  assert.equal(queue.length, 0);
});
