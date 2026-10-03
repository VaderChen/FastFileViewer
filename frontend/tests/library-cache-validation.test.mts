import assert from 'node:assert/strict';
import test from 'node:test';
import { isLibraryTree } from '../src/libraryTree.ts';

const entry = (id = 'image') => ({
  id, name: 'image.png', path: '/fixture/image.png', directoryPath: '/fixture',
  source: 'file', format: 'png', kind: 'image', size: 12,
});
const node = (id = 'root'): any => ({
  id, name: id, path: '/fixture/' + id, kind: 'directory', scanned: true,
  images: [], children: [],
});

test('cache validation accepts nested directories and archived entries without mutation', () => {
  const root = node();
  root.images.push(entry());
  const archive = { ...node('archive'), kind: 'archive', images: [{
    ...entry('archived'), source: 'archive', archivePath: '/fixture/items.tar', innerPath: 'image.png',
  }] };
  root.children.push(archive, { ...node('pending'), scanned: false });
  const snapshot = JSON.stringify(root);
  assert.equal(isLibraryTree(root), true);
  assert.equal(JSON.stringify(root), snapshot);
});

test('cache validation rejects malformed entries and ambiguous identifiers', () => {
  const mutations = [
    (root: any) => { root.children = [null]; },
    (root: any) => { root.images = null; },
    (root: any) => { root.images = [{ ...entry(), size: Infinity }]; },
    (root: any) => { root.images = [{ ...entry(), size: -1 }]; },
    (root: any) => { root.images = [{ ...entry(), source: 'archive' }]; },
    (root: any) => { root.images = [{ ...entry(), kind: 'unknown' }]; },
    (root: any) => { root.images = [{ ...entry(), name: 42 }]; },
    (root: any) => { root.children = [node()]; },
    (root: any) => { root.images = [entry()]; root.children = [{ ...node('child'), images: [entry()] }]; },
  ];
  for (const mutate of mutations) {
    const root = node();
    mutate(root);
    assert.equal(isLibraryTree(root), false);
  }
  for (const value of [null, [], false, 'tree', {}]) assert.equal(isLibraryTree(value), false);
});

test('cache validation bounds nesting and terminates on cyclic input', () => {
  const root = node();
  let current = root;
  for (let depth = 1; depth <= 256; depth++) {
    const child = node('node-' + depth);
    current.children.push(child);
    current = child;
  }
  assert.equal(isLibraryTree(root), true);
  current.children.push(node('too-deep'));
  assert.equal(isLibraryTree(root), false);
  const cycle = node();
  cycle.children.push(cycle);
  assert.equal(isLibraryTree(cycle), false);
});
