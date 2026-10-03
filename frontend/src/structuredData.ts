const maxTableRows = 5_000;
const maxTableColumns = 100;

export interface ParsedJsonDocument {
  value: unknown;
  error: string;
}

export interface ParsedDelimitedDocument {
  rows: string[][];
  truncated: boolean;
}

export function parseJsonDocument(text: string): ParsedJsonDocument {
  try {
    return { value: JSON.parse(text) as unknown, error: '' };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export function parseDelimitedText(text: string, delimiter: ',' | '\t', rowLimit = maxTableRows): ParsedDelimitedDocument {
  const rows: string[][] = [];
  let row: string[] = [];
  let fieldStart = 0;
  let fieldQuoted = false;
  let closingQuote = -1;
  let rowStarted = false;
  let quoted = false;
  let truncated = false;

  const pushField = (end: number) => {
    if (row.length < maxTableColumns) {
      // Slice complete fields instead of allocating a string node for each character.
      const value = fieldQuoted
        ? text.slice(fieldStart + 1, closingQuote >= 0 ? closingQuote : end).replace(/""/g, '"')
          + (closingQuote >= 0 ? text.slice(closingQuote + 1, end) : '')
        : text.slice(fieldStart, end);
      row.push(value);
    } else {
      truncated = true;
    }
    fieldStart = end + 1;
    fieldQuoted = false;
    closingQuote = -1;
  };
  const pushRow = (end: number) => {
    pushField(end);
    rows.push(row);
    row = [];
    rowStarted = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    // A row ending exactly at the limit is complete; only further input is omitted.
    if (rows.length >= rowLimit) {
      truncated = true;
      break;
    }
    const character = text[index];
    rowStarted = true;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        index += 1;
      } else if (character === '"') {
        quoted = false;
        closingQuote = index;
      }
      continue;
    }

    if (character === '"' && index === fieldStart) {
      quoted = true;
      fieldQuoted = true;
    } else if (character === delimiter) {
      pushField(index);
    } else if (character === '\n' || character === '\r') {
      pushRow(index);
      if (character === '\r' && text[index + 1] === '\n') {
        index += 1;
        fieldStart = index + 1;
      }
    }
  }

  if (rowStarted) {
    pushRow(text.length);
  }
  return { rows, truncated };
}

export interface JsonPreviewNode {
  name: string;
  value?: unknown;
  children?: JsonPreviewNode[];
  count?: number;
  array?: boolean;
  truncated?: boolean;
}

// Iterative traversal bounds both memory and render depth, even for valid deeply nested JSON.
export function buildJsonPreview(value: unknown, nodeLimit = 10_000, depthLimit = 64): { root: JsonPreviewNode; truncated: boolean; count: number } {
  const root: JsonPreviewNode = { name: '$' };
  const pending = [{ node: root, value, depth: 0 }];
  let count = 1;
  let truncated = false;
  while (pending.length) {
    const item = pending.pop()!;
    if (item.value === null || typeof item.value !== 'object') {
      item.node.value = item.value;
      continue;
    }
    const object = item.value as Record<string, unknown>;
    const array = Array.isArray(item.value) ? item.value : null;
    // Parsed JSON arrays are dense; avoid allocating all keys for a limited preview.
    const keys = array ? null : Object.keys(object);
    const childCount = array ? array.length : keys!.length;
    item.node.children = [];
    item.node.array = array !== null;
    item.node.count = childCount;
    if (item.depth >= depthLimit && childCount) {
      item.node.truncated = truncated = true;
      continue;
    }
    for (let index = 0; index < childCount; index += 1) {
      if (count >= nodeLimit) {
        item.node.truncated = truncated = true;
        break;
      }
      const key = array ? String(index) : keys![index];
      const child: JsonPreviewNode = { name: key };
      item.node.children.push(child);
      pending.push({ node: child, value: object[key], depth: item.depth + 1 });
      count++;
    }
  }
  return { root, truncated, count };
}

export interface DelimitedTableSort {
  column: number;
  direction: 'asc' | 'desc';
}

let tableCollator: Intl.Collator | undefined;

export function selectDelimitedRows(dataRows: string[][], query: string, sort: DelimitedTableSort | null, rowLimit: number): ParsedDelimitedDocument {
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

  const rows = normalizedQuery ? dataRows.filter(matches) : dataRows;
  // An already ordered, entirely numeric column needs no sort workspace.
  // Stop at the first nonnumeric or out-of-order value; mixed values still
  // use the original pair-dependent numeric/locale comparator below.
  let ordered = true;
  let previousNumber = sort.direction === 'asc' ? -Infinity : Infinity;
  for (const row of rows) {
    const value = row[sort.column] ?? '';
    const number = Number(value);
    if (value.trim() === '' || !Number.isFinite(number)
      || (sort.direction === 'asc' ? number < previousNumber : number > previousNumber)) {
      ordered = false;
      break;
    }
    previousNumber = number;
  }
  if (ordered) return { rows: rows.slice(0, rowLimit), truncated: rows.length > rowLimit };

  // Cache numeric keys before sorting. Indices preserve the original rows
  // without allocating a wrapper object for every record.
  const numbers = new Float64Array(rows.length);
  const order = new Array<number>(rows.length);
  for (let index = 0; index < rows.length; index++) {
    const value = rows[index][sort.column] ?? '';
    const number = Number(value);
    numbers[index] = value.trim() !== '' && Number.isFinite(number) ? number : NaN;
    order[index] = index;
  }
  order.sort((left, right) => {
    let comparison: number;
    if (!Number.isNaN(numbers[left]) && !Number.isNaN(numbers[right])) {
      comparison = numbers[left] - numbers[right];
    } else {
      tableCollator ??= new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      comparison = tableCollator.compare(rows[left][sort.column] ?? '', rows[right][sort.column] ?? '');
    }
    return sort.direction === 'asc' ? comparison : -comparison;
  });
  return { rows: order.slice(0, rowLimit).map(index => rows[index]), truncated: rows.length > rowLimit };
}
