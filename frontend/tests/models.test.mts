import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { fetchModelData, maxModelBytes, ModelError, resolveModelResource, validate3MF, validateGLTF, validatePLY } from '../src/modelResources.ts';
import { isLibraryTree } from '../src/libraryTree.ts';
import { filterWorkspaceEntries } from '../src/workspaceFilters.ts';
import { libraryCounts } from '../src/libraryView.ts';
import type { ImageEntry, LibraryNode } from '../src/types.ts';
import { loadSource, globalValue } from './helpers/hookHarness.mts';
import { modelFixtures } from './helpers/modelFixtures.mts';
import { MeshoptEncoder } from 'meshoptimizer';

const source = (file: string) => loadSource(file, undefined, { three: THREE });
const base = 'http://localhost/model/selected/';
const fixtures = modelFixtures();
const arrayBuffer = (data: Uint8Array) => data.slice().buffer;

test('model resource URLs preserve Unicode/spaces and reject scope escapes', () => {
  for (const name of ['mesh.bin', 'textures/圖片 #1.png', 'materials/cube.mtl']) {
    const encoded = name.split('/').map(encodeURIComponent).join('/');
    assert.equal(resolveModelResource(encoded, base), base + encoded);
  }
  for (const name of ['../outside.bin', 'https://example.com/image.png', '/image/other', '/model/other/model.glb', '%2e%2e/outside.bin', '%2foutside.bin', 'file:///private/image.png', 'textures\\image.png', '.hidden.png', 'secret.txt', 'data:image/svg+xml;base64,AA==', 'blob:https://example.com/image']) {
    assert.throws(() => resolveModelResource(name, base), ModelError, name);
  }
  assert.equal(resolveModelResource('data:image/png;base64,AA==', base), 'data:image/png;base64,AA==');
  assert.equal(resolveModelResource('mesh.bin', 'wails://wails/model/selected/'), 'wails://wails/model/selected/mesh.bin');
  assert.throws(() => resolveModelResource('file:///model/selected/mesh.bin', 'wails://wails/model/selected/'), /resource/);
});

test('model formats remain separate from documents, media and cached library entries', () => {
  const entries = ['model', 'image', 'text', 'audio'].map((kind, index) => ({ id: String(index), kind, name: kind+'.glb', path: '/fixture/'+kind+'.glb', directoryPath: '/fixture', format: '.glb', source: 'file', size: 12 })) as ImageEntry[];
  const node: LibraryNode = { id: 'root', name: 'root', path: '/fixture', kind: 'directory', scanned: true, children: [], images: entries };
  assert.equal(isLibraryTree(node), true);
  assert.deepEqual(filterWorkspaceEntries(entries, '', 'model', 'all'), [entries[0]]);
  assert.deepEqual(filterWorkspaceEntries(entries, '', 'document', 'all'), [entries[2]]);
  assert.deepEqual(libraryCounts(node), { entries: 4, images: 1, models: 1, documents: 1, media: 1, archives: 0 });
});

test('GLTF and 3MF validation rejects truncated and oversized declarations before parsing', () => {
  validateGLTF(arrayBuffer(fixtures['cube.gltf']), false);
  validateGLTF(arrayBuffer(fixtures['cube.glb']), true);
  validate3MF(arrayBuffer(fixtures['cube.3mf']));
  validatePLY(arrayBuffer(fixtures['cube.ply']));
  assert.throws(() => validatePLY(arrayBuffer(new TextEncoder().encode('ply\nformat binary_little_endian 1.0\nelement vertex 1000000000\nend_header\n'))), /large/);
  assert.throws(() => validateGLTF(new ArrayBuffer(4), true));
  const huge = new TextEncoder().encode(JSON.stringify({ accessors: [{ count: 2**32 }] }));
  assert.throws(() => validateGLTF(arrayBuffer(huge), false), /large/);
  for (const length of [0, 1, 4, 20, 40]) assert.throws(() => validate3MF(arrayBuffer(fixtures['cube.3mf'].slice(0, length))));
  const invalidZip = fixtures['cube.3mf'].slice();
  const view = new DataView(invalidZip.buffer);
  for (let i = 0; i < invalidZip.length - 28; i++) if (view.getUint32(i, true) === 0x02014b50) { view.setUint32(i + 24, maxModelBytes + 1, true); break; }
  assert.throws(() => validate3MF(arrayBuffer(invalidZip)), /large/);
});

