// 縮圖以 LRU 快取在記憶體中，並搭配 IntersectionObserver 只在捲入畫面時才載入。
const thumbnailCache = new Map<string, string>();
const maxThumbnailCacheEntries = 200;
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
  thumbnailCache.delete(path);
  thumbnailCache.set(path, dataUri);
  while (thumbnailCache.size > maxThumbnailCacheEntries) {
    const oldestKey = thumbnailCache.keys().next().value;
    if (typeof oldestKey !== 'string') {
      break;
    }
    thumbnailCache.delete(oldestKey);
  }
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
