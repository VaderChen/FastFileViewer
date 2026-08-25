// 下載網址解析與顯示用的純函式，與 React 狀態無關，方便單獨測試。

export function extractDownloadURLs(value: string): string[] {
  const matches = value.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  const urls: string[] = [];
  for (const match of matches) {
    const candidate = match.replace(/[.,;]+$/, '');
    try {
      const parsed = new URL(candidate);
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname) {
        urls.push(parsed.toString());
      }
    } catch {
      continue;
    }
  }
  return urls;
}

export function shouldResolveDownloadPage(rawURL: string): boolean {
  try {
    const parsed = new URL(rawURL);
    const path = parsed.pathname.toLowerCase();
    const filename = path.split('/').filter(Boolean).pop() ?? '';
    const extensionMatch = filename.match(/(\.[a-z0-9]{1,10})$/);
    if (!extensionMatch) {
      return true;
    }
    return ['.html', '.htm', '.php', '.asp', '.aspx', '.jsp'].includes(extensionMatch[1]);
  } catch {
    return false;
  }
}

export function downloadCandidateDisplayURL(rawURL: string): string {
  try {
    const parsed = new URL(rawURL);
    return `${parsed.hostname}${decodeURIComponent(parsed.pathname)}`;
  } catch {
    return rawURL;
  }
}

export function downloadHost(rawURL: string): string {
  try {
    return new URL(rawURL).hostname;
  } catch {
    return rawURL;
  }
}

export function formatDownloadSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  if (size < 1024 * 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
