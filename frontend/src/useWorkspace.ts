import { useEffect, useMemo, useRef, useState } from 'react';
import type { DuplicateGroup, ImageEntry, FileOperationFailure } from './types';
import { filterWorkspaceEntries } from './workspaceFilters';
import type { WorkspaceKindFilter, WorkspaceSourceFilter } from './workspaceFilters';
import { extractErrorMessage, isOperationCancelled } from './operations';
import type { LibraryEntryMove } from './libraryTree';

// 一次算出 workspacePageSize 筆，捲動到底再逐批補上，避免大型圖庫一次渲染上萬張縮圖。
export const workspacePageSize = 120;

interface WorkspaceLabels {
  exportDestination: string;
  exportedSummary: string;
  noDuplicates: string;
  operationFailed: string;
  trashSelected?: string;
  moveSelected?: string;
  chooseMoveDestination?: string;
  trashConfirm?: string;
  trashDialogTitle?: string;
  trashConfirmButton?: string;
  cancel?: string;
  movedSummary?: string;
}

interface UseWorkspaceOptions {
  libraryImages: ImageEntry[];
  labels: WorkspaceLabels;
  onEntriesRemoved?: (ids: string[]) => void;
  onEntryMoved?: (oldId: string, replacement: ImageEntry) => void;
  onEntriesMoved?: (moves: LibraryEntryMove[]) => void;
}

function libraryService() {
  return window.go?.app?.App;
}

function fileService() {
  return window.go?.app?.FileService;
}

