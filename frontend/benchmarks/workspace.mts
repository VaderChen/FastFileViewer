// Run with: node --expose-gc --max-semi-space-size=256 benchmarks/workspace.mts
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { filterWorkspaceEntries } from '../src/workspaceFilters.ts';
import { globalValue, hookHarness, loadSource } from '../tests/helpers/hookHarness.mts';
import type { ImageEntry } from '../src/types.ts';

const entries: ImageEntry[] = Array.from({ length: 50000 }, (_, index) => ({
  id: String(index), name: `圖片-${index}.png`, path: `/fixture/圖庫/圖片-${index}.png`,
  directoryPath: '/fixture/圖庫', source: index % 3 ? 'file' : 'archive',
  kind: 'image', format: '.png', size: index,
}));
const selectedEntries = entries.slice(0, 10000);
const removedIds = selectedEntries.slice(0, 5000).map((entry) => entry.id);
const harness = hookHarness();
const { useWorkspace } = loadSource('useWorkspace.ts', harness.react);
let libraryImages = entries;
const labels = { operationFailed: 'Failed' };
const render = () => harness.render(() => useWorkspace({ libraryImages, labels }));
const restore = globalValue('window', { go: { app: {
  App: { BeginOperation: async () => 1, FinishOperation: async () => undefined },
  FileService: { ConfirmTrashEntries: async () => ({ removedIds, failed: [] }) },
} } });
const cases = [
  { name: 'filter all 50000', prepare: () => undefined, run: () => {
    assert.equal(filterWorkspaceEntries(entries, '', 'all', 'all').length, entries.length);
  } },
  { name: 'search 50000 without matches', prepare: () => undefined, run: () => {
    assert.equal(filterWorkspaceEntries(entries, 'missing', 'all', 'all').length, 0);
  } },
  { name: 'reconcile empty selection 50000', prepare: () => {
    libraryImages = entries; render().clearSelection(); render();
  }, run: () => {
    harness.effects.find((effect) => effect.deps.length === 1 && effect.deps[0] === libraryImages)!.run();
  } },
  { name: 'select all 50000', prepare: () => {
    libraryImages = entries; render().clearSelection(); render();
  }, run: () => render().selectAllFiltered() },
  { name: 'remove 5000 of 10000 selected', prepare: () => {
    libraryImages = selectedEntries; render().clearSelection(); render().selectAllFiltered(); render();
  }, run: async () => {
    await render().trashSelected();
  } },
];
const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
assert.ok(gc, 'Use --expose-gc');
const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
try {
  for (const operation of cases) {
    const times: number[] = [], heap: number[] = [];
    for (let index = 0; index < 12; index++) {
      operation.prepare();
      harness.updates.length = 0;
      gc();
      const before = process.memoryUsage().heapUsed;
      const start = performance.now();
      await operation.run();
      const elapsed = performance.now() - start;
      const bytes = process.memoryUsage().heapUsed - before;
      if (operation.name.startsWith('remove')) assert.equal(render().selectedIds.size, 5000);
      if (index >= 3) { times.push(elapsed); heap.push(bytes); }
    }
    console.log(JSON.stringify({ operation: operation.name, medianMs: median(times), medianHeapGrowthBytes: median(heap) }));
  }
} finally { restore(); }
