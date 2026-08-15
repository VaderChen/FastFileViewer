import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDelimitedText, parseJsonDocument } from '../src/structuredData.ts';
import { filterWorkspaceEntries } from '../src/workspaceFilters.ts';

test('parses quoted CSV cells and embedded newlines', () => {
  const parsed = parseDelimitedText('name,note\r\nAlice,"hello, world"\r\nBob,"line 1\nline 2"', ',');
  assert.deepEqual(parsed.rows, [
    ['name', 'note'],
    ['Alice', 'hello, world'],
    ['Bob', 'line 1\nline 2'],
  ]);
});

test('parses JSON and reports invalid content', () => {
  assert.deepEqual(parseJsonDocument('{"ok":true}').value, { ok: true });
  assert.notEqual(parseJsonDocument('{broken').error, '');
});

test('filters workspace entries by query, kind, and source', () => {
  const entries = [
    { id: '1', name: 'photo.png', path: '/photo.png', directoryPath: '/', source: 'file', format: '.png', kind: 'image', size: 1 },
    { id: '2', name: 'data.json', path: '/archive.zip::data.json', directoryPath: '/archive.zip', source: 'archive', archivePath: '/archive.zip', innerPath: 'data.json', format: '.json', kind: 'code', size: 2 },
  ] as const;
  assert.deepEqual(filterWorkspaceEntries([...entries], 'data', 'document', 'archive').map((entry) => entry.id), ['2']);
  assert.deepEqual(filterWorkspaceEntries([...entries], '', 'image', 'all').map((entry) => entry.id), ['1']);
});
