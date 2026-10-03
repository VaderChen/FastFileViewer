import assert from 'node:assert/strict';
import test from 'node:test';
import { flush, loadSource, hookHarness, globalValue } from './helpers/hookHarness.mts';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { buildJsonPreview, parseJsonDocument } from '../src/structuredData.ts';
import { moveLibraryEntry } from '../src/libraryTree.ts';
import type { ImageEntry, LibraryNode } from '../src/types.ts';


const image = (id: string, directoryPath = '/from'): ImageEntry => ({
  id, name: 'same.txt', path: directoryPath + '/same.txt', directoryPath, source: 'file', format: '.txt', kind: 'text', size: 1,
});
const node = (path: string, images: ImageEntry[] = [], children: LibraryNode[] = []): LibraryNode => ({
  id: path, path, name: path, kind: 'directory', scanned: true, images, children,
});

test('JSON preview bounds deep and wide input and real React rendering', () => {
  const deep = '['.repeat(8000) + '0' + ']'.repeat(8000);
  const result = buildJsonPreview(parseJsonDocument(deep).value);
  assert.equal(result.truncated, true);
  assert.ok(result.count <= 65);
  const wide = buildJsonPreview(Array.from({ length: 20000 }, () => ({ child: 1 })));
  assert.equal(wide.truncated, true);
  assert.equal(wide.count, 10000);
  const { JsonStructuredView } = loadSource('structuredViewers.tsx');
  const html = renderToString(createElement(JsonStructuredView, { text: deep, labels: { invalidJson: 'Invalid', truncated: 'Preview limited' } }));
  assert.ok(html.includes('Preview limited'));
  assert.ok(html.length < 10000);
});

test('move relocates an entry to its destination and drops entries outside the library', () => {
  const original = image('original');
  const sameName = image('archive', '/archive.zip');
  const unchanged = node('/elsewhere');
  const root = node('/', [], [node('/from', [original, sameName]), node('/to'), unchanged]);
  const moved = image('moved', '/to');
  const updated = moveLibraryEntry(root, original.id, moved);
  assert.deepEqual(updated.children[0].images, [sameName]);
  assert.deepEqual(updated.children[1].images, [moved]);
  assert.equal(updated.children[2], unchanged);
  const outside = moveLibraryEntry(root, original.id, image('outside', '/external'));
  assert.deepEqual(outside.children[0].images, [sameName]);
  assert.equal(outside.children[1], root.children[1]);
});

test('workspace uses backend identities, reports partial failure and finishes the operation', async () => {
  const harness = hookHarness();
  const { useWorkspace } = loadSource('useWorkspace.ts', harness.react);
  const original = image('original');
  const archive = { ...image('archive', '/archive.zip'), source: 'archive' };
  const moved = image('moved', '/to');
  const finishes: number[] = [];
  const changes: any[] = [];
  const restore = globalValue('window', { go: { app: {
    App: { BeginOperation: async () => 42, FinishOperation: async (id: number) => finishes.push(id) },
    FileService: {
      SelectMoveDestination: async () => '/to',
      MoveEntries: async () => ({ moved: [moved], originalIds: { moved: 'original' }, failed: [{ path: archive.path, error: 'Archive cannot be moved' }] }),
    },
  } } });
  try {
    const options = { libraryImages: [archive, original], labels: { operationFailed: 'Failed', movedSummary: 'Moved' }, onEntryMoved: (...args: any[]) => changes.push(args) };
    const render = () => harness.render(() => useWorkspace(options));
    render().selectAllFiltered();
    await render().moveSelected();
    assert.deepEqual(changes, [['original', moved]]);
    assert.deepEqual(finishes, [42]);
    assert.ok(render().message.includes('Archive cannot be moved'));
    assert.equal(render().busy, false);
  } finally { restore(); }
});

test('workspace closes operations on chooser cancellation, bridge errors and trash cancellation', async () => {
  for (const scenario of ['cancel', 'throw', 'trash']) {
    const harness = hookHarness();
    const { useWorkspace } = loadSource('useWorkspace.ts', harness.react);
    const finishes: number[] = [];
    const restore = globalValue('window', { go: { app: {
      App: { BeginOperation: async () => 7, FinishOperation: async (id: number) => finishes.push(id) },
      FileService: {
        SelectMoveDestination: async () => { if (scenario === 'throw') throw new Error('chooser failed'); return ''; },
        ConfirmTrashEntries: async () => ({ removedIds: [], failed: [] }),
      },
    } } });
    try {
      const render = () => harness.render(() => useWorkspace({ libraryImages: [image('one')], labels: { operationFailed: 'Failed' } }));
      render().selectAllFiltered();
      if (scenario === 'trash') await render().trashSelected(); else await render().moveSelected();
      assert.deepEqual(finishes, [7], scenario);
      assert.equal(render().busy, false);
      if (scenario === 'throw') assert.equal(render().message, 'chooser failed');
    } finally { restore(); }
  }
});

test('late subtitle responses neither overwrite the next video nor leak object URLs', async () => {
  const harness = hookHarness();
  const { MediaPlayer } = loadSource('MediaPlayer.tsx', harness.react);
  const pending: Array<(value: any) => void> = [];
  const restoreWindow = globalValue('window', { go: { app: { App: { LoadDocumentByPath: () => new Promise((resolve) => pending.push(resolve)) } } } });
  const restoreStorage = globalValue('localStorage', { getItem: () => null });
  const created: string[] = [], revoked: string[] = [];
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => { const url = 'blob:' + created.length; created.push(url); return url; };
  URL.revokeObjectURL = (url) => { revoked.push(url); };
  try {
    const labels = { subtitleFailed: 'Subtitle failed' };
    const renderSubtitleEffect = (id: string) => {
      const entry = { ...image(id), path: '/' + id + '.mp4', kind: 'video', format: '.mp4' };
      harness.render(() => MediaPlayer({ entry, subtitle: { ...image(id + '-subtitle'), path: '/' + id + '.srt' }, labels }));
      return harness.effects.find((effect) => effect.deps?.[0] === entry.kind && effect.deps?.[1] === entry.path)!.run();
    };
    const oldCleanup = renderSubtitleEffect('old') as () => void;
    oldCleanup();
    const nextCleanup = renderSubtitleEffect('new') as () => void;
    pending[1]({ text: '1\n00:00:00,000 --> 00:00:01,000\nNew subtitle\n', format: '.srt' });
    await flush();
    assert.equal(created.length, 1);
    const updateCount = harness.updates.length;
    pending[0]({ text: '1\n00:00:00,000 --> 00:00:01,000\nOld subtitle\n', format: '.srt' });
    await flush();
    assert.equal(harness.updates.length, updateCount);
    assert.equal(created.length, 1);
    nextCleanup();
    assert.deepEqual(revoked, created);
  } finally {
    URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke;
    restoreWindow(); restoreStorage();
  }
});
