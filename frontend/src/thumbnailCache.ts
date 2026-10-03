// 縮圖以 LRU 快取在記憶體中，並搭配 IntersectionObserver 只在捲入畫面時才載入。
const thumbnailCache = new Map<string, string>();
const maxThumbnailCacheEntries = 200;
const maxThumbnailCacheBytes = 16 * 1024 * 1024;
let thumbnailCacheBytes = 0;
let thumbnailGeneration = 0;
const visibilityCallbacks = new WeakMap<Element, () => void>();
let visibilityObserver: IntersectionObserver | null = null;

// readThumbnail 會把命中的項目移到最新，維持淘汰順序。
export function readThumbnail(path: string): string {
  const thumbnail = thumbnailCache.get(path);
  if (!thumbnail) {
    return '';
  }
  thumbnailCache.delete(path);
  thumbnailCache.set(path, thumbnail);
  return thumbnail;
}

// storeThumbnail 會在超過上限時淘汰最久沒被讀取的項目。
export function storeThumbnail(path: string, dataUri: string) {
  thumbnailCacheBytes -= (thumbnailCache.get(path)?.length ?? 0) * 2;
  thumbnailCache.delete(path);
  // 以 UTF-16 的保守上限計算，避免少數大型 SVG 撐滿記憶體。
  if (dataUri.length * 2 > maxThumbnailCacheBytes) return;
  thumbnailCache.set(path, dataUri);
  thumbnailCacheBytes += dataUri.length * 2;
  while (thumbnailCache.size > maxThumbnailCacheEntries || thumbnailCacheBytes > maxThumbnailCacheBytes) {
    const oldestKey = thumbnailCache.keys().next().value;
    if (typeof oldestKey !== 'string') {
      break;
    }
    thumbnailCacheBytes -= (thumbnailCache.get(oldestKey)?.length ?? 0) * 2;
    thumbnailCache.delete(oldestKey);
  }
}

interface ThumbnailRequest {
  start: () => void;
  cancel: () => void;
}
const thumbnailQueue: ThumbnailRequest[] = [];
const pendingThumbnailRequests = new Set<ThumbnailRequest>();
let activeThumbnailRequests = 0;

// 重掃同一路徑時淘汰舊世代，包含尚未回傳的後端結果。
export function clearThumbnailCache(): number {
  thumbnailGeneration++;
  thumbnailCache.clear();
  thumbnailCacheBytes = 0;
  for (const request of pendingThumbnailRequests) request.cancel();
  return thumbnailGeneration;
}

function drainThumbnailQueue() {
  while (activeThumbnailRequests < 3 && thumbnailQueue.length) {
    thumbnailQueue.shift()!.start();
  }
}

// 卡片卸載時直接移除尚未送到 Go 的工作，不累積後端 goroutine。
export function requestThumbnail(path: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const generation = thumbnailGeneration;
    let settled = false;
    const finish = (result: { dataUri: string } | { error: unknown }) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      pendingThumbnailRequests.delete(request);
      if ('error' in result) reject(result.error);
      else resolve(result.dataUri);
    };
    const abort = () => {
      const index = thumbnailQueue.indexOf(request);
      if (index >= 0) thumbnailQueue.splice(index, 1);
      finish({ error: new DOMException('Thumbnail cancelled', 'AbortError') });
    };
    const request: ThumbnailRequest = { cancel: abort, start: () => {
      activeThumbnailRequests += 1;
      const loader = window.go?.app?.App?.LoadThumbnailByPath;
      Promise.resolve().then(() => settled ? undefined : loader?.(path, 280)).then((payload) => {
        if (settled || generation !== thumbnailGeneration) return;
        if (!payload?.dataUri) throw new Error('Thumbnail unavailable');
        storeThumbnail(path, payload.dataUri);
        finish({ dataUri: payload.dataUri });
      }).catch((error) => finish({ error })).finally(() => {
        activeThumbnailRequests -= 1;
        drainThumbnailQueue();
      });
    } };
    if (signal.aborted) { abort(); return; }
    pendingThumbnailRequests.add(request);
    signal.addEventListener('abort', abort, { once: true });
    thumbnailQueue.push(request);
    drainThumbnailQueue();
  });
}

// observeThumbnailVisibility 共用單一個觀察器，回傳解除觀察的函式。
export function observeThumbnailVisibility(element: Element, onVisible: () => void) {
  if (!visibilityObserver) {
    visibilityObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }
          const callback = visibilityCallbacks.get(entry.target);
          visibilityObserver?.unobserve(entry.target);
          visibilityCallbacks.delete(entry.target);
          callback?.();
        });
      },
      { rootMargin: '400px' },
    );
  }
  visibilityCallbacks.set(element, onVisible);
  visibilityObserver.observe(element);
  return () => {
    visibilityObserver?.unobserve(element);
    visibilityCallbacks.delete(element);
  };
}
