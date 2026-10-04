import type { ImageEntry, LibraryNode } from './types';

// Only copy children when a descendant actually changes.
function transformLibraryTree(node: LibraryNode, update: (node: LibraryNode) => LibraryNode): LibraryNode {
  const current = update(node);
  let children = current.children;
  for (let index = 0; index < current.children.length; index++) {
    const child = transformLibraryTree(current.children[index], update);
    if (child !== current.children[index]) {
      if (children === current.children) children = current.children.slice();
      children[index] = child;
    }
  }
  return children === current.children ? current : { ...current, children };
}

function removeImages(images: ImageEntry[], shouldRemove: (entry: ImageEntry) => boolean): ImageEntry[] {
  const first = images.findIndex(shouldRemove);
  if (first < 0) return images;
  const kept = images.slice(0, first);
  for (let index = first + 1; index < images.length; index++) {
    if (!shouldRemove(images[index])) kept.push(images[index]);
  }
  return kept;
}

const entryNameCollator = new Intl.Collator(undefined, { numeric: true });

// replaceLibraryEntry 只複製實際受影響的分支，未變動的陣列也保留原參考。
export function replaceLibraryEntry(node: LibraryNode, replacedEntryId: string, replacement: ImageEntry): LibraryNode {
  const matches = (entry: ImageEntry) => entry.id === replacedEntryId;
  return transformLibraryTree(node, (current) => {
    const replacedIndex = current.images.findIndex(matches);
    if (replacedIndex < 0) return current;
    const images = current.images.slice();
    images[replacedIndex] = replacement;
    return { ...current, images };
  });
}

export function removeLibraryEntries(node: LibraryNode, removedEntryIds: ReadonlySet<string>): LibraryNode {
  if (removedEntryIds.size === 0) return node;
  const shouldRemove = (entry: ImageEntry) => removedEntryIds.has(entry.id);
  return transformLibraryTree(node, (current) => {
    const images = removeImages(current.images, shouldRemove);
    return images === current.images ? current : { ...current, images };
  });
}

// 同批掃描結果只遍歷一次樹，未受影響的分支維持參考相等性。
export function mergeScannedNodes(current: LibraryNode, scanned: LibraryNode[]): LibraryNode {
  if (scanned.length === 0) return current;
  const updates = new Map(scanned.map((node) => [node.id, node]));
  return transformLibraryTree(current, (node) => {
    const replacement = updates.get(node.id);
    if (!replacement) return node;
    const existingChildren = new Map(node.children.map((child) => [child.id, child]));
    let children = replacement.children;
    for (let index = 0; index < replacement.children.length; index++) {
      const child = replacement.children[index];
      const existing = existingChildren.get(child.id);
      if (existing && child.kind === 'directory' && !child.scanned) {
        if (children === replacement.children) children = replacement.children.slice();
        children[index] = { ...child, scanned: existing.scanned, images: existing.images, children: existing.children };
      }
    }
    return { ...replacement, children };
  });
}

// A move removes the old entry and inserts it only into its actual destination.
export function moveLibraryEntry(node: LibraryNode, oldId: string, replacement: ImageEntry): LibraryNode {
  const removeOld = (entry: ImageEntry) => entry.id === oldId;
  const removeAtDestination = (entry: ImageEntry) => entry.id === oldId || entry.id === replacement.id;
  return transformLibraryTree(node, (current) => {
    const destination = current.kind === 'directory' && current.path === replacement.directoryPath;
    let images = removeImages(current.images, destination ? removeAtDestination : removeOld);
    if (destination) {
      if (images === current.images) images = images.slice();
      images.push(replacement);
      images.sort((a, b) => entryNameCollator.compare(a.name, b.name));
    }
    return images === current.images ? current : { ...current, images };
  });
}

export interface LibraryEntryMove {
  oldId: string;
  replacement: ImageEntry;
}

// Apply a completed batch in one traversal, preserving sequential move semantics.
export function moveLibraryEntries(node: LibraryNode, moves: readonly LibraryEntryMove[]): LibraryNode {
  if (moves.length === 0) return node;
  if (moves.length === 1) return moveLibraryEntry(node, moves[0].oldId, moves[0].replacement);
  const lastRemoval = new Map<string, number>();
  const destinations = new Map<string, Map<string, { replacement: ImageEntry; index: number }>>();
  moves.forEach(({ oldId, replacement }, index) => {
    lastRemoval.set(oldId, index);
    let entries = destinations.get(replacement.directoryPath);
    if (!entries) destinations.set(replacement.directoryPath, entries = new Map());
    // Reinsert repeated identities so stable equal-name ordering follows the last move.
    entries.delete(replacement.id);
    entries.set(replacement.id, { replacement, index });
  });
  const removeOld = (entry: ImageEntry) => lastRemoval.has(entry.id);
  return transformLibraryTree(node, (current) => {
    const additions = current.kind === 'directory' ? destinations.get(current.path) : undefined;
    const shouldRemove = additions ? (entry: ImageEntry) => removeOld(entry) || additions.has(entry.id) : removeOld;
    let images = removeImages(current.images, shouldRemove);
    if (additions) {
      if (images === current.images) images = images.slice();
      for (const { replacement, index } of additions.values()) {
        if ((lastRemoval.get(replacement.id) ?? -1) <= index) images.push(replacement);
      }
      images.sort((a, b) => entryNameCollator.compare(a.name, b.name));
    }
    return images === current.images ? current : { ...current, images };
  });
}

// Validate persisted trees before recursive render/search helpers consume them.
export function isLibraryTree(value: unknown): value is LibraryNode {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  const nodeIds = new Set<string>();
  const imageIds = new Set<string>();
  const entryKinds = new Set(['image', 'text', 'markdown', 'code', 'pdf', 'video', 'audio', 'subtitle', 'model']);
  const record = (item: unknown): item is Record<string, unknown> =>
    item !== null && typeof item === 'object' && !Array.isArray(item);
  const nonEmptyString = (item: unknown): item is string => typeof item === 'string' && item.length > 0;
  while (pending.length) {
    const { value: node, depth } = pending.pop()!;
    if (depth > 256 || !record(node)
      || !nonEmptyString(node.id) || nodeIds.has(node.id)
      || typeof node.name !== 'string' || !nonEmptyString(node.path)
      || (node.kind !== 'directory' && node.kind !== 'archive')
      || typeof node.scanned !== 'boolean'
      || !Array.isArray(node.images) || !Array.isArray(node.children)) return false;
    nodeIds.add(node.id);
    for (const entry of node.images) {
      if (!record(entry) || !nonEmptyString(entry.id) || imageIds.has(entry.id)
        || typeof entry.name !== 'string' || !nonEmptyString(entry.path)
        || typeof entry.directoryPath !== 'string' || typeof entry.format !== 'string'
        || typeof entry.kind !== 'string' || !entryKinds.has(entry.kind)
        || typeof entry.size !== 'number' || !Number.isFinite(entry.size) || entry.size < 0
        || (entry.source !== 'file' && entry.source !== 'archive')
        || (entry.source === 'archive' && (!nonEmptyString(entry.archivePath) || !nonEmptyString(entry.innerPath)))) return false;
      imageIds.add(entry.id);
    }
    for (const child of node.children) pending.push({ value: child, depth: depth + 1 });
  }
  return true;
}
