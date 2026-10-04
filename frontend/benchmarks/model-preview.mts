import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { fetchModelData } from '../src/modelResources.ts';
import { referenceFetchModelData, referenceModelBounds } from '../tests/helpers/modelReference.mts';
import { globalValue, loadSource } from '../tests/helpers/hookHarness.mts';

// node --expose-gc benchmarks/model-preview.mts
// Synthetic local streams isolate input buffering; they do not measure total
// WebKit/GPU memory or include geometry parsing and texture decoding.
async function streamCase(name: string, read: typeof fetchModelData) {
  globalThis.gc?.();
  const baseline = process.memoryUsage().arrayBuffers;
  let emitted = 0;
  const chunkSize = 64 * 1024;
  const bytes = 64 * 1024 * 1024;
  const restore = globalValue('fetch', async () => new Response(new ReadableStream({
    pull(controller) {
      if (emitted === bytes) { controller.close(); return; }
      // Periodic GC represents collection opportunities during a longer read.
      if (emitted % (4 * 1024 * 1024) === 0) globalThis.gc?.();
      const chunk = new Uint8Array(chunkSize);
      chunk.fill((emitted / chunkSize) % 251);
      emitted += chunkSize;
      controller.enqueue(chunk);
    },
  }), { headers: { 'content-length': String(bytes) } }));
  let callbacks = 0;
  try {
    const data = await read('http://localhost/model/fixture/model.glb', new AbortController().signal, () => callbacks++);
    const inputBufferMiB = (process.memoryUsage().arrayBuffers - baseline) / 1024 / 1024;
    const contents = new Uint8Array(data);
    assert.equal(contents.length, bytes);
    for (let offset = 0; offset < bytes; offset += chunkSize) {
      assert.equal(contents[offset], (offset / chunkSize) % 251);
      assert.equal(contents[offset + chunkSize - 1], (offset / chunkSize) % 251);
    }
    console.log(JSON.stringify({ name, inputBufferMiB, progressCallbacks: callbacks }));
  } finally { restore(); }
}

await streamCase('64 MiB stream before', referenceFetchModelData);
await streamCase('64 MiB stream after', fetchModelData);

const { modelBounds } = loadSource('modelViewer.ts', undefined, { three: THREE });
const root = new THREE.Group();
const geometry = new THREE.BoxGeometry();
const material = new THREE.MeshStandardMaterial();
for (let index = 0; index < 5000; index++) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(index % 100, Math.floor(index / 100), index % 7);
  root.add(mesh);
}
assert.deepEqual(modelBounds(root), referenceModelBounds(root));
for (const [name, inspect] of [['shared 5000 meshes before', referenceModelBounds], ['shared 5000 meshes after', modelBounds]] as const) {
  for (let index = 0; index < 10; index++) inspect(root);
  const samples: number[] = [];
  for (let round = 0; round < 5; round++) {
    globalThis.gc?.();
    const start = performance.now();
    for (let index = 0; index < 30; index++) inspect(root);
    samples.push((performance.now() - start) / 30);
  }
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({ name, medianMilliseconds: samples[2] }));
}
