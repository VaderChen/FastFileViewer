import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import hljs from 'highlight.js/lib/common';
import { reconcileVisibleSelection } from '../src/libraryView.ts';
import { hookHarness } from '../tests/helpers/hookHarness.mts';
import { loadCodeHighlight } from '../tests/helpers/codeHighlight.mts';
import type { ImageEntry } from '../src/types.ts';

let sink: unknown;
function measure(name: string, run: () => unknown, iterations: number) {
  for (let i = 0; i < 5; i++) sink = run();
  const samples = [];
  for (let round = 0; round < 5; round++) {
    globalThis.gc?.();
    const start = performance.now();
    for (let i = 0; i < iterations; i++) sink = run();
    const ms = (performance.now() - start) / iterations;
    globalThis.gc?.();
    const before = process.memoryUsage().heapUsed;
    sink = run();
    samples.push({ ms, heapBytes: process.memoryUsage().heapUsed - before });
  }
  samples.sort((a, b) => a.ms - b.ms);
  console.log(JSON.stringify({ name, ...samples[2] }));
}

const entries = Array.from({ length: 50000 }, (_, index) => ({ id: String(index) }) as ImageEntry);
for (const ids of [[], ['25000']]) {
  const selected = new Set(ids);
  const before = () => {
    const visible = new Set(entries.map(entry => entry.id));
    const next = new Set([...selected].filter(id => visible.has(id)));
    return next.size ? next : new Set([entries[0].id]);
  };
  const after = () => reconcileVisibleSelection(entries, selected);
  assert.deepEqual([...after()], [...before()]);
  measure(`selection before, ${ids.length} of 50000`, before, 100);
  measure(`selection after, ${ids.length} of 50000`, after, 100);
}

const code = 'const item = { name: "example", count: 100 };\n'.repeat(1000);
const props = { code, language: 'javascript', truncatedLabel: 'limit' };
const before = loadCodeHighlight((calculate: () => unknown) => calculate(), hljs);
const harness = hookHarness();
const after = loadCodeHighlight(harness.react.useMemo, hljs);
measure('highlight before, unchanged 1000-line document rerender', () => before(props), 20);
measure('highlight after, unchanged 1000-line document rerender', () => harness.render(() => after(props)), 20);
void sink;
