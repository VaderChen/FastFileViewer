import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createLogSpectrumCalculator, findSidecarSubtitle } from '../src/mediaSupport.ts';
import { referenceSpectrum, referenceSidecar } from '../tests/helpers/mediaReference.mts';
import type { ImageEntry } from '../src/types.ts';

// Run with node --expose-gc --max-semi-space-size=256 benchmarks/media-functions.mts
let sink: unknown;
function measure(name: string, iterations: number, run: () => unknown) {
  for (let index = 0; index < 1000; index++) sink = run();
  const samples = [];
  for (let round = 0; round < 5; round++) {
    globalThis.gc?.();
    const start = performance.now();
    for (let index = 0; index < iterations; index++) sink = run();
    const ms = (performance.now() - start) / iterations;
    globalThis.gc?.();
    const before = process.memoryUsage().heapUsed;
    sink = run();
    samples.push({ ms, heapBytes: process.memoryUsage().heapUsed - before });
  }
  samples.sort((a, b) => a.ms - b.ms);
  console.log(JSON.stringify({ name, iterations, ...samples[2] }));
}

const data = Float32Array.from({ length: 16384 }, (_, index) => -90 + (index % 80));
const calculate = createLogSpectrumCalculator(48000, 32768, 72);
assert.deepEqual(calculate(data, false), referenceSpectrum(data, 48000, 32768, 72, false));
measure('spectrum before, 72 bars', 20000, () => referenceSpectrum(data, 48000, 32768, 72, false));
measure('spectrum after, 72 bars', 20000, () => calculate(data, false));

const media: ImageEntry = { id: 'video', name: 'movie.mp4', path: 'fixture/movie.mp4', directoryPath: 'fixture', source: 'file', format: '.mp4', kind: 'video', size: 1 };
for (const matching of [false, true]) {
  const entries: ImageEntry[] = Array.from({ length: 20000 }, (_, index) => ({ ...media, id: String(index), name: `${matching ? 'movie' : 'other'}.${20000 - index}.srt`, kind: 'subtitle', format: '.srt' }));
  assert.equal(findSidecarSubtitle(media, entries), referenceSidecar(media, entries));
  measure(`sidecar before, 20000 ${matching ? 'matching' : 'unmatched'}`, 50, () => referenceSidecar(media, entries));
  measure(`sidecar after, 20000 ${matching ? 'matching' : 'unmatched'}`, 50, () => findSidecarSubtitle(media, entries));
}
void sink;
