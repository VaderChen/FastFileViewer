// Baseline immediately before the current function review.
import type { DelimitedTableSort, ParsedDelimitedDocument } from '../../src/structuredData.ts';

let tableCollator: Intl.Collator | undefined;

function compareTableValues(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (left.trim() !== '' && right.trim() !== '' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  tableCollator ??= new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return tableCollator.compare(left, right);
}

export function previousSelectDelimitedRows(dataRows: string[][], query: string, sort: DelimitedTableSort | null, rowLimit: number): ParsedDelimitedDocument {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = (row: string[]) => row.some((cell) => cell.toLocaleLowerCase().includes(normalizedQuery));
  if (!sort) {
    if (!normalizedQuery) {
      return { rows: dataRows.slice(0, rowLimit), truncated: dataRows.length > rowLimit };
    }
    const rows: string[][] = [];
    for (const row of dataRows) {
      if (!matches(row)) continue;
      // Only one additional match is needed to show the existing preview warning.
      if (rows.length >= rowLimit) return { rows, truncated: true };
      rows.push(row);
    }
    return { rows, truncated: false };
  }

  // Filtering already owns a new array; sorting it avoids a second full copy.
  const rows = normalizedQuery ? dataRows.filter(matches) : [...dataRows];
  rows.sort((left, right) => {
    const comparison = compareTableValues(left[sort.column] ?? '', right[sort.column] ?? '');
    return sort.direction === 'asc' ? comparison : -comparison;
  });
  return { rows: rows.slice(0, rowLimit), truncated: rows.length > rowLimit };
}