test('model fetch limits both declared and streamed sizes and supports cancellation', async () => {
  let cancelled = false;
  const restore = globalValue('fetch', async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-length': String(maxModelBytes + 1) } }));
  try { await assert.rejects(fetchModelData(base, new AbortController().signal), /large/); assert.equal(cancelled, true); } finally { restore(); }
  let chunks = 0;
  const chunk = new Uint8Array(1024 * 1024);
  const restoreStream = globalValue('fetch', async () => new Response(new ReadableStream({
    pull(controller) { if (chunks++ < 130) controller.enqueue(chunk); else controller.close(); },
    cancel() { cancelled = true; },
  })));
  cancelled = false;
  try { await assert.rejects(fetchModelData(base, new AbortController().signal), /large/); assert.equal(cancelled, true); } finally { restoreStream(); }
  const controller = new AbortController();
  controller.abort();
  const restoreFetch = globalValue('fetch', async () => new Response(new Uint8Array([1,2,3])));
  try { await assert.rejects(fetchModelData(base, controller.signal), /abort/i); } finally { restoreFetch(); }
});

test('real geometry loaders and camera fitting handle offset, narrow and empty models', async () => {
  const restoreProgress = globalValue('ProgressEvent', class extends Event { constructor(type: string, options: object) { super(type); Object.assign(this, options); } });
  const { ModelLoadScope, loadModel } = source('modelLoaders.ts');
  const { fitModelDistance, modelBounds } = source('modelViewer.ts');
  for (const format of ['.obj', '.stl', '.ply', '.fbx', '.glb', '.gltf']) {
    const controller = new AbortController();
    const scope = new ModelLoadScope(base, controller.signal, () => {});
    const restoreFetch = globalValue('fetch', async (url: string) => {
      const path = new URL(typeof url === 'string' ? url : (url as any).url).pathname.slice('/model/selected/'.length);
      return fixtures[path] ? new Response(fixtures[path]) : new Response('', { status: 404 });
    });
    try {
      const root = await loadModel(arrayBuffer(fixtures['cube'+format]), format, scope);
      const sphere = modelBounds(root);
      assert.ok(Math.abs(sphere.radius - Math.sqrt(3)) < 1e-6, format);
      assert.ok(fitModelDistance(0.5) > fitModelDistance(2));
    } finally { restoreFetch(); controller.abort(); }
  }
  const { Group } = THREE;
  assert.throws(() => modelBounds(new Group()), /empty/);
  restoreProgress();
});

test('model disposal releases shared resources once and closes image bitmaps', () => {
  const { disposeModel, ModelLoadScope } = source('modelLoaders.ts');
  const { Group, BoxGeometry, Mesh, MeshStandardMaterial, Texture } = THREE;
  let geometryDisposed = 0, materialDisposed = 0, textureDisposed = 0, bitmapClosed = 0;
  const geometry = new BoxGeometry(); geometry.addEventListener('dispose', () => geometryDisposed++);
  const texture = new Texture({ close: () => bitmapClosed++ }); texture.addEventListener('dispose', () => textureDisposed++);
  const material = new MeshStandardMaterial({ map: texture }); material.addEventListener('dispose', () => materialDisposed++);
  const root = new Group(); root.add(new Mesh(geometry, material), new Mesh(geometry, material));
  disposeModel([root]);
  assert.deepEqual([geometryDisposed, materialDisposed, textureDisposed, bitmapClosed], [1,1,1,1]);
  const controller = new AbortController();
  const scope = new ModelLoadScope(base, controller.signal, () => {});
  controller.abort();
  const late = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  let released = false; late.geometry.addEventListener('dispose', () => { released = true; });
  scope.track(late);
  assert.equal(released, true);
  assert.throws(() => scope.manager.resolveURL(base+'mesh.bin'), /abort/i);
});

test('Meshopt-compressed glTF decodes using the bundled offline decoder', async () => {
  await MeshoptEncoder.ready;
  const document = JSON.parse(new TextDecoder().decode(fixtures['cube.gltf']));
  const modes = ['ATTRIBUTES', 'TRIANGLES', 'ATTRIBUTES'];
  const strides = [12, 2, 8];
  const counts = [8, 36, 8];
  const chunks: Uint8Array[] = [];
  let offset = 0;
  document.bufferViews.forEach((view: any, index: number) => {
    const encoded = MeshoptEncoder.encodeGltfBuffer(fixtures['mesh.bin'].subarray(view.byteOffset, view.byteOffset + view.byteLength), counts[index], strides[index], modes[index]);
    view.buffer = 1;
    view.extensions = { EXT_meshopt_compression: { buffer: 0, byteOffset: offset, byteLength: encoded.length, byteStride: strides[index], count: counts[index], mode: modes[index], filter: 'NONE' } };
    chunks.push(encoded); offset += encoded.length;
  });
  document.buffers = [{ byteLength: offset, uri: 'data:application/octet-stream;base64,' + Buffer.concat(chunks).toString('base64') }, { byteLength: fixtures['mesh.bin'].byteLength }];
  document.extensionsUsed = document.extensionsRequired = ['EXT_meshopt_compression'];
  const { ModelLoadScope, loadModel } = source('modelLoaders.ts');
  const { modelBounds } = source('modelViewer.ts');
  const controller = new AbortController();
  const restore = globalValue('ProgressEvent', class extends Event { constructor(type: string, options: object) { super(type); Object.assign(this, options); } });
  try {
    const root = await loadModel(arrayBuffer(new TextEncoder().encode(JSON.stringify(document))), '.gltf', new ModelLoadScope(base, controller.signal, () => {}));
    assert.ok(Math.abs(modelBounds(root).radius - Math.sqrt(3)) < 1e-6);
  } finally { controller.abort(); restore(); }
});

test('resource limit failures remain fatal even if a texture loader catches them', async () => {
  const { ModelLoadScope } = source('modelLoaders.ts');
  const controller = new AbortController();
  const scope = new ModelLoadScope(base, controller.signal, () => {});
  try {
    for (let i = 0; i < 256; i++) scope.manager.resolveURL(`texture-${i}.png`);
    assert.throws(() => scope.manager.resolveURL('too-many.png'), /large/);
    await assert.rejects(scope.ready(), /large/);
  } finally { controller.abort(); }
});

test('streamed model reads preserve bytes for accurate, absent and inaccurate length headers', async () => {
  for (const size of [undefined, '0', '6', '2', '20', 'invalid']) {
    const restore = globalValue('fetch', async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array(0));
        controller.enqueue(new Uint8Array([3, 4, 5, 6]));
        controller.close();
      },
    }), { headers: size === undefined ? {} : { 'content-length': size } }));
    const progress: number[] = [];
    try {
      assert.deepEqual([...new Uint8Array(await fetchModelData(base, new AbortController().signal, value => progress.push(value)))], [1, 2, 3, 4, 5, 6]);
      assert.equal(progress.at(-1), 1);
    } finally { restore(); }
  }
  const slice = new Uint8Array([99, 1, 2, 99]).subarray(1, 3);
  const restore = globalValue('fetch', async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(slice); controller.close(); } })));
  try { assert.deepEqual([...new Uint8Array(await fetchModelData(base, new AbortController().signal))], [1, 2]); } finally { restore(); }
});

