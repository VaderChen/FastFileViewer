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
  let field = '';
  let quoted = false;
  let truncated = false;

  const pushRow = () => {
    row.push(field);
    field = '';
    rows.push(row.slice(0, maxTableColumns));
    row = [];
    if (rows.length >= rowLimit) {
      truncated = true;
      return false;
    }
    return true;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === delimiter) {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
      if (!pushRow()) {
        break;
      }
    } else {
      field += character;
    }
  }

  if (!truncated && (field.length > 0 || row.length > 0)) {
    pushRow();
  }
  return { rows, truncated };
}
