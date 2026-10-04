export const maxModelBytes = 128 * 1024 * 1024;
export const maxModelGeometryBytes = 256 * 1024 * 1024;

export function checkModelSignal(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

export class ModelError extends Error {
  code: 'resource' | 'large' | 'empty' | 'unsupported' | 'webgl' | 'invalid';
  constructor(code: ModelError['code']) {
    super(code);
    this.code = code;
  }
}

// A loader may resolve relative paths itself. Check the final URL too so an
// absolute URI, encoded traversal, or a different model's URL cannot escape.
export function resolveModelResource(value: string, base: string): string {
  if (/^data:/i.test(value)) {
    if (!/^data:(?:application\/(?:octet-stream|gltf-buffer)|image\/(?:png|jpeg|webp|gif|bmp|avif));base64,/i.test(value)) throw new ModelError('resource');
    if (value.length > maxModelBytes * 4 / 3 + 128) throw new ModelError('large');
    return value;
  }
  if (value.startsWith('blob:')) {
    if (new URL(value).origin !== new URL(base).origin) throw new ModelError('resource');
    return value;
  }
  if (value.includes('\\')) throw new ModelError('resource');
  const root = new URL(base);
  const url = new URL(value, root);
  if (url.origin !== root.origin || url.protocol !== root.protocol || url.host !== root.host || !url.pathname.startsWith(root.pathname) || url.username || url.password) throw new ModelError('resource');
  let name: string;
  try { name = decodeURIComponent(url.pathname.slice(root.pathname.length)); }
  catch { throw new ModelError('resource'); }
  if (name.includes('\\') || name.includes(':') || name.includes('\0') || name.split('/').some(part => !part || part.startsWith('.'))
    || !/\.(glb|gltf|obj|stl|ply|fbx|3mf|bin|mtl|png|jpe?g|webp|gif|bmp|avif|tga)$/i.test(name)) throw new ModelError('resource');
  return url.href;
}

export async function fetchModelData(url: string, signal: AbortSignal, onProgress?: (fraction: number) => void): Promise<ArrayBuffer> {
  checkModelSignal(signal);
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
    checkModelSignal(signal);
    if (data.byteLength > maxModelBytes) throw new ModelError('large');
    onProgress?.(1);
    return data;
  }
  // The local endpoint supplies a byte length. Fill one destination directly
  // instead of retaining every chunk and then allocating a second model copy.
  const knownSize = Number.isSafeInteger(size) && size > 0 ? size : 0;
  let destination: Uint8Array<ArrayBuffer> | undefined;
  const chunks: Uint8Array[] = [];
  let total = 0;
  let lastPercent = -1;
  try {
    while (true) {
      checkModelSignal(signal);
      const { done, value } = await reader.read();
      checkModelSignal(signal);
      if (done) break;
      if (!value.byteLength) continue;
      const next = total + value.byteLength;
      if (next > maxModelBytes) throw new ModelError('large');
      if (!total && knownSize >= next) destination = new Uint8Array(knownSize);
      if (destination && next <= destination.byteLength) {
        destination.set(value, total);
      } else {
        // A missing or inaccurate header still uses the bounded streaming path.
        if (destination) { chunks.push(destination.subarray(0, total)); destination = undefined; }
        chunks.push(value);
      }
      total = next;
      if (knownSize) {
        const percent = Math.min(100, Math.floor(total / knownSize * 100));
        if (percent !== lastPercent) { lastPercent = percent; onProgress?.(percent / 100); }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  checkModelSignal(signal);
  if (lastPercent !== 100) onProgress?.(1);
  if (destination) return total === destination.byteLength ? destination.buffer : destination.slice(0, total).buffer;
  if (chunks.length === 1 && chunks[0].byteOffset === 0 && chunks[0].buffer.byteLength === total && chunks[0].buffer instanceof ArrayBuffer) return chunks[0].buffer;
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result.buffer;
}

// Accessors can allocate arrays even when no buffer is present. Validate the
// declared sizes before invoking a parser rather than after allocation.
export function validateGLTF(data: ArrayBuffer, binary: boolean): void {
  let json: Uint8Array;
  if (binary) {
    if (data.byteLength < 20) throw new ModelError('invalid');
    const view = new DataView(data);
    const length = view.getUint32(12, true);
    if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== data.byteLength
      || view.getUint32(16, true) !== 0x4e4f534a || length > data.byteLength - 20) throw new ModelError('invalid');
    json = new Uint8Array(data, 20, length);
  } else json = new Uint8Array(data);
  const document = JSON.parse(new TextDecoder().decode(json));
  let bytes = 0;
  for (const buffer of document.buffers ?? []) {
    if (!Number.isSafeInteger(buffer.byteLength) || buffer.byteLength < 0) throw new ModelError('invalid');
    bytes += buffer.byteLength;
  }
  for (const accessor of document.accessors ?? []) {
    if (!Number.isSafeInteger(accessor.count) || accessor.count < 0) throw new ModelError('invalid');
    // Conservative bound covers MAT4 and sparse accessors as well.
    bytes += accessor.count * 64;
  }
  if (bytes > maxModelGeometryBytes || (document.nodes?.length ?? 0) > 10000) throw new ModelError('large');
  if ((document.extensionsRequired ?? []).some((name: string) => name === 'KHR_draco_mesh_compression' || name === 'KHR_texture_basisu')) throw new ModelError('unsupported');
}

// 3MF is ZIP-compressed. Bound the declared expansion before ThreeMFLoader's
// synchronous unzip, including malformed/truncated and ZIP64 archives.
export function validate3MF(data: ArrayBuffer): void {
  const view = new DataView(data);
  let end = data.byteLength - 22;
  const minimum = Math.max(0, end - 65535);
  while (end >= minimum && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < minimum) throw new ModelError('invalid');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (count === 0xffff || count > 4096 || offset === 0xffffffff) throw new ModelError('large');
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new ModelError('invalid');
    total += view.getUint32(offset + 24, true);
    if (total > maxModelBytes) throw new ModelError('large');
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
}

export function validatePLY(data: ArrayBuffer): void {
  const header = new TextDecoder().decode(new Uint8Array(data, 0, Math.min(data.byteLength, 64 * 1024)));
  const end = header.indexOf('end_header');
  if (!header.startsWith('ply') || end < 0) throw new ModelError('invalid');
  let elements = 0;
  for (const match of header.slice(0, end).matchAll(/^element\s+\S+\s+(\S+)/gm)) {
    const count = Number(match[1]);
    if (!Number.isSafeInteger(count) || count < 0) throw new ModelError('invalid');
    elements += count;
    if (elements > 5_000_000) throw new ModelError('large');
  }
}
