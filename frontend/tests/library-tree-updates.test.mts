import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeScannedNodes, moveLibraryEntries, moveLibraryEntry, removeLibraryEntries, replaceLibraryEntry } from '../src/libraryTree.ts';
import type { LibraryEntryMove } from '../src/libraryTree.ts';
import type { ImageEntry, LibraryNode } from '../src/types.ts';
import { globalValue, hookHarness, loadSource } from './helpers/hookHarness.mts';

const image = (id: string, directoryPath = '/source', name = id + '.txt'): ImageEntry => ({
  id, name, directoryPath, path: `${directoryPath}/${name}`, source: 'file', format: '.txt', kind: 'text', size: 1,
});
const node = (path: string, images: ImageEntry[] = [], children: LibraryNode[] = []): LibraryNode => ({
  id: path, path, name: path, kind: 'directory', scanned: true, images, children,
});

test('entry updates retain unchanged image and child arrays without mutating input', () => {
  const nested = node('/source/nested', [image('keep')]);
  const source = node('/source', [image('before'), image('target'), image('after')], [nested]);
  const untouched = node('/untouched', [image('untouched')]);
  const root = node('/', [image('root')], [source, untouched]);
  const replacement = image('replacement');
  for (const updated of [
    replaceLibraryEntry(root, 'target', replacement),
    removeLibraryEntries(root, new Set(['target'])),
    moveLibraryEntry(root, 'target', image('outside', '/outside')),
  ]) {
    assert.equal(updated.images, root.images);
    assert.equal(updated.children[0].children, source.children);
    assert.equal(updated.children[1], untouched);
    assert.deepEqual(root.children[0].images.map((entry) => entry.id), ['before', 'target', 'after']);
  }
  assert.equal(replaceLibraryEntry(root, 'missing', replacement), root);
  assert.equal(removeLibraryEntries(root, new Set(['missing'])), root);
  assert.equal(moveLibraryEntries(root, []), root);
});

test('batched scans preserve already loaded descendants and accept nested results in any order', () => {
  const leaf = node('/source/leaf', [image('cached')]);
  const source = node('/source', [image('old')], [leaf]);
  const untouched = node('/elsewhere');
  const root = node('/', [], [source, untouched]);
  const leafPlaceholder = { ...leaf, scanned: false, images: [], children: [] };
  const sourceScan = node('/source', [image('new')], [leafPlaceholder]);
  const leafScan = node('/source/leaf', [image('rescanned')]);
  const partial = mergeScannedNodes(root, [sourceScan]);
  assert.equal(partial.children[0].children[0].images, leaf.images);
  assert.equal(partial.children[0].children[0].scanned, true);
  assert.equal(partial.images, root.images);
  assert.equal(partial.children[1], untouched);
  for (const scans of [[sourceScan, leafScan], [leafScan, sourceScan]]) {
    const updated = mergeScannedNodes(root, scans);
    assert.deepEqual(updated.children[0].children[0].images.map((entry) => entry.id), ['rescanned']);
    assert.equal(updated.children[1], untouched);
  }
  assert.equal(mergeScannedNodes(root, []), root);
});

