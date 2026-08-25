import { useEffect, useState } from 'react';
import type { ClipboardEvent, DragEvent } from 'react';
import type { DownloadItem, DownloadResolution } from './types';
import { extractDownloadURLs, shouldResolveDownloadPage } from './downloads';
import { extractErrorMessage } from './operations';

interface UseDownloadsOptions {
  // panelVisible 為 true 時即使沒有進行中的項目也持續輪詢，讓面板保持即時。
  panelVisible: boolean;
  operationFailedLabel: string;
  onError: (message: string) => void;
}

function downloadService() {
  return window.go?.app?.DownloadService;
}

// useDownloads 把下載佇列的狀態、輪詢與所有操作集中在一起，讓畫面元件只需要處理呈現。
export function useDownloads({ panelVisible, operationFailedLabel, onError }: UseDownloadsOptions) {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [downloadURL, setDownloadURL] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pendingResolutions, setPendingResolutions] = useState<DownloadResolution[]>([]);
  const [selectedHLSURLs, setSelectedHLSURLs] = useState<Set<string>>(new Set());
  const [selectionSubmitting, setSelectionSubmitting] = useState(false);
  const currentResolution = pendingResolutions[0] ?? null;

  const refresh = async () => {
    const items = await downloadService()?.ListDownloads?.();
    if (items) {
      setDownloads(items);
    }
  };

  useEffect(() => {
    const firstCandidate = currentResolution?.candidates[0];
    setSelectedHLSURLs(new Set(firstCandidate ? [firstCandidate.url] : []));
  }, [currentResolution]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, []);

  useEffect(() => {
    const hasActiveDownload = downloads.some((item) => item.status === 'queued' || item.status === 'downloading');
    if (!panelVisible && !hasActiveDownload) {
      return;
    }
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 750);
    return () => window.clearInterval(timer);
  }, [downloads, panelVisible]);

  const submitURLs = async (rawValues: string[]) => {
    const urls = Array.from(new Set(rawValues.flatMap(extractDownloadURLs)));
    if (urls.length === 0 || submitting) {
      return;
    }
    setSubmitting(true);
    onError('');
    const failures: string[] = [];
    const resolutionsForSelection: DownloadResolution[] = [];
    for (const url of urls) {
      try {
        const service = downloadService();
        if (shouldResolveDownloadPage(url) && service?.ResolveDownloadURL) {
          const resolution = await service.ResolveDownloadURL(url);
          if (resolution.candidates.length > 1) {
            resolutionsForSelection.push(resolution);
            continue;
          }
          if (resolution.candidates.length === 1 && service.StartResolvedDownload) {
            await service.StartResolvedDownload(resolution.sourceUrl, resolution.candidates[0].url, resolution.name);
            continue;
          }
        }
        await service?.StartDownload?.(url);
      } catch (error) {
        failures.push(extractErrorMessage(error, operationFailedLabel));
      }
    }
    if (resolutionsForSelection.length > 0) {
      setPendingResolutions((current) => [...current, ...resolutionsForSelection]);
    }
    await refresh().catch(() => undefined);
    setSubmitting(false);
    setDownloadURL('');
    if (failures.length > 0) {
      onError(failures.join('\n'));
    }
  };

  const toggleHLSSelection = (url: string) => {
    setSelectedHLSURLs((current) => {
      const next = new Set(current);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  };

  const selectAllHLSCandidates = () => {
    setSelectedHLSURLs(new Set(currentResolution?.candidates.map((candidate) => candidate.url) ?? []));
  };

  const clearHLSSelection = () => {
    setSelectedHLSURLs(new Set());
  };

  const closeCurrentResolution = () => {
    if (selectionSubmitting) {
      return;
    }
    setPendingResolutions((current) => current.slice(1));
  };

  const confirmHLSSelection = async () => {
    if (!currentResolution || selectedHLSURLs.size === 0 || selectionSubmitting) {
      return;
    }
    setSelectionSubmitting(true);
    onError('');
    const failures: string[] = [];
    for (const candidate of currentResolution.candidates) {
      if (!selectedHLSURLs.has(candidate.url)) {
        continue;
      }
      try {
        await downloadService()?.StartResolvedDownload?.(currentResolution.sourceUrl, candidate.url, currentResolution.name);
      } catch (error) {
        failures.push(extractErrorMessage(error, operationFailedLabel));
      }
    }
    await refresh().catch(() => undefined);
    setSelectionSubmitting(false);
    setPendingResolutions((current) => current.slice(1));
    if (failures.length > 0) {
      onError(failures.join('\n'));
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLElement>) => {
    const value = event.clipboardData.getData('text/uri-list') || event.clipboardData.getData('text/plain');
    if (extractDownloadURLs(value).length === 0) {
      return;
    }
    event.preventDefault();
    void submitURLs([value]);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!Array.from(event.dataTransfer.types).some((type) => type === 'text/uri-list' || type === 'text/plain')) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragActive(true);
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    const value = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain');
    setDragActive(false);
    if (extractDownloadURLs(value).length === 0) {
      return;
    }
    event.preventDefault();
    void submitURLs([value]);
  };

  const cancel = async (id: string) => {
    await downloadService()?.CancelDownload?.(id);
    await refresh().catch(() => undefined);
  };

  const remove = async (id: string) => {
    try {
      await downloadService()?.RemoveDownload?.(id);
      await refresh();
    } catch (error) {
      onError(extractErrorMessage(error, operationFailedLabel));
    }
  };

  const reveal = async (id: string) => {
    try {
      await downloadService()?.RevealDownload?.(id);
    } catch (error) {
      onError(extractErrorMessage(error, operationFailedLabel));
    }
  };

  const openDirectory = () => {
    void downloadService()?.OpenDownloadsDirectory?.();
  };

  return {
    downloads,
    downloadURL,
    setDownloadURL,
    dragActive,
    setDragActive,
    submitting,
    currentResolution,
    selectedHLSURLs,
    selectionSubmitting,
    submitURLs,
    toggleHLSSelection,
    selectAllHLSCandidates,
    clearHLSSelection,
    closeCurrentResolution,
    confirmHLSSelection,
    handlePaste,
    handleDragOver,
    handleDrop,
    cancel,
    remove,
    reveal,
    openDirectory,
  };
}
