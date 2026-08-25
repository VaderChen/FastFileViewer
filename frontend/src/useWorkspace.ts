import { useEffect, useMemo, useRef, useState } from 'react';
import type { DuplicateGroup, ImageEntry } from './types';
import { filterWorkspaceEntries } from './workspaceFilters';
import type { WorkspaceKindFilter, WorkspaceSourceFilter } from './workspaceFilters';
import { extractErrorMessage, isOperationCancelled } from './operations';

// 一次算出 workspacePageSize 筆，捲動到底再逐批補上，避免大型圖庫一次渲染上萬張縮圖。
export const workspacePageSize = 120;

interface WorkspaceLabels {
  exportDestination: string;
  exportedSummary: string;
  noDuplicates: string;
  operationFailed: string;
}

interface UseWorkspaceOptions {
  libraryImages: ImageEntry[];
  labels: WorkspaceLabels;
}

function libraryService() {
  return window.go?.app?.App;
}

// useWorkspace 管理內容工作區的篩選、選取、分批載入，以及匯出與重複檔偵測這兩個可取消操作。
export function useWorkspace({ libraryImages, labels }: UseWorkspaceOptions) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<WorkspaceKindFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<WorkspaceSourceFilter>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [displayLimit, setDisplayLimit] = useState(workspacePageSize);
  const [loadTarget, setLoadTarget] = useState<number | null>(null);
  const operationRef = useRef<number | null>(null);

  const filteredImages = useMemo(
    () => filterWorkspaceEntries(libraryImages, query, kindFilter, sourceFilter),
    [libraryImages, kindFilter, query, sourceFilter],
  );
  const displayedImages = useMemo(
    () => filteredImages.slice(0, displayLimit),
    [filteredImages, displayLimit],
  );
  const selectedImages = useMemo(
    () => libraryImages.filter((image) => selectedIds.has(image.id)),
    [libraryImages, selectedIds],
  );

  // 圖庫重新掃描後，已消失的項目要從選取集合移除。
  useEffect(() => {
    const validIds = new Set(libraryImages.map((image) => image.id));
    setSelectedIds((current) => new Set(Array.from(current).filter((id) => validIds.has(id))));
  }, [libraryImages]);

  useEffect(() => {
    setDuplicateGroups([]);
    setDisplayLimit(workspacePageSize);
    setLoadTarget(null);
  }, [kindFilter, query, sourceFilter]);

  useEffect(() => {
    if (loadTarget === null) {
      return;
    }
    if (displayLimit >= loadTarget) {
      const timer = window.setTimeout(() => setLoadTarget(null), 320);
      return () => window.clearTimeout(timer);
    }
    const frame = window.requestAnimationFrame(() => {
      setDisplayLimit((current) => Math.min(loadTarget, current + workspacePageSize));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [displayLimit, loadTarget]);

  const toggleImage = (imageId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
        next.add(imageId);
      }
      return next;
    });
  };

  const selectImage = (imageId: string) => {
    setSelectedIds((current) => new Set(current).add(imageId));
  };

  const selectAllFiltered = () => {
    setSelectedIds((current) => new Set([...current, ...filteredImages.map((image) => image.id)]));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const loadMore = () => {
    setLoadTarget(Math.min(displayLimit + workspacePageSize, filteredImages.length));
  };

  const loadAll = () => {
    setLoadTarget(filteredImages.length);
  };

  const cancelLoadMore = () => {
    setLoadTarget(null);
  };

  // runOperation 統一處理忙碌旗標、操作編號與取消後不覆寫訊息的規則。
  const runOperation = async (task: (operationId: number) => Promise<string>) => {
    setBusy(true);
    setMessage('');
    try {
      const operationId = await libraryService()?.BeginOperation?.() ?? 0;
      operationRef.current = operationId;
      const result = await task(operationId);
      if (result) {
        setMessage(result);
      }
    } catch (error) {
      if (!isOperationCancelled(error)) {
        setMessage(extractErrorMessage(error, labels.operationFailed));
      }
    } finally {
      operationRef.current = null;
      setBusy(false);
    }
  };

  const exportSelected = async () => {
    if (selectedImages.length === 0) {
      return;
    }
    await runOperation(async (operationId) => {
      const result = await libraryService()?.ExportImages?.(selectedImages, labels.exportDestination, operationId);
      return result ? `${labels.exportedSummary}: ${result.exported.toLocaleString()} · ${result.destination}` : '';
    });
  };

  const detectDuplicates = async () => {
    if (filteredImages.length === 0) {
      return;
    }
    await runOperation(async (operationId) => {
      const groups = await libraryService()?.DetectDuplicates?.(filteredImages, operationId);
      setDuplicateGroups(groups ?? []);
      return groups && groups.length > 0 ? '' : labels.noDuplicates;
    });
  };

  const cancelOperation = () => {
    if (operationRef.current !== null) {
      void libraryService()?.CancelOperation?.(operationRef.current);
    }
  };

  return {
    open,
    setOpen,
    query,
    setQuery,
    kindFilter,
    setKindFilter,
    sourceFilter,
    setSourceFilter,
    selectedIds,
    selectedImages,
    filteredImages,
    displayedImages,
    duplicateGroups,
    busy,
    message,
    loadTarget,
    loadingMore: loadTarget !== null,
    toggleImage,
    selectImage,
    selectAllFiltered,
    clearSelection,
    loadMore,
    loadAll,
    cancelLoadMore,
    exportSelected,
    detectDuplicates,
    cancelOperation,
  };
}
