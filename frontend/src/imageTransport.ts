// 只解碼目前要顯示的原圖；切圖時取消尚未完成的 HTTP 要求。
export function decodeImageURL(url: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      image.onload = null;
      image.onerror = null;
      if (error) {
        image.removeAttribute('src');
        reject(error);
      } else resolve();
    };
    const abort = () => finish(new DOMException('Image loading cancelled', 'AbortError'));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    image.decoding = 'async';
    image.onerror = () => finish(new Error('Unable to load image'));
    image.onload = () => {
      if (typeof image.decode === 'function') image.decode().then(() => finish(), () => finish(new Error('Unable to decode image')));
      else finish();
    };
    image.src = url;
  });
}

// 僅在剪貼簿需要文字備援時產生 Base64，保留原本的複製功能。
export async function imageURLToDataURI(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Unable to copy image');
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unable to copy image'));
    reader.onerror = () => reject(reader.error ?? new Error('Unable to copy image'));
    reader.readAsDataURL(blob);
  });
}
