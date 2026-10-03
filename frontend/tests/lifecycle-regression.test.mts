import assert from 'node:assert/strict';
import test from 'node:test';
import { flush, globalValue, hookHarness, loadSource } from './helpers/hookHarness.mts';
import type { ImageEntry } from '../src/types.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

const image = (id: string): ImageEntry => ({
  id, name: id + '.mp3', path: '/' + id + '.mp3', directoryPath: '/', source: 'file', format: '.mp3', kind: 'audio', size: 1,
});

function findElement(tree: any, match: (element: any) => boolean): any {
  if (!tree || typeof tree !== 'object') return undefined;
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = findElement(child, match);
      if (found) return found;
    }
    return undefined;
  }
  return match(tree) ? tree : findElement(tree.props?.children, match);
}

test('workspace reserves a pending operation and cancels its late backend ID', async () => {
  const harness = hookHarness();
  const { useWorkspace } = loadSource('useWorkspace.ts', harness.react);
  const begin = deferred<number>();
  let beginCalls = 0, duplicateCalls = 0;
  const cancelled: number[] = [], finished: number[] = [];
  const restore = globalValue('window', { go: { app: { App: {
    BeginOperation: () => { beginCalls++; return begin.promise; },
    CancelOperation: async (id: number) => { cancelled.push(id); },
    FinishOperation: async (id: number) => { finished.push(id); },
    DetectDuplicates: async () => { duplicateCalls++; return []; },
  } } } });
  try {
    const render = () => harness.render(() => useWorkspace({ libraryImages: [image('one')], labels: { operationFailed: 'Failed' } }));
    const first = render().detectDuplicates();
    await render().detectDuplicates();
    assert.equal(beginCalls, 1);
    assert.equal(render().busy, true);
    render().cancelOperation();
    begin.resolve(71);
    await first;
    assert.equal(duplicateCalls, 0);
    assert.deepEqual(cancelled, [71]);
    assert.deepEqual(finished, [71]);
    assert.equal(render().busy, false);
  } finally { restore(); }
});

test('workspace cancellation suppresses late duplicate results and a pending move chooser', async () => {
  for (const operation of ['duplicates', 'move']) {
    const harness = hookHarness();
    const { useWorkspace } = loadSource('useWorkspace.ts', harness.react);
    const response = deferred<any>();
    let moves = 0;
    const finished: number[] = [];
    const restore = globalValue('window', { go: { app: {
      App: {
        BeginOperation: async () => 23,
        CancelOperation: async () => undefined,
        FinishOperation: async (id: number) => { finished.push(id); },
        DetectDuplicates: () => response.promise,
      },
      FileService: {
        SelectMoveDestination: () => response.promise,
        MoveEntries: async () => { moves++; return { moved: [], originalIds: {}, failed: [] }; },
      },
    } } });
    try {
      const render = () => harness.render(() => useWorkspace({ libraryImages: [image('one')], labels: { operationFailed: 'Failed' } }));
      render().selectAllFiltered();
      const pending = operation === 'duplicates' ? render().detectDuplicates() : render().moveSelected();
      await flush();
      render().cancelOperation();
      response.resolve(operation === 'duplicates' ? [{ images: [image('one'), image('two')] }] : '/destination');
      await pending;
      assert.deepEqual(render().duplicateGroups, [], operation);
      assert.equal(moves, 0, operation);
      assert.deepEqual(finished, [23], operation);
      assert.equal(render().message, '', operation);
    } finally { restore(); }
  }
});

test('duplicate detection discards results for a library or filter that has changed', async () => {
  const harness = hookHarness();
  const { useWorkspace } = loadSource('useWorkspace.ts', harness.react);
  const duplicates = deferred<any[]>();
  const restore = globalValue('window', { go: { app: { App: {
    BeginOperation: async () => 13,
    FinishOperation: async () => undefined,
    DetectDuplicates: () => duplicates.promise,
  } } } });
  try {
    let libraryImages = [image('one'), image('two')];
    const render = () => harness.render(() => useWorkspace({ libraryImages, labels: { operationFailed: 'Failed' } }));
    const pending = render().detectDuplicates();
    await flush();
    libraryImages = [image('different')];
    render();
    duplicates.resolve([{ images: [image('one'), image('two')] }]);
    await pending;
    assert.deepEqual(render().duplicateGroups, []);
    assert.equal(render().message, '');
  } finally { restore(); }
});

test('workspace unmount cancels and finishes an operation still waiting for its ID', async () => {
  const harness = hookHarness();
  const { useWorkspace } = loadSource('useWorkspace.ts', harness.react);
  const begin = deferred<number>();
  const cancelled: number[] = [], finished: number[] = [];
  const restore = globalValue('window', { go: { app: { App: {
    BeginOperation: () => begin.promise,
    CancelOperation: async (id: number) => { cancelled.push(id); },
    FinishOperation: async (id: number) => { finished.push(id); },
  } } } });
  try {
    const workspace = harness.render(() => useWorkspace({ libraryImages: [image('one')], labels: { operationFailed: 'Failed' } }));
    const cleanup = harness.effects.find((effect) => effect.deps?.length === 0)!.run() as () => void;
    const pending = workspace.detectDuplicates();
    cleanup();
    const updateCount = harness.updates.length;
    begin.resolve(17);
    await pending;
    assert.deepEqual(cancelled, [17]);
    assert.deepEqual(finished, [17]);
    assert.equal(harness.updates.length, updateCount);
  } finally { restore(); }
});

