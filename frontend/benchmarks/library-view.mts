// Run with: node --expose-gc benchmarks/library-view.mts
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { buildVisibleTree, collectImages, collectImageRefs, libraryCounts } from '../src/libraryView.ts';
import type { ImageEntry, LibraryNode } from '../src/types.ts';

function fixture(): LibraryNode {
  let sequence = 0;
  const make = (depth: number): LibraryNode => {
    const id = String(sequence++);
    return { id, name: id, path: '/fixture/' + id, kind: 'directory', scanned: true,
      images: Array.from({ length: 80 }, (_, i): ImageEntry => ({ id: id + '-' + i, name: 'Image-' + i,
        path: '/fixture/' + id + '/' + i, directoryPath: '/fixture/' + id, source: 'file',
        kind: i % 3 === 0 ? 'audio' : i % 3 === 1 ? 'text' : 'image', format: '.png', size: 1 })),
      children: depth ? Array.from({ length: 5 }, () => make(depth - 1)) : [],
    };
  };
  return make(4);
}

const previousVisible = (node: LibraryNode): LibraryNode => ({ ...node, children: node.children.flatMap(child => [previousVisible(child)]) });
const previousImages = (node: LibraryNode): ImageEntry[] => [...node.images, ...node.children.flatMap(previousImages)];
const previousRefs = (node: LibraryNode, ancestorIds: string[] = []): any[] => {
  const next = [...ancestorIds, node.id];
  return [...node.children.flatMap(child => previousRefs(child, next)), ...node.images.map(image => ({ image, node, ancestorIds }))];
};
function previousCounts(images: ImageEntry[], tree: LibraryNode) {
  const archives = (node: LibraryNode): number => (node.kind === 'archive' ? 1 : 0) + node.children.reduce((sum, child) => sum + archives(child), 0);
  const media = (entry: ImageEntry) => entry.kind === 'video' || entry.kind === 'audio' || entry.kind === 'subtitle';
  return { images: images.filter(e => e.kind === 'image').length,
    documents: images.filter(e => e.kind !== 'image' && !media(e)).length,
    media: images.filter(media).length, archives: archives(tree) };
}
const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
if (!globalThis.gc) throw new Error('Run Node with --expose-gc');
for (const mode of ['previous', 'optimized']) {
  const times: number[] = [], heaps: number[] = [], renders: number[] = [];
  for (let run = 0; run < 7; run++) {
    const tree = fixture();
    globalThis.gc();
    const heap = process.memoryUsage().heapUsed;
    const start = performance.now();
    const visible = mode === 'previous' ? previousVisible(tree) : buildVisibleTree(tree)!;
    const images = mode === 'previous' ? previousImages(visible) : collectImages(visible);
    const refs = mode === 'previous' ? previousRefs(visible) : collectImageRefs(visible);
    const counts = mode === 'previous' ? previousCounts(images, visible) : libraryCounts(visible);
    const elapsed = performance.now() - start;
    const heapGrowth = process.memoryUsage().heapUsed - heap;
    assert.equal(images.length, 62480);
    assert.equal(refs.length, images.length);
    assert.equal(counts.images + counts.documents + counts.media, images.length);
    const renderStart = performance.now();
    for (let i = 0; i < 100; i++) {
      const current = mode === 'previous' ? previousCounts(images, visible) : libraryCounts(visible);
      assert.equal(current.images, counts.images);
    }
    if (run > 1) { times.push(elapsed); heaps.push(heapGrowth); renders.push(performance.now() - renderStart); }
  }
  console.log(JSON.stringify({ mode, entries: 62480, preparationMedianMs: median(times),
    preparationHeapGrowthBytes: median(heaps), unchangedRenderCounts100Ms: median(renders) }));
}
