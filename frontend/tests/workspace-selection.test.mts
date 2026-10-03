import assert from 'node:assert/strict';
import test from 'node:test';
import { filterWorkspaceEntries } from '../src/workspaceFilters.ts';
import type { WorkspaceKindFilter, WorkspaceSourceFilter } from '../src/workspaceFilters.ts';
import type { ImageEntry } from '../src/types.ts';
import { flush, globalValue, hookHarness, loadSource } from './helpers/hookHarness.mts';

const image = (id: string, values: Partial<ImageEntry> = {}): ImageEntry => ({
  id, name: id + '.png', path: '/fixture/' + id + '.png', directoryPath: '/fixture',
  source: 'file', format: '.png', kind: 'image', size: 1, ...values,
});

test('workspace filters retain locale matching, field order and fresh result identity', () => {
  const entries = [
    image('中文', { name: '測試圖片.png' }), image('accent', { name: 'Été.png' }),
    image('turkish', { name: 'İSTANBUL.png' }), image('greek', { name: 'ΟΣ.png' }),
    image('path', { path: '/fixture/ÉTÉ/data', name: 'plain' }),
    image('directory', { directoryPath: '/Σ/', kind: 'text' }),
    image('format', { format: '.TXT', kind: 'code', source: 'archive' }),
    image('audio', { kind: 'audio' }), image('video', { kind: 'video' }),
    image('subtitle', { kind: 'subtitle' }), image('pdf', { kind: 'pdf' }),
  ];
  const queries = ['', '  ', '測試', 'ÉTÉ', ' i ', 'i\u0307', 'ΟΣ', 'ος', 'σ', '.txt', 'absent'];
  const isMedia = (entry: ImageEntry) => ['audio', 'video', 'subtitle'].includes(entry.kind);
  for (const query of queries) for (const kind of ['all', 'image', 'document', 'media'] as WorkspaceKindFilter[]) {
    for (const source of ['all', 'file', 'archive'] as WorkspaceSourceFilter[]) {
      const normalized = query.trim().toLocaleLowerCase();
      const expected = entries.filter((entry) =>
        (kind === 'all' || (kind === 'image' ? entry.kind === 'image' : kind === 'media' ? isMedia(entry) : entry.kind !== 'image' && !isMedia(entry)))
        && (source === 'all' || entry.source === source)
        && (!normalized || [entry.name, entry.path, entry.directoryPath, entry.format].some((value) => value.toLocaleLowerCase().includes(normalized))));
      const actual = filterWorkspaceEntries(entries, query, kind, source);
      assert.deepEqual(actual, expected, `${query}/${kind}/${source}`);
      assert.notEqual(actual, entries);
      assert.notEqual(actual, filterWorkspaceEntries(entries, query, kind, source));
    }
  }
});

test('workspace range selection and select-all retain order and hidden selections', () => {
  const harness = hookHarness();
  const { useWorkspace } = loadSource('useWorkspace.ts', harness.react);
  const libraryImages = ['a', 'b', 'c', 'd'].map((id) => image(id));
  const render = () => harness.render(() => useWorkspace({ libraryImages, labels: {} }));
  render().toggleImage('d');
  render().toggleImage('b', { range: true });
  assert.deepEqual([...render().selectedIds], ['b', 'c', 'd']);
  render().toggleImage('c', { toggle: true });
  render().setQuery('a.png');
  render().selectAllFiltered();
  assert.deepEqual([...render().selectedIds], ['b', 'd', 'a']);
  assert.deepEqual(render().selectedImages.map((entry: ImageEntry) => entry.id), ['a', 'b', 'd']);
  render().selectImage('b');
  assert.deepEqual([...render().selectedIds], ['b', 'd', 'a']);
  render().clearSelection();
  assert.deepEqual([...render().selectedIds], []);
});

test('workspace rescan prunes missing selections without changing selection order', () => {
  const harness = hookHarness();
  const { useWorkspace } = loadSource('useWorkspace.ts', harness.react);
  let libraryImages = ['a', 'b', 'c', 'd'].map((id) => image(id));
  const render = () => harness.render(() => useWorkspace({ libraryImages, labels: {} }));
  for (const id of ['d', 'missing', 'b', 'a']) render().selectImage(id);
  libraryImages = [image('a'), image('d'), image('b')];
  render();
  harness.effects.find((effect) => effect.deps.length === 1 && effect.deps[0] === libraryImages)!.run();
  assert.deepEqual([...render().selectedIds], ['d', 'b', 'a']);
  assert.deepEqual(render().selectedImages.map((entry: ImageEntry) => entry.id), ['a', 'd', 'b']);
  libraryImages = [];
  render();
  harness.effects.find((effect) => effect.deps.length === 1 && effect.deps[0] === libraryImages)!.run();
  assert.deepEqual([...render().selectedIds], []);
});

