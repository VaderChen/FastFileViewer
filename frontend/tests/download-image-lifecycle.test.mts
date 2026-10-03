import assert from 'node:assert/strict';
import test from 'node:test';
import { flush, globalValue, hookHarness, loadSource } from './helpers/hookHarness.mts';
import { decodeImageURL } from '../src/imageTransport.ts';
import { clearThumbnailCache, readThumbnail, requestThumbnail, storeThumbnail } from '../src/thumbnailCache.ts';

test('unchanged download snapshots retain state and every visible field still updates', async () => {
  const { reconcileDownloads } = await import('../src/downloads.ts');
  const item = { id: 'one', url: 'https://example.test/one.png', name: 'one.png', path: '/downloads/one.png',
    status: 'downloading' as const, contentType: 'image/png', bytes: 5, totalBytes: 10,
    error: '', createdAt: 1, completedAt: 0 };
  const previous = [item];
  assert.equal(reconcileDownloads(previous, [{ ...item }]), previous);
  assert.equal(reconcileDownloads(previous, previous), previous);
  const empty: typeof previous = [];
  assert.equal(reconcileDownloads(empty, []), empty);
  for (const [field, value] of Object.entries(item)) {
    const next = [{ ...item, [field]: typeof value === 'number' ? value + 1 : value + '-changed' }];
    assert.equal(reconcileDownloads(previous, next), next, field);
  }
  for (const field of ['error', 'completedAt'] as const) {
    const next = [{ ...item }]; delete next[0][field];
    assert.equal(reconcileDownloads(previous, next), next, field);
  }
  const second = { ...item, id: 'two' };
  for (const next of [[], [second, item], [item, second]]) assert.equal(reconcileDownloads(previous, next), next);
  const ordered = [item, second], reordered = [second, item];
  assert.equal(reconcileDownloads(ordered, reordered), reordered);
});

test('download polling keeps unchanged state identity without delaying progress or removal', async () => {
  let backend = [{ id: 'one', url: 'https://example.test/one.png', name: 'one.png', path: '',
    status: 'downloading', contentType: 'image/png', bytes: 5, totalBytes: 10, createdAt: 1 }];
  const fixture = downloadsFixture({ ListDownloads: async () => structuredClone(backend) });
  let stopPoll: (() => void) | undefined;
  try {
    await flush();
    const initial = fixture.render().downloads;
    stopPoll = fixture.harness.effects.find(effect => effect.deps.length === 2)!.run() as () => void;
    const poll = fixture.intervals.values().next().value!;
    for (let index = 0; index < 5; index++) { poll(); await flush(); assert.equal(fixture.render().downloads, initial); }
    backend[0].bytes = 9; poll(); await flush();
    const changed = fixture.render().downloads;
    assert.notEqual(changed, initial); assert.equal(changed[0].bytes, 9); assert.equal(initial[0].bytes, 5);
    backend = []; poll(); await flush(); assert.deepEqual(fixture.render().downloads, []);
  } finally { stopPoll?.(); fixture.unmount(); fixture.restore(); }
});


function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function downloadsFixture(service: object = {}) {
  const harness = hookHarness();
  const { useDownloads } = loadSource('useDownloads.ts', harness.react);
  const errors: string[] = [];
  const intervals = new Map<number, () => void>();
  let nextInterval = 0;
  const restore = globalValue('window', {
    go: { app: { DownloadService: { ListDownloads: async () => [], ...service } } },
    setInterval: (run: () => void) => { intervals.set(++nextInterval, run); return nextInterval; },
    clearInterval: (id: number) => intervals.delete(id),
  });
  const render = () => harness.render(() => useDownloads({
    panelVisible: true, operationFailedLabel: 'Failed', onError: (error: string) => errors.push(error),
  }));
  render();
  const unmount = harness.effects.find((effect) => effect.deps.length === 0)!.run() as () => void;
  return { harness, render, errors, intervals, restore, unmount };
}

test('download submissions are reserved synchronously and preserve newly typed URLs', async () => {
  const response = deferred<void>();
  const starts: string[] = [];
  const fixture = downloadsFixture({ StartDownload: (url: string) => { starts.push(url); return response.promise; } });
  try {
    fixture.render().setDownloadURL('https://example.test/first.png');
    const downloads = fixture.render();
    const first = downloads.submitURLs(['https://example.test/first.png']);
    const duplicate = downloads.submitURLs(['https://example.test/first.png']);
    assert.deepEqual(starts, ['https://example.test/first.png']);
    fixture.render().setDownloadURL('https://example.test/next.png');
    response.resolve();
    await Promise.all([first, duplicate]);
    assert.equal(fixture.render().submitting, false);
    assert.equal(fixture.render().downloadURL, 'https://example.test/next.png');
  } finally { fixture.unmount(); fixture.restore(); }
});

