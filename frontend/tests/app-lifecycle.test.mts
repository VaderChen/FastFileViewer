import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { flush, globalValue, hookHarness, loadSource } from './helpers/hookHarness.mts';
import type { ImageEntry, LibraryNode } from '../src/types.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function find(tree: any, match: (element: any) => boolean): any {
  if (!tree || typeof tree !== 'object') return undefined;
  if (Array.isArray(tree)) {
    for (const child of tree) { const found = find(child, match); if (found) return found; }
    return undefined;
  }
  return match(tree) ? tree : find(tree.props?.children, match);
}

const entry = (path: string, kind: ImageEntry['kind'] = 'image'): ImageEntry => ({
  id: path, name: path.split('/').pop()!, path, directoryPath: path.slice(0, path.lastIndexOf('/')),
  source: 'file', format: kind === 'pdf' ? '.pdf' : '.png', kind, size: 1,
});
const node = (path: string, images = [entry(path + '/one.png')]): LibraryNode => ({
  id: path, name: path.split('/').pop()!, path, kind: 'directory', scanned: true, images, children: [],
});
const result = (path: string, images?: ImageEntry[]) => ({ rootPath: path, node: node(path, images), warnings: [] });
const cache = (path: string) => JSON.stringify({ rootPath: path, tree: node(path), selectedNodeId: path, selectedImageId: '',
  expandedNodeIds: [path], scannedDirectories: 1, savedAt: Date.now() });

test('directory scans preserve FIFO order and prioritize the pending Finder path', async () => {
  for (const targeted of [false, true]) {
    const calls: string[] = [];
    const children: Record<string, string[]> = {
      '/root': ['/root/b', '/root/a'], '/root/b': ['/root/b/deep'], '/root/a': ['/root/a/deep'],
    };
    const app = appHarness({
      ConsumeOpenFilePaths: async () => targeted ? ['/root/a/deep/file.png'] : [],
      ScanDirectory: async (path: string) => {
        calls.push(path);
        const current = node(path);
        current.children = (children[path] ?? []).map(child => ({ ...node(child), scanned: false }));
        if (path === '/root') current.children.push({ ...node('/root/pack.zip'), kind: 'archive' });
        return { rootPath: path, node: current, warnings: [] };
      },
    });
    try {
      const cleanup = app.effect('consumeOpenFilesTail').run();
      await flush();
      app.scan('/root'); await flush();
      assert.deepEqual(calls, targeted
        ? ['/root', '/root/a', '/root/a/deep', '/root/b', '/root/b/deep']
        : ['/root', '/root/b', '/root/a', '/root/b/deep', '/root/a/deep']);
      assert.equal(app.rootNode()?.children.filter(child => child.scanned).length, 3);
      assert.deepEqual(app.finished, [1]);
      cleanup!();
    } finally { app.dispose(); }
  }
});

test('stopping a directory scan discards the remaining queued paths', async () => {
  const pending = deferred<any>();
  const calls: string[] = [];
  const app = appHarness({ ScanDirectory: async (path: string) => {
    calls.push(path);
    if (path !== '/root') return pending.promise;
    return { rootPath: path, node: { ...node(path), children: [node('/root/a'), node('/root/b')] }, warnings: [] };
  } });
  try {
    app.scan('/root'); await flush();
    app.button('Stop scan').props.onClick();
    pending.resolve(result('/root/a')); await flush();
    assert.deepEqual(calls, ['/root', '/root/a']);
    assert.deepEqual(app.cancelled, [1]);
    assert.deepEqual(app.finished, [1]);
  } finally { app.dispose(); }
});

