import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { flush, globalValue, hookHarness, loadSource } from './helpers/hookHarness.mts';
import { convertSubtitleToWebVTT } from '../src/mediaSupport.ts';

const labels = new Proxy({}, { get: (_target, key) => String(key) });
const media = (id: string, kind = 'video') => ({ id, path: `/${id}.${kind === 'video' ? 'mp4' : 'mp3'}`, name: id, kind, format: kind === 'video' ? '.mp4' : '.mp3', source: 'file', directoryPath: '/', size: 1 });

function findElement(node: any, predicate: (node: any) => boolean): any {
  if (!node || typeof node !== 'object') return undefined;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
}

function playerFixture(bridge: object = {}, browser: object = {}) {
  const harness = hookHarness();
  const { MediaPlayer } = loadSource('MediaPlayer.tsx', harness.react);
  const restoreWindow = globalValue('window', {
    setTimeout, clearTimeout, ...browser,
    go: { app: { App: { BeginOperation: async () => 1, FinishOperation: async () => {}, CancelOperation: async () => {}, ...bridge }, MediaService: { PrepareMediaByPath: async (path: string) => `media:${path}`, ReleasePlaybackCache: async () => {} } } },
  });
  const restoreStorage = globalValue('localStorage', { getItem: () => null, setItem: () => {} });
  const render = (entry: any, extra: object = {}) => harness.render(() => MediaPlayer({ entry, subtitle: null, labels, ...extra }));
  return {
    harness, render,
    start(entry: any, extra: object = {}) {
      render(entry, extra);
      return harness.effects.find(({ deps }) => deps.length === 2 && deps[0] === entry.id && deps[1] === entry.path)!.run() as () => void;
    },
    restore() { restoreStorage(); restoreWindow(); },
  };
}

async function subtitleFixture(text: string) {
  const fixture = playerFixture({ LoadDocumentByPath: async () => ({ text, format: '.vtt' }) });
  const entry = media('captions');
  const cleanupMedia = fixture.start(entry);
  const cleanupSubtitle = fixture.harness.effects.find(({ deps }) => deps[0] === 'video' && deps[1] === entry.path)!.run() as () => void;
  await flush();
  return {
    ...fixture,
    cuesAt(time: number) {
      const video = findElement(fixture.render(entry), (node) => node.type === 'video');
      video.props.onTimeUpdate({ currentTarget: { currentTime: time } });
      const overlay = findElement(fixture.render(entry), (node) => node.props?.className === 'subtitle-overlay-content');
      return overlay?.props.children.map((node: any) => node.props.children) ?? [];
    },
    restore() { cleanupSubtitle(); cleanupMedia(); fixture.restore(); },
  };
}

test('video subtitles display valid minute-only and long-hour WebVTT timestamps', async () => {
  const fixture = await subtitleFixture('WEBVTT\n\n00:01.000 --> 00:03.000\nshort\n\n100:00:01.000 --> 100:00:03.000\nlong\n');
  try {
    assert.deepEqual(fixture.cuesAt(2), ['short']);
    assert.deepEqual(fixture.cuesAt(360002), ['long']);
  } finally { fixture.restore(); }
});

test('subtitle decoding preserves escaped angle brackets and decodes entities once', async () => {
  const fixture = await subtitleFixture('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Speaker><b>Say &lt;hello&gt;</b> &amp;lt;world&amp;gt; &nbsp;done\n');
  try { assert.deepEqual(fixture.cuesAt(2), ['Say <hello> &lt;world&gt; \u00a0done']); }
  finally { fixture.restore(); }
});

test('subtitle comments and invalid time ranges never become visible cues', async () => {
  const fixture = await subtitleFixture('WEBVTT\n\nNOTE example\n00:00:01.000 --> 00:00:03.000\ncomment\n\n00:99:00.000 --> 02:00:00.000\ninvalid\n\n00:00:03.000 --> 00:00:01.000\nbackward\n\n00:00:01.000 --> 00:00:03.000\nactual\n');
  try {
    assert.deepEqual(fixture.cuesAt(2), ['actual']);
    assert.deepEqual(fixture.cuesAt(6000), []);
  } finally { fixture.restore(); }
});