test('HLS confirmation cannot submit twice or close its active resolution', async () => {
  const response = deferred<void>();
  const resolution = { sourceUrl: 'https://example.test/watch', name: 'clip', candidates: [
    { url: 'https://example.test/one.m3u8', name: 'one' },
    { url: 'https://example.test/two.m3u8', name: 'two' },
  ] };
  const starts: string[] = [];
  const fixture = downloadsFixture({
    ResolveDownloadURL: async () => resolution,
    StartResolvedDownload: (_source: string, url: string) => { starts.push(url); return response.promise; },
  });
  try {
    await fixture.render().submitURLs([resolution.sourceUrl]);
    fixture.render();
    fixture.harness.effects.find((effect) => effect.deps.length === 1 && effect.deps[0] === resolution)!.run();
    const downloads = fixture.render();
    const first = downloads.confirmHLSSelection();
    const second = downloads.confirmHLSSelection();
    downloads.closeCurrentResolution();
    assert.equal(fixture.render().currentResolution, resolution);
    assert.deepEqual(starts, [resolution.candidates[0].url]);
    response.resolve();
    await Promise.all([first, second]);
    assert.equal(fixture.render().currentResolution, null);
    assert.equal(fixture.render().selectionSubmitting, false);
  } finally { fixture.unmount(); fixture.restore(); }
});

test('slow download polling is coalesced and cannot undo a newer removal snapshot', async () => {
  const lists = [deferred<any[]>(), deferred<any[]>()];
  let listCalls = 0;
  const fixture = downloadsFixture({
    ListDownloads: () => lists[listCalls++].promise,
    RemoveDownload: async () => undefined,
  });
  let stopPoll: (() => void) | undefined;
  try {
    fixture.render();
    stopPoll = fixture.harness.effects.find((effect) => effect.deps.length === 2)!.run() as () => void;
    const poll = [...fixture.intervals.values()][0];
    poll(); poll(); poll();
    assert.equal(listCalls, 1);
    const removal = fixture.render().remove('old');
    await flush();
    assert.equal(listCalls, 2);
    lists[1].resolve([{ id: 'new', status: 'completed' }]);
    await removal;
    lists[0].resolve([{ id: 'old', status: 'completed' }]);
    await flush();
    assert.deepEqual(fixture.render().downloads.map((item: any) => item.id), ['new']);
  } finally { stopPoll?.(); fixture.unmount(); fixture.restore(); }
});

test('unmount prevents late page resolution from starting a download or updating state', async () => {
  const response = deferred<any>();
  let starts = 0;
  const fixture = downloadsFixture({
    ResolveDownloadURL: () => response.promise,
    StartResolvedDownload: async () => { starts++; },
    StartDownload: async () => { starts++; },
  });
  try {
    const pending = fixture.render().submitURLs(['https://example.test/watch', 'https://example.test/next.png']);
    fixture.unmount();
    const updates = fixture.harness.updates.length;
    response.resolve({ sourceUrl: 'https://example.test/watch', name: 'clip', candidates: [{ url: 'https://example.test/clip.m3u8' }] });
    await pending;
    await flush();
    assert.equal(starts, 0);
    assert.equal(fixture.harness.updates.length, updates);
    assert.deepEqual(fixture.errors, ['']);
  } finally { fixture.restore(); }
});

test('unmount stops the remaining HLS selections after an accepted download', async () => {
  const response = deferred<void>();
  const resolution = { sourceUrl: 'https://example.test/watch', name: 'clip', candidates: [
    { url: 'https://example.test/one.m3u8' }, { url: 'https://example.test/two.m3u8' },
  ] };
  const starts: string[] = [];
  const fixture = downloadsFixture({
    ResolveDownloadURL: async () => resolution,
    StartResolvedDownload: (_source: string, url: string) => { starts.push(url); return response.promise; },
  });
  try {
    await fixture.render().submitURLs([resolution.sourceUrl]);
    fixture.render().selectAllHLSCandidates();
    const pending = fixture.render().confirmHLSSelection();
    fixture.unmount();
    const updates = fixture.harness.updates.length;
    response.resolve();
    await pending;
    assert.deepEqual(starts, [resolution.candidates[0].url]);
    assert.equal(fixture.harness.updates.length, updates);
  } finally { fixture.restore(); }
});

test('download cancel and directory failures are reported without rejecting event handlers', async () => {
  const fixture = downloadsFixture({
    CancelDownload: async () => { throw new Error('cancel failed'); },
    OpenDownloadsDirectory: async () => { throw new Error('directory unavailable'); },
  });
  try {
    await fixture.render().cancel('item');
    await fixture.render().openDirectory();
    assert.deepEqual(fixture.errors, ['cancel failed', 'directory unavailable']);
  } finally { fixture.unmount(); fixture.restore(); }
});

