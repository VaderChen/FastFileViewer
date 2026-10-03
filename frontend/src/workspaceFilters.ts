import type { ImageEntry } from './types';

export type WorkspaceKindFilter = 'all' | 'image' | 'document' | 'media';
export type WorkspaceSourceFilter = 'all' | 'file' | 'archive';

export function filterWorkspaceEntries(
  entries: ImageEntry[],
  query: string,
  kindFilter: WorkspaceKindFilter,
  sourceFilter: WorkspaceSourceFilter,
): ImageEntry[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  // Keep a fresh result for every filter change: the workspace uses its identity
  // to invalidate pending duplicate detection, including whitespace-only edits.
  if (!normalizedQuery && kindFilter === 'all' && sourceFilter === 'all') {
    return entries.slice();
  }
  return entries.filter((entry) => {
    if (kindFilter === 'image' && entry.kind !== 'image') {
      return false;
    }
    if (kindFilter === 'document' && (entry.kind === 'image' || isMediaKindValue(entry.kind))) {
      return false;
    }
    if (kindFilter === 'media' && !isMediaKindValue(entry.kind)) {
      return false;
    }
    if (sourceFilter !== 'all' && entry.source !== sourceFilter) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    return entry.name.toLocaleLowerCase().includes(normalizedQuery)
      || entry.path.toLocaleLowerCase().includes(normalizedQuery)
      || entry.directoryPath.toLocaleLowerCase().includes(normalizedQuery)
      || entry.format.toLocaleLowerCase().includes(normalizedQuery);
  });
}

function isMediaKindValue(kind: ImageEntry['kind']): boolean {
  return kind === 'video' || kind === 'audio' || kind === 'subtitle';
}