test('SAMI sync delimiters do not leak into subtitle text or create blank cues', () => {
  const text = '<SAMI><BODY><SYNC Start=1000><P Class=ENCC>First<br>Line<SYNC Start="3000"><P Class=ENCC>&nbsp;</BODY></SAMI>';
  assert.equal(convertSubtitleToWebVTT(text, '.smi'), 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nFirst\nLine\n');
});

test('pause requested while the next audio prepares prevents delayed autoplay', async () => {
  const fixture = playerFixture();
  let cleanup = fixture.start(media('old', 'audio'));
  try {
    await flush();
    const oldAudio = findElement(fixture.render(media('old', 'audio')), (node) => node.type === 'audio');
    oldAudio.ref.current = { paused: false };
    cleanup();
    const next = media('next', 'audio');
    cleanup = fixture.start(next, { pausePlayback: true });
    oldAudio.ref.current = null;
    fixture.harness.effects.find(({ deps }) => deps[0] === true)!.run();
    await flush();
    const audio = findElement(fixture.render(next, { pausePlayback: true }), (node) => node.type === 'audio');
    assert.equal(audio.props.autoPlay, false);
    let played = 0;
    audio.props.onCanPlay({ currentTarget: { play: async () => { played++; } } });
    assert.equal(played, 0);
  } finally { cleanup(); fixture.restore(); }
});

for (const failedStep of ['source', 'connect']) {
  test(`partially initialized audio graphs close their AudioContext after ${failedStep} failure`, async () => {
    let closed = 0;
    const disconnected: string[] = [];
    const node = (name: string) => ({ connect() { if (failedStep === 'connect') throw new Error('device unavailable'); }, disconnect() { disconnected.push(name); } });
    class Context {
      destination = {};
      createMediaElementSource() { if (failedStep === 'source') throw new Error('source unavailable'); return node('source'); }
      createAnalyser() { return node('analyser'); }
      createGain() { return node('gain'); }
      async close() { closed++; }
    }
    const fixture = playerFixture({}, { AudioContext: Context });
    const entry = media('graph', 'audio');
    const cleanup = fixture.start(entry);
    try {
      await flush();
      const tree = fixture.render(entry);
      findElement(tree, (node) => node.type === 'audio').ref.current = {};
      findElement(tree, (node) => node.type === 'canvas').ref.current = {};
      fixture.harness.effects.find(({ deps }) => deps.length === 5 && deps[2] === 'audio')!.run();
      assert.equal(closed, 1);
      if (failedStep === 'connect') assert.deepEqual(disconnected.sort(), ['analyser', 'gain', 'source']);
    } finally { cleanup(); fixture.restore(); }
  });
}

test('large unterminated subtitle tags complete within a bounded process time', () => {
  const moduleURL = new URL('../src/mediaSupport.ts', import.meta.url).href;
  const script = `import { convertSubtitleToWebVTT, decodeSubtitleText } from ${JSON.stringify(moduleURL)};
    const tail = '{'.repeat(300000);
    const text = '[Events]\\nDialogue: 0,0:00:01.20,0:00:03.40,Default,,0,0,0,,' + tail;
    if (!convertSubtitleToWebVTT(text, '.ass')?.includes(tail)) process.exit(2);
    if (!convertSubtitleToWebVTT('{0}{25}' + tail, '.sub')?.includes(tail)) process.exit(3);
    if (convertSubtitleToWebVTT('<SYNC Start=' + '9'.repeat(300000), '.smi') !== null) process.exit(4);
    if (convertSubtitleToWebVTT('<sync '.repeat(50000), '.smi') !== null) process.exit(5);
    if (decodeSubtitleText('<'.repeat(300000)) !== '<'.repeat(300000)) process.exit(6);`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { timeout: 5000, encoding: 'utf8' });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr);
});

test('audio graph reuses its context across visibility changes and releases listeners and frames on disposal', async () => {
  const timers = new Map<number, () => void>(), frames = new Map<number, () => void>();
  const listeners = new Map<string, () => void>();
  let sequence = 0, created = 0, closed = 0, disconnected = 0;
  class Context {
    destination = {}; currentTime = 0;
    constructor() { created++; }
    node() { return { connect() {}, disconnect() { disconnected++; } }; }
    createMediaElementSource() { return this.node(); }
    createAnalyser() { return { ...this.node(), frequencyBinCount: 16384 }; }
    createGain() { return { ...this.node(), gain: { cancelScheduledValues() {}, setValueAtTime() {} } }; }
    async resume() {}
    async close() { closed++; }
  }
  const fixture = playerFixture({}, {
    AudioContext: Context,
    setTimeout(callback: () => void) { const id = ++sequence; timers.set(id, callback); return id; },
    clearTimeout(id: number) { timers.delete(id); },
    requestAnimationFrame(callback: () => void) { const id = ++sequence; frames.set(id, callback); return id; },
    cancelAnimationFrame(id: number) { frames.delete(id); },
  });
  const entry = media('playing', 'audio');
  const cleanupMedia = fixture.start(entry);
  let cleanupGraph: (() => void) | undefined;
  try {
    await flush();
    const tree = fixture.render(entry);
    findElement(tree, (node) => node.type === 'audio').ref.current = {
      paused: false, ended: false, muted: false,
      addEventListener(type: string, listener: () => void) { listeners.set(type, listener); },
      removeEventListener(type: string, listener: () => void) { if (listeners.get(type) === listener) listeners.delete(type); },
    };
    findElement(tree, (node) => node.type === 'canvas').ref.current = { getContext() { return null; } };
    const graphEffect = () => fixture.harness.effects.find(({ deps }) => deps.length === 5 && deps[2] === 'audio')!;
    cleanupGraph = graphEffect().run() as () => void;
    assert.equal(frames.size, 1);
    assert.equal(listeners.size, 4);
    cleanupGraph();
    assert.equal(frames.size, 0);
    assert.equal(listeners.size, 0);
    assert.equal(timers.size, 1);
    fixture.render(entry, { visible: false });
    cleanupGraph = graphEffect().run() as () => void;
    assert.equal(created, 1);
    assert.equal(closed, 0);
    assert.equal(timers.size, 0);
    assert.equal(frames.size, 0);
    cleanupGraph(); cleanupGraph = undefined;
    for (const callback of timers.values()) callback();
    assert.equal(closed, 1);
    assert.equal(disconnected, 3);
    assert.equal(listeners.size, 0);
  } finally { cleanupGraph?.(); cleanupMedia(); fixture.restore(); }
});