function imageViewerFixture() {
  const harness = hookHarness();
  const { useImageViewer } = loadSource('useImageViewer.ts', harness.react);
  const frames = new Map<number, () => void>();
  const cancelled: number[] = [];
  let nextFrame = 0;
  const restore = globalValue('window', {
    requestAnimationFrame: (run: () => void) => { frames.set(++nextFrame, run); return nextFrame; },
    cancelAnimationFrame: (id: number) => { cancelled.push(id); frames.delete(id); },
  });
  let imageId = 'old';
  const render = () => harness.render(() => useImageViewer({ zoomBehavior: 'fit', fullscreen: false, imageId, panEnabled: true }));
  return { harness, frames, cancelled, render, restore, changeImage: (id: string) => { imageId = id; } };
}

function stage() {
  const captured = new Set<number>();
  return {
    clientWidth: 100, clientHeight: 100, scrollWidth: 500, scrollHeight: 500, scrollLeft: 0, scrollTop: 0,
    setPointerCapture: (id: number) => captured.add(id),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: (id: number) => captured.delete(id),
  };
}

test('image centering coalesces frames and releases pending work on unmount', () => {
  const fixture = imageViewerFixture();
  try {
    const viewer = fixture.render();
    viewer.stageRef.current = stage();
    const cleanup = fixture.harness.effects.find((effect) => effect.deps.length === 3)!.run() as () => void;
    viewer.centerImage();
    viewer.centerImage();
    assert.equal(fixture.frames.size, 1);
    assert.equal(fixture.cancelled.length, 1);
    cleanup();
    assert.equal(fixture.frames.size, 0);
  } finally { fixture.restore(); }
});

test('stale image centering cannot scroll a replacement stage or a newly selected image', () => {
  for (const replaceStage of [false, true]) {
    const fixture = imageViewerFixture();
    try {
      const viewer = fixture.render();
      const oldStage = stage(), nextStage = stage();
      viewer.stageRef.current = oldStage;
      viewer.centerImage();
      const frame = [...fixture.frames.values()][0];
      if (replaceStage) viewer.stageRef.current = nextStage;
      else { fixture.changeImage('new'); fixture.render(); }
      frame();
      assert.equal(oldStage.scrollLeft, 0);
      assert.equal(nextStage.scrollLeft, 0);
    } finally { fixture.restore(); }
  }
});

test('changing images releases the old pointer capture and stops dragging the new image', () => {
  const fixture = imageViewerFixture();
  try {
    const viewer = fixture.render();
    const oldStage = stage(), nextStage = stage();
    viewer.stageRef.current = oldStage;
    const cleanup = fixture.harness.effects.find((effect) => effect.deps.length === 3)!.run() as () => void;
    const event = (target: object, id = 1) => ({
      currentTarget: target, pointerId: id, button: 0, clientX: 0, clientY: 0, preventDefault() {},
    });
    viewer.handlePanStart(event(oldStage));
    assert.equal(oldStage.hasPointerCapture(1), true);
    assert.equal(fixture.render().panning, true);
    // A second pointer must not replace the drag without releasing the first capture.
    fixture.render().handlePanStart(event(oldStage, 2));
    assert.equal(oldStage.hasPointerCapture(2), false);
    cleanup();
    assert.equal(oldStage.hasPointerCapture(1), false);
    fixture.changeImage('new');
    const next = fixture.render();
    next.stageRef.current = nextStage;
    fixture.harness.effects.find((effect) => effect.deps.length === 3)!.run();
    next.handlePanMove({ ...event(nextStage), clientX: 50, clientY: 50 });
    assert.equal(nextStage.scrollLeft, 0);
    assert.equal(fixture.render().panning, false);
  } finally { fixture.restore(); }
});

test('aborting image transport during decoding ignores the late decoder result', async () => {
  const decoded = deferred<void>();
  class FakeImage {
    static latest: FakeImage;
    src = '';
    decoding = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() { FakeImage.latest = this; }
    removeAttribute(name: string) { if (name === 'src') this.src = ''; }
    decode() { return decoded.promise; }
  }
  const restore = globalValue('Image', FakeImage);
  try {
    const controller = new AbortController();
    const pending = decodeImageURL('/image/old', controller.signal);
    const rejection = assert.rejects(pending, { name: 'AbortError' });
    FakeImage.latest.onload!();
    controller.abort();
    await rejection;
    decoded.resolve();
    await flush();
    assert.equal(FakeImage.latest.src, '');
    assert.equal(FakeImage.latest.onload, null);
    assert.equal(FakeImage.latest.onerror, null);
  } finally { restore(); }
});