function appHarness(api: Record<string, any> = {}) {
  const h = hookHarness();
  const cancelled: number[] = [], finished: number[] = [], resetPaths: string[] = [];
  const timers: Array<() => void> = [];
  const storage = new Map<string, string>();
  const events = new Map<string, () => void>();
  let operation = 0;
  const bridge = {
    BeginOperation: async () => ++operation,
    CancelOperation: async (id: number) => { cancelled.push(id); },
    FinishOperation: async (id: number) => { finished.push(id); },
    ResetLibrary: async () => { resetPaths.push('reset'); },
    ScanDirectory: async (path: string) => result(path),
    LoadLibraryCache: async () => '',
    ConsumeOpenFilePaths: async () => [],
    ...api,
  };
  const restores = [
    globalValue('localStorage', { getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) }),
    globalValue('navigator', { language: 'en', languages: ['en'] }),
    globalValue('window', { go: { app: { App: bridge } }, setTimeout: (run: () => void) => { timers.push(run); return timers.length; },
      clearTimeout: () => {}, requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} }),
  ];
  const modules: Record<string, any> = {
    '../wailsjs/runtime/runtime': {
      EventsOn: (name: string, handler: () => void) => { events.set(name, handler); return () => events.delete(name); },
      WindowSetTitle: () => {}, WindowIsFullscreen: async () => false,
    },
    'react-markdown': () => null, 'remark-gfm': () => {}, 'rehype-highlight': () => {},
    '../../assets/appicon.png': 'icon.png',
    './imageTransport': { decodeImageURL: async () => {}, imageURLToDataURI: async (url: string) => url },
  };
  for (const theme of ['github-dark', 'github', 'atom-one-dark', 'nord', 'monokai']) {
    modules['highlight.js/styles/' + theme + '.css?inline'] = '';
  }
  const { default: App } = loadSource('App.tsx', { ...React, ...h.react }, modules);
  const render = () => h.render(() => App());
  const pathInput = () => find(render(), e => e.type === 'input' && e.props.placeholder === 'Choose or enter a content folder');
  const scan = (path: string) => {
    pathInput().props.onChange({ target: { value: path } });
    pathInput().props.onKeyDown({ key: 'Enter' });
  };
  const button = (title: string) => find(render(), e => e.type === 'button' && e.props.title === title);
  const effect = (fragment: string) => {
    render();
    const selected = h.effects.find(e => e.run.toString().includes(fragment));
    assert.ok(selected, 'missing effect: ' + fragment);
    return selected;
  };
  const rootNode = () => find(render(), e => e.props?.node && e.props.depth === 0)?.props.node as LibraryNode | undefined;
  const select = (image: ImageEntry) => {
    const tree = find(render(), e => e.props?.node && e.props.depth === 0);
    assert.ok(tree);
    tree.props.onSelectImage(tree.props.node, image, { metaKey: false, ctrlKey: false, shiftKey: false });
  };
  return { h, bridge, render, scan, button, effect, rootNode, select, pathInput, cancelled, finished, resetPaths, timers, storage, events,
    dispose: () => restores.reverse().forEach(restore => restore()) };
}

test('stopping during cache loading never restores a cached tree or starts a backend scan', async () => {
  const pending = deferred<string>();
  let scans = 0;
  const app = appHarness({ LoadLibraryCache: () => pending.promise, ScanDirectory: async () => { scans++; return result('/old'); } });
  try {
    app.scan('/old');
    app.button('Stop scan').props.onClick();
    pending.resolve(cache('/old'));
    await flush();
    assert.equal(scans, 0);
    assert.equal(app.resetPaths.length, 0);
    assert.equal(app.rootNode(), undefined);
  } finally { app.dispose(); }
});

test('stopped scans cancel and finish a late operation ID before ResetLibrary', async () => {
  const begin = deferred<number>();
  const app = appHarness({ BeginOperation: () => begin.promise });
  try {
    app.scan('/old');
    await flush();
    app.button('Stop scan').props.onClick();
    begin.resolve(71);
    await flush();
    assert.deepEqual(app.cancelled, [71]);
    assert.deepEqual(app.finished, [71]);
    assert.equal(app.resetPaths.length, 0);
  } finally { app.dispose(); }
});

test('a superseded scan failure cannot clear the newer library', async () => {
  const old = deferred<any>();
  const app = appHarness({ ScanDirectory: (path: string) => path === '/old' ? old.promise : Promise.resolve(result(path)) });
  try {
    app.scan('/old');
    await flush();
    app.scan('/new');
    await flush();
    assert.equal(app.rootNode()?.path, '/new');
    old.reject(new Error('old disk disconnected'));
    await flush();
    assert.equal(app.rootNode()?.path, '/new');
    assert.deepEqual(app.cancelled, [1]);
    assert.deepEqual([...app.finished].sort(), [1, 2]);
  } finally { app.dispose(); }
});

