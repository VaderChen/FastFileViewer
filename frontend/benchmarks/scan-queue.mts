// Run with: node --expose-gc benchmarks/scan-queue.mts
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { ScanQueue } from '../src/scanQueue.ts';

const normalize = (path: string) => {
  const normalized = path.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized;
};
const within = (target: string, directory: string) => {
  const normalized = normalize(directory);
  return target === normalized || target.startsWith(normalized + '/');
};
const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
if (!globalThis.gc) throw new Error('Run Node with --expose-gc');
for (const hasTarget of [false, true]) {
  const count = hasTarget ? 2500 : 40000;
  const paths = Array.from({ length: count }, (_, i) => '/fixture/folder-' + i);
  const target = hasTarget ? paths[count - 1] + '/image.png' : '';
  let expected: string[] | undefined;
  for (const mode of ['previous', 'optimized']) {
    const times: number[] = [], heaps: number[] = [];
    for (let run = 0; run < 5; run++) {
      globalThis.gc();
      const heap = process.memoryUsage().heapUsed;
      const start = performance.now();
      const order: string[] = [];
      if (mode === 'previous') {
        const pending = paths.slice();
        const prioritize = () => {
          const normalizedTarget = normalize(target);
          if (normalizedTarget) pending.sort((a, b) => Number(!within(normalizedTarget, a)) - Number(!within(normalizedTarget, b)));
        };
        prioritize();
        while (pending.length) { order.push(pending.shift()!); prioritize(); }
      } else {
        const normalizedTarget = normalize(target);
        const pending = new ScanQueue(normalizedTarget ? path => within(normalizedTarget, path) : undefined);
        for (const path of paths) pending.push(path);
        while (pending.length) order.push(pending.shift()!);
      }
      const elapsed = performance.now() - start;
      const heapGrowth = process.memoryUsage().heapUsed - heap;
      if (!expected) expected = order;
      assert.deepEqual(order, expected);
      if (run > 0) { times.push(elapsed); heaps.push(heapGrowth); }
    }
    console.log(JSON.stringify({ mode, folders: count, priorityTarget: hasTarget,
      medianMs: median(times), medianHeapGrowthBytes: median(heaps) }));
  }
}