const labels = new Proxy({}, { get: (_target, key) => String(key) });
function mediaHarness(app: object, media: object) {
  const harness = hookHarness();
  const { MediaPlayer } = loadSource('MediaPlayer.tsx', harness.react);
  const restoreWindow = globalValue('window', { go: { app: { App: app, MediaService: media } } });
  const restoreStorage = globalValue('localStorage', { getItem: () => null, setItem: () => undefined });
  return {
    harness,
    render: (entry: ImageEntry) => harness.render(() => MediaPlayer({ entry, subtitle: null, labels })),
    start(entry: ImageEntry) {
      this.render(entry);
      return harness.effects.find((effect) => effect.deps?.length === 2 && effect.deps[0] === entry.id && effect.deps[1] === entry.path)!.run() as () => void;
    },
    restore() { restoreWindow(); restoreStorage(); },
  };
}

test('late media preparation IDs cannot replace the new playback operation', async () => {
  const begins = [deferred<number>(), deferred<number>()];
  const prepare = deferred<string>();
  const cancelled: number[] = [], finished: number[] = [], prepared: string[] = [];
  let starts = 0;
  const fixture = mediaHarness({
    BeginOperation: () => begins[starts++].promise,
    CancelOperation: async (id: number) => { cancelled.push(id); },
    FinishOperation: async (id: number) => { finished.push(id); },
  }, {
    PrepareMediaByPath: (path: string) => { prepared.push(path); return prepare.promise; },
    ReleasePlaybackCache: async () => undefined,
  });
  try {
    fixture.start(image('old'))();
    const cleanupNew = fixture.start(image('new'));
    begins[1].resolve(202);
    await flush();
    const updateCount = fixture.harness.updates.length;
    begins[0].resolve(101);
    await flush();
    assert.deepEqual(prepared, ['/new.mp3']);
    assert.deepEqual(cancelled, [101]);
    assert.deepEqual(finished, [101]);
    assert.equal(fixture.harness.updates.length, updateCount);
    cleanupNew();
    assert.deepEqual(cancelled, [101, 202]);
    prepare.resolve('media:new');
    await flush();
    assert.deepEqual(finished, [101, 202]);
  } finally { fixture.restore(); }
});

test('media operation allocation errors become visible playback errors', async () => {
  const fixture = mediaHarness({
    BeginOperation: async () => { throw new Error('bridge disconnected'); },
  }, { ReleasePlaybackCache: async () => undefined });
  try {
    const cleanup = fixture.start(image('broken'));
    await flush();
    assert.ok(fixture.harness.updates.includes('bridge disconnected'));
    cleanup();
  } finally { fixture.restore(); }
});

test('audio fallback ignores stale conversion results and late operation allocations', async () => {
  for (const stage of ['conversion', 'allocation']) {
    const fallback = deferred<string>();
    const lateBegin = deferred<number>();
    const cancelled: number[] = [], finished: number[] = [];
    let begins = 0, conversions = 0;
    const fixture = mediaHarness({
      BeginOperation: async () => {
        const id = ++begins;
        return stage === 'allocation' && id === 2 ? lateBegin.promise : id;
      },
      CancelOperation: async (id: number) => { cancelled.push(id); },
      FinishOperation: async (id: number) => { finished.push(id); },
    }, {
      PrepareMediaByPath: async (path: string) => 'media:' + path,
      PrepareCompatibleMediaByPath: () => { conversions++; return fallback.promise; },
      ReleasePlaybackCache: async () => undefined,
    });
    try {
      const old = image('old'), next = image('new');
      const cleanupOld = fixture.start(old);
      await flush();
      const audio = findElement(fixture.render(old), (node) => node.type === 'audio');
      assert.ok(audio);
      audio.props.onError();
      await flush();
      if (stage === 'conversion') {
        const confirm = findElement(fixture.render(old), (node) => node.props?.className === 'media-conversion-confirm');
        assert.ok(confirm);
        confirm.props.onClick();
        await flush();
        assert.equal(conversions, 1);
      }
      cleanupOld();
      const cleanupNew = fixture.start(next);
      await flush();
      const updateCount = fixture.harness.updates.length;
      if (stage === 'allocation') lateBegin.resolve(2); else fallback.resolve('media:stale-fallback');
      await flush();
      assert.equal(fixture.harness.updates.length, updateCount, stage);
      const nextAudio = findElement(fixture.render(next), (node) => node.type === 'audio');
      assert.equal(nextAudio.props.src, 'media:/new.mp3', stage);
      assert.ok(cancelled.includes(2), stage);
      assert.ok(finished.includes(2), stage);
      if (stage === 'allocation') assert.equal(conversions, 0);
      cleanupNew();
    } finally { fixture.restore(); }
  }
});
