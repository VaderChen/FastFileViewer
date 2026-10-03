// Run with: node --expose-gc benchmarks/structured-table.mts
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { selectDelimitedRows } from '../src/structuredData.ts';
import type { DelimitedTableSort } from '../src/structuredData.ts';

function previousRows(dataRows: string[][], query: string, sort: DelimitedTableSort | null, rowLimit: number) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  let rows = normalizedQuery
    ? dataRows.filter(row => row.some(cell => cell.toLocaleLowerCase().includes(normalizedQuery)))
    : dataRows;
  if (sort) {
    rows = [...rows].sort((left, right) => {
      const a = left[sort.column] ?? '', b = right[sort.column] ?? '';
      const an = Number(a), bn = Number(b);
      const comparison = a.trim() !== '' && b.trim() !== '' && Number.isFinite(an) && Number.isFinite(bn)
        ? an - bn : a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
      return sort.direction === 'asc' ? comparison : -comparison;
    });
  }
  return { rows: rows.slice(0, rowLimit), truncated: rows.length > rowLimit };
}

const rows = Array.from({ length: 4999 }, (_, row) => Array.from({ length: 24 }, (_, column) =>
  column === 0 ? '文件 Item ' + ((row * 7919) % 4999)
    : column === 23 ? 'MATCH' : 'Unrelated Cell ' + row + '-' + column));
const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
if (!globalThis.gc) throw new Error('Run Node with --expose-gc');
for (const scenario of [
  { name: 'sort-text', query: '', sort: { column: 0, direction: 'asc' as const } },
  { name: 'filter-many', query: 'match', sort: null },
  { name: 'filter-sort', query: 'match', sort: { column: 0, direction: 'asc' as const } },
]) {
  const expected = previousRows(rows, scenario.query, scenario.sort, 1000);
  for (const [mode, select] of [['previous', previousRows], ['optimized', selectDelimitedRows]] as const) {
    const times: number[] = [], heaps: number[] = [];
    for (let run = 0; run < 9; run++) {
      globalThis.gc();
      const heap = process.memoryUsage().heapUsed;
      const start = performance.now();
      const result = select(rows, scenario.query, scenario.sort, 1000);
      const elapsed = performance.now() - start;
      const heapGrowth = process.memoryUsage().heapUsed - heap;
      assert.deepEqual(result, expected);
      if (run > 1) { times.push(elapsed); heaps.push(heapGrowth); }
    }
    console.log(JSON.stringify({ scenario: scenario.name, mode, rows: rows.length, columns: 24,
      medianMs: median(times), heapGrowthBytes: median(heaps) }));
  }
}