test('clearing thumbnails cancels old requests without exceeding the backend concurrency limit', async () => {
  clearThumbnailCache();
  storeThumbnail('/prior.png', 'data:prior');
  const calls: { path: string; response: ReturnType<typeof deferred<{ dataUri: string }>> }[] = [];
  const restore = globalValue('window', { go: { app: { App: {
    LoadThumbnailByPath: (path: string) => {
      const response = deferred<{ dataUri: string }>();
      calls.push({ path, response });
      return response.promise;
    },
  } } } });
  try {
    const pending = Array.from({ length: 5 }, (_, index) => requestThumbnail('/old-' + index + '.png', new AbortController().signal).catch((error) => error.name));
    await flush();
    assert.equal(calls.length, 3);
    clearThumbnailCache();
    assert.equal(readThumbnail('/prior.png'), '');
    assert.deepEqual(await Promise.all(pending), Array(5).fill('AbortError'));
    const next = requestThumbnail('/old-0.png', new AbortController().signal);
    await flush();
    assert.equal(calls.length, 3, 'cancelled backend work must keep its slot until it completes');
    for (const call of calls.slice()) call.response.resolve({ dataUri: 'data:stale' });
    await flush();
    assert.deepEqual(calls.map((call) => call.path), ['/old-0.png', '/old-1.png', '/old-2.png', '/old-0.png']);
    assert.equal(readThumbnail('/old-0.png'), '');
    assert.equal(readThumbnail('/old-1.png'), '');
    calls[3].response.resolve({ dataUri: 'data:updated' });
    assert.equal(await next, 'data:updated');
    assert.equal(readThumbnail('/old-0.png'), 'data:updated');
    await flush();
  } finally { clearThumbnailCache(); restore(); }
});

test('clearing a thumbnail before its backend call starts skips the obsolete decode', async () => {
  let calls = 0;
  const restore = globalValue('window', { go: { app: { App: {
    LoadThumbnailByPath: async () => { calls++; return { dataUri: 'data:obsolete' }; },
  } } } });
  try {
    const pending = requestThumbnail('/obsolete.png', new AbortController().signal).catch((error) => error.name);
    clearThumbnailCache();
    assert.equal(await pending, 'AbortError');
    await flush();
    assert.equal(calls, 0);
    assert.equal(readThumbnail('/obsolete.png'), '');
  } finally { clearThumbnailCache(); restore(); }
});

function findImageSource(element: any): string | undefined {
  if (!element || typeof element !== 'object') return undefined;
  if (element.type === 'img') return element.props.src;
  for (const child of [element.props?.children].flat()) {
    const source = findImageSource(child);
    if (source) return source;
  }
  return undefined;
}

test('a refreshed thumbnail card hides its old image immediately and reloads the same path', async () => {
  clearThumbnailCache();
  const path = '/same.png';
  storeThumbnail(path, 'data:old');
  const response = deferred<{ dataUri: string }>();
  const calls: string[] = [];
  const restore = globalValue('window', { go: { app: { App: {
    LoadThumbnailByPath: (path: string) => { calls.push(path); return response.promise; },
  } } } });
  const harness = hookHarness();
  const { ThumbnailCard } = loadSource('ThumbnailCard.tsx', harness.react, {
    './thumbnailCache': {
      readThumbnail, requestThumbnail,
      observeThumbnailVisibility: (_element: object, visible: () => void) => { visible(); return () => undefined; },
    },
  });
  let revision = 0;
  const render = () => harness.render(() => ThumbnailCard({
    image: { id: path, path, name: 'same.png', kind: 'image', size: 1, source: 'file', format: '.png' },
    revision, active: false, selected: false, archiveLabel: 'Archive', folderLabel: 'Folder',
    onToggle() {}, onOpen() {},
  }));
  let cleanup: (() => void) | undefined;
  try {
    const initial = render();
    initial.ref.current = {};
    assert.equal(findImageSource(initial), 'data:old');
    harness.effects.find((effect) => effect.deps.length === 2)!.run();
    render();
    harness.effects.find((effect) => effect.deps.length === 4)!.run();
    revision = clearThumbnailCache();
    assert.equal(findImageSource(render()), undefined);
    cleanup = harness.effects.find((effect) => effect.deps.length === 4)!.run() as () => void;
    await flush();
    assert.deepEqual(calls, [path]);
    response.resolve({ dataUri: 'data:new' });
    await flush();
    assert.equal(findImageSource(render()), 'data:new');
  } finally { cleanup?.(); clearThumbnailCache(); restore(); }
});
