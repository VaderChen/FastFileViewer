import assert from 'node:assert/strict';
import test from 'node:test';
import { selectDelimitedRows } from '../src/structuredData.ts';
import type { DelimitedTableSort } from '../src/structuredData.ts';

function previousRows(dataRows: string[][], query: string, sort: DelimitedTableSort | null, rowLimit: number) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  let rows = normalizedQuery
    ? dataRows.filter(row => row.some(cell => cell.toLocaleLowerCase().includes(normalizedQuery)))
    : dataRows;
  if (sort) {
    rows = [...rows].sort((left, right) => {
      const a = left[sort.column] ?? '';
      const b = right[sort.column] ?? '';
      const an = Number(a), bn = Number(b);
      const comparison = a.trim() !== '' && b.trim() !== '' && Number.isFinite(an) && Number.isFinite(bn)
        ? an - bn : a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
      return sort.direction === 'asc' ? comparison : -comparison;
    });
  }
  return { rows: rows.slice(0, rowLimit), truncated: rows.length > rowLimit };
}

test('table sorting retains numeric, locale, missing-column and stable-tie behavior', () => {
  const values = ['', ' ', '0', '-0', '001', '1', '-2', '1e2', '0x10', 'Infinity', 'NaN', '10.5',
    'Item2', 'item10', 'ITEM02', 'é', 'É', 'e', '中文12', '中文2', '日本語', 'İ', 'i', '😀', 'ß'];
  const rows = values.map((value, index) => [value, String(index), index % 2 ? 'MATCH' : 'keep']);
  rows.push(['short'], []);
  const before = rows.map(row => [...row]);
  for (const column of [0, 1, 3]) {
    for (const direction of ['asc', 'desc'] as const) {
      for (const query of ['', ' match ', 'ITEM', '0', 'absent']) {
        const sort = { column, direction };
        assert.deepEqual(selectDelimitedRows(rows, query, sort, 7), previousRows(rows, query, sort, 7));
      }
    }
  }
  assert.deepEqual(rows, before, 'preview sorting must not mutate parsed records');
  for (const left of values) for (const right of values) {
    const pair = [[left, 'first'], [right, 'second']];
    assert.deepEqual(selectDelimitedRows(pair, '', { column: 0, direction: 'asc' }, 2),
      previousRows(pair, '', { column: 0, direction: 'asc' }, 2));
  }
});

test('table filtering preserves exact preview boundaries and final matches', () => {
  for (const count of [0, 999, 1000, 1001, 4999]) {
    const rows = Array.from({ length: count }, (_, i) => [String(i), 'MATCH']);
    for (const query of ['', ' match ', 'absent']) {
      assert.deepEqual(selectDelimitedRows(rows, query, null, 1000), previousRows(rows, query, null, 1000));
    }
  }
  const rows = [...Array.from({ length: 4000 }, () => ['skip']), ['  MiXeD  ', 'last']];
  assert.deepEqual(selectDelimitedRows(rows, ' mixed ', null, 1000),
    { rows: [['  MiXeD  ', 'last']], truncated: false });
});

test('sorting includes matching records beyond the visible row limit', () => {
  const rows = Array.from({ length: 4999 }, (_, i) => [String(4999 - i), i % 2 ? 'match' : 'skip']);
  for (const direction of ['asc', 'desc'] as const) {
    const sort = { column: 0, direction };
    const actual = selectDelimitedRows(rows, 'match', sort, 1000);
    assert.deepEqual(actual, previousRows(rows, 'match', sort, 1000));
    assert.equal(actual.rows.length, 1000);
    assert.equal(actual.truncated, true);
  }
});

test('unsorted filtering stops after the first omitted matching record', () => {
  let reads = 0;
  const rows = Array.from({ length: 4999 }, () => {
    const row: string[] = [];
    Object.defineProperty(row, '0', { get() { reads++; return 'match'; }, enumerable: true });
    return row;
  });
  const result = selectDelimitedRows(rows, 'match', null, 1000);
  assert.equal(result.rows.length, 1000);
  assert.equal(result.truncated, true);
  assert.equal(reads, 1001, 'later rows cannot affect the visible records or warning');
});