test('model progress is bounded for small chunks and abort cancels a pending read', async () => {
  let chunks = 0;
  const restore = globalValue('fetch', async () => new Response(new ReadableStream({
    pull(controller) { if (chunks++ < 4096) controller.enqueue(new Uint8Array([7])); else controller.close(); },
  }), { headers: { 'content-length': '4096' } }));
  const progress: number[] = [];
  try {
    const data = await fetchModelData(base, new AbortController().signal, value => progress.push(value));
    assert.equal(data.byteLength, 4096);
    assert.ok(new Uint8Array(data).every(value => value === 7));
    assert.ok(progress.length <= 101);
    assert.equal(progress.at(-1), 1);
    assert.ok(progress.every((value, index) => !index || value > progress[index - 1]));
  } finally { restore(); }

  const controller = new AbortController();
  let body: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const restorePending = globalValue('fetch', async () => new Response(new ReadableStream({
    start(value) { body = value; }, cancel() { cancelled = true; },
  })));
  try {
    const reading = fetchModelData(base, controller.signal);
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    body!.enqueue(new Uint8Array([1]));
    await assert.rejects(reading, /abort/i);
    assert.equal(cancelled, true);
  } finally { restorePending(); }
});

test('aborted previews release scenes immediately and clean late/shared images exactly once', async () => {
  const { ModelLoadScope } = source('modelLoaders.ts');
  const parent = new AbortController();
  const scope = new ModelLoadScope(base, parent.signal, () => {});
  let geometryReleased = 0, materialReleased = 0, textureReleased = 0, imageClosed = 0;
  const geometry = new THREE.BoxGeometry();
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture });
  geometry.addEventListener('dispose', () => geometryReleased++);
  material.addEventListener('dispose', () => materialReleased++);
  texture.addEventListener('dispose', () => textureReleased++);
  const root = new THREE.Mesh(geometry, material);
  scope.track(root);
  scope.materials.add(material);
  scope.manager.itemStart('late-image');
  scope.manager.itemStart('another-image');
  const ready = scope.ready();
  scope.dispose();
  await assert.rejects(ready, /abort/i);
  assert.equal(parent.signal.aborted, false, 'disposal must not abort an unrelated caller');
  assert.equal(scope.signal.aborted, true);
  assert.equal(scope.roots.size, 0);
  assert.equal(scope.materials.size, 0);
  texture.image = { close: () => imageClosed++ };
  scope.manager.itemEnd('late-image');
  assert.equal(imageClosed, 1, 'a finished image must not wait for other pending resources');
  scope.manager.itemEnd('another-image');
  scope.track(new THREE.Mesh(geometry, material));
  scope.dispose();
  assert.deepEqual([geometryReleased, materialReleased, textureReleased, imageClosed], [1, 1, 1, 1]);
  assert.equal(scope.roots.size, 0, 'late scenes must not be retained');
});

