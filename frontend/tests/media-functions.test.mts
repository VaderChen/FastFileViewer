import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateLogSpectrumAmplitudes, createLogSpectrumCalculator, findSidecarSubtitle } from '../src/mediaSupport.ts';
import { referenceSpectrum, referenceSidecar } from './helpers/mediaReference.mts';
import type { ImageEntry } from '../src/types.ts';

test('spectrum workspace preserves every bar across sample rates, FFT sizes, silence and malformed bins', () => {
  for (const sampleRate of [8000, 44100, 48000, 96000, 0, Number.NaN]) {
    for (const fftSize of [32, 2048, 32768]) {
      for (const bars of [-1, 0, 1, 2, 72, 72.5]) {
        const calculate = createLogSpectrumCalculator(sampleRate, fftSize, bars);
        for (const count of [0, 1, 2, fftSize / 2]) {
          const data = Float32Array.from({ length: count }, (_, index) => [-Infinity, -90, -20, -70, NaN, Infinity, 10][index % 7]);
          const unchanged = data.slice();
          for (const idle of [true, false, true, false]) {
            const expected = referenceSpectrum(data, sampleRate, fftSize, bars, idle);
            assert.deepEqual(calculate(data, idle), expected);
            assert.deepEqual(calculateLogSpectrumAmplitudes(data, sampleRate, fftSize, bars, idle), expected);
          }
          assert.deepEqual(data, unchanged);
        }
      }
    }
  }
});

test('spectrum workspaces stay local to each player and only reuse their own output', () => {
  const first = createLogSpectrumCalculator(48000, 32768, 72);
  const second = createLogSpectrumCalculator(44100, 2048, 72);
  const data = new Float32Array(16384).fill(-30);
  const output = first(data, false);
  const previous = output.slice();
  const other = second(data, true);
  assert.notEqual(other, output);
  assert.deepEqual(output, previous);
  assert.equal(first(data, true), output);
  assert.notDeepEqual(output, previous);
  assert.notEqual(calculateLogSpectrumAmplitudes(data, 48000, 32768, 72, false), output);
});

const entry = (name: string, extra: Partial<ImageEntry> = {}): ImageEntry => ({
  id: name, name, path: `fixture/${name}`, directoryPath: 'fixture', source: 'file', format: name.slice(name.lastIndexOf('.')), kind: 'subtitle', size: 1, ...extra,
});

test('sidecar selection keeps format ranking, exact-match preference and stable ties', () => {
  const media = entry('Movie.mp4', { kind: 'video' });
  const candidates = [entry('Movie.zh.vtt'), entry('Movie.srt'), entry('MOVIE.srt'), entry('Movie.custom'), entry('Movie.vtt')];
  for (let index = 0; index < candidates.length; index++) {
    const items = candidates.slice(index);
    assert.equal(findSidecarSubtitle(media, items), referenceSidecar(media, items));
  }
  const first = entry('Movie.srt', { id: 'first' });
  const second = entry('Movie.srt', { id: 'second' });
  assert.equal(findSidecarSubtitle(media, [first, second]), first);
  assert.equal(findSidecarSubtitle(media, [second, first]), second);
});

test('sidecar lookup matches the old stable sort across sources, Unicode names and shuffled libraries', () => {
  let seed = 42;
  const random = (limit: number) => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) % limit);
  const stems = ['Movie', 'movie', 'MOVIE', '日本語', '音樂', '', 'a.b', '.hidden', 'é', 'e\u0301'];
  const suffixes = ['', '.zh', '-en', '_ja', 'other', '.2', '.10'];
  const formats = ['.srt', '.vtt', '.ass', '.ssa', '.smi', '.sub', '.SRT', '.unknown'];
  const candidates = Array.from({ length: 2000 }, (_, index) => entry(stems[random(stems.length)] + suffixes[random(suffixes.length)] + formats[random(formats.length)], {
    id: String(index), source: index % 3 ? 'file' : 'archive', directoryPath: index % 5 ? 'fixture' : 'other', archivePath: index % 7 ? 'a.zip' : 'b.zip', kind: index % 11 ? 'subtitle' : 'audio',
  }));
  const original = [...candidates];
  for (const stem of stems) {
    for (const source of ['file', 'archive'] as const) {
      for (const archivePath of ['a.zip', 'b.zip']) {
        const media = entry(`${stem}.mp4`, { kind: 'video', source, archivePath });
        assert.equal(findSidecarSubtitle(media, candidates), referenceSidecar(media, candidates));
        const reversed = [...candidates].reverse();
        assert.equal(findSidecarSubtitle(media, reversed), referenceSidecar(media, reversed));
      }
    }
  }
  assert.deepEqual(candidates, original);
  assert.equal(findSidecarSubtitle(entry('Movie.mp3', { kind: 'audio' }), candidates), null);
});
