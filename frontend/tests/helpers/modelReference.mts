// Baseline retained for reproducible model-preview memory and CPU comparisons.
import { Box3, BufferGeometry, Mesh, Object3D, Sphere, Texture } from 'three';
import { checkModelSignal, maxModelBytes, maxModelGeometryBytes, ModelError } from '../../src/modelResources.ts';

export async function referenceFetchModelData(url: string, signal: AbortSignal, onProgress?: (fraction: number) => void): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal, credentials: 'same-origin' });
  if (!response.ok) throw new ModelError('resource');
  const size = Number(response.headers.get('content-length'));
  if (size > maxModelBytes) {
    await response.body?.cancel();
    throw new ModelError('large');
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const data = await response.arrayBuffer();
    if (data.byteLength > maxModelBytes) throw new ModelError('large');
    return data;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      checkModelSignal(signal);
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxModelBytes) throw new ModelError('large');
      chunks.push(value);
      if (size > 0) onProgress?.(Math.min(1, total / size));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result.buffer;
}

export function referenceModelBounds(root: Object3D): Sphere {
  const geometries = new Set<BufferGeometry>();
  const buffers = new Set<ArrayBufferLike>();
  const textures = new Set<Texture>();
  let bytes = 0;
  let vertices = 0;
  let texturePixels = 0;
  let objects = 0;
  root.traverse(node => {
    if (++objects > 10000) throw new ModelError('large');
    const material = (node as Mesh).material;
    for (const item of Array.isArray(material) ? material : material ? [material] : []) {
      for (const value of Object.values(item)) if (value?.isTexture && !textures.has(value)) {
        textures.add(value);
        const image = value.image;
        if (image?.width && image?.height) texturePixels += image.width * image.height;
      }
    }
    const geometry = (node as Mesh).geometry;
    if (!geometry || geometries.has(geometry)) return;
    geometries.add(geometry);
    vertices += geometry.getAttribute('position')?.count ?? 0;
    const attributes = [...Object.values(geometry.attributes), ...Object.values(geometry.morphAttributes).flat()];
    if (geometry.index) attributes.push(geometry.index);
    for (const attribute of attributes) {
      const buffer = attribute.array.buffer;
      if (!buffers.has(buffer)) { buffers.add(buffer); bytes += buffer.byteLength; }
    }
  });
  if (bytes > maxModelGeometryBytes || vertices > 5_000_000 || texturePixels > 32 * 1024 * 1024) throw new ModelError('large');
  if (!vertices) throw new ModelError('empty');
  root.updateMatrixWorld(true);
  const sphere = new Box3().setFromObject(root).getBoundingSphere(new Sphere());
  if (![sphere.radius, ...sphere.center.toArray()].every(Number.isFinite)) throw new ModelError('invalid');
  // A point cloud may consist of a single point.
  if (sphere.radius <= 0) sphere.radius = 1;
  return sphere;
}