test('a new scan waits for an earlier library reset and prevents old scanning from starting', async () => {
  const resetting = deferred<void>();
  let resets = 0;
  const scanned: string[] = [];
  const app = appHarness({
    ResetLibrary: () => ++resets === 1 ? resetting.promise : Promise.resolve(),
    ScanDirectory: async (path: string) => { scanned.push(path); return result(path); },
  });
  try {
    app.scan('/old'); await flush();
    app.scan('/new'); await flush();
    assert.equal(resets, 1);
    assert.deepEqual(scanned, []);
    resetting.resolve(); await flush();
    assert.equal(resets, 2);
    assert.deepEqual(scanned, ['/new']);
    assert.equal(app.rootNode()?.path, '/new');
  } finally { app.dispose(); }
});

test('PDF switching cancels both a pending BeginOperation and active preparation', async () => {
  for (const pendingBegin of [true, false]) {
    const begin = deferred<number>(), prepared = deferred<string>();
    let preparations = 0;
    const app = appHarness();
    try {
      const pdf = entry('/docs/one.pdf', 'pdf');
      app.bridge.ScanDirectory = async () => result('/docs', [pdf]);
      app.scan('/docs'); await flush(); app.select(pdf);
      app.bridge.BeginOperation = () => pendingBegin ? begin.promise : Promise.resolve(80);
      app.bridge.PrepareDocumentByPath = () => { preparations++; return prepared.promise; };
      const cleanup = app.effect('PrepareDocumentByPath').run();
      await flush();
      assert.equal(preparations, pendingBegin ? 0 : 1);
      assert.equal(typeof cleanup, 'function');
      cleanup!();
      begin.resolve(80); prepared.resolve('http://media/old.pdf');
      await flush();
      assert.ok(app.cancelled.includes(80));
      assert.ok(app.finished.includes(80));
      assert.equal(preparations, pendingBegin ? 0 : 1);
      assert.equal(find(app.render(), e => e.type === 'iframe' && e.props.src === 'http://media/old.pdf'), undefined);
    } finally { app.dispose(); }
  }
});

test('checksum reserves once before BeginOperation and ignores late results after selection changes', async () => {
  const app = appHarness();
  try {
    const images = [entry('/docs/one.png'), entry('/docs/two.png')];
    app.bridge.ScanDirectory = async () => result('/docs', images);
    app.scan('/docs'); await flush(); app.select(images[0]);
    const cleanup = app.effect('setActiveChecksum').run();
    const pending = deferred<string>();
    let calculations = 0, begins = 0;
    app.bridge.BeginOperation = async () => { begins++; return 90; };
    app.bridge.CalculateChecksum = () => { calculations++; return pending.promise; };
    const button = app.button('Calculate SHA-256');
    button.props.onClick(); button.props.onClick();
    await flush();
    assert.equal(begins, 1);
    assert.equal(calculations, 1);
    cleanup!(); app.select(images[1]); app.effect('setActiveChecksum').run();
    pending.resolve('stale-checksum-should-not-appear'); await flush();
    assert.ok(app.cancelled.includes(90));
    assert.ok(app.finished.includes(90));
    assert.equal(find(app.render(), e => e.type === 'button' && String(e.props.children).includes('stale-checksum')), undefined);
  } finally { app.dispose(); }
});

test('a checksum cancelled before its ID arrives never starts hashing', async () => {
  const app = appHarness();
  try {
    app.scan('/docs'); await flush(); app.select(entry('/docs/one.png'));
    const cleanup = app.effect('setActiveChecksum').run();
    const begin = deferred<number>();
    let calculations = 0;
    app.bridge.BeginOperation = () => begin.promise;
    app.bridge.CalculateChecksum = async () => { calculations++; return 'hash'; };
    app.button('Calculate SHA-256').props.onClick();
    cleanup!();
    begin.resolve(91); await flush();
    assert.equal(calculations, 0);
    assert.ok(app.cancelled.includes(91));
    assert.ok(app.finished.includes(91));
  } finally { app.dispose(); }
});

test('typing a different root cannot save the old library under the new path', async () => {
  let saves = 0;
  const app = appHarness({ SaveLibraryCache: async () => { saves++; } });
  try {
    app.scan('/old'); await flush();
    app.pathInput().props.onChange({ target: { value: '/new' } });
    app.effect('writeLibraryCache').run();
    app.effect('writeLibrarySelection').run();
    for (const timer of app.timers) timer();
    await flush();
    assert.equal(saves, 0);
    assert.equal(app.storage.size, 0);
  } finally { app.dispose(); }
});

