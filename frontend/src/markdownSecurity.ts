export const maxRenderedDocumentCharacters = 2_000_000;
export const maxRenderedCodeLines = 30_000;

export function blockMarkdownUrl(_url?: string): string {
  return '';
}

export function limitDocumentPreview(value: string, maxCharacters = maxRenderedDocumentCharacters): { text: string; truncated: boolean } {
  if (value.length <= maxCharacters) {
    return { text: value, truncated: false };
  }
  return {
    text: value.slice(0, maxCharacters),
    truncated: true,
  };
}

export function normalizeDocumentLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}