test('shared materials are inspected once and environment lighting matches each material family', () => {
  const { inspectModel } = source('modelViewer.ts');
  const geometry = new THREE.BoxGeometry();
  const texture = new THREE.Texture({ width: 32, height: 32 });
  const material = new THREE.MeshStandardMaterial({ map: texture });
  let inspections = 0;
  Object.defineProperty(material, 'inspectionProbe', { enumerable: true, get() { inspections++; return null; } });
  const root = new THREE.Group();
  for (let index = 0; index < 1000; index++) root.add(new THREE.Mesh(geometry, material));
  assert.equal(inspectModel(root).needsEnvironment, true);
  assert.equal(inspections, 1);
  for (const candidate of [new THREE.MeshStandardMaterial(), new THREE.MeshPhysicalMaterial(), new THREE.MeshLambertMaterial(), new THREE.MeshPhongMaterial()]) {
    assert.equal(inspectModel(new THREE.Mesh(geometry, candidate)).needsEnvironment, true, candidate.type);
  }
  for (const candidate of [new THREE.MeshBasicMaterial(), new THREE.PointsMaterial(), new THREE.MeshStandardMaterial({ envMap: texture })]) {
    assert.equal(inspectModel(new THREE.Mesh(geometry, candidate)).needsEnvironment, false, candidate.type);
  }
});

