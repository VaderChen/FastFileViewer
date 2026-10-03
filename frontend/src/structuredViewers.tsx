import { Component, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { buildJsonPreview, parseDelimitedText, parseJsonDocument } from './structuredData';
import type { JsonPreviewNode } from './structuredData';
import './structuredViewers.css';

const maxRenderedTableRows = 1_000;

export interface StructuredViewerLabels {
  invalidJson: string;
  filterRows: string;
  noMatchingRows: string;
  rows: string;
  columns: string;
  truncated: string;
}

class JsonPreviewBoundary extends Component<{ text: string; label: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="structured-error"><strong>{this.props.label}</strong><pre>{this.props.text.slice(0, 100_000)}</pre></div>;
    return this.props.children;
  }
}

export function JsonStructuredView({ text, labels }: { text: string; labels: StructuredViewerLabels }) {
  return <JsonPreviewBoundary key={text} text={text} label={labels.invalidJson}><JsonPreview text={text} labels={labels} /></JsonPreviewBoundary>;
}

function JsonPreview({ text, labels }: { text: string; labels: StructuredViewerLabels }) {
  const document = useMemo(() => parseJsonDocument(text), [text]);
  const preview = useMemo(() => buildJsonPreview(document.value), [document]);
  if (document.error) {
    return (
      <div className="structured-error">
        <strong>{labels.invalidJson}</strong>
        <span>{document.error}</span>
      </div>
    );
  }

  return (
    <div className="json-structured-view">
      <JsonNode key={text} node={preview.root} depth={0} truncatedLabel={labels.truncated} />
      {preview.truncated ? <div className="structured-warning">{labels.truncated}</div> : null}
    </div>
  );
}

function JsonNode({ node, depth, truncatedLabel }: { node: JsonPreviewNode; depth: number; truncatedLabel: string }) {
  const [expanded, setExpanded] = useState(depth < 2);
  if (!node.children) {
    return (
      <div className="json-leaf" style={{ paddingLeft: depth === 0 ? 0 : '18px' }}>
        <span className="json-key">{node.name}</span>
        <span className={'json-value ' + typeof node.value}>{formatJsonPrimitive(node.value)}</span>
      </div>
    );
  }
  return (
    <details className="json-branch" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)} style={{ marginLeft: depth === 0 ? 0 : '18px' }}>
      <summary>
        <span className="json-key">{node.name}</span>
        <span className="json-count">{node.array ? '[' + node.count + ']' : '{' + node.count + '}'}</span>
      </summary>
      {expanded ? <div>
        {node.children.map((child) => <JsonNode key={child.name} node={child} depth={depth + 1} truncatedLabel={truncatedLabel} />)}
        {node.truncated ? <div className="structured-warning">{truncatedLabel}</div> : null}
      </div> : null}
    </details>
  );
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
  const dataRows = useMemo(() => parsed.rows.slice(1), [parsed.rows]);
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
    return { rows: nextRows.slice(0, maxRenderedTableRows), truncated: nextRows.length > maxRenderedTableRows };
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
            {visibleRows.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {header.map((_, column) => <td key={column}>{row[column] ?? ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {visibleRows.rows.length === 0 ? <div className="table-empty">{labels.noMatchingRows}</div> : null}
      </div>
      {parsed.truncated || visibleRows.truncated ? <div className="structured-warning">{labels.truncated}</div> : null}
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