test('batch moves preserve sequential collisions, chains, destinations, and stable numeric sorting', () => {
  const left = node('/left', [image('a'), image('b'), image('c')]);
  const existing = image('existing', '/right', 'same.txt');
  const right = node('/right', [image('ten', '/right', '10.txt'), existing, image('two', '/right', '2.txt')]);
  const archive = { ...node('/right', [image('inside')]), id: 'archive', kind: 'archive' as const };
  const untouched = node('/untouched', [image('untouched')]);
  const root = node('/', [], [left, right, archive, untouched]);
  const move = (oldId: string, id: string, directoryPath: string, name: string): LibraryEntryMove => ({
    oldId, replacement: image(id, directoryPath, name),
  });
  const moves = [
    move('a', 'first', '/right', 'same.txt'),
    move('b', 'second', '/right', 'same.txt'),
    move('first', 'outside', '/outside', 'same.txt'),
    move('c', 'first', '/right', 'same.txt'),
    move('second', 'second', '/right', 'same.txt'),
  ];
  const updated = moveLibraryEntries(root, moves);
  assert.deepEqual(updated, moves.reduce((tree, move) => moveLibraryEntry(tree, move.oldId, move.replacement), root));
  assert.deepEqual(updated.children[0].images, []);
  assert.deepEqual(updated.children[1].images.map((entry) => entry.id), ['two', 'ten', 'existing', 'first', 'second']);
  assert.equal(updated.children[2], archive);
  assert.equal(updated.children[3], untouched);
  assert.deepEqual(root.children[0].images.map((entry) => entry.id), ['a', 'b', 'c']);
});

test('batch moves match ordered single moves across mixed repeated identities', () => {
  let seed = 42;
  const next = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
  const root = node('/', [], Array.from({ length: 5 }, (_, directory) => node(`/directory-${directory}`,
    Array.from({ length: 10 }, (_, index) => image(`image-${directory * 10 + index}`, `/directory-${directory}`, `name-${index % 3}.txt`)))));
  for (let sample = 0; sample < 30; sample++) {
    const moves = Array.from({ length: 30 }, () => ({
      oldId: `image-${next(60)}`,
      replacement: image(`image-${next(60)}`, `/directory-${next(6)}`, `name-${next(3)}.txt`),
    }));
    assert.deepEqual(moveLibraryEntries(root, moves), moves.reduce((tree, move) => moveLibraryEntry(tree, move.oldId, move.replacement), root));
  }
});

test('move sorting keeps the existing locale and numeric filename ordering', () => {
  const names = ['10.txt', '2.txt', '檔案.txt', 'é.txt', 'e.txt', 'a.txt', 'A.txt', '😀.txt'];
  const entries = names.map((name, index) => image(String(index), '/destination', name));
  const replacement = image('moved', '/destination', '11.txt');
  const root = node('/destination', entries);
  const expected = [...entries, replacement].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  assert.deepEqual(moveLibraryEntry(root, 'missing', replacement).images, expected);
  assert.deepEqual(root.images, entries);
});

test('workspace reports one move batch with backend identities and retains partial failure messages', async () => {
  const harness = hookHarness();
  const { useWorkspace } = loadSource('useWorkspace.ts', harness.react);
  const entries = [image('first'), image('second'), image('third')];
  const moved = [image('new-first', '/destination'), image('unmapped', '/destination'), image('new-second', '/destination')];
  const batches: LibraryEntryMove[][] = [];
  const finishes: number[] = [];
  const restore = globalValue('window', { go: { app: {
    App: { BeginOperation: async () => 7, FinishOperation: async (id: number) => finishes.push(id) },
    FileService: {
      SelectMoveDestination: async () => '/destination',
      MoveEntries: async () => ({ moved, originalIds: { 'new-first': 'first', 'new-second': 'second' }, failed: [{ path: '/source/third.txt', error: 'Busy' }] }),
    },
  } } });
  try {
    const render = () => harness.render(() => useWorkspace({
      libraryImages: entries, labels: { operationFailed: 'Failed', movedSummary: 'Moved' },
      onEntriesMoved: (moves: LibraryEntryMove[]) => batches.push(moves),
      onEntryMoved: () => assert.fail('Batch result must not also invoke individual callbacks'),
    }));
    render().selectAllFiltered();
    await render().moveSelected();
    assert.deepEqual(batches, [[{ oldId: 'first', replacement: moved[0] }, { oldId: 'second', replacement: moved[2] }]]);
    assert.deepEqual(finishes, [7]);
    assert.ok(render().message.includes('Busy'));
    assert.equal(render().busy, false);
  } finally { restore(); }
});