test('serialized Finder consumption preserves a delayed file when the next event has no paths', async () => {
  const first = deferred<string[]>();
  let consumes = 0;
  const app = appHarness({ ConsumeOpenFilePaths: () => ++consumes === 1 ? first.promise : Promise.resolve([]) });
  try {
    const cleanup = app.effect('consumeOpenFilesTail').run();
    await flush();
    app.events.get('fastfileviewer:file-open')!();
    await flush();
    assert.equal(consumes, 1);
    first.resolve(['/docs/one.pdf']); await flush();
    assert.equal(consumes, 2);
    app.bridge.OpenFileByPath = async () => entry('/docs/one.pdf', 'pdf');
    app.effect('isCurrentRequest').run(); await flush();
    assert.equal(app.rootNode()?.images[0].path, '/docs/one.pdf');
    cleanup!();
  } finally { app.dispose(); }
});

test('Finder direct-open discards an older response and its delayed background scan', async () => {
  const old = deferred<ImageEntry>();
  let paths = ['/old/one.pdf'];
  const app = appHarness({ ConsumeOpenFilePaths: async () => paths,
    OpenFileByPath: (path: string) => path.startsWith('/old') ? old.promise : Promise.resolve(entry(path, 'pdf')) });
  try {
    const cleanup = app.effect('consumeOpenFilesTail').run(); await flush();
    app.effect('isCurrentRequest').run(); await flush();
    paths = ['/new/two.pdf'];
    app.events.get('fastfileviewer:file-open')!(); await flush();
    app.effect('isCurrentRequest').run(); await flush();
    old.resolve(entry('/old/one.pdf', 'pdf')); await flush();
    assert.equal(app.rootNode()?.images[0].path, '/new/two.pdf');
    app.scan('/chosen'); await flush();
    for (const timer of app.timers) timer();
    await flush();
    assert.equal(app.rootNode()?.path, '/chosen');
    cleanup!();
  } finally { app.dispose(); }
});

test('Finder opening into an existing library survives the intermediate root-path render', async () => {
  for (const destination of ['/other/new.pdf', '/existing/new.pdf']) {
    const opened = deferred<ImageEntry>();
    const app = appHarness({ ConsumeOpenFilePaths: async () => [destination], OpenFileByPath: () => opened.promise });
    try {
      app.scan('/existing'); await flush();
      const cleanup = app.effect('consumeOpenFilesTail').run(); await flush();
      app.effect('isCurrentRequest').run(); await flush();
      // React renders immediately after setRootPath, while tree is still the old library.
      app.effect('isCurrentRequest').run(); await flush();
      opened.resolve(entry(destination, 'pdf')); await flush();
      assert.equal(app.rootNode()?.images[0].path, destination);
      cleanup!();
    } finally { app.dispose(); }
  }
});

test('late startup cache cannot replace a library selected during bootstrap', async () => {
  const pending = deferred<string>();
  const app = appHarness({
    Bootstrap: async () => ({ defaultPath: '/old', supportedImages: ['.png'], supportedDocuments: ['.pdf'],
      supportedMedia: ['.mp4'], supportedPacks: ['.zip'] }),
    LoadLibraryCache: (path: string) => path === '/old' ? pending.promise : Promise.resolve(''),
  });
  try {
    app.storage.set('fastfileviewer.rootPath', '/old');
    const cleanup = app.effect('consumeOpenFilesTail').run(); await flush();
    app.scan('/new'); await flush();
    pending.resolve(cache('/old')); await flush();
    assert.equal(app.rootNode()?.path, '/new');
    cleanup!();
  } finally { app.dispose(); }
});

test('unmount prevents a pending scan ID from starting more work', async () => {
  const begin = deferred<number>();
  const app = appHarness({ BeginOperation: () => begin.promise });
  try {
    const cleanup = app.effect('consumeOpenFilesTail').run(); await flush();
    app.scan('/old'); await flush();
    cleanup!();
    begin.resolve(72); await flush();
    assert.equal(app.resetPaths.length, 0);
    assert.deepEqual(app.cancelled, [72]);
    assert.deepEqual(app.finished, [72]);
    assert.equal(app.rootNode(), undefined);
  } finally { app.dispose(); }
});

