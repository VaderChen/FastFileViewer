// Run: node --expose-gc benchmarks/function-review.mts
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { selectDelimitedRows } from '../src/structuredData.ts';
import { previousSelectDelimitedRows } from '../tests/helpers/tableFunctionReference.mts';

if (!globalThis.gc) throw new Error('Run Node with --expose-gc');
let sink: unknown;
const median = (values: number[]) => values.sort((a, b) => a-b)[Math.floor(values.length/2)];
for (const kind of ['numeric', 'natural', 'mixed', 'sorted'] as const) {
  const rows = Array.from({ length: 4999 }, (_, index) => {
    const n = (index * 7919) % 4999;
    return [kind === 'sorted' ? String(index) : kind === 'numeric' ? '  ' + (n/3).toFixed(5) + ' '
      : kind === 'natural' ? 'File ' + n : index % 3 === 0 ? String(n) : 'File ' + n, String(index)];
  });
  const sort = { column: 0, direction: 'asc' as const };
  const expected = previousSelectDelimitedRows(rows, '', sort, 1000);
  for (const [mode, select] of [['before', previousSelectDelimitedRows], ['after', selectDelimitedRows]] as const) {
    assert.deepEqual(select(rows, '', sort, 1000), expected);
    for (let i = 0; i < 60; i++) sink = select(rows, '', sort, 1000);
    const times: number[] = [], heaps: number[] = [], buffers: number[] = [];
    for (let round = 0; round < 7; round++) {
      globalThis.gc();
      const start = performance.now();
      for (let i = 0; i < 50; i++) sink = select(rows, '', sort, 1000);
      times.push((performance.now()-start)/50);
      globalThis.gc();
      const before = process.memoryUsage();
      sink = select(rows, '', sort, 1000);
      const after = process.memoryUsage();
      heaps.push(after.heapUsed-before.heapUsed);
      buffers.push(after.arrayBuffers-before.arrayBuffers);
    }
    console.log(JSON.stringify({ scenario: kind, mode, rows: rows.length, medianMs: median(times),
      heapGrowthBytes: median(heaps), arrayBufferGrowthBytes: median(buffers) }));
  }
}
void sink;
