import { useMemo, useState } from 'react';
import { parseDelimitedText, parseJsonDocument } from './structuredData';
import './structuredViewers.css';

const maxJsonNodes = 10_000;
const maxRenderedTableRows = 1_000;

export interface StructuredViewerLabels {
  invalidJson: string;
  filterRows: string;
  noMatchingRows: string;
  rows: string;
  columns: string;
  truncated: string;
}

export function JsonStructuredView({ text, labels }: { text: string; labels: StructuredViewerLabels }) {
  const document = useMemo(() => parseJsonDocument(text), [text]);
  if (document.error) {
    return (
      <div className="structured-error">
        <strong>{labels.invalidJson}</strong>
        <span>{document.error}</span>
      </div>
    );
  }

  const budget = { count: 0, truncated: false };
  const truncated = countJsonNodes(document.value, maxJsonNodes + 1) > maxJsonNodes;
  return (
    <div className="json-structured-view">
      <JsonNode name="$" value={document.value} depth={0} budget={budget} />
      {truncated ? <div className="structured-warning">{labels.truncated}</div> : null}
    </div>
  );
}

function JsonNode({ name, value, depth, budget }: { name: string; value: unknown; depth: number; budget: { count: number; truncated: boolean } }) {
  budget.count += 1;
  if (budget.count > maxJsonNodes) {
    budget.truncated = true;
    return null;
  }
  if (value === null || typeof value !== 'object') {
    return (
      <div className="json-leaf" style={{ paddingLeft: depth === 0 ? 0 : '18px' }}>
        <span className="json-key">{name}</span>
        <span className={`json-value ${typeof value}`}>{formatJsonPrimitive(value)}</span>
      </div>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>);
  return (
    <details className="json-branch" open={depth < 2} style={{ marginLeft: depth === 0 ? 0 : '18px' }}>
      <summary>
        <span className="json-key">{name}</span>
        <span className="json-count">{Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}</span>
      </summary>
      <div>
        {entries.map(([childName, childValue]) => (
          <JsonNode key={childName} name={childName} value={childValue} depth={depth + 1} budget={budget} />
        ))}
      </div>
    </details>
  );
}

function countJsonNodes(value: unknown, limit: number): number {
  let count = 1;
  if (value === null || typeof value !== 'object') {
    return count;
  }
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  for (const child of children) {
    count += countJsonNodes(child, limit - count);
    if (count >= limit) {
      return count;
    }
  }
  return count;
}

function formatJsonPrimitive(value: unknown): string {
  if (typeof value === 'string') {
    return `"${value}"`;
  }
  return String(value);
}

export function DelimitedTableView({ text, delimiter, labels }: { text: string; delimiter: ',' | '\t'; labels: StructuredViewerLabels }) {
  const parsed = useMemo(() => parseDelimitedText(text, delimiter), [delimiter, text]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ column: number; direction: 'asc' | 'desc' } | null>(null);
  const header = parsed.rows[0] ?? [];
  const dataRows = parsed.rows.slice(1);
  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    let nextRows = normalizedQuery
      ? dataRows.filter((row) => row.some((cell) => cell.toLocaleLowerCase().includes(normalizedQuery)))
      : dataRows;
    if (sort) {
      nextRows = [...nextRows].sort((left, right) => {
        const comparison = compareTableValues(left[sort.column] ?? '', right[sort.column] ?? '');
        return sort.direction === 'asc' ? comparison : -comparison;
      });
    }
    return nextRows.slice(0, maxRenderedTableRows);
  }, [dataRows, query, sort]);

  const toggleSort = (column: number) => {
    setSort((current) => current?.column === column
      ? { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      : { column, direction: 'asc' });
  };

  return (
    <div className="delimited-table-view">
      <div className="table-view-toolbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={labels.filterRows} />
        <span>{dataRows.length.toLocaleString()} {labels.rows} · {header.length.toLocaleString()} {labels.columns}</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {header.map((cell, column) => (
                <th key={`${cell}-${column}`}>
                  <button type="button" onClick={() => toggleSort(column)}>
                    {cell || `#${column + 1}`}
                    {sort?.column === column ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {header.map((_, column) => <td key={column}>{row[column] ?? ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {visibleRows.length === 0 ? <div className="table-empty">{labels.noMatchingRows}</div> : null}
      </div>
      {parsed.truncated || dataRows.length > maxRenderedTableRows ? <div className="structured-warning">{labels.truncated}</div> : null}
    </div>
  );
}

function compareTableValues(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (left.trim() !== '' && right.trim() !== '' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}
