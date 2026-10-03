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