test('workspace partial trash retains failures and unaffected selections', async () => {
  const harness = hookHarness();
  const { useWorkspace } = loadSource('useWorkspace.ts', harness.react);
  const libraryImages = ['a', 'b', 'c', 'd'].map((id) => image(id));
  const removed: string[][] = [], finished: number[] = [], paths: string[][] = [];
  const restore = globalValue('window', { go: { app: {
    App: { BeginOperation: async () => 4, FinishOperation: async (id: number) => { finished.push(id); } },
    FileService: { ConfirmTrashEntries: async (values: string[]) => {
      paths.push(values);
      return { removedIds: ['c', 'a', 'c'], failed: [{ path: '/fixture/b.png', error: 'Denied' }] };
    } },
  } } });
  try {
    const render = () => harness.render(() => useWorkspace({ libraryImages,
      labels: { trashSelected: 'Trashed' }, onEntriesRemoved: (ids: string[]) => removed.push(ids) }));
    for (const id of ['d', 'c', 'b', 'a']) render().selectImage(id);
    await render().trashSelected();
    assert.deepEqual([...render().selectedIds], ['d', 'b']);
    assert.deepEqual(paths, [libraryImages.map((entry) => entry.path)]);
    assert.deepEqual(removed, [['c', 'a', 'c']]);
    assert.equal(render().message, 'Trashed: 3\n/fixture/b.png: Denied');
    assert.deepEqual(finished, [4]);
  } finally { restore(); }
});

test('workspace duplicate trash retains failed entries and unchanged groups', async () => {
  const harness = hookHarness();
  const { useWorkspace } = loadSource('useWorkspace.ts', harness.react);
  const libraryImages = ['a', 'b', 'c', 'd', 'e'].map((id) => image(id));
  const groups = [{ hash: 'first', totalBytes: 3, images: libraryImages.slice(0, 3) },
    { hash: 'other', totalBytes: 2, images: libraryImages.slice(3) }];
  const removed: string[][] = [];
  const restore = globalValue('window', { go: { app: {
    App: { BeginOperation: async () => 5, FinishOperation: async () => undefined, DetectDuplicates: async () => groups },
    FileService: { ConfirmTrashEntries: async () => ({ removedIds: ['b', 'b'], failed: [{ path: '/fixture/c.png', error: 'Denied' }] }) },
  } } });
  try {
    const render = () => harness.render(() => useWorkspace({ libraryImages, labels: {}, onEntriesRemoved: (ids: string[]) => removed.push(ids) }));
    await render().detectDuplicates();
    await render().trashDuplicateGroup(groups[0], 'a');
    assert.deepEqual(render().duplicateGroups[0].images.map((entry: ImageEntry) => entry.id), ['a', 'c']);
    assert.equal(render().duplicateGroups[1], groups[1]);
    assert.deepEqual(removed, [['b', 'b']]);
    assert.equal(render().message, '/fixture/c.png: Denied');
  } finally { restore(); }
});

test('workspace whitespace query changes still clear duplicates and invalidate pending results', async () => {
  const harness = hookHarness();
  const { useWorkspace } = loadSource('useWorkspace.ts', harness.react);
  const libraryImages = [image('a'), image('b')];
  const groups = [{ hash: 'pair', totalBytes: 2, images: libraryImages }];
  let response: Promise<typeof groups> = Promise.resolve(groups);
  let accept!: (value: typeof groups) => void;
  const restore = globalValue('window', { go: { app: { App: {
    BeginOperation: async () => 6, FinishOperation: async () => undefined, DetectDuplicates: () => response,
    CancelOperation: async () => undefined,
  } } } });
  try {
    const render = () => harness.render(() => useWorkspace({ libraryImages, labels: {} }));
    await render().detectDuplicates();
    const oldFiltered = render().filteredImages;
    render().setQuery(' ');
    const next = render();
    assert.notEqual(next.filteredImages, oldFiltered);
    harness.effects.find((effect) => effect.deps.length === 1 && effect.deps[0] === next.filteredImages)!.run();
    assert.deepEqual(render().duplicateGroups, []);
    response = new Promise((resolve) => { accept = resolve; });
    const pending = render().detectDuplicates();
    await flush();
    render().setQuery('  ');
    render();
    accept(groups);
    await pending;
    assert.deepEqual(render().duplicateGroups, []);
    response = new Promise((resolve) => { accept = resolve; });
    const cancelled = render().detectDuplicates();
    await flush();
    render().cancelOperation();
    accept(groups);
    await cancelled;
    assert.deepEqual(render().duplicateGroups, []);
    assert.equal(render().message, '');
  } finally { restore(); }
});