test('viewer coalesces resize/render work and releases pending work on disposal', async () => {
  const { ModelLoadScope } = source('modelLoaders.ts');
  const frames = new Map<number, FrameRequestCallback>();
  const sizes: number[][] = [];
  let frameID = 0, renders = 0, rendererDisposed = 0, contextLost = 0, observerDisconnected = 0;
  let canvas: EventTarget | undefined;
  const host = { clientWidth: 640, clientHeight: 480, appendChild(value: EventTarget) { canvas = value; } };
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const win = Object.assign(new EventTarget(), { devicePixelRatio: 2, location: { href: base } });
  class Renderer {
    domElement = Object.assign(new EventTarget(), { remove() { canvas = undefined; } });
    setClearAlpha() {}
    setDrawingBufferSize(...values: number[]) { sizes.push(values); }
    render(scene: THREE.Scene) { assert.equal(scene.matrixWorldAutoUpdate, false); renders++; }
    dispose() { rendererDisposed++; }
    forceContextLoss() { contextLost++; }
  }
  class Controls extends THREE.EventDispatcher<any> {
    target = new THREE.Vector3();
    update() { this.dispatchEvent({ type: 'change' }); }
    dispose() {}
  }
  class Observer {
    callback: () => void;
    constructor(callback: () => void) { this.callback = callback; }
    observe() { this.callback(); }
    disconnect() { observerDisconnected++; }
  }
  const restores = [
    globalValue('window', win), globalValue('document', doc), globalValue('ResizeObserver', Observer),
    globalValue('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameID, callback); return frameID; }),
    globalValue('cancelAnimationFrame', (id: number) => frames.delete(id)),
    globalValue('fetch', async () => new Response(new Uint8Array([1]))),
  ];
  const flushFrame = () => {
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0));
  };
  try {
    const { createModelViewer } = loadSource('modelViewer.ts', undefined, {
      three: { ...THREE, WebGLRenderer: Renderer },
      'three/examples/jsm/controls/OrbitControls.js': { OrbitControls: Controls },
      './modelLoaders': { ModelLoadScope, loadModel: async (_data: unknown, _format: unknown, scope: any) => scope.track(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())) },
    });
    const viewer = createModelViewer(host, base + 'cube.obj', '.obj', new AbortController().signal, { progress() {}, contextLost() {} });
    assert.equal(frames.size, 0, 'loading an empty scene should not draw');
    await viewer.ready;
    assert.deepEqual(sizes, [[640, 480, 2]], 'initial sizing should allocate the drawing buffer once');
    assert.equal(frames.size, 1);
    flushFrame();
    assert.equal(renders, 1);
    win.dispatchEvent(new Event('resize'));
    assert.equal(sizes.length, 1);
    assert.equal(frames.size, 0, 'unchanged dimensions should not repaint');
    host.clientWidth = 8192;
    win.dispatchEvent(new Event('resize'));
    assert.deepEqual(sizes.at(-1), [8192, 480, 0.5]);
    viewer.fit(); viewer.fit();
    assert.equal(frames.size, 1, 'multiple invalidations should share one frame');
    doc.hidden = true;
    flushFrame();
    assert.equal(renders, 1, 'a queued frame must not draw after the page is hidden');
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    flushFrame();
    assert.equal(renders, 2);
    viewer.fit();
    viewer.dispose(); viewer.dispose();
    assert.equal(frames.size, 0);
    assert.equal(canvas, undefined);
    assert.deepEqual([rendererDisposed, contextLost, observerDisconnected], [1, 1, 1]);
    host.clientWidth = 320;
    win.dispatchEvent(new Event('resize'));
    assert.equal(sizes.length, 2, 'disposed viewers must remove resize listeners');
  } finally { restores.reverse().forEach(restore => restore()); }
});
