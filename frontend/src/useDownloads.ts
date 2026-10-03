import { useEffect, useRef, useState } from 'react';
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
  const lifecycleRef = useRef({ mounted: true, generation: 0 });
  const submittingRef = useRef<object | null>(null);
  const selectionSubmittingRef = useRef<object | null>(null);
  const refreshRef = useRef<Promise<void> | null>(null);
  const refreshSequenceRef = useRef(0);
  const currentResolution = pendingResolutions[0] ?? null;
  const hasActiveDownload = downloads.some((item) => item.status === 'queued' || item.status === 'downloading');

  const isCurrent = (generation: number) => lifecycleRef.current.mounted && lifecycleRef.current.generation === generation;

  const refresh = (force = false): Promise<void> => {
    // 慢速輪詢只保留一個要求；操作完成後可強制重讀，且舊回應不能覆蓋新狀態。
    if (!lifecycleRef.current.mounted) return Promise.resolve();
    if (refreshRef.current && !force) return refreshRef.current;
    const sequence = ++refreshSequenceRef.current;
    const generation = lifecycleRef.current.generation;
    const request = (async () => {
      const items = await downloadService()?.ListDownloads?.();
      if (items && isCurrent(generation) && sequence === refreshSequenceRef.current) setDownloads(items);
    })().finally(() => {
      if (refreshRef.current === request) refreshRef.current = null;
    });
    refreshRef.current = request;
    return request;
  };

  const reportError = (error: unknown, generation: number) => {
    if (isCurrent(generation)) onError(extractErrorMessage(error, operationFailedLabel));
  };

  useEffect(() => {
    const firstCandidate = currentResolution?.candidates[0];
    setSelectedHLSURLs(new Set(firstCandidate ? [firstCandidate.url] : []));
  }, [currentResolution]);

  useEffect(() => {
    lifecycleRef.current.mounted = true;
    void refresh().catch(() => undefined);
    return () => {
      lifecycleRef.current.mounted = false;
      lifecycleRef.current.generation++;
      submittingRef.current = null;
      selectionSubmittingRef.current = null;
      refreshRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!panelVisible && !hasActiveDownload) {
      return;
    }
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 750);
    return () => window.clearInterval(timer);
  }, [hasActiveDownload, panelVisible]);

  const submitURLs = async (rawValues: string[]) => {
    const urls = Array.from(new Set(rawValues.flatMap(extractDownloadURLs)));
    if (urls.length === 0 || submittingRef.current || !lifecycleRef.current.mounted) {
      return;
    }
    const submission = {};
    const generation = lifecycleRef.current.generation;
    const submittedInput = downloadURL;
    submittingRef.current = submission;
    setSubmitting(true);
    onError('');
    const failures: string[] = [];
    const resolutionsForSelection: DownloadResolution[] = [];
    for (const url of urls) {
      if (!isCurrent(generation)) break;
      try {
        const service = downloadService();
        if (shouldResolveDownloadPage(url) && service?.ResolveDownloadURL) {
          const resolution = await service.ResolveDownloadURL(url);
          if (!isCurrent(generation)) break;
          if (resolution.candidates.length > 1) {
            resolutionsForSelection.push(resolution);
            continue;
          }
          if (resolution.candidates.length === 1 && service.StartResolvedDownload) {
            await service.StartResolvedDownload(resolution.sourceUrl, resolution.candidates[0].url, resolution.name);
            continue;
          }
        }
        if (!service?.StartDownload) throw new Error(operationFailedLabel);
        await service.StartDownload(url);
      } catch (error) {
        failures.push(extractErrorMessage(error, operationFailedLabel));
      }
    }
    if (!isCurrent(generation)) return;
    if (resolutionsForSelection.length > 0) {
      setPendingResolutions((current) => [...current, ...resolutionsForSelection]);
    }
    await refresh(true).catch(() => undefined);
    if (!isCurrent(generation) || submittingRef.current !== submission) return;
    submittingRef.current = null;
    setSubmitting(false);
    setDownloadURL((current) => current === submittedInput ? '' : current);
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
    if (selectionSubmittingRef.current) {
      return;
    }
    setPendingResolutions((current) => current.slice(1));
  };

  const confirmHLSSelection = async () => {
    if (!currentResolution || selectedHLSURLs.size === 0 || selectionSubmittingRef.current || !lifecycleRef.current.mounted) {
      return;
    }
    const submission = {};
    const generation = lifecycleRef.current.generation;
    selectionSubmittingRef.current = submission;
    setSelectionSubmitting(true);
    onError('');
    const failures: string[] = [];
    for (const candidate of currentResolution.candidates) {
      if (!isCurrent(generation)) break;
      if (!selectedHLSURLs.has(candidate.url)) {
        continue;
      }
      try {
        const service = downloadService();
        if (!service?.StartResolvedDownload) throw new Error(operationFailedLabel);
        await service.StartResolvedDownload(currentResolution.sourceUrl, candidate.url, currentResolution.name);
      } catch (error) {
        failures.push(extractErrorMessage(error, operationFailedLabel));
      }
    }
    if (!isCurrent(generation)) return;
    await refresh(true).catch(() => undefined);
    if (!isCurrent(generation) || selectionSubmittingRef.current !== submission) return;
    selectionSubmittingRef.current = null;
    setSelectionSubmitting(false);
    setPendingResolutions((current) => current[0] === currentResolution ? current.slice(1) : current);
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
    const generation = lifecycleRef.current.generation;
    try {
      await downloadService()?.CancelDownload?.(id);
      if (isCurrent(generation)) await refresh(true);
    } catch (error) {
      reportError(error, generation);
    }
  };

  const remove = async (id: string) => {
    const generation = lifecycleRef.current.generation;
    try {
      await downloadService()?.RemoveDownload?.(id);
      if (isCurrent(generation)) await refresh(true);
    } catch (error) {
      reportError(error, generation);
    }
  };

  const reveal = async (id: string) => {
    const generation = lifecycleRef.current.generation;
    try {
      await downloadService()?.RevealDownload?.(id);
    } catch (error) {
      reportError(error, generation);
    }
  };

  const openDirectory = async () => {
    const generation = lifecycleRef.current.generation;
    try {
      await downloadService()?.OpenDownloadsDirectory?.();
    } catch (error) {
      reportError(error, generation);
    }
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
