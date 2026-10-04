import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVisibleTree, collectImages, collectImageRefs, containsSelectedImage, imagePrefetchCandidates, libraryCounts } from '../src/libraryView.ts';
import type { ImageEntry, LibraryNode } from '../src/types.ts';

const entry = (id: string, kind: ImageEntry['kind'] = 'image'): ImageEntry => ({
  id, name: id, path: '/fixture/' + id, directoryPath: '/fixture', kind, source: 'file', format: '.png', size: 1,
});
const node = (id: string, images: ImageEntry[] = [], children: LibraryNode[] = []): LibraryNode => ({
  id, name: id, path: '/fixture/' + id, kind: 'directory', scanned: true, images, children,
});

test('library traversal preserves distinct workspace and navigation orders', () => {
  const child = node('child', [entry('second', 'text')], [node('deep', [entry('first', 'audio')])]);
  const root = node('root', [entry('last')], [child, node('sibling', [entry('third')])]);
  assert.deepEqual(collectImages(root).map(e => e.id), ['last', 'second', 'first', 'third']);
  const refs = collectImageRefs(root);
  assert.deepEqual(refs.map(e => e.image.id), ['first', 'second', 'third', 'last']);
  assert.deepEqual(refs.map(e => e.ancestorIds), [['root', 'child'], ['root'], ['root'], []]);
  assert.strictEqual(refs[1].node, child);
  assert.strictEqual(refs[3].image, root.images[0]);
});

test('visible tree keeps pending directories and root while sharing unchanged branches', () => {
  const populated = node('populated', [entry('image')]);
  const pending = { ...node('pending'), scanned: false };
  const empty = node('empty', [], [node('nested-empty')]);
  const root = node('root', [], [populated, empty, pending]);
  const visible = buildVisibleTree(root)!;
  assert.deepEqual(visible.children.map(c => c.id), ['populated', 'pending']);
  assert.strictEqual(visible.children[0], populated);
  assert.strictEqual(visible.children[1], pending);
  assert.strictEqual(buildVisibleTree(root), visible);
  assert.strictEqual(buildVisibleTree(populated), populated);
  assert.strictEqual(buildVisibleTree(pending), pending);
  assert.equal(buildVisibleTree(empty, false), null);
  assert.deepEqual(buildVisibleTree(empty)?.children, []);
  assert.equal(root.children.length, 3);
  assert.equal(buildVisibleTree(null), null);
});

test('immutable tree updates refresh counts and visibility without retaining stale results', () => {
  const child = { ...node('archive', [entry('text', 'markdown'), entry('audio', 'audio')]), kind: 'archive' as const };
  const root = node('root', [entry('image')], [child]);
  const previous = libraryCounts(root);
  assert.deepEqual(previous, { entries: 3, images: 1, documents: 1, media: 1, models: 0, archives: 1 });
  assert.strictEqual(libraryCounts(root), previous);
  const changed = { ...root, images: [entry('pdf', 'pdf')], children: [{ ...child, images: [] }] };
  const visible = buildVisibleTree(changed)!;
  assert.deepEqual(libraryCounts(visible), { entries: 1, images: 0, documents: 1, media: 0, models: 0, archives: 0 });
  assert.deepEqual(libraryCounts(root), previous);
  for (const kind of ['video', 'subtitle', 'code', 'text'] as const) {
    const counts = libraryCounts(node(kind, [entry(kind, kind)]));
    assert.equal(counts.entries, 1);
    assert.equal(counts.media, kind === 'video' || kind === 'subtitle' ? 1 : 0);
  }
});

test('collapsed selection matches selected IDs in descendants without per-ID searches', () => {
  const root = node('root', [entry('one')], [node('child', [entry('two')])]);
  assert.equal(containsSelectedImage(root, '', new Set()), false);
  assert.equal(containsSelectedImage(root, 'one', new Set()), true);
  assert.equal(containsSelectedImage(root, 'missing', new Set(['two'])), true);
  assert.equal(containsSelectedImage(root, 'missing', new Set(['elsewhere'])), false);
});

test('prefetch keeps wrapped image-only order, deduplication and single-image behavior', () => {
  for (let length = 1; length <= 40; length++) {
    const images = Array.from({ length }, (_, i) => entry(String(i), i % 3 === 0 ? 'text' : 'image'));
    // Different entries can share an underlying cache key.
    if (length > 8) images[8] = { ...images[8], path: images[2].path };
    const root = node('root', images);
    const refs = collectImageRefs(root);
    const onlyImages = images.filter(e => e.kind === 'image');
    for (const selected of onlyImages) {
      const index = onlyImages.indexOf(selected);
      const expected: ImageEntry[] = [];
      const keys = new Set<string>();
      const key = (e: ImageEntry) => e.path + '\u0000' + e.size;
      for (const offset of [1, -1, 2, -2]) {
        const candidate = onlyImages[(index + offset + onlyImages.length) % onlyImages.length];
        if (candidate && key(candidate) !== key(selected) && !keys.has(key(candidate))) {
          keys.add(key(candidate)); expected.push(candidate);
        }
      }
      assert.deepEqual(imagePrefetchCandidates(refs, selected), expected);
    }
    assert.deepEqual(imagePrefetchCandidates(refs, entry('missing')), []);
  }
});
