import assert from 'node:assert/strict';
import test from 'node:test';
import { blockMarkdownUrl, limitDocumentPreview, normalizeDocumentLineEndings } from '../src/markdownSecurity.ts';

test('blocks every markdown URL in offline mode', () => {
  assert.equal(blockMarkdownUrl(), '');
  assert.equal(blockMarkdownUrl('https://example.com'), '');
});

test('limits large rendered documents', () => {
  assert.deepEqual(limitDocumentPreview('hello', 10), { text: 'hello', truncated: false });
  assert.deepEqual(limitDocumentPreview('0123456789', 4), { text: '0123', truncated: true });
});

test('normalizes CRLF and CR line endings', () => {
  assert.equal(normalizeDocumentLineEndings('first\r\nsecond\rthird'), 'first\nsecond\nthird');
});