// useWorkspace 管理內容工作區的篩選、選取、分批載入，以及匯出與重複檔偵測這兩個可取消操作。
export function useWorkspace({ libraryImages, labels, onEntriesRemoved, onEntryMoved, onEntriesMoved }: UseWorkspaceOptions) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<WorkspaceKindFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<WorkspaceSourceFilter>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectionAnchorId, setSelectionAnchorId] = useState('');
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [displayLimit, setDisplayLimit] = useState(workspacePageSize);
  const [loadTarget, setLoadTarget] = useState<number | null>(null);
  const operationRef = useRef<{ id: number; cancelled: boolean } | null>(null);

  const filteredImages = useMemo(
    () => filterWorkspaceEntries(libraryImages, query, kindFilter, sourceFilter),
    [libraryImages, kindFilter, query, sourceFilter],
  );
  const filteredImagesRef = useRef(filteredImages);
  filteredImagesRef.current = filteredImages;
  const displayedImages = useMemo(
    () => filteredImages.slice(0, displayLimit),
    [filteredImages, displayLimit],
  );
  const selectedImages = useMemo(
    () => selectedIds.size ? libraryImages.filter((image) => selectedIds.has(image.id)) : [],
    [libraryImages, selectedIds],
  );

  // 圖庫重新掃描後，已消失的項目要從選取集合移除。
  useEffect(() => {
    setSelectedIds((current) => {
      if (!current.size) return current;
      const valid = new Set<string>();
      for (let index = 0; index < libraryImages.length; index++) {
        const image = libraryImages[index];
        if (current.has(image.id)) valid.add(image.id);
        if (valid.size === current.size) return current;
      }
      const next = new Set<string>();
      current.forEach((id) => { if (valid.has(id)) next.add(id); });
      return next;
    });
  }, [libraryImages]);

  useEffect(() => {
    setDuplicateGroups([]);
  }, [filteredImages]);

  useEffect(() => {
    setDisplayLimit(workspacePageSize);
    setLoadTarget(null);
  }, [kindFilter, query, sourceFilter]);

  useEffect(() => {
    if (loadTarget === null) {
      return;
    }
    if (loadTarget > filteredImages.length) {
      setLoadTarget(filteredImages.length);
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
  }, [displayLimit, filteredImages.length, loadTarget]);

  const toggleImage = (imageId: string, options?: { toggle?: boolean; range?: boolean }) => {
    setSelectedIds((current) => {
      if (options?.range && selectionAnchorId) {
        const anchorIndex = filteredImages.findIndex((image) => image.id === selectionAnchorId);
        const targetIndex = filteredImages.findIndex((image) => image.id === imageId);
        if (anchorIndex >= 0 && targetIndex >= 0) {
          const start = Math.min(anchorIndex, targetIndex);
          const end = Math.max(anchorIndex, targetIndex);
          const next = new Set<string>();
          for (let index = start; index <= end; index++) next.add(filteredImages[index].id);
          return next;
        }
      }
      const next = new Set(current);
      if (next.has(imageId) && (options?.toggle || !options?.range)) {
        next.delete(imageId);
      } else {
        next.add(imageId);
      }
      return next;
    });
    if (!options?.range) {
      setSelectionAnchorId(imageId);
    }
  };

  const selectImage = (imageId: string) => {
    setSelectedIds((current) => current.has(imageId) ? current : new Set(current).add(imageId));
  };

  const selectAllFiltered = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (let index = 0; index < filteredImages.length; index++) next.add(filteredImages[index].id);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setSelectionAnchorId('');
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

  // 先保留操作身分，再向後端取得編號，避免快速點擊或等待編號時的取消遺失。
  const runOperation = async (task: (operationId: number, isCurrent: () => boolean) => Promise<string>) => {
    if (operationRef.current) return;
    const operation = { id: 0, cancelled: false };
    operationRef.current = operation;
    const service = libraryService();
    const isCurrent = () => operationRef.current === operation && !operation.cancelled;
    setBusy(true);
    setMessage('');
    try {
      operation.id = await service?.BeginOperation?.() ?? 0;
      if (!isCurrent()) {
        if (operation.id) await service?.CancelOperation?.(operation.id);
        return;
      }
      const result = await task(operation.id, isCurrent);
      if (result && isCurrent()) {
        setMessage(result);
      }
    } catch (error) {
      if (isCurrent() && !isOperationCancelled(error)) {
        setMessage(extractErrorMessage(error, labels.operationFailed));
      }
    } finally {
      if (operation.id) {
        try { await service?.FinishOperation?.(operation.id); } catch { /* Preserve the original operation result. */ }
      }
      if (operationRef.current === operation) {
        operationRef.current = null;
        setBusy(false);
      }
    }
  };

  useEffect(() => () => {
    const operation = operationRef.current;
    if (!operation) return;
    operation.cancelled = true;
    operationRef.current = null;
    if (operation.id) {
      void libraryService()?.CancelOperation?.(operation.id).catch(() => undefined);
    }
  }, []);

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
    await runOperation(async (operationId, isCurrent) => {
      const groups = await libraryService()?.DetectDuplicates?.(filteredImages, operationId);
      if (!isCurrent() || filteredImagesRef.current !== filteredImages) return '';
      setDuplicateGroups(groups ?? []);
      return groups && groups.length > 0 ? '' : labels.noDuplicates;
    });
  };

  const trashSelected = async () => {
    if (selectedImages.length === 0) return;
    await runOperation(async () => {
      const result = await fileService()?.ConfirmTrashEntries?.(
        selectedImages.map((image) => image.path),
        labels.trashDialogTitle ?? '',
        labels.trashConfirm ?? '',
        labels.trashConfirmButton ?? '',
        labels.cancel ?? '',
      );
      const ids = result?.removedIds ?? [];
      if (ids.length) {
        onEntriesRemoved?.(ids);
        setSelectedIds((current) => {
          if (!current.size) return current;
          const removedIds = new Set(ids);
          const next = new Set<string>();
          current.forEach((id) => { if (!removedIds.has(id)) next.add(id); });
          return next;
        });
      }
      return operationSummary(labels.trashSelected ? `${labels.trashSelected}: ${ids.length}` : '', result?.failed);
    });
  };

  const moveSelected = async () => {
    if (selectedImages.length === 0) return;
    await runOperation(async (_operationId, isCurrent) => {
      const destination = await fileService()?.SelectMoveDestination?.(labels.chooseMoveDestination ?? '選擇移動目的地');
      if (!destination || !isCurrent()) return '';
      const result = await fileService()?.MoveEntries?.(selectedImages.map((image) => image.path), destination);
      const moves: LibraryEntryMove[] = [];
      for (const moved of result?.moved ?? []) {
        const originalId = result?.originalIds[moved.id];
        if (originalId) moves.push({ oldId: originalId, replacement: moved });
      }
      if (moves.length && onEntriesMoved) onEntriesMoved(moves);
      else for (const { oldId, replacement } of moves) onEntryMoved?.(oldId, replacement);
      return operationSummary(result?.moved?.length && labels.movedSummary ? `${labels.movedSummary}: ${result.moved.length}` : '', result?.failed);
    });
  };

  const trashDuplicateGroup = async (group: DuplicateGroup, keepID: string) => {
    const targets = group.images.filter((image) => image.id !== keepID);
    if (!targets.length) return;
    await runOperation(async () => {
      const result = await fileService()?.ConfirmTrashEntries?.(
        targets.map((image) => image.path),
        labels.trashDialogTitle ?? '',
        labels.trashConfirm ?? '',
        labels.trashConfirmButton ?? '',
        labels.cancel ?? '',
      );
      const ids = result?.removedIds ?? [];
      if (ids.length) onEntriesRemoved?.(ids);
      const removedIds = new Set(ids);
      setDuplicateGroups((groups) => groups.map((item) => item === group ? { ...item, images: item.images.filter((image) => !removedIds.has(image.id)) } : item).filter((item) => item.images.length > 1));
      return operationSummary(labels.trashSelected ? `${labels.trashSelected}: ${ids.length}` : '', result?.failed);
    });
  };

  const cancelOperation = () => {
    const operation = operationRef.current;
    if (!operation) return;
    operation.cancelled = true;
    if (operation.id) {
      void libraryService()?.CancelOperation?.(operation.id).catch(() => undefined);
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
    trashSelected,
    moveSelected,
    trashDuplicateGroup,
    cancelOperation,
  };
}

function operationSummary(summary: string, failures: FileOperationFailure[] = []): string {
  return [summary, ...failures.map((failure) => failure.path + ': ' + failure.error)].filter(Boolean).join('\n');
}
