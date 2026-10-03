import assert from 'node:assert/strict';
import test from 'node:test';
import { flush, globalValue, hookHarness, loadSource } from './helpers/hookHarness.mts';
import { referenceDrawAudioVisualization } from './helpers/visualizerReference.mts';

function findElement(node: any, type: string): any {
  if (!node || typeof node !== 'object') return undefined;
  if (node.type === type) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const found = findElement(child, type);
    if (found) return found;
  }
}

function recordingCanvas() {
  const commands: unknown[] = [];
  let gradientId = 0;
  const context = new Proxy({
    createLinearGradient(...coordinates: number[]) {
      const id = ++gradientId;
      commands.push(['gradient', id, ...coordinates]);
      return { id, addColorStop(...stop: unknown[]) { commands.push(['stop', id, ...stop]); } };
    },
  }, {
    get(target: any, name) { return name in target ? target[name] : (...args: unknown[]) => commands.push([name, ...args]); },
    set(_target, name, value) { commands.push(['set', name, typeof value === 'object' ? value.id : value]); return true; },
  });
  return { commands, canvas: { clientWidth: 640, clientHeight: 240, width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement };
}

for (const mode of ['spectrum', 'waveform', 'both'] as const) {
  test(`player ${mode} preserves canvas drawing while reading only the required analyser data`, async () => {
    const harness = hookHarness();
    const { MediaPlayer } = loadSource('MediaPlayer.tsx', harness.react);
    const frames = new Map<number, () => void>();
    const timers: (() => void)[] = [];
    let sequence = 0, frequencyReads = 0, waveformReads = 0, closed = 0;
    const listeners = new Map<string, () => void>();
    const audio = { paused: false, ended: false, muted: false, addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) };
    const node = () => ({ connect() {}, disconnect() {} });
    let analyser: any;
    class AudioContextFixture {
      sampleRate = 48000;
      currentTime = 0;
      destination = {};
      createMediaElementSource() { return node(); }
      createAnalyser() {
        analyser = { ...node(), context: this, fftSize: 2048,
          get frequencyBinCount() { return this.fftSize / 2; },
          getFloatFrequencyData(data: Float32Array) { frequencyReads++; for (let i = 0; i < data.length; i++) data[i] = -90 + (i % 80); },
          getByteTimeDomainData(data: Uint8Array) { waveformReads++; for (let i = 0; i < data.length; i++) data[i] = i % 256; },
        };
        return analyser;
      }
      createGain() { return { ...node(), gain: { cancelScheduledValues() {}, setValueAtTime() {} } }; }
      async resume() {}
      async close() { closed++; }
    }
    const restoreWindow = globalValue('window', {
      devicePixelRatio: 1.5, AudioContext: AudioContextFixture,
      setTimeout: (fn: () => void) => timers.push(fn), clearTimeout() {},
      requestAnimationFrame: (fn: () => void) => { frames.set(++sequence, fn); return sequence; },
      cancelAnimationFrame: (id: number) => frames.delete(id),
      go: { app: { App: { BeginOperation: async () => 1, FinishOperation: async () => {}, CancelOperation: async () => {} }, MediaService: { PrepareMediaByPath: async () => 'media:fixture', ReleasePlaybackCache: async () => {} } } },
    });
    const restoreStorage = globalValue('localStorage', { getItem: (key: string) => key.endsWith('audioVisualizationMode') ? mode : key.endsWith('audioVisualizerColors') ? 'true' : null, setItem() {} });
    const restorePerformance = globalValue('performance', { now: () => 1234 });
    const entry = { id: 'fixture', path: 'fixture.mp3', kind: 'audio', format: '.mp3', name: 'fixture.mp3' };
    const render = () => harness.render(() => MediaPlayer({ entry, subtitle: null, labels: new Proxy({}, { get: (_, key) => String(key) }) }));
    let cleanupMedia: (() => void) | undefined, cleanupGraph: (() => void) | undefined;
    try {
      render();
      cleanupMedia = harness.effects.find(({ deps }) => deps.length === 2 && deps[0] === entry.id && deps[1] === entry.path)!.run() as () => void;
      await flush();
      const tree = render();
      const actual = recordingCanvas(), expected = recordingCanvas();
      findElement(tree, 'audio').ref.current = audio;
      findElement(tree, 'canvas').ref.current = actual.canvas;
      cleanupGraph = harness.effects.find(({ deps }) => deps.length === 5 && deps[2] === 'audio')!.run() as () => void;
      const frequency = new Float32Array(analyser.frequencyBinCount), waveform = new Uint8Array(analyser.fftSize);
      for (const idle of [false, false, true]) {
        actual.commands.length = expected.commands.length = 0;
        frequencyReads = waveformReads = 0;
        audio.paused = idle;
        if (idle) listeners.get('pause')!();
        else {
          const [id, draw] = frames.entries().next().value!;
          frames.delete(id);
          draw();
        }
        assert.equal(frequencyReads, !idle && mode !== 'waveform' ? 1 : 0);
        assert.equal(waveformReads, !idle && mode !== 'spectrum' ? 1 : 0);
        referenceDrawAudioVisualization(expected.canvas, analyser, frequency, waveform, idle, mode, true);
        assert.deepEqual(actual.commands, expected.commands);
        assert.equal(actual.canvas.width, expected.canvas.width);
        assert.equal(actual.canvas.height, expected.canvas.height);
      }
      cleanupGraph(); cleanupGraph = undefined;
      assert.equal(frames.size, 0);
      assert.equal(listeners.size, 0);
      timers.forEach(fn => fn());
      assert.equal(closed, 1);
    } finally {
      cleanupGraph?.(); cleanupMedia?.();
      restorePerformance(); restoreStorage(); restoreWindow();
    }
  });
}
