import assert from 'node:assert/strict';
import test from 'node:test';
import { virtualGridRange } from '../src/virtualGrid.ts';
import { readThumbnail, requestThumbnail, storeThumbnail } from '../src/thumbnailCache.ts';
import { decodeImageURL, imageURLToDataURI } from '../src/imageTransport.ts';
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('virtual grid bounds ten thousand images and includes the last row', () => {
  const first = virtualGridRange(10000, 850, 700, 0);
  const middle = virtualGridRange(10000, 850, 700, 120000);
  const end = virtualGridRange(10000, 850, 700, first.totalHeight - 700);
  assert.ok(first.end < 40);
  assert.ok(middle.end - middle.start < 40);
  assert.equal(end.end, 10000);
  assert.ok(end.start < end.end);
  assert.equal(virtualGridRange(0, 0, 0, 0).totalHeight, 0);
  assert.equal(virtualGridRange(10, 140, 700, 0).columns, 1);
  assert.equal(virtualGridRange(2, 850, 700, 120000).start, 0);
});

test('thumbnail cache enforces a byte budget', () => {
  const large = 'a'.repeat(3 * 1024 * 1024);
  for (const key of ['a', 'b', 'c']) storeThumbnail(`/bytes/${key}`, large);
  assert.equal(readThumbnail('/bytes/a'), '');
  assert.equal(readThumbnail('/bytes/c'), large);
  storeThumbnail('/bytes/huge', 'a'.repeat(9 * 1024 * 1024));
  assert.equal(readThumbnail('/bytes/huge'), '');
});

test('thumbnail queue cancels offscreen work while keeping three backend slots', async () => {
  const calls: string[] = [];
  const releases: Array<() => void> = [];
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { go: { app: { App: {
    LoadThumbnailByPath: (path: string) => new Promise((resolve) => {
      calls.push(path);
      releases.push(() => resolve({ dataUri: `data:${path}` }));
    }),
  } } } } });
  try {
    const controllers = Array.from({ length: 5 }, () => new AbortController());
    const pending = controllers.map((c, i) => requestThumbnail(`/queue/${i}`, c.signal).catch((e) => e.name));
    await flush();
    assert.equal(calls.length, 3);
    controllers[3].abort();
    controllers[0].abort();
    await flush();
    assert.equal(calls.length, 3);
    releases.shift()!();
    await flush();
    assert.deepEqual(calls, ['/queue/0', '/queue/1', '/queue/2', '/queue/4']);
    while (releases.length) releases.shift()!();
    const results = await Promise.all(pending);
    await flush();
    assert.equal(results[0], 'AbortError');
    assert.equal(results[3], 'AbortError');
    assert.equal(readThumbnail('/queue/0'), '');
  } finally {
    if (prior) Object.defineProperty(globalThis, 'window', prior);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('image transport cancels network requests and surfaces errors', async () => {
  class FakeImage {
    static latest: FakeImage;
    src = ''; decoding = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() { FakeImage.latest = this; }
    removeAttribute(name: string) { if (name === 'src') this.src = ''; }
    decode() { return Promise.resolve(); }
  }
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: FakeImage });
  try {
    const controller = new AbortController();
    const rejection = assert.rejects(decodeImageURL('/image/one', controller.signal), { name: 'AbortError' });
    controller.abort(); await rejection;
    assert.equal(FakeImage.latest.src, '');
    const failed = decodeImageURL('/image/missing'); FakeImage.latest.onerror!();
    await assert.rejects(failed, /Unable to load image/);
    const loaded = decodeImageURL('/image/ok'); FakeImage.latest.onload!(); await loaded;
    assert.equal(await imageURLToDataURI('data:image/png;base64,abc'), 'data:image/png;base64,abc');
  } finally {
    if (prior) Object.defineProperty(globalThis, 'Image', prior);
    else Reflect.deleteProperty(globalThis, 'Image');
  }
});

test('batch scan merges nested results and preserves untouched branches', async () => {
  const { mergeScannedNodes } = await import('../src/libraryTree.ts');
  const node = (id: string) => ({ id, name: id, path: `/${id}`, kind: 'directory' as const, scanned: false, images: [], children: [] });
  const left = node('left');
  const untouched = node('right');
  const root = { ...node('root'), children: [left, untouched] };
  const grandchild = node('grandchild');
  const updated = mergeScannedNodes(root, [{ ...left, scanned: true, children: [grandchild] }, { ...grandchild, scanned: true }]);
  assert.equal(updated.children[1], untouched);
  assert.equal(updated.children[0].children[0].scanned, true);
  assert.equal(mergeScannedNodes(updated, []), updated);
});