test('a manual scan supersedes an in-flight Finder request without restarting it on the next render', async () => {
  const opened = deferred<ImageEntry>();
  let calls = 0;
  const app = appHarness({
    ConsumeOpenFilePaths: async () => ['/finder/one.pdf'],
    OpenFileByPath: () => { calls++; return opened.promise; },
  });
  try {
    const cleanup = app.effect('consumeOpenFilesTail').run(); await flush();
    app.effect('isCurrentRequest').run(); await flush();
    app.scan('/chosen'); await flush();
    opened.resolve(entry('/finder/one.pdf', 'pdf')); await flush();
    app.effect('isCurrentRequest').run(); await flush();
    assert.equal(calls, 1);
    assert.equal(app.rootNode()?.path, '/chosen');
    cleanup!();
  } finally { app.dispose(); }
});

test('a delayed startup file request cannot override a manually selected library', async () => {
  const consumed = deferred<string[]>();
  const app = appHarness({ ConsumeOpenFilePaths: () => consumed.promise });
  try {
    const cleanup = app.effect('consumeOpenFilesTail').run(); await flush();
    app.scan('/chosen'); await flush();
    consumed.resolve(['/startup/one.pdf']); await flush();
    app.effect('isCurrentRequest').run(); await flush();
    assert.equal(app.rootNode()?.path, '/chosen');
    assert.equal(app.pathInput().props.value, '/chosen');
    cleanup!();
  } finally { app.dispose(); }
});

test('image prefetch handles rejected allocation and cancellation cleanup without unhandled rejections', async () => {
  for (const lateID of [false, true]) {
    const app = appHarness();
    try {
      const images = [entry('/images/one.png'), entry('/images/two.png')];
      app.bridge.ScanDirectory = async () => result('/images', images);
      const loaded: string[] = [];
      app.bridge.LoadImageByPathWithOperation = async (path: string) => {
        loaded.push(path);
        return { id: path, name: path, mime: 'image/png', dataUri: 'data:image/png,ok', source: 'file', location: path };
      };
      app.scan('/images'); await flush(); app.select(images[0]);
      app.effect('PrepareDocumentByPath').run(); await flush();
      const begin = deferred<number>();
      app.bridge.BeginOperation = () => lateID ? begin.promise : Promise.reject(new Error('bridge closed'));
      app.bridge.CancelOperation = async (id: number) => { app.cancelled.push(id); throw new Error('closing'); };
      app.bridge.FinishOperation = async (id: number) => { app.finished.push(id); throw new Error('closing'); };
      const cleanup = app.effect('prefetchImagePayload').run();
      assert.equal(typeof cleanup, 'function');
      cleanup!(); begin.resolve(95); await flush();
      assert.deepEqual(loaded, [images[0].path]);
      if (lateID) {
        assert.ok(app.cancelled.includes(95));
        assert.ok(app.finished.includes(95));
      }
    } finally { app.dispose(); }
  }
});

test('malformed nested library caches fall back to the existing scan flow', async () => {
  for (const broken of [
    { ...node('/library'), images: null },
    { ...node('/library'), children: [null] },
    { ...node('/library'), images: [{ ...entry('/library/file.png'), name: 42 }] },
  ]) {
    let scans = 0;
    const payload = JSON.stringify({ ...JSON.parse(cache('/library')), tree: broken });
    const app = appHarness({ LoadLibraryCache: async () => payload, ScanDirectory: async () => { scans++; return result('/library'); } });
    try {
      app.scan('/library');
      for (let index = 0; index < 5; index++) await flush();
      assert.equal(scans, 1);
      assert.equal(app.rootNode()?.images[0]?.name, 'one.png');
    } finally { app.dispose(); }
  }
});

test('invalid cached selection metadata cannot reach render state', async () => {
  let scans = 0;
  const payload = JSON.stringify({ ...JSON.parse(cache('/library')), scannedDirectories: { invalid: true } });
  const app = appHarness({ LoadLibraryCache: async () => payload, ScanDirectory: async () => { scans++; return result('/library'); } });
  try {
    app.scan('/library');
    for (let index = 0; index < 5; index++) await flush();
    assert.equal(scans, 1);
    assert.ok(app.h.updates.every((value) => value?.invalid !== true));
    assert.equal(app.rootNode()?.path, '/library');
  } finally { app.dispose(); }
});
