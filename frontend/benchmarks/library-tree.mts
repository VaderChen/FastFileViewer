import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import * as libraryTree from '../src/libraryTree.ts';
import type { ImageEntry, LibraryNode } from '../src/types.ts';

// Run with: node --expose-gc --max-semi-space-size=256 benchmarks/library-tree.mts
const image = (id: string, directoryPath: string): ImageEntry => ({
  id, directoryPath, name: `${id}.txt`, path: `${directoryPath}/${id}.txt`,
  source: 'file', format: '.txt', kind: 'text', size: 1,
});
const node = (id: string, images: ImageEntry[] = [], children: LibraryNode[] = []): LibraryNode => ({
  id, path: `/${id}`, name: id, kind: 'directory', scanned: true, images, children,
});
const folders = Array.from({ length: 2000 }, (_, i) => {
  const id = `folder-${i}`;
  return node(id, Array.from({ length: 20 }, (_, j) => image(`${id}-${j}`, `/${id}`)));
});
const tree = node('library', [], [...folders, node('destination')]);
const moves = Array.from({ length: 100 }, (_, i) => ({
  oldId: folders[i].images[0].id,
  replacement: image(`moved-${i}`, '/destination'),
}));
const batchMove = (libraryTree as typeof libraryTree & {
  moveLibraryEntries?: (tree: LibraryNode, moves: typeof moves) => LibraryNode;
}).moveLibraryEntries;
const operations = {
  'remove missing entries': () => libraryTree.removeLibraryEntries(tree, new Set(['missing'])),
  'replace missing entry': () => libraryTree.replaceLibraryEntry(tree, 'missing', moves[0].replacement),
  'merge empty scan batch': () => libraryTree.mergeScannedNodes(tree, []),
  'move 100 entries': () => batchMove
    ? batchMove(tree, moves)
    : moves.reduce((current, move) => libraryTree.moveLibraryEntry(current, move.oldId, move.replacement), tree),
};
const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
assert.ok(gc, 'Use --expose-gc to measure temporary heap growth');
for (const [name, operation] of Object.entries(operations)) {
  for (let i = 0; i < 5; i++) operation();
  const times: number[] = [];
  const heap: number[] = [];
  for (let i = 0; i < 9; i++) {
    gc();
    const beforeHeap = process.memoryUsage().heapUsed;
    const start = performance.now();
    const result = operation();
    times.push(performance.now() - start);
    heap.push(Math.max(0, process.memoryUsage().heapUsed - beforeHeap) / 1024);
    if (name.startsWith('move')) assert.equal(result.children.at(-1)!.images.length, moves.length);
    else assert.equal(result, tree);
  }
  console.log(JSON.stringify({ operation: name, medianMs: median(times), medianHeapGrowthKiB: median(heap) }));
}
