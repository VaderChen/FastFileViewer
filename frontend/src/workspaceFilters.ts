import type { ImageEntry } from './types';

export type WorkspaceKindFilter = 'all' | 'image' | 'document';
export type WorkspaceSourceFilter = 'all' | 'file' | 'archive';

export function filterWorkspaceEntries(
  entries: ImageEntry[],
  query: string,
  kindFilter: WorkspaceKindFilter,
  sourceFilter: WorkspaceSourceFilter,
): ImageEntry[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return entries.filter((entry) => {
    if (kindFilter === 'image' && entry.kind !== 'image') {
      return false;
    }
    if (kindFilter === 'document' && entry.kind === 'image') {
      return false;
    }
    if (sourceFilter !== 'all' && entry.source !== sourceFilter) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    return [entry.name, entry.path, entry.directoryPath, entry.format]
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  });
}
